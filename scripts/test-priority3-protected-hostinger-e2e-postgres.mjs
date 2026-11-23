import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {run,createReleaseFence,reconcileHistoricalExternalStep} from "./priority3-protected-hostinger-release.mjs";

// This suite owns and deletes disposable PostgreSQL tables/roles. Never allow
// a shared or hosted URL, even when invoked outside the protected CI runner.
const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(url!==undefined){
  const parsed=new URL(url);
  if(!["postgres:","postgresql:"].includes(parsed.protocol)||
    !["127.0.0.1","localhost","::1"].includes(parsed.hostname)||
    parsed.pathname!=="/ishikeit_outbox_test"||
    parsed.search||parsed.hash)
    throw Error("Refusing Hostinger release end-to-end test outside disposable PG17");
}
if(url===undefined){
  test("Hostinger release SQL e2e requires disposable PostgreSQL",{skip:true},()=>{});
}else{
  const pool=new pg.Pool({connectionString:url,max:4,connectionTimeoutMillis:5000});
  const cfg={appSha:"a".repeat(40),dbSha:"b".repeat(40),
    oldSha:"c".repeat(40),oldUuid:"01a1d96f-bc54-70a0-ae01-504fa9a27c72"};
  const buildUuid="01a1e342-947f-70f3-b65e-144a94b21856";
  const install=buildUuid;
  const scope="ishikeit_priority3_production";
  const newStatus=()=>({uuid:buildUuid,status:"completed",sha:cfg.appSha,
    source:"git",originOwner:"ishinaillab",originRepo:"ishikeit",
    originBranch:"main",originInstallation:install});
  const oldStatus=()=>({uuid:cfg.oldUuid,status:"completed",sha:cfg.oldSha,
    source:"git",originOwner:"ishinaillab",originRepo:"ishikeit",
    originBranch:"main",originInstallation:cfg.oldUuid});
  let createdRoles=[];
  const db={query:(sql,args)=>pool.query(sql,args)};
  const fetcher=async url=>url.includes("api.github.com")?
    {status:200,json:async()=>({ref:"refs/heads/main",
    object:{type:"commit",sha:url.includes("ishikeit-db")?cfg.dbSha:cfg.appSha}})}:
    {status:200,json:async()=>({status:url.endsWith("/health/live")?"ok":"ready"})};
  const githubToken="test-only-github-readback-token-not-real";
  function api(overrides={}){
    const state={started:0,apiReadbacks:0};
    return {...state,
      async assertAutoOff(){state.apiReadbacks++},
      async disableAutoDeploy(){state.apiReadbacks++},
      async assertGitInstallationAccess(){state.apiReadbacks++},
      async assertBuildSettings(){state.apiReadbacks++},
      async latest(){return state.started?newStatus():oldStatus()},
      async get(uuid){assert.equal(uuid,buildUuid);return newStatus()},
      async start(){state.started++;return buildUuid},
      state,...overrides};
  }
  async function record(){
    const {rows}=await pool.query(
      "SELECT generation,holder_digest IS NULL AS released,pending_external_step,"+
      "verified_app_deploy_at IS NOT NULL AS verified FROM "+
      "public.ishikeit_release_ownership WHERE scope=$1",[scope]);
    return rows[0];
  }
  before(async()=>{
    const existing=await pool.query(
      "SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])",
      [["anon","authenticated"]]);
    const roles=new Set(existing.rows.map(row=>row.rolname));
    for(const role of ["anon","authenticated"]){
      if(roles.has(role))continue;
      await pool.query("CREATE ROLE "+role+" NOLOGIN");
      createdRoles.push(role);
    }
    for(const file of [
      "0001_foundation.sql","0010_ishikeit_workspace_connections.sql",
      "0012_ishikeit_event_tenant_provenance.sql",
      "0025_priority3_release_ownership_fence.sql",
      "0026_priority3_active_disconnect_quarantine.sql",
      "0027_priority3_tenant_send_generation_fence.sql",
      "0028_priority3_release_external_step_hold.sql",
      "0029_priority3_native_outbox_write_fence.sql"
    ])await pool.query(await readFile("migrations/"+file,"utf8"));
    await pool.query("CREATE SCHEMA supabase_migrations");
    await pool.query("CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY)");
    const versions=[...Array.from({length:44},(_,i)=>
      "202610"+String(i+1).padStart(8,"0")),"20261118222000"];
    await pool.query("INSERT INTO supabase_migrations.schema_migrations(version) "+
      "SELECT unnest($1::text[])",[versions]);
  });
  beforeEach(async()=>{
    await pool.query("TRUNCATE public.ishikeit_release_ownership");
    await pool.query(
      "ALTER TABLE public.outbox ENABLE TRIGGER ishikeit_native_outbox_write_fence");
  });
  after(async()=>{
    try{
      await pool.query("DROP SCHEMA IF EXISTS supabase_migrations CASCADE");
      await pool.query(
        "DROP TABLE IF EXISTS public.ishikeit_release_ownership,"+
        "public.ishikeit_active_disconnect_cleanup,"+
        "public.outbox,public.inbound_events,public.ishikeit_connection_audit,"+
        "public.ishikeit_account_connections,public.ishikeit_provider_accounts,"+
        "public.ishikeit_workspace_memberships,public.ishikeit_workspaces CASCADE");
      await pool.query(
        "DROP FUNCTION IF EXISTS public.ishikeit_guard_native_outbox_write()");
      for(const role of createdRoles.reverse())await pool.query("DROP ROLE "+role);
    }finally{await pool.end()}
  });

  test("live PG17 preflight is truly read-only and does not acquire a lease",async()=>{
    const seen=[];
    const tracked={query:(sql,args)=>{seen.push(sql);return pool.query(sql,args)}};
    const upstream=api();
    const result=await run({cfg:{...cfg,mode:"preflight"},db:tracked,api:upstream,
      fetcher,githubToken,log:()=>{}});
    assert.deepEqual(result,{mode:"preflight",buildUuid:null});
    assert.equal(upstream.state.started,0);
    assert.ok(seen.length>0&&seen.every(sql=>sql.startsWith("SELECT")),
      "All database preflight operations must be SELECT-only");
    assert.equal(await record(),undefined);
  });

  test("real PG17 single-owner lease arms before Hostinger POST and resolves exact build",async()=>{
    const upstream=api();
    upstream.start=async()=>{
      const row=await record();
      assert.equal(row?.pending_external_step,"app_deploy");
      assert.equal(row?.released,false);
      const competing=createReleaseFence((sql,args)=>pool.query(sql,args));
      await assert.rejects(competing.acquire(cfg),/Another release owns the lease/i);
      upstream.state.started++;
      return buildUuid;
    };
    const result=await run({cfg:{...cfg,mode:"deploy"},db,api:upstream,
      fetcher,githubToken,log:()=>{},sleep:async()=>{}});
    assert.deepEqual(result,{mode:"deployed",buildUuid});
    assert.equal(upstream.state.started,1);
    const row=await record();
    assert.equal(row?.released,true);
    assert.equal(row?.verified,true);
    assert.equal(row?.pending_external_step,null);
    assert.ok(Number(row.generation)>1);
  });

  test("unknown Hostinger outcome retains DB hold across expiration until genuine reconcile",async()=>{
    const upstream=api();
    upstream.start=async()=>{
      const row=await record();
      assert.equal(row?.pending_external_step,"app_deploy");
      upstream.state.started++;
      throw Error("Synthetic Hostinger response lost after build accepted");
    };
    await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db,api:upstream,
      fetcher,githubToken,log:()=>{}}),/response lost/i);
    assert.equal(upstream.state.started,1);
    assert.equal((await record())?.pending_external_step,"app_deploy");
    await pool.query(
      "UPDATE public.ishikeit_release_ownership "+
      "SET expires_at=clock_timestamp()-interval '1 second' WHERE scope=$1",
      [scope]);
    const competing=createReleaseFence((sql,args)=>pool.query(sql,args));
    await assert.rejects(competing.acquire(cfg),/Another release owns the lease/i);
    const restored=await run({cfg:{...cfg,mode:"reconcile"},db,api:upstream,
      fetcher,githubToken,log:()=>{}});
    assert.deepEqual(restored,{mode:"reconciled",buildUuid});
    assert.equal(upstream.state.started,1,"Reconcile must never re-send a Hostinger build");
    const row=await record();
    assert.equal(row?.pending_external_step,null);
    assert.equal(row?.verified,true);
    assert.equal(row?.released,true);
  });

  test("historical completion preserves six-digit microsecond CAS in real PG17",async()=>{
    const precise="2026-11-22 17:40:12.122779+00";
    const heldCfg={...cfg,appSha:"d".repeat(40),mode:"reconcile-historical",
      heldAppSha:cfg.oldSha};
    const build={...oldStatus(),originInstallation:install,
      createdAt:"2026-11-22T17:40:12Z"};
    await pool.query(
      "INSERT INTO public.ishikeit_release_ownership "+
      "(scope,generation,holder_digest,app_main_sha,db_main_sha,expires_at,"+
      "pending_external_step,pending_external_step_at) "+
      "VALUES($1,7,decode(repeat('ab',32),'hex'),$2,$3,"+
      "clock_timestamp()-interval '10 seconds','app_deploy',$4::timestamptz)",
      [scope,cfg.oldSha,cfg.dbSha,precise]);
    const pre=await pool.query(
      "SELECT pending_external_step_at::text AS exact,"+
      "pending_external_step_at=date_trunc('milliseconds',pending_external_step_at) "+
      "AS truncated_matches FROM public.ishikeit_release_ownership "+
      "WHERE scope=$1",[scope]);
    assert.equal(pre.rows[0].exact,precise);
    assert.equal(pre.rows[0].truncated_matches,false,
      "This regression must require microseconds beyond JS Date precision");
    await reconcileHistoricalExternalStep(db.query,heldCfg,build);
    const accepted=await record();
    assert.equal(Number(accepted.generation),8);
    assert.equal(accepted.released,true);
    assert.equal(accepted.pending_external_step,null);
    assert.equal(accepted.verified,true);
  });

  test("historical microsecond CAS rejects a concurrent one-microsecond change",async()=>{
    const precise="2026-11-22 17:40:12.122779+00";
    const heldCfg={...cfg,appSha:"d".repeat(40),mode:"reconcile-historical",
      heldAppSha:cfg.oldSha};
    const build={...oldStatus(),originInstallation:install,
      createdAt:"2026-11-22T17:40:12Z"};
    await pool.query(
      "INSERT INTO public.ishikeit_release_ownership "+
      "(scope,generation,holder_digest,app_main_sha,db_main_sha,expires_at,"+
      "pending_external_step,pending_external_step_at) "+
      "VALUES($1,7,decode(repeat('ab',32),'hex'),$2,$3,"+
      "clock_timestamp()-interval '10 seconds','app_deploy',$4::timestamptz)",
      [scope,cfg.oldSha,cfg.dbSha,precise]);
    let updates=0;
    const concurrent=async(sql,args)=>{
      if(sql.startsWith("UPDATE public.ishikeit_release_ownership SET "+
        "pending_external_step=NULL")){
        updates++;
        await pool.query(
          "UPDATE public.ishikeit_release_ownership "+
          "SET pending_external_step_at=pending_external_step_at+"+
          "interval '1 microsecond' WHERE scope=$1",[scope]);
      }
      return pool.query(sql,args);
    };
    await assert.rejects(reconcileHistoricalExternalStep(concurrent,heldCfg,build),
      /CAS changed/u);
    assert.equal(updates,1);
    const rejected=await record();
    assert.equal(Number(rejected.generation),7);
    assert.equal(rejected.released,false);
    assert.equal(rejected.pending_external_step,"app_deploy");
    assert.equal(rejected.verified,false);
  });

  test("expired hold cannot be cleared when hosted deployment has not been verified",async()=>{
    const upstream=api();
    upstream.start=async()=>{upstream.state.started++;throw Error("Synthetic unconfirmed POST")};
    await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db,api:upstream,
      fetcher,githubToken,log:()=>{}}),/unconfirmed POST/i);
    await pool.query(
      "UPDATE public.ishikeit_release_ownership "+
      "SET expires_at=clock_timestamp()-interval '1 second' WHERE scope=$1",
      [scope]);
    upstream.latest=async()=>({...oldStatus(),originInstallation:install});
    await assert.rejects(run({cfg:{...cfg,mode:"reconcile"},db,api:upstream,
      fetcher,githubToken,log:()=>{}}),/No completed deployed Hostinger build/i);
    const row=await record();
    assert.equal(row?.pending_external_step,"app_deploy");
    assert.equal(row?.released,false);
    assert.equal(row?.verified,false);
  });
}
