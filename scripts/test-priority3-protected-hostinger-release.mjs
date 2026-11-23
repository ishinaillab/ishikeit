import test from "node:test";
import assert from "node:assert/strict";
import {Buffer} from "node:buffer";
import {
  validateConfig,validateDatabaseUrl,parseBuild,assertBuildOrigin,releaseBuildSettings,
  createHostingerClient,assertGitHeads,assertHealth,run,
  assertHistoricalGitAncestry
} from "./priority3-protected-hostinger-release.mjs";

const shaA="a".repeat(40),shaB="b".repeat(40),shaOld="c".repeat(40);
const oldUuid="01a1d96f-bc54-70a0-ae01-504fa9a27c72";
const newUuid="01a1e342-947f-70f3-b65e-144a94b21856";
const cfg={appSha:shaA,dbSha:shaB,oldSha:shaOld,oldUuid,mode:"preflight"};
const ghToken="g".repeat(38);
function approvedOrigin(b,bad=false){return {...b,source:"git",
  originOwner:bad?"unapproved":"ishinaillab",originRepo:"ishikeit",
  originBranch:"main",originInstallation:b.originInstallation};}
function stubFetch(changed=false,health="ok",historicalParents=null){
  return async url=>{
    if(url.includes("/git/commits/")){
      const sha=url.split("/").at(-1);
      const parents=historicalParents?.[sha]??(sha===shaA?[shaOld]:[]);
      return {status:200,json:async()=>({sha,
        parents:parents.map(sha=>({sha}))})};
    }
    if(url.includes("github.com")){
      return {status:200,json:async()=>({ref:"refs/heads/main",
        object:{type:"commit",sha:url.includes("ishikeit-db")?shaB:
          (changed?"d".repeat(40):shaA)}})};
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
  wrongBuildInstallation=false,oldBuildInstallation=oldUuid,
  enableAutoOnStart=false,enableAutoOnGet=false,denyDisable=false,
  oldCreatedAt=undefined}={}){
  const state={started:0,checked:0,install:0,settings:0,get:0,old:0,
    autoOn:autoEnabled,autoDisabled:0};
  return {state,
    async assertAutoOff(){state.checked++;
      if(state.autoOn)throw Error("auto deployment active")},
    async disableAutoDeploy(){state.autoDisabled++;
      if(denyDisable)throw Error("Hostinger auto-deployment deletion denied");
      state.autoOn=false;
    },
    async assertGitInstallationAccess(){state.install++;
      if(installationDenied)throw Error("Hostinger Git installation unavailable")},
    async assertBuildSettings(){state.settings++;if(settingsDrift)throw Error("Hostinger saved build setting drifted")},
    async latest(){state.old++; if(state.started>0){
      return approvedOrigin({uuid:latestMismatched?oldUuid:newUuid,
        sha:latestMismatched?shaOld:shaA,status:"completed",
        originInstallation:wrongBuildInstallation?oldUuid:newUuid},wrongOrigin);
    }
      return approvedOrigin({uuid:oldUuidValue,sha:oldSha,status:"completed",
        originInstallation:oldBuildInstallation,
        ...(oldCreatedAt===undefined?{}:{createdAt:oldCreatedAt})},wrongOrigin);
    },
    async start(){state.started++;
      if(enableAutoOnStart)state.autoOn=true;
      if(unverified)throw Error("Hostinger timeout after POST");
      return newUuid;
    },
    async get(){state.get++;
      if(enableAutoOnGet)state.autoOn=true;
      return approvedOrigin({status:failBuild?"failed":"completed",
        uuid:newUuid,sha:mismatchNew?shaOld:shaA,
        originInstallation:wrongBuildInstallation?oldUuid:newUuid},wrongOrigin);
    }
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
test("Hostinger auto-deploy removal uses exact authenticated DELETE with strict post-readback",async()=>{
  const calls=[];
  const root={installation_uuid:null,is_enabled:null,owner:null,
    repository:null,branch:null,directory:null};
  const api=createHostingerClient(async(url,opts)=>{
    calls.push({url,method:opts.method});
    if(opts.method==="DELETE")return {ok:true,status:200,
      json:async()=>({message:"Request accepted"})};
    return {ok:true,status:200,json:async()=>root};
  },"v".repeat(40));
  await api.disableAutoDeploy();
  await api.assertAutoOff();
  assert.equal(calls[0].method,"DELETE");
  assert.match(calls[0].url,/\/git\/auto-deployments\/settings$/u);
  assert.equal(calls[1].method,"GET");
  assert.equal(calls[1].url,calls[0].url);
  const reject=createHostingerClient(async()=>({ok:false,status:503}),"v".repeat(40));
  await assert.rejects(reject.disableAutoDeploy(),/HTTP 503/u);
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
const historicalCreatedAt="2026-11-22T17:40:12Z";
const historicalArmedAt="2026-11-22T17:40:12.122779Z";
const historicalCfg={...cfg,mode:"reconcile-historical",heldAppSha:shaOld};
function historicalDb({pendingApp=shaOld,pendingDb=shaB,
  expired=true,step="app_deploy",armedAt=historicalArmedAt,casWins=true}={}){
  const base=fakeDb();
  const state={readCount:0,updateCount:0};
  return {...base,historical:state,async query(sql,params){
    if(sql.startsWith("SELECT generation,app_main_sha,db_main_sha")){
      state.readCount++;
      return {rows:[{generation:"7",app_main_sha:pendingApp,
        db_main_sha:pendingDb,pending_external_step:step,
        pending_external_step_at:new Date(armedAt),expired}]};
    }
    if(sql.startsWith("UPDATE public.ishikeit_release_ownership SET "+
      "pending_external_step=NULL")){
      state.updateCount++;
      assert.match(sql,/generation=\$4 AND pending_external_step_at=\$5/u);
      assert.match(sql,/expires_at<=clock_timestamp\(\)/u);
      assert.deepEqual(params,[SCOPE_HIST,shaOld,shaB,7,new Date(armedAt)]);
      base.state.resolved=casWins;
      return {rows:casWins?[{generation:8}]:[]};
    }
    return base.query(sql,params);
  }};
}
const SCOPE_HIST="ishikeit_priority3_production";
test("historical release diagnostics expose only fixed stage identifiers",async()=>{
  const outputs=[];
  const db=historicalDb(),api=fakeApi({
    oldSha:shaOld,oldUuidValue:oldUuid,
    oldBuildInstallation:newUuid,oldCreatedAt:historicalCreatedAt
  });
  await run({cfg:historicalCfg,db,api,fetcher:stubFetch(),
    githubToken:ghToken,log:stage=>outputs.push(stage)});
  const stages=outputs.filter(x=>x.startsWith(
    "Priority 3 historical reconciliation stage: "));
  assert.deepEqual(stages,[
    "github_ref_initial","hostinger_auto_deploy_initial",
    "hostinger_installation_initial","hostinger_settings_initial",
    "hostinger_latest_initial","health_admission","schema_readback",
    "native_account_counts","git_ancestry","health_final",
    "github_ref_final","hostinger_auto_deploy_final",
    "hostinger_installation_final","hostinger_settings_final",
    "hostinger_latest_final","hold_cas","hold_reconciled"
  ].map(x=>"Priority 3 historical reconciliation stage: "+x));
  assert.equal(api.state.started,0);
  const failed=[];
  await assert.rejects(run({cfg:historicalCfg,db:historicalDb({
    casWins:false}),api:fakeApi({
    oldSha:shaOld,oldUuidValue:oldUuid,
    oldBuildInstallation:newUuid,oldCreatedAt:historicalCreatedAt}),
    fetcher:stubFetch(),githubToken:ghToken,
    log:x=>failed.push(x)}),/CAS changed/u);
  assert.equal(failed.at(-1),
    "Priority 3 historical reconciliation stage: hold_cas");
  for(const x of [...outputs,...failed]){
    assert.doesNotMatch(x,/bearer|authorization:|postgres:\/\/|token=|secret=/iu);
  }
});
test("historical reconciliation requires matching deployed SHA and current approved main",()=>{
  assert.deepEqual(validateConfig(historicalCfg),historicalCfg);
  for(const item of [
    {heldAppSha:undefined},{heldAppSha:"0".repeat(40)},
    {oldSha:"f".repeat(40)},{appSha:shaOld},
    {mode:"deploy",heldAppSha:shaOld},
    {mode:"preflight",heldAppSha:shaOld}
  ])assert.throws(()=>validateConfig({...historicalCfg,...item}));
});
test("historical protected main ancestry rejects forks, missing parents and unsafe ranges",async()=>{
  const safe={...historicalCfg};
  await assertHistoricalGitAncestry(stubFetch(),ghToken,safe);
  await assertHistoricalGitAncestry(stubFetch(false,"ok",{
    [shaA]:["d".repeat(40)],["d".repeat(40)]:[shaOld]
  }),ghToken,safe);
  await assert.rejects(assertHistoricalGitAncestry(stubFetch(false,"ok",{
    [shaA]:["0".repeat(40),shaOld]
  }),ghToken,safe),/ancestry unverified/u);
  await assert.rejects(assertHistoricalGitAncestry(stubFetch(false,"ok",{
    [shaA]:["d".repeat(40)],["d".repeat(40)]:[shaA]
  }),ghToken,safe),/cycle/u);
  const chain={};for(let i=0;i<18;i++)chain[i.toString(16).padStart(40,"0")]=
    [(i+1).toString(16).padStart(40,"0")];
  chain[shaA]=["0".repeat(40)];
  await assert.rejects(assertHistoricalGitAncestry(stubFetch(false,"ok",chain),
    ghToken,safe),/not reachable/u);
});
test("owner-reviewed historical Hostinger reconciliation never posts another build",async()=>{
  const db=historicalDb();
  const api=fakeApi({oldSha:shaOld,oldUuidValue:oldUuid,
    oldBuildInstallation:newUuid,oldCreatedAt:historicalCreatedAt});
  const outcome=await run({cfg:historicalCfg,db,api,fetcher:stubFetch(),
    githubToken:ghToken,log:()=>{}});
  assert.deepEqual(outcome,{mode:"reconciled-historical",buildUuid:oldUuid});
  assert.equal(api.state.started,0);
  assert.equal(db.state.acquired,false);
  assert.equal(db.state.armed,false);
  assert.equal(db.state.resolved,true);
  assert.equal(db.historical.readCount,1);
  assert.equal(db.historical.updateCount,1);
});
for(const [label,opts,pattern] of [
  ["unexpired hold",{expired:false},/exact expired/u],
  ["other provider deployment",{pendingApp:"d".repeat(40)},/exact expired/u],
  ["wrong database source",{pendingDb:"d".repeat(40)},/exact expired/u],
  ["unarmed operation",{step:null},/exact expired/u],
  ["build created long before arm",{armedAt:"2026-11-22T17:20:12Z"},/timestamp/u],
  ["raced concurrent hold update",{casWins:false},/CAS changed/u]
]){
  test("historical reconciliation refuses "+label+" without clearing hold",async()=>{
    const db=historicalDb(opts);
    const api=fakeApi({oldSha:shaOld,oldUuidValue:oldUuid,
      oldBuildInstallation:newUuid,oldCreatedAt:historicalCreatedAt});
    await assert.rejects(run({cfg:historicalCfg,db,api,
      fetcher:stubFetch(),githubToken:ghToken,log:()=>{}}),pattern);
    assert.equal(api.state.started,0,"Never issue Hostinger POST");
    assert.equal(db.state.resolved,false,"Must leave unresolved hold");
  });
}
test("historical readback denies wrong deployment installation, missing timestamp and Git drift",async()=>{
  for(const opts of [
    {oldBuildInstallation:oldUuid,oldCreatedAt:historicalCreatedAt},
    {oldBuildInstallation:newUuid},
    {oldBuildInstallation:newUuid,oldCreatedAt:"2026-11-22T16:40:12Z"}
  ]){
    const db=historicalDb(),api=fakeApi({
      oldSha:shaOld,oldUuidValue:oldUuid,...opts});
    await assert.rejects(run({cfg:historicalCfg,db,api,
      fetcher:stubFetch(),githubToken:ghToken,log:()=>{}}));
    assert.equal(db.historical.updateCount,0);
    assert.equal(api.state.started,0);
  }
  const db=historicalDb(),api=fakeApi({oldSha:shaOld,oldUuidValue:oldUuid,
    oldBuildInstallation:newUuid,oldCreatedAt:historicalCreatedAt});
  await assert.rejects(run({cfg:historicalCfg,db,api,
    fetcher:stubFetch(true),githubToken:ghToken,log:()=>{}}),/drifted/u);
  assert.equal(db.historical.updateCount,0);
  assert.equal(api.state.started,0);
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
  assert.equal(api.state.autoDisabled,2,
    "A provider build may enable auto-deploy during submission and completion");
});
test("build-induced auto-deployment is disabled twice before accepting release",async()=>{
  const db=fakeDb(),api=fakeApi({enableAutoOnStart:true,enableAutoOnGet:true});
  const result=await run({cfg:{...cfg,mode:"deploy"},db,api,
    fetcher:stubFetch(),githubToken:ghToken,log:()=>{}});
  assert.equal(result.mode,"deployed");
  assert.equal(api.state.started,1);
  assert.equal(api.state.autoDisabled,2);
  assert.equal(api.state.autoOn,false);
  assert.equal(db.state.resolved,true);
});
test("auto-deploy closure failure after Hostinger POST retains the external hold",async()=>{
  const db=fakeDb(),api=fakeApi({enableAutoOnStart:true,denyDisable:true});
  await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db,api,
    fetcher:stubFetch(),githubToken:ghToken,log:()=>{}}),/deletion denied/u);
  assert.equal(api.state.started,1,"Never submit a duplicate Hostinger build");
  assert.equal(db.state.armed,true);
  assert.equal(db.state.released,false);
  assert.equal(db.state.resolved,false);
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

test("provider-only preflight validates exact release identity without allowing mutation",()=>{
  assert.deepEqual(validateConfig({...cfg,mode:"provider-preflight"}),
    {...cfg,mode:"provider-preflight"});
  assert.throws(()=>validateConfig({...cfg,mode:"provider-deploy"}));
});
test("owner provider-only preflight works before migration 45 and never touches PostgreSQL",async()=>{
  const db=fakeDb({migration:44}),api=fakeApi(),lines=[];
  const result=await run({cfg:{...cfg,mode:"provider-preflight"},db,api,
    fetcher:stubFetch(),githubToken:ghToken,log:x=>lines.push(x)});
  assert.deepEqual(result,{mode:"provider-preflight",buildUuid:null});
  assert.equal(db.queries.length,0,"Provider inspection must never read or write production SQL");
  assert.equal(db.state.acquired,false);
  assert.equal(db.state.armed,false);
  assert.equal(api.state.started,0);
  assert.ok(api.state.checked>=2&&api.state.install>=2&&
    api.state.settings>=2&&api.state.old>=2,
  "Perform both initial and final authenticated provider readbacks");
  assert.ok(lines.some(x=>/provider-only/i.test(x)));
});
test("provider-only preflight fails closed on an unavailable installation without SQL or build",async()=>{
  const db=fakeDb({migration:44}),api=fakeApi({installationDenied:true});
  await assert.rejects(run({cfg:{...cfg,mode:"provider-preflight"},db,api,
    fetcher:stubFetch(),githubToken:ghToken,log:()=>{}}),/installation unavailable/i);
  assert.equal(db.queries.length,0);
  assert.equal(api.state.started,0);
});
test("provider-only preflight rejects active auto deploy, wrong build and broken health",async()=>{
  for(const [apiOptions,fetcher,expected] of [
    [{autoEnabled:true},stubFetch(),/auto deployment/i],
    [{wrongOrigin:true},stubFetch(),/source does not match/i],
    [{oldSha:"d".repeat(40)},stubFetch(),/current live build/i],
    [{},stubFetch(false,"unhealthy"),/health/i]
  ]){
    const db=fakeDb({migration:44}),api=fakeApi(apiOptions);
    await assert.rejects(run({cfg:{...cfg,mode:"provider-preflight"},db,api,
      fetcher,githubToken:ghToken,log:()=>{}}),expected);
    assert.equal(db.queries.length,0);
    assert.equal(api.state.started,0);
  }
});
