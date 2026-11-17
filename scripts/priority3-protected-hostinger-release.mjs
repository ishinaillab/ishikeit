#!/usr/bin/env node
// Priority 3 single-writer Hostinger controller. Only for manual, main-only,
// separately owner-approved GitHub Actions. Any uncertain hosted operation
// remains pending in PostgreSQL, including after lease expiry.
import {randomBytes,createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import pg from "pg";

const PROJECT="vhmrliqemkfxblzsoyaz", USER="u328762438",
  DOMAIN="apps.ishinaillab.com", INSTALL="01a1e342-947f-70f3-b65e-144a94b21856";
const SCOPE="ishikeit_priority3_production";
const HOST="https://developers.hostinger.com";
const URLROOT="/api/hosting/v1/accounts/"+USER+"/websites/"+DOMAIN;
const BUILDS=URLROOT+"/nodejs/builds";
const SETTINGS=BUILDS+"/settings";
const AUTODEPLOY=URLROOT+"/git/auto-deployments/settings";
const shaPattern=/^[0-9a-f]{40}$/u;
const uuidPattern=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;

function insist(ok,msg){if(!ok)throw Error(msg)}
export function validateConfig(cfg){
  insist(cfg&&typeof cfg==="object","Configuration absent");
  insist(shaPattern.test(cfg.appSha)&&shaPattern.test(cfg.dbSha),"Protected commit identity invalid");
  insist(shaPattern.test(cfg.oldSha)&&uuidPattern.test(cfg.oldUuid),"Existing build identity invalid");
  insist(cfg.appSha!==cfg.oldSha,"Deployment target must differ from already deployed SHA");
  insist(["preflight","deploy","reconcile"].includes(cfg.mode),
    "Unsupported protected release operation");
  return cfg;
}
export function validateDatabaseUrl(value){
  let u;
  try{u=new URL(value)}catch{throw Error("Production database connection unavailable")}
  insist(["postgres:","postgresql:"].includes(u.protocol),"Expected PostgreSQL");
  insist(u.hostname.endsWith(".supabase.com")||u.hostname.endsWith(".supabase.co"),
    "Unexpected database domain");
  insist(u.hostname.includes(PROJECT)||decodeURIComponent(u.username).endsWith("."+PROJECT),
    "Database project identity mismatched");
  insist(Boolean(u.password),"Database credential missing");
}
export function parseBuild(raw){
  const b=raw?.build??raw?.data??raw;
  insist(b&&typeof b==="object"&&!Array.isArray(b),"Missing Hostinger build record");
  const src=b.options?.source_options??b.source_options??{};
  return {
    uuid:b.uuid??b.id,
    status:b.state??b.status,
    sha:src.commit?.hash??b.commit?.hash,
    source:b.options?.source_type??b.source_type,
    originOwner:src.owner,originRepo:src.repository,originBranch:src.branch
  };
}
export function assertBuildOrigin(b){
  insist(b?.source==="git"&&b.originOwner==="ishinaillab"&&
    b.originRepo==="ishikeit"&&b.originBranch==="main",
    "Hostinger build source does not match approved owner/repo/main");
}
export function releaseBuildSettings(){
  return {node_version:24,app_type:"fastify",root_directory:".",
    output_directory:"",build_script:"build",
    entry_file:"dist/processes/http.js",package_manager:"npm",
    source_type:"git",
    source_options:{owner:"ishinaillab",repository:"ishikeit",
      branch:"main",installation_uuid:INSTALL}};
}
export function createHostingerClient(fetcher,token){
  insist(typeof token==="string"&&token.length>=24,"Protected Hostinger API token absent");
  async function call(method,path,body){
    insist(path.startsWith(URLROOT+"/")&&!path.includes(".."),"Unapproved Hostinger path");
    const res=await fetcher(HOST+path,{
      method,redirect:"error",signal:AbortSignal.timeout(25000),
      headers:{Authorization:"Bearer "+token,Accept:"application/json",
        ...(body?{"Content-Type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(method==="GET"&&path===AUTODEPLOY&&res.status===404)return {absent:true};
    insist(res.ok,"Hostinger API refused request, HTTP "+res.status);
    const data=await res.json();
    insist(data&&typeof data==="object","Hostinger API response invalid");
    return data;
  }
  return {
    async assertAutoOff(){
      const status=await call("GET",AUTODEPLOY);
      insist(status.absent===true,"Cannot prove Hostinger Git auto-deploy is disabled");
    },
    async assertBuildSettings(){
      // Settings come from the same authenticated site as the authoritative
      // build list. Do not deploy to a different framework or entry point.
      const raw=await call("GET",SETTINGS);
      const s=raw.data??raw;
      insist(s&&typeof s==="object"&&!Array.isArray(s),
        "Hostinger Node.js build settings unavailable");
      for(const [key,value] of Object.entries({
        node_version:24,app_type:"fastify",build_script:"build",
        entry_file:"dist/processes/http.js",package_manager:"npm"
      })){
        insist(s[key]===value,"Hostinger saved build setting drifted: "+key);
      }
      insist([null,undefined,"","."].includes(s.root_directory),
        "Hostinger application root directory drifted");
      insist([null,undefined,""].includes(s.output_directory),
        "Hostinger output directory drifted");
    },
    async latest(){
      const data=await call("GET",BUILDS+"?page=1&per_page=1");
      const items=Array.isArray(data)?data:(data.data??data.builds);
      insist(Array.isArray(items)&&items.length===1,"Latest Hostinger build ambiguous");
      return parseBuild(items[0]);
    },
    async get(uuid){
      insist(uuidPattern.test(uuid),"Hostinger build UUID invalid");
      return parseBuild(await call("GET",BUILDS+"/"+uuid));
    },
    async start(){
      const b=await call("POST",BUILDS,releaseBuildSettings());
      const item=b.build??b.data??b;
      const uuid=item.uuid??item.id;
      insist(uuidPattern.test(uuid),"Hostinger accepted build but UUID missing");
      return uuid;
    }
  };
}
export function createReleaseFence(query){
  const secret=randomBytes(32);
  const digest=createHash("sha256").update(secret).digest();
  let generation=null,armed=false;
  function args(cfg){return [SCOPE,digest,cfg.appSha,cfg.dbSha]}
  async function update(sql,bind,error){
    const r=await query(sql,bind);
    insist(r.rows.length===1,error);
    return r.rows[0];
  }
  return {
    get armed(){return armed},
    get acquired(){return generation!==null},
    async acquire(cfg){
      const row=await update(
        "INSERT INTO public.ishikeit_release_ownership "+
        "(scope,generation,holder_digest,app_main_sha,db_main_sha,expires_at,updated_at) "+
        "VALUES ($1,1,$2,$3,$4,clock_timestamp()+interval '15 minutes',clock_timestamp()) "+
        "ON CONFLICT(scope) DO UPDATE SET "+
        "generation=public.ishikeit_release_ownership.generation+1,"+
        "holder_digest=EXCLUDED.holder_digest,app_main_sha=EXCLUDED.app_main_sha,"+
        "db_main_sha=EXCLUDED.db_main_sha,expires_at=clock_timestamp()+interval '15 minutes',"+
        "updated_at=clock_timestamp() WHERE "+
        "(public.ishikeit_release_ownership.holder_digest IS NULL OR "+
        "public.ishikeit_release_ownership.expires_at<=clock_timestamp()) "+
        "AND public.ishikeit_release_ownership.pending_external_step IS NULL "+
        "RETURNING generation",args(cfg),
        "Another release owns the lease, or previous external action is unresolved");
      generation=Number(row.generation);
      insist(Number.isSafeInteger(generation)&&generation>0,"Invalid lease generation");
    },
    async check(cfg){
      insist(generation!==null,"No acquired release");
      await update("SELECT 1 FROM public.ishikeit_release_ownership "+
        "WHERE scope=$1 AND holder_digest=$2 AND app_main_sha=$3 AND db_main_sha=$4 "+
        "AND generation=$5 AND expires_at>clock_timestamp() "+
        "AND pending_external_step IS NULL",
        [...args(cfg),generation],"Release lease invalid or stale");
    },
    async renew(cfg){
      await update("UPDATE public.ishikeit_release_ownership "+
        "SET expires_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp() "+
        "WHERE scope=$1 AND holder_digest=$2 AND app_main_sha=$3 AND db_main_sha=$4 "+
        "AND generation=$5 AND expires_at>clock_timestamp() RETURNING generation",
        [...args(cfg),generation],"Owner lease expired or changed");
    },
    async arm(cfg){
      await this.check(cfg);
      await update("UPDATE public.ishikeit_release_ownership "+
        "SET pending_external_step='app_deploy',"+
        "pending_external_step_at=clock_timestamp(),updated_at=clock_timestamp() "+
        "WHERE scope=$1 AND holder_digest=$2 AND app_main_sha=$3 AND db_main_sha=$4 "+
        "AND generation=$5 AND expires_at>clock_timestamp() "+
        "AND pending_external_step IS NULL RETURNING generation",
        [...args(cfg),generation],"Unable to durably arm hosted release");
      armed=true;
    },
    async resolve(cfg){
      insist(armed,"No armed external step to verify");
      await update("UPDATE public.ishikeit_release_ownership "+
        "SET holder_digest=NULL,generation=generation+1,"+
        "expires_at=clock_timestamp(),verified_app_deploy_at=clock_timestamp(),"+
        "pending_external_step=NULL,pending_external_step_at=NULL,updated_at=clock_timestamp() "+
        "WHERE scope=$1 AND holder_digest=$2 AND app_main_sha=$3 AND db_main_sha=$4 "+
        "AND generation=$5 AND expires_at>clock_timestamp() "+
        "AND pending_external_step='app_deploy' RETURNING generation",
        [...args(cfg),generation],"Verified deployed release could not be reconciled");
      armed=false;
    },
    async releaseUnarmed(cfg){
      insist(!armed,"Refuse to discard uncertain hosted release");
      if(generation===null)return;
      await update("UPDATE public.ishikeit_release_ownership "+
        "SET holder_digest=NULL,generation=generation+1,expires_at=clock_timestamp(),"+
        "updated_at=clock_timestamp() "+
        "WHERE scope=$1 AND holder_digest=$2 AND app_main_sha=$3 AND db_main_sha=$4 "+
        "AND generation=$5 AND expires_at>clock_timestamp() "+
        "AND pending_external_step IS NULL RETURNING generation",
        [...args(cfg),generation],"Unarmed owner release failed");
    }
  };
}
// A previously armed external operation is never cleared just by lease expiry.
// Only an exact verified hosted deployment, under fresh protected owner
// approvals, permits reconciliation; active release holders cannot be bypassed.
export async function reconcileCompletedExternalStep(query,cfg){
  const result=await query(
    "UPDATE public.ishikeit_release_ownership "+
    "SET pending_external_step=NULL,pending_external_step_at=NULL,"+
    "verified_app_deploy_at=clock_timestamp(),holder_digest=NULL,"+
    "generation=generation+1,expires_at=clock_timestamp(),updated_at=clock_timestamp() "+
    "WHERE scope=$1 AND app_main_sha=$2 AND db_main_sha=$3 "+
    "AND pending_external_step='app_deploy' "+
    "AND expires_at<=clock_timestamp() RETURNING generation",
    [SCOPE,cfg.appSha,cfg.dbSha]);
  insist(result.rows.length===1,
    "No expired matching external build hold, or release owner still active");
}
export async function assertGitHeads(fetcher,token,cfg){
  insist(typeof token==="string"&&token.length>=16,"Readback GitHub token unavailable");
  for(const [name,expected] of [["ishikeit",cfg.appSha],["ishikeit-db",cfg.dbSha]]){
    const res=await fetcher("https://api.github.com/repos/ishinaillab/"+name+"/commits/main",{
      method:"GET",redirect:"error",signal:AbortSignal.timeout(20000),
      headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
        "User-Agent":"ishikeit-protected-release",
        "X-GitHub-Api-Version":"2022-11-28"}
    });
    insist(res.status===200,"GitHub protected branch readback unavailable");
    const data=await res.json();
    insist(data?.sha===expected,"Protected GitHub HEAD drifted: "+name);
  }
}
export async function assertHealth(fetcher){
  for(const [route,expected] of [["/health/live","ok"],["/health/ready","ready"]]){
    const res=await fetcher("https://"+DOMAIN+route,{
      method:"GET",redirect:"error",signal:AbortSignal.timeout(10000)});
    insist(res.status===200,"Hostinger health "+route+" failed");
    const body=await res.json();
    insist(body?.status===expected,"Hostinger health response invalid");
  }
}
const pause=ms=>delay(ms);
export async function run({cfg,db,api,fetcher=globalThis.fetch,githubToken,
  sleep=pause,maxPolls=160,log=console.log}){
  const fence=createReleaseFence((...args)=>db.query(...args));
  let didArm=false,finished=false;
  try{
    await assertGitHeads(fetcher,githubToken,cfg);
    await api.assertAutoOff();
    await api.assertBuildSettings();
    const old=await api.latest();
    assertBuildOrigin(old);
    if(cfg.mode!=="reconcile")insist(
      old.uuid===cfg.oldUuid&&old.sha===cfg.oldSha&&old.status==="completed",
      "Hostinger current live build does not match expected old source");
    const migration=await db.query("SELECT count(*)::int AS total FROM supabase_migrations.schema_migrations");
    insist(Number(migration.rows[0]?.total)===44,"Production migration acceptance not 44/44");
    const n=await db.query("SELECT "+
      "(SELECT count(*) FROM public.ishikeit_account_connections)::int AS links,"+
      "(SELECT count(*) FROM public.ishikeit_active_disconnect_cleanup)::int AS cleanup");
    insist(Number(n.rows[0]?.links)===0&&Number(n.rows[0]?.cleanup)===0,
      "Live native connections/cleanup require separate release treatment");
    if(cfg.mode==="reconcile"){
      insist(old.status==="completed"&&old.sha===cfg.appSha,
        "No completed deployed Hostinger build matching protected SHA");
      await assertHealth(fetcher);
      await assertGitHeads(fetcher,githubToken,cfg);
      await api.assertAutoOff();
      await api.assertBuildSettings();
      const after=await api.latest();
      assertBuildOrigin(after);
      insist(after.status==="completed"&&after.uuid===old.uuid&&after.sha===cfg.appSha,
        "Hosted build changed during authoritative readback");
      await reconcileCompletedExternalStep((...args)=>db.query(...args),cfg);
      finished=true;
      log("Previously uncertain external Hostinger step verified and reconciled");
      return {mode:"reconciled",buildUuid:old.uuid};
    }
    await fence.acquire(cfg);
    await assertGitHeads(fetcher,githubToken,cfg);
    await fence.check(cfg);
    await api.assertAutoOff();
    await api.assertBuildSettings();
    const oldAgain=await api.latest();
    assertBuildOrigin(oldAgain);
    insist(oldAgain.uuid===cfg.oldUuid&&oldAgain.sha===cfg.oldSha,
      "Hostinger deployment changed during admission");
    if(cfg.mode==="preflight"){
      await fence.releaseUnarmed(cfg);finished=true;
      log("Protected Hostinger admission passed; NO DEPLOYMENT attempted");
      return {mode:"preflight",buildUuid:null};
    }
    // Persist a hard stop before POST; a timeout after this may have built.
    await fence.arm(cfg);didArm=true;
    await assertGitHeads(fetcher,githubToken,cfg);
    const uuid=await api.start();
    log("Hostinger build admitted; external step remains fenced");
    for(let i=0;i<maxPolls;i++){
      await fence.renew(cfg);
      const b=await api.get(uuid);
      assertBuildOrigin(b);
      if(b.status==="failed")throw Error("Hostinger build failed; owner reconciliation required");
      if(b.status==="completed"){
        insist(b.sha===cfg.appSha,"Built commit differs from authorized main");
        await assertGitHeads(fetcher,githubToken,cfg);
        const active=await api.latest();
        assertBuildOrigin(active);
        insist(active.uuid===uuid&&active.sha===cfg.appSha&&active.status==="completed",
          "Latest deployed Hostinger build does not match authorized source");
        await assertHealth(fetcher);
        await api.assertAutoOff();
        await api.assertBuildSettings();
        await fence.resolve(cfg);finished=true;
        log("Hostinger exact deployment verified and lease reconciled");
        return {mode:"deployed",buildUuid:uuid};
      }
      insist(["pending","running","building"].includes(b.status),
        "Unknown Hostinger build state; fail closed");
      await sleep(10000);
    }
    throw Error("Hostinger build timeout; pending step remains locked");
  }finally{
    if(!didArm&&!finished&&fence.acquired){
      await fence.releaseUnarmed(cfg);
    }
    // Once a hosted action is armed NEVER clear it without verified outcome.
  }
}
export async function main(env=process.env){
  const cfg=validateConfig({
    appSha:env.ISHIKEIT_RELEASE_APP_SHA,dbSha:env.ISHIKEIT_RELEASE_DB_SHA,
    oldUuid:env.ISHIKEIT_EXPECTED_HOSTINGER_BUILD_UUID,
    oldSha:env.ISHIKEIT_EXPECTED_HOSTINGER_BUILD_SHA,
    mode:env.ISHIKEIT_RELEASE_OPERATION
  });
  validateDatabaseUrl(env.ISHIKEIT_DATABASE_URL);
  const api=createHostingerClient(globalThis.fetch,env.ISHIKEIT_HOSTINGER_API_TOKEN);
  const db=new pg.Client({connectionString:env.ISHIKEIT_DATABASE_URL,
    ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,
    application_name:"ishikeit_priority3_hostinger_release"});
  await db.connect();
  try{
    const result=await run({cfg,db,api,
      githubToken:env.ISHIKEIT_GITHUB_READBACK_TOKEN});
    console.log("Priority 3 release outcome: "+result.mode);
  }finally{await db.end()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error("Priority 3 release FAILED CLOSED; inspect approved Hostinger build and PostgreSQL lease privately");process.exitCode=1});
}
