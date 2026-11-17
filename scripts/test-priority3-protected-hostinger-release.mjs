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
  originOwner:bad?"unapproved":"ishinaillab",originRepo:"ishikeit",originBranch:"main"};}
function stubFetch(changed=false,health="ok"){
  return async url=>{
    if(url.includes("github.com")){
      return {status:200,json:async()=>({sha:url.includes("ishikeit-db")?shaB:(changed?"d".repeat(40):shaA)})};
    }
    return {status:200,json:async()=>({status:url.endsWith("/health/live")?health:"ready"})};
  };
}
function fakeDb({migration=44,native=0,lockAvailable=true,checkLive=true}={}){
  const queries=[],state={armed:false,acquired:false,released:false,resolved:false};
  return {queries,state,async query(sql,params){
    queries.push({sql,params});
    if(sql.includes("supabase_migrations"))return {rows:[{total:migration}]};
    if(sql.includes("AS links"))return {rows:[{links:native,cleanup:0}]};
    if(sql.startsWith("INSERT")){
      state.acquired=lockAvailable;
      return {rows:lockAvailable?[{generation:5}]:[]};
    }
    if(sql.startsWith("SELECT 1 FROM public.ishikeit_release_ownership")){
      return {rows:checkLive&&!state.armed?[{one:1}]:[]};
    }
    if(sql.includes("SET pending_external_step=")){
      state.armed=true;
      return {rows:[{generation:5}]};
    }
    if(sql.includes("verified_app_deploy_at=")){
      state.resolved=true;state.armed=false;
      return {rows:[{generation:6}]};
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
  settingsDrift=false,wrongOrigin=false}={}){
  const state={started:0,checked:0,settings:0,get:0,old:0};
  return {state,
    async assertAutoOff(){state.checked++;if(autoEnabled)throw Error("auto deployment active")},
    async assertBuildSettings(){state.settings++;if(settingsDrift)throw Error("Hostinger saved build setting drifted")},
    async latest(){state.old++; if(state.started>0){
      return approvedOrigin({uuid:latestMismatched?oldUuid:newUuid,
        sha:latestMismatched?shaOld:shaA,status:"completed"},wrongOrigin);
    }
      return approvedOrigin({uuid:oldUuidValue,sha:oldSha,status:"completed"},wrongOrigin);
    },
    async start(){state.started++;if(unverified)throw Error("Hostinger timeout after POST");return newUuid},
    async get(){state.get++;return approvedOrigin({status:failBuild?"failed":"completed",
      uuid:newUuid,sha:mismatchNew?shaOld:shaA},wrongOrigin)}
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
  for(const u of ["invalid","postgres://other:pass@evil.com/db",
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
  for(const f of [{source:"archive"},{originOwner:"other"},
    {originRepo:"other"},{originBranch:"staging"}])
    assert.throws(()=>assertBuildOrigin({...b,...f}),/source/);
  assert.throws(()=>parseBuild(null));
});
test("Hostinger API requires verified 404 for disabled Git auto deploy",async()=>{
  const req=[];
  const fake=async(url,opts)=>{req.push({url,method:opts.method});
    return {status:url.includes("auto-deployments")?404:200,ok:true,
      json:async()=>url.endsWith("/settings")?{
        node_version:24,app_type:"fastify",build_script:"build",
        entry_file:"dist/processes/http.js",package_manager:"npm",
        root_directory:null,output_directory:null
      }:[{uuid:oldUuid,state:"completed",
        options:{source_options:{commit:{hash:shaOld}}}}]}};
  const a=createHostingerClient(fake,"t".repeat(40));
  await a.assertAutoOff();
  await a.assertBuildSettings();
  assert.equal((await a.latest()).sha,shaOld);
  assert(req.every(x=>x.url.startsWith("https://developers.hostinger.com/api/hosting/v1/accounts/")));
  const denied=createHostingerClient(async()=>({status:200,ok:true,
    json:async()=>({branch:"main"})}),"t".repeat(40));
  await assert.rejects(denied.assertAutoOff(),/disabled/);
  assert.throws(()=>createHostingerClient(fake,""));
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
  assert.equal(db.state.released,true);
  assert.equal(db.state.armed,false);
  assert.equal(db.queries.filter(x=>x.sql.includes("pending_external_step='app_deploy'")).length,0);
});
for(const [name,opts,expect] of [
  ["migration drift",{migration:39},/44/],
  ["native active links",{native:1},/connections/],
  ["no lease",{lockAvailable:false},/owned|lease|unresolved/i]
]){
  test("preflight refuses "+name,async()=>{
    const db=fakeDb(opts),api=fakeApi();
    await assert.rejects(run({cfg,db,api,fetcher:stubFetch(),
      githubToken:ghToken,log:()=>{}}),expect);
    assert.equal(api.state.started,0);
  });
}
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
for(const [name,opts] of [
  ["provider failed",{failBuild:true}],
  ["build commit mismatch",{mismatchNew:true}],
  ["current build still older",{latestMismatched:true}],
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
  await assert.rejects(run({cfg:{...cfg,mode:"deploy"},db,api,
    fetcher:stubFetch(false,"unhealthy"),githubToken:ghToken,
    log:()=>{}}),/health/);
  assert.equal(db.state.armed,true);
  assert.equal(db.state.released,false);
});
test("runtime lease is random digest and never passed as plaintext DB value",async()=>{
  const db=fakeDb(),api=fakeApi();
  await run({cfg,db,api,fetcher:stubFetch(),githubToken:ghToken,log:()=>{}});
  const first=db.queries.find(x=>x.sql.startsWith("INSERT"));
  assert.equal(Buffer.isBuffer(first.params[1]),true);
  assert.equal(first.params[1].length,32);
  assert.equal(db.queries.some(x=>x.sql.includes("holder_digest=NULL")&&x.sql.includes("pending_external_step IS NULL")),true);
});
