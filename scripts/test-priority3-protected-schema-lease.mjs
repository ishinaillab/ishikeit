import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {
  validateSchemaReleaseConfig,assertExactRemotePrefix,assertLiveMigrationAccepted,
  runProtectedSchemaRelease,migrationCliEnvironment,pushReviewedMigration
} from "./priority3-protected-schema-lease.mjs";

const cfg={
  appSha:"a".repeat(40),dbSha:"b".repeat(40),operation:"apply"
};
const versions=[...Array.from({length:44},(_,i)=>
  "202610"+String(i+1).padStart(8,"0")),"20261118222000"];
function fake({count=44,guard=true,canAcquire=true,canRenew=true,
  expired=true,allowResolve=true,denyHeadsAt=0}={}){
  let headCount=0;
  const state={count,guard,started:0,armCalled:0,released:0,
    resolved:0,acquired:0,renewed:0,sql:[],eventOrder:[],
    pending:false,leaseActive:false,completed:false};
  const db={async query(sql,params=[]){
    state.sql.push(sql);
    if(sql.startsWith("SELECT version FROM supabase_migrations"))
      return {rows:versions.slice(0,state.count).map(version=>({version}))};
    if(sql.includes("AS guard_version"))
      return {rows:[{total:state.count,guard_version:state.guard,
        guard_enabled:state.guard}]};
    if(sql.startsWith("UPDATE public.ishikeit_release_ownership")){
      // These reconciliation updates must never resolve a wrong-kind,
      // active-holder, or wrong-SHA migration.
      assert.match(sql,/pending_external_step='schema_migration'/u);
      assert.deepEqual(params.slice(0,3),
        ["ishikeit_priority3_production",cfg.appSha,cfg.dbSha]);
      if(!state.pending||!allowResolve)return {rows:[]};
      if(params.length===3&&(!expired||state.leaseActive))return {rows:[]};
      if(params.length>3&&(!state.leaseActive||!state.armedValid))return {rows:[]};
      state.resolved++;
      state.pending=false;
      state.completed=true;
      return {rows:[{generation:2}]};
    }
    throw Error("Unexpected mocked SQL: "+sql.slice(0,100));
  }};
  const fence={
    async acquire(cmd){
      state.eventOrder.push("acquire");
      state.acquired++;
      assert.equal(cmd.scope,"ishikeit_priority3_production");
      assert.equal(cmd.appMainSha,cfg.appSha);
      assert.equal(cmd.dbMainSha,cfg.dbSha);
      assert.equal(cmd.ttlSeconds,900);
      assert.match(cmd.holderSecret,/^[A-Za-z0-9_-]{43}$/u);
      if(!canAcquire)return undefined;
      state.leaseActive=true;return {generation:1};
    },
    async check(){
      state.eventOrder.push("check");return state.leaseActive;
    },
    async beginExternalStep(ticket){
      state.eventOrder.push("arm");
      state.armCalled++;
      assert.equal(ticket.step,"schema_migration");
      if(!state.leaseActive)return false;
      state.pending=true;state.armedValid=true;
      return true;
    },
    async renew(){
      state.renewed++;
      return canRenew?{generation:1}:undefined;
    },
    async release(){
      state.released++;
      state.eventOrder.push("release");
      if(state.pending)throw Error("Unsafe release of armed migration");
      state.leaseActive=false;return true;
    }
  };
  const readbackHeads=async()=>{
    headCount++;
    state.eventOrder.push("heads");
    if(headCount===denyHeadsAt)throw Error("Protected GitHub main changed");
  };
  const applyMigration=async()=>{
    state.started++;
    state.eventOrder.push("provider_submit");
    assert.equal(state.pending,true,"Must durably arm before CLI submission");
    state.count=45;
  };
  return {db,fence,state,readbackHeads,applyMigration};
}

test("protected schema release only allows apply/reconcile exact protected SHA identity",()=>{
  assert.deepEqual(validateSchemaReleaseConfig(cfg),cfg);
  for(const c of [
    {...cfg,appSha:"invalid"},{...cfg,dbSha:"main"},
    {...cfg,operation:"preflight"},{...cfg,operation:"verify"}
  ])assert.throws(()=>validateSchemaReleaseConfig(c));
});

test("successful SQL release arms durable hold before invoking non-idempotent provider CLI",async()=>{
  const fixture=fake();
  const result=await runProtectedSchemaRelease({
    cfg,versions,...fixture});
  assert.equal(result.status,"applied");
  assert.equal(fixture.state.started,1);
  assert.equal(fixture.state.armCalled,1);
  assert.equal(fixture.state.resolved,1);
  assert.equal(fixture.state.released,0);
  assert.equal(fixture.state.pending,false);
  assert.ok(fixture.state.eventOrder.indexOf("arm")<
    fixture.state.eventOrder.indexOf("provider_submit"));
  assert.equal(fixture.state.renewed,1);
});

test("old/mismatched migration prefix fails before lease or external mutation",async()=>{
  for(const count of [43,45]){
    const f=fake({count});
    await assert.rejects(runProtectedSchemaRelease({cfg,versions,...f}),
      /migration history\/prefix/i);
    assert.equal(f.state.acquired,0);
    assert.equal(f.state.started,0);
    assert.equal(f.state.armCalled,0);
  }
});
test("concurrent release owner denies migration without retrying CLI",async()=>{
  const f=fake({canAcquire:false});
  await assert.rejects(runProtectedSchemaRelease({cfg,versions,...f}),
    /another release owns/i);
  assert.equal(f.state.started,0);
  assert.equal(f.state.resolved,0);
});
test("GitHub main mismatch before arm releases only unarmed lease",async()=>{
  const f=fake({denyHeadsAt:3});
  await assert.rejects(runProtectedSchemaRelease({cfg,versions,...f}),
    /main changed/i);
  assert.equal(f.state.acquired,1);
  assert.equal(f.state.armCalled,0);
  assert.equal(f.state.released,1);
  assert.equal(f.state.started,0);
});
test("an ambiguous provider CLI timeout preserves the migration hold",async()=>{
  const f=fake();
  await assert.rejects(runProtectedSchemaRelease({cfg,versions,...f,
    applyMigration:async()=>{
      f.state.started++;
      assert.equal(f.state.pending,true);
      throw Error("simulated provider timeout");
    }}),/provider timeout/i);
  assert.equal(f.state.armCalled,1);
  assert.equal(f.state.started,1);
  assert.equal(f.state.released,0);
  assert.equal(f.state.resolved,0);
  assert.equal(f.state.pending,true);
});
test("a completed CLI with disabled database guard retains unresolved hold",async()=>{
  const f=fake({guard:false});
  await assert.rejects(runProtectedSchemaRelease({cfg,versions,...f}),
    /native outbox write-fence migration 45\/45/i);
  assert.equal(f.state.started,1);
  assert.equal(f.state.resolved,0);
  assert.equal(f.state.released,0);
  assert.equal(f.state.pending,true);
});
test("failed lease renewal after genuine readback retains schema external hold",async()=>{
  const f=fake({canRenew:false});
  await assert.rejects(runProtectedSchemaRelease({cfg,versions,...f}),
    /lease expired/i);
  assert.equal(f.state.started,1);
  assert.equal(f.state.pending,true);
  assert.equal(f.state.resolved,0);
});
test("owner-approved recovery only reconciles verified 45/45 without provider retry",async()=>{
  const f=fake({count:45});
  f.state.pending=true;
  const result=await runProtectedSchemaRelease({
    cfg:{...cfg,operation:"reconcile"},versions,...f
  });
  assert.equal(result.status,"reconciled");
  assert.equal(f.state.started,0);
  assert.equal(f.state.acquired,0);
  assert.equal(f.state.resolved,1);
});
test("reconciliation denies incomplete schema, active holder, or wrong release SHAs",async()=>{
  for(const options of [
    {count:44},{count:45,expired:false,canAcquire:true},{count:45,allowResolve:false},
    {count:45,guard:false}
  ]){
    const f=fake(options);f.state.pending=true;
    await assert.rejects(runProtectedSchemaRelease({
      cfg:{...cfg,operation:"reconcile"},versions,...f
    }),/migration|hold|native/i);
    assert.equal(f.state.started,0);
    assert.equal(f.state.resolved,0);
  }
});
test("live schema accepted requires exact version history AND enabled native guard",async()=>{
  const f=fake({count:45,guard:true});
  await assert.doesNotReject(assertLiveMigrationAccepted(f.db,versions));
  f.state.guard=false;
  await assert.rejects(assertLiveMigrationAccepted(f.db,versions),
    /native outbox/i);
});
test("refuses untrusted or partial migration catalog",async()=>{
  const f=fake({count:44});
  await assert.doesNotReject(assertExactRemotePrefix(f.db,versions,44));
  await assert.rejects(assertExactRemotePrefix(f.db,versions,45),
    /prefix mismatched/i);
});

test("Supabase CLI subprocess receives only runtime essentials and no owner credentials",async()=>{
  const parent={
    PATH:"/usr/local/bin:/usr/bin",HOME:"/tmp/home",CI:"true",
    PGSSLMODE:"disable",GITHUB_TOKEN:"redacted-unrelated",
    ISHIKEIT_GITHUB_READBACK_TOKEN:"redacted-github",
    ISHIKEIT_HOSTINGER_API_TOKEN:"redacted-hostinger",
    ISHIKEIT_DATABASE_URL:"redacted-db",
    DATABASE_URL:"redacted-parent-db",
    SUPABASE_ACCESS_TOKEN:"redacted-supabase",
    SUPABASE_SECRET_KEY:"redacted-service",
    NODE_ENV:"production",ISHIKEIT_RELEASE_APP_SHA:"redacted-app-sha",
    PGUSER:"unapproved",PGPASSWORD:"redacted-pg-password"
  };
  const target="postgres://test:synthetic@localhost:5432/postgres";
  let call;
  const fakeSpawn=(command,args,options)=>{
    call={command,args,options};
    const emitter=new EventEmitter();
    process.nextTick(()=>emitter.emit("close",0,null));
    return emitter;
  };
  await pushReviewedMigration("db-release",target,{
    spawnProcess:fakeSpawn,environment:parent
  });
  assert.equal(call.command,"supabase");
  assert.deepEqual(call.args,[
    "db","push","--yes","--skip-vault","--remote="+target
  ]);
  assert.equal(call.options.cwd,"db-release");
  assert.equal(call.options.shell,false);
  assert.equal(call.options.stdio,"ignore");
  assert.equal(call.options.env.PGSSLMODE,"require");
  assert.equal(call.options.env.PATH,parent.PATH);
  assert.equal(call.options.env.HOME,parent.HOME);
  assert.equal(call.options.env.CI,"true");
  assert.deepEqual(Object.keys(call.options.env).sort(),
    ["PATH","HOME","CI","PGSSLMODE"].sort());
  for(const secret of [
    "GITHUB_TOKEN","ISHIKEIT_GITHUB_READBACK_TOKEN",
    "ISHIKEIT_HOSTINGER_API_TOKEN","DATABASE_URL","ISHIKEIT_DATABASE_URL",
    "SUPABASE_ACCESS_TOKEN","SUPABASE_SECRET_KEY","PGPASSWORD",
    "ISHIKEIT_RELEASE_APP_SHA"
  ])assert.equal(Object.hasOwn(call.options.env,secret),false);
});
test("Supabase CLI environment refuses inherited credentials and forces TLS",()=>{
  const env=migrationCliEnvironment({
    PATH:"/usr/bin",PGSSLMODE:"disable",SUPABASE_ACCESS_TOKEN:"hidden",
    GITHUB_ACTIONS:"true",TMPDIR:"/tmp",NODE_OPTIONS:"--require malicious.js"
  });
  assert.deepEqual(env,{PATH:"/usr/bin",TMPDIR:"/tmp",
    GITHUB_ACTIONS:"true",PGSSLMODE:"require"});
});
test("Supabase CLI failed or ambiguous subprocess exit is never accepted",async()=>{
  const target="postgres://test:synthetic@localhost:5432/postgres";
  for(const [code,signal] of [[1,null],[null,"SIGTERM"]]){
    const fakeSpawn=()=>{
      const emitter=new EventEmitter();
      process.nextTick(()=>emitter.emit("close",code,signal));
      return emitter;
    };
    await assert.rejects(pushReviewedMigration("db-release",target,{
      spawnProcess:fakeSpawn,environment:{PATH:"/usr/bin"}
    }),/result unknown/);
  }
});
