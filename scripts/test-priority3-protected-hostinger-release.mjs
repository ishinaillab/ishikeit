import test from "node:test";
import assert from "node:assert/strict";
import {Buffer} from "node:buffer";
import {
  validateConfig,validateDatabaseUrl,parseBuild,assertBuildOrigin,releaseBuildSettings,
  createHostingerClient,assertGitHeads,assertHealth,run
} from "./priority3-protected-hostinger-release.mjs";

const shaA="a".repeat(40),shaB="b".repeat(40),shaOld="c".repeat(40);
const oldUuid="01a1d96f-bc54-70a0-ae01-504fa9a27c72";
const newUuid="01a1e342-947f-70f3-b65e-144a94b21856";
const cfg={appSha:shaA,dbSha:shaB,oldSha:shaOld,oldUuid,mode:"preflight"};
const ghToken="g".repeat(38);
function approvedOrigin(b,bad=false){return {...b,source:"git",
  originOwner:bad?"unapproved":"ishinaillab",originRepo:"ishikeit",
  originBranch:"main",originInstallation:b.originInstallation};}
function stubFetch(changed=false,health="ok"){
  return async url=>{
    if(url.includes("github.com")){
      return {status:200,json:async()=>({sha:url.includes("ishikeit-db")?shaB:(changed?"d".repeat(40):shaA)})};
    }
    return {status:200,json:async()=>({status:url.endsWith("/health/live")?health:"ready"})};
  };
}
function fakeDb({migration=45,guardVersion=true,guardEnabled=true,
  native=0,lockAvailable=true,checkLive=true,leaseBusy=false}={}){
  const queries=[],state={armed:false,acquired:false,released:false,resolved:false};
  return {queries,state,async query(sql,params){
    queries.push({sql,params});
    if(sql.includes("supabase_migrations"))
      return {rows:[{total:migration,guard_version:guardVersion,guard_enabled:guardEnabled}]};
    if(sql.includes("AS links"))return {rows:[{links:native,cleanup:0}]};
    if(sql.includes("AS busy"))return {rows:[{busy:leaseBusy?1:0}]};
    if(sql.startsWith("INSERT")){
      state.acquired=lockAvailable;
      return {rows:lockAvailable?[{generation:5}]:[]};
    }
    if(sql.startsWith("SELECT 1 FROM public.ishikeit_release_ownership")){
      return {rows:checkLive&&!state.armed?[{one:1}]:[]};
    }
    if(sql.includes("verified_app_deploy_at=")){
      state.resolved=true;state.armed=false;
      return {rows:[{generation:6}]};
    }
    if(sql.includes("SET pending_external_step=")){
      state.armed=true;
      return {rows:[{generation:5}]};
    }
    if(sql.includes("holder_digest=NULL")){
      state.released=true;state.acquired=false;
      return {rows:[{generation:6}]};
    }
    if(sql.includes("expires_at=clock_timestamp()+interval '15 minutes'"))
      return {rows:[{generation:5}]};
    throw Error("Test mock unexpected SQL");
  }};
}
function fakeApi({oldSha=shaOld,oldUuidValue=oldUuid,autoEnabled=false,failBuild=false,
  mismatchNew=false,latestMismatched=false,unverified=false,
  settingsDrift=false,wrongOrigin=false,installationDenied=false,
  wrongBuildInstallation=false,oldBuildInstallation=oldUuid}={}){
  const state={started:0,checked:0,install:0,settings:0,get:0,old:0};
  return {state,
    async assertAutoOff(){state.checked++;if(autoEnabled)throw Error("auto deployment active")},
    async assertGitInstallationAccess(){state.install++;
      if(installationDenied)throw Error("Hostinger Git installation unavailable")},
    async assertBuildSettings(){state.settings++;if(settingsDrift)throw Error("Hostinger saved build setting drifted")},
    async latest(){state.old++; if(state.started>0){
      return approvedOrigin({uuid:latestMismatched?oldUuid:newUuid,
        sha:latestMismatched?shaOld:shaA,status:"completed",
        originInstallation:wrongBuildInstallation?oldUuid:newUuid},wrongOrigin);
    }
      return approvedOrigin({uuid:oldUuidValue,sha:oldSha,status:"completed",
        originInstallation:oldBuildInstallation},wrongOrigin);
    },
    async start(){state.started++;if(unverified)throw Error("Hostinger timeout after POST");return newUuid},
    async get(){state.get++;return approvedOrigin({status:failBuild?"failed":"completed",
      uuid:newUuid,sha:mismatchNew?shaOld:shaA,
      originInstallation:wrongBuildInstallation?oldUuid:newUuid},wrongOrigin)}
  };
}
test("admission rejects unknown operation, malformed SHA, malformed old build",()=>{
  assert.deepEqual(validateConfig(cfg),cfg);
  for(const item of [{mode:"apply"},{appSha:"no"},{dbSha:"no"},{oldUuid:"no"},
    {oldSha:shaA}])assert.throws(()=>validateConfig({...cfg,...item}));
});
test("DB URL project identity and explicit SSL endpoint guard",()=>{
  assert.doesNotThrow(()=>validateDatabaseUrl(
    "postgresql://postgres.vhmrliqemkfxblzsoyaz:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"));
  assert.doesNotThrow(()=>validateDatabaseUrl(
    "postgresql://postgres:pass@db.vhmrliqemkfxblzsoyaz.supabase.co:5432/postgres"));
  assert.doesNotThrow(()=>validateDatabaseUrl(
    "postgresql://postgres.vhmrliqemkfxblzsoyaz:pass@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"));
  for(const u of ["invalid","postgres://other:pass@evil.com/db",
    "postgresql://postgres.vhmrliqemkfxblzsoyaz:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.vhmrliqemkfxblzsoyaz:pass@db.unrelated.supabase.co:5432/postgres",
    "postgresql://postgres:pass@db.vhmrliqemkfxblzsoyaz.supabase.co:5432/otherdb",
    "postgresql://postgres:pass@db.vhmrliqemkfxblzsoyaz.supabase.co:5432/postgres?sslmode=disable",
    "postgresql://postgres.notproject:pass@aws-0-ap-southeast-1.pooler.supabase.com/postgres",
    "mysql://postgres.vhmrliqemkfxblzsoyaz:pass@aws-0-ap-southeast-1.pooler.supabase.com/postgres"])
    assert.throws(()=>validateDatabaseUrl(u));
});
test("GitHub commit HEAD checks fail closed on any app drift",async()=>{
  await assertGitHeads(stubFetch(),ghToken,cfg);
  await assert.rejects(assertGitHeads(stubFetch(true),ghToken,cfg),/drifted/);
  await assert.rejects(assertGitHeads(stubFetch(),"",cfg),/unavailable/);
});
test("live and ready health endpoints both require exact canonical status",async()=>{
  await assertHealth(stubFetch());
  await assert.rejects(assertHealth(stubFetch(false,"error")),/invalid/);
});
test("only official owner Git installation, main, build and Fastify path are allowed",()=>{
  const s=releaseBuildSettings();
  assert.deepEqual(s.source_options,{owner:"ishinaillab",repository:"ishikeit",
    branch:"main",installation_uuid:"01a1e342-947f-70f3-b65e-144a94b21856"});
  assert.equal(s.entry_file,"dist/processes/http.js");
  assert.equal(s.node_version,24);
  assert.equal(s.app_type,"fastify");
});
test("parseBuild pins source owner, repository, branch and exact commit",()=>{
  const b=parseBuild({uuid:oldUuid,state:"completed",
    options:{source_type:"git",source_options:{owner:"ishinaillab",
      repository:"ishikeit",branch:"main",commit:{hash:shaOld}}}});
  assert.deepEqual(b,approvedOrigin({uuid:oldUuid,status:"completed",sha:shaOld}));
  assert.doesNotThrow(()=>assertBuildOrigin(b));
  assert.throws(()=>assertBuildOrigin(b,true),/installation/i);
  const pinned={...b,originInstallation:newUuid};
  assert.doesNotThrow(()=>assertBuildOrigin(pinned,true));
  assert.throws(()=>assertBuildOrigin({...pinned,originInstallation:oldUuid},true),/installation/i);
  for(const f of [{source:"archive"},{originOwner:"other"},
    {originRepo:"other"},{originBranch:"staging"}])
    assert.throws(()=>assertBuildOrigin({...b,...f}),/source/);
  assert.throws(()=>parseBuild(null));
});
test("Hostinger API accepts documented 200/null auto-deploy state and explicit disabled link",async()=>{
  const keys=["installation_uuid","is_enabled","owner","repository","branch","directory"];
  const unconfigured=Object.fromEntries(keys.map(k=>[k,null]));
  const linked={...unconfigured,is_enabled:false,
    installation_uuid:newUuid,owner:"ishinaillab",
    repository:"ishikeit",branch:"main",directory:""};
  const load=async(body,status=200)=>{
    const api=createHostingerClient(async()=>({status,ok:status===200,
      json:async()=>body}),"t".repeat(40));
    return api.assertAutoOff();
  };
  await load(unconfigured);
  await load({data:unconfigured});
  await load(linked);
  for(const value of [
    {...linked,is_enabled:true},
    {...linked,is_enabled:null},
    {...linked,is_enabled:"false"},
    {...linked,installation_uuid:"unverified"},
    {...linked,branch:undefined},
    {...linked,installation_uuid:oldUuid},
    {...linked,owner:"other"},
    {...linked,repository:"other"},
    {...linked,branch:"staging"},
    {...linked,directory:"elsewhere"},
    {branch:"main"},
    {data:null},
    {...unconfigured,owner:"ishinaillab"}
  ])await assert.rejects(load(value),/disabled/);
  await assert.rejects(load(unconfigured,404),/HTTP 404/);
  await assert.rejects(load(unconfigured,401),/HTTP 401/);
  assert.throws(()=>createHostingerClient(async()=>{},""));
});
test("Hostinger installation requires active owner OAuth and exact main repo proof",async()=>{
  const identity={uuid:newUuid,provider:"github",account_login:"ishinaillab",
    account_type:"user",status:"active",has_oauth:true};
  const repo={name:"ishikeit",owner:"ishinaillab",
    full_name:"ishinaillab/ishikeit",default_branch:"main"};
  const checked=[];
  const create=(install=[identity],repos=[repo],status=200)=>
    createHostingerClient(async(url,opts)=>{
      checked.push({url,method:opts.method});
      return {status,ok:status===200,
        json:async()=>url.includes("/repositories")?{data:repos}:{data:install}};
    },"t".repeat(40));
  await create().assertGitInstallationAccess();
  assert(checked.every(x=>x.method==="GET"));
  assert(checked.some(x=>x.url.includes("/git/installations?provider=github&status=active")));
  assert(checked.some(x=>x.url.includes("/git/installations/"+newUuid+"/repositories")));
  for(const variant of [
    [[{...identity,status:"suspended"}],[repo]],
    [[{...identity,has_oauth:false}],[repo]],
    [[{...identity,account_login:"another"}],[repo]],
    [[{...identity,uuid:oldUuid}],[repo]],
    [[identity],[{...repo,full_name:"other/ishikeit"}]],
    [[identity],[{...repo,default_branch:"develop"}]],
    [[],[repo]],
    [[identity],[]],
    [{bad:true},[repo]],
    [[identity],{bad:true}]
  ])await assert.rejects(create(...variant).assertGitInstallationAccess(),/installation|repository/i);
  await assert.rejects(create([identity],[repo],429).assertGitInstallationAccess(),/HTTP 429/);
});
test("Hostinger API refuses mismatched saved Node.js framework and entry file",async()=>{
  const valid={node_version:24,app_type:"fastify",build_script:"build",
    entry_file:"dist/processes/http.js",package_manager:"npm",
    root_directory:null,output_directory:null};
  for(const change of [{app_type:"express"},{node_version:22},
    {entry_file:"src/processes/http.ts"},{package_manager:"yarn"},
    {root_directory:"other"},{output_directory:"dist"}]){
    const api=createHostingerClient(async(url)=>({status:200,ok:true,
      json:async()=>url.endsWith("/settings")?{...valid,...change}:valid}),"s".repeat(40));
    await assert.rejects(api.assertBuildSettings(),/drifted/);
  }
});
test("Hostinger API POST pins branch and UUID readback, without exposing token",async()=>{
  const payloads=[];
  const a=createHostingerClient(async(url,opts)=>{
    if(opts.method==="POST"){payloads.push(JSON.parse(opts.body));
      return {status:201,ok:true,json:async()=>({uuid:newUuid})}}
    return {status:404,ok:false};
  },"p".repeat(40));
  assert.equal(await a.start(),newUuid);
  assert.equal(payloads[0].source_options.branch,"main");
  assert.equal(JSON.stringify(payloads).includes("p".repeat(40)),false);
});
test("protected preflight verifies external heads, live build and DB but never POSTs",async()=>{
  const db=fakeDb(),api=fakeApi(),out=[];
  const result=await run({cfg,db,api,fetcher:stubFetch(),
    githubToken:ghToken,log:x=>out.push(x)});
  assert.equal(result.mode,"preflight");
  assert.equal(api.state.started,0);
  assert.equal(db.state.released,false);
  assert.equal(db.state.acquired,false);
  assert.equal(db.state.armed,false);
  assert.ok(db.queries.every(x=>x.sql.trimStart().startsWith("SELECT")),
    "Preflight must never INSERT, UPDATE, DELETE or execute a production lease write");
  assert.equal(db.queries.filter(x=>x.sql.includes("pending_external_step='app_deploy'")).length,0);
});
for(const [name,opts,expect] of [
  ["migration drift",{migration:39},/45/],
  ["native active links",{native:1},/connections/],
  ["active or unresolved lease",{leaseBusy:true},/held|unresolved/i]
]){
  test("preflight refuses "+name,async()=>{
    const db=fakeDb(opts),api=fakeApi();
    await assert.rejects(run({cfg,db,api,fetcher:stubFetch(),
      githubToken:ghToken,log:()=>{}}),expect);
    assert.equal(api.state.started,0);
  });
}
test("preflight rejects unhealthy old service with no writes or Hostinger POST",async()=>{
  const db=fakeDb(),api=fakeApi();
  await assert.rejects(run({cfg,db,api,fetcher:stubFetch(false,"unhealthy"),
    githubToken:ghToken,log:()=>{}}),/health/i);
  assert.equal(api.state.started,0);
  assert.equal(db.state.acquired,false);
  assert.equal(db.queries.some(x=>!x.sql.trimStart().startsWith("SELECT")),false);
});
test("deploy refuses unhealthy old service before acquiring a lease",async()=>{
  const db=fakeDb(),api=fakeApi();
  await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db,api,
    fetcher:stubFetch(false,"unhealthy"),githubToken:ghToken,log:()=>{}}),/health/i);
  assert.equal(api.state.started,0);
  assert.equal(db.state.armed,false);
  assert.equal(db.state.acquired,false);
});
test("preflight requires no DB mutation rights; deployment still requires CAS",async()=>{
  const db=fakeDb({lockAvailable:false}),api=fakeApi();
  const outcome=await run({cfg,db,api,fetcher:stubFetch(),
    githubToken:ghToken,log:()=>{}});
  assert.equal(outcome.mode,"preflight");
  assert.ok(db.queries.every(x=>/^SELECT\b/u.test(x.sql)),
    "Even a read-only database user must be able to perform admission checks");
  assert.equal(db.state.acquired,false);
  assert.equal(api.state.started,0);
});
test("preflight rejects revoked Git installation without leasing or deploying",async()=>{
  const db=fakeDb(),api=fakeApi({installationDenied:true});
  await assert.rejects(run({cfg,db,api,fetcher:stubFetch(),
    githubToken:ghToken,log:()=>{}}),/installation unavailable/);
  assert.equal(db.state.acquired,false);
  assert.equal(api.state.started,0);
});

test("preflight refuses GitHub head mismatch without acquiring lease or building",async()=>{
  const db=fakeDb(),api=fakeApi();
  await assert.rejects(run({cfg,db,api,fetcher:stubFetch(true),
    githubToken:ghToken,log:()=>{}}),/drifted/);
  assert.equal(db.state.acquired,false);
  assert.equal(api.state.started,0);
});
test("preflight refuses Hostinger build with unapproved Git origin before taking lease",async()=>{
  const db=fakeDb(),api=fakeApi({wrongOrigin:true});
  await assert.rejects(run({cfg,db,api,fetcher:stubFetch(),
    githubToken:ghToken,log:()=>{}}),/source does not match/);
  assert.equal(db.state.acquired,false);
  assert.equal(api.state.started,0);
});
test("preflight refuses unapproved Hostinger build settings before acquiring a lease",async()=>{
  const db=fakeDb(),api=fakeApi({settingsDrift:true});
  await assert.rejects(run({cfg,db,api,fetcher:stubFetch(),
    githubToken:ghToken,log:()=>{}}),/build setting drifted/);
  assert.equal(db.state.acquired,false);
  assert.equal(api.state.started,0);
});
test("preflight refuses Hostinger build identity drift without admitting build",async()=>{
  const db=fakeDb(),api=fakeApi({oldSha:"d".repeat(40)});
  await assert.rejects(run({cfg,db,api,fetcher:stubFetch(),
    githubToken:ghToken,log:()=>{}}),/current live build/);
  assert.equal(db.state.acquired,false);
});
test("reconcile accepts an expired pending release only with the approved Git installation",async()=>{
  const db=fakeDb(),api=fakeApi({oldSha:shaA,oldUuidValue:newUuid,
    oldBuildInstallation:newUuid});
  const result=await run({cfg:{...cfg,mode:"reconcile"},db,api,
    fetcher:stubFetch(),githubToken:ghToken,log:()=>{}});
  assert.equal(result.mode,"reconciled");
  assert.equal(db.state.resolved,true);
  assert.equal(api.state.started,0);
});
test("reconcile refuses a same-commit hosted build from an unapproved installation",async()=>{
  const db=fakeDb(),api=fakeApi({oldSha:shaA,oldUuidValue:newUuid,
    oldBuildInstallation:oldUuid});
  await assert.rejects(run({cfg:{...cfg,mode:"reconcile"},db,api,
    fetcher:stubFetch(),githubToken:ghToken,log:()=>{}}),/installation/i);
  assert.equal(db.state.resolved,false);
  assert.equal(api.state.started,0);
});
test("deploy records external hold before host POST and clears only after verified live",async()=>{
  const db=fakeDb(),api=fakeApi();let armedBeforePost=false;
  const originalStart=api.start;
  api.start=async()=>{armedBeforePost=db.state.armed;return originalStart()};
  const result=await run({cfg:{...cfg,mode:"deploy"},db,api,
    fetcher:stubFetch(),githubToken:ghToken,sleep:async()=>{},log:()=>{}});
  assert.equal(result.mode,"deployed");
  assert.equal(result.buildUuid,newUuid);
  assert.equal(armedBeforePost,true);
  assert.equal(db.state.resolved,true);
  assert.equal(db.state.armed,false);
});
test("failed final GitHub readback before Hostinger POST releases only the unarmed lease",async()=>{
  const db=fakeDb(),api=fakeApi(),original=stubFetch();
  let githubRequests=0;
  const fetcher=async(url,options)=>{
    if(url.includes("github.com")&&++githubRequests===5)
      return {status:503,json:async()=>({})};
    return original(url,options);
  };
  await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db,api,
    fetcher,githubToken:ghToken,log:()=>{}}),/GitHub protected branch readback unavailable/u);
  assert.equal(githubRequests,5,"Must perform a final GitHub readback at admission");
  assert.equal(api.state.started,0,"No hosted request may be sent after failed readback");
  assert.equal(db.state.armed,false,"Do not persist a pending step before a failing pre-POST check");
  assert.equal(db.state.released,true,"Release only the unused, unarmed lease");
});
test("after durable arm the next external operation is Hostinger POST, not a fallible read",async()=>{
  const db=fakeDb(),api=fakeApi(),original=stubFetch();
  let postArmReadbacks=0;
  const fetcher=async(url,options)=>{
    if(url.includes("github.com")&&db.state.armed&&api.state.started===0)
      postArmReadbacks++;
    return original(url,options);
  };
  const result=await run({cfg:{...cfg,mode:"deploy"},db,api,
    fetcher,githubToken:ghToken,log:()=>{}});
  assert.equal(result.mode,"deployed");
  assert.equal(postArmReadbacks,0,"No pre-POST readback may strand an unsubmitted build");
});
for(const [name,opts] of [
  ["provider failed",{failBuild:true}],
  ["build commit mismatch",{mismatchNew:true}],
  ["current build still older",{latestMismatched:true}],
  ["completed build used other Git installation",{wrongBuildInstallation:true}],
  ["provider HTTP timeout after arm",{unverified:true}]
]){
  test("never releases after armed "+name,async()=>{
    const db=fakeDb(),api=fakeApi(opts);
    await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db,api,
      fetcher:stubFetch(),githubToken:ghToken,sleep:async()=>{},
      log:()=>{}}));
    assert.equal(db.state.armed,true);
    assert.equal(db.state.resolved,false);
    assert.equal(db.state.released,false);
  });
}
test("after arm even health failure leaves durable unresolved external step",async()=>{
  const db=fakeDb(),api=fakeApi();
  const normal=stubFetch();
  const fetcher=async(url,opts)=>{
    if(db.state.armed&&url.includes("/health/"))
      return {status:200,json:async()=>({status:"unhealthy"})};
    return normal(url,opts);
  };
  await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db,api,
    fetcher,githubToken:ghToken,log:()=>{}}),/health/);
  assert.equal(db.state.armed,true);
  assert.equal(db.state.released,false);
  assert.equal(db.state.resolved,false);
});
test("protected Hostinger release refuses the older 44-migration schema and requires native outbox fence",async()=>{
  const before=fakeDb({migration:44}),oldApi=fakeApi();
  await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db:before,api:oldApi,
    fetcher:stubFetch(),githubToken:ghToken,log:()=>{}}),/migration|native outbox/i);
  assert.equal(before.state.acquired,false,"No lease before mandatory schema is confirmed");
  assert.equal(oldApi.state.started,0,"No Hostinger build on old schema");
  const migrated=fakeDb({migration:45}),api=fakeApi();
  const check=await run({cfg,db:migrated,api,fetcher:stubFetch(),githubToken:ghToken,log:()=>{}});
  assert.equal(check.mode,"preflight");
  assert.equal(migrated.state.acquired,false);
  assert.equal(api.state.started,0);
});
test("protected Hostinger release rejects missing migration version or disabled native insert trigger",async()=>{
  for(const opts of [{migration:45,guardVersion:false},{migration:45,guardEnabled:false}]){
    const db=fakeDb(opts),api=fakeApi();
    await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db,api,
      fetcher:stubFetch(),githubToken:ghToken,log:()=>{}}),/native|schema|migration/i);
    assert.equal(db.state.acquired,false);
    assert.equal(api.state.started,0);
  }
});
test("runtime lease is random digest and never passed as plaintext DB value",async()=>{
  const db=fakeDb(),api=fakeApi();
  await run({cfg:{...cfg,mode:"deploy"},db,api,fetcher:stubFetch(),githubToken:ghToken,log:()=>{}});
  const first=db.queries.find(x=>x.sql.startsWith("INSERT"));
  assert.equal(Buffer.isBuffer(first.params[1]),true);
  assert.equal(first.params[1].length,32);
  assert.equal(db.queries.some(x=>x.sql.includes("holder_digest=NULL")&&x.sql.includes("pending_external_step=NULL")&&x.sql.includes("verified_app_deploy_at=")),true);
  assert.equal(db.state.resolved,true);
});
