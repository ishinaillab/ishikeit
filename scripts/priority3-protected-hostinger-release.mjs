#!/usr/bin/env node
// Priority 3 single-writer Hostinger controller. Only for manual, main-only,
// separately owner-approved GitHub Actions. Any uncertain hosted operation
// remains pending in PostgreSQL, including after lease expiry.
import {randomBytes,createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import pg from "pg";
import {verifiedSupabaseSsl} from "./priority3-supabase-tls.mjs";

const PROJECT="vhmrliqemkfxblzsoyaz", USER="u328762438",
  DOMAIN="apps.ishinaillab.com", INSTALL="01a1e342-947f-70f3-b65e-144a94b21856";
const SCOPE="ishikeit_priority3_production";
const HOST="https://developers.hostinger.com";
const URLROOT="/api/hosting/v1/accounts/"+USER+"/websites/"+DOMAIN;
const BUILDS=URLROOT+"/nodejs/builds";
const SETTINGS=BUILDS+"/settings";
const AUTODEPLOY=URLROOT+"/git/auto-deployments/settings";
const GIT_INSTALLATIONS="/api/hosting/v1/git/installations";
const GIT_INSTALLATION_REPOS=GIT_INSTALLATIONS+"/"+INSTALL+"/repositories";
const AUTODEPLOY_FIELDS=[
  "installation_uuid","is_enabled","owner","repository","branch","directory"
];
const shaPattern=/^[0-9a-f]{40}$/u;
const uuidPattern=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;

function insist(ok,msg){if(!ok)throw Error(msg)}
export function validateConfig(cfg){
  insist(cfg&&typeof cfg==="object","Configuration absent");
  insist(shaPattern.test(cfg.appSha)&&shaPattern.test(cfg.dbSha),"Protected commit identity invalid");
  insist(shaPattern.test(cfg.oldSha)&&uuidPattern.test(cfg.oldUuid),"Existing build identity invalid");
  insist(cfg.appSha!==cfg.oldSha,"Deployment target must differ from already deployed SHA");
  insist(["provider-preflight","preflight","deploy","reconcile",
    "reconcile-historical"].includes(cfg.mode),
    "Unsupported protected release operation");
  if(cfg.mode==="reconcile-historical"){
    insist(shaPattern.test(cfg.heldAppSha)&&cfg.heldAppSha===cfg.oldSha,
      "Historical held SHA must exactly match the currently deployed build");
    insist(cfg.heldAppSha!==cfg.appSha,
      "Historical hold must precede current protected main");
  }else{
    insist(cfg.heldAppSha===undefined,
      "Historical source may be supplied only for historical reconciliation");
  }
  return cfg;
}
export function validateDatabaseUrl(value){
  let u;
  try{u=new URL(value)}catch{throw Error("Production database connection unavailable")}
  insist(["postgres:","postgresql:"].includes(u.protocol),"Expected PostgreSQL");
  // A generic *.supabase.com suffix plus a project substring in the username
  // cannot establish that this credential will reach *this* production DB.
  // Pin the exact direct host, or the documented Singapore Supavisor pooler.
  const direct=u.hostname==="db."+PROJECT+".supabase.co";
  const pooler=/^aws-[0-9]+-ap-southeast-1\.pooler\.supabase\.com$/u.test(u.hostname);
  insist(direct||pooler,"Unexpected production database endpoint");
  insist(decodeURIComponent(u.username)===(direct?"postgres":"postgres."+PROJECT),
    "Database project identity mismatched");
  insist(u.pathname==="/postgres"&&["","5432","6543"].includes(u.port),
    "Unexpected production database name or port");
  insist(!u.search&&!u.hash,"Unapproved database connection URL options");
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
    originOwner:src.owner,originRepo:src.repository,originBranch:src.branch,
    originInstallation:src.installation_uuid,
    ...(typeof b.created_at==="string"?{createdAt:b.created_at}:{})
  };
}
export function assertBuildOrigin(b,requireApprovedInstallation=false){
  insist(b?.source==="git"&&b.originOwner==="ishinaillab"&&
    b.originRepo==="ishikeit"&&b.originBranch==="main",
    "Hostinger build source does not match approved owner/repo/main");
  // Legacy deployment may have used an older installation; *new* builds
  // must read back the exact installation used by the protected controller.
  if(requireApprovedInstallation)insist(b.originInstallation===INSTALL,
    "Hostinger build Git installation differs from approved installation");
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
    insist((path.startsWith(URLROOT+"/")||
      (method==="GET"&&[GIT_INSTALLATIONS+"?provider=github&status=active",
        GIT_INSTALLATION_REPOS].includes(path)))&&!path.includes(".."),
      "Unapproved Hostinger path");
    const res=await fetcher(HOST+path,{
      method,redirect:"error",signal:AbortSignal.timeout(25000),
      headers:{Authorization:"Bearer "+token,Accept:"application/json",
        ...(body?{"Content-Type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    insist(res.ok,"Hostinger API refused request, HTTP "+res.status);
    const data=await res.json();
    insist(data&&typeof data==="object","Hostinger API response invalid");
    return data;
  }
  return {
    async assertAutoOff(){
      // Hostinger now documents HTTP 200 with all six fields null for no
      // configuration; HTTP 404 is ambiguous and must fail closed.
      const raw=await call("GET",AUTODEPLOY);
      const settings=raw.data??raw;
      insist(settings&&typeof settings==="object"&&!Array.isArray(settings)&&
        AUTODEPLOY_FIELDS.every(key=>Object.hasOwn(settings,key)),
        "Cannot prove Hostinger Git auto-deploy is disabled: incomplete readback");
      if(AUTODEPLOY_FIELDS.every(key=>settings[key]===null))return;
      insist(settings.is_enabled===false&&
        settings.installation_uuid===INSTALL&&
        settings.owner==="ishinaillab"&&
        settings.repository==="ishikeit"&&
        settings.branch==="main"&&
        settings.directory==="",
        "Cannot prove Hostinger Git auto-deploy is disabled for approved repository");
      // A disabled link for another account/repo/branch cannot be the
      // deployment controller's accepted origin; reject configuration drift.
    },
    async assertGitInstallationAccess(){
      // Prove that the exact Git installation can access main before arming
      // an external step that cannot be cleared without reconciliation.
      const list=await call("GET",GIT_INSTALLATIONS+"?provider=github&status=active");
      const installations=Array.isArray(list)?list:list.data;
      insist(Array.isArray(installations),
        "Hostinger Git installations readback incomplete");
      const identity=installations.find(x=>x?.uuid===INSTALL);
      insist(identity?.provider==="github"&&identity.account_login==="ishinaillab"&&
        identity.status==="active"&&
        (identity.account_type!=="user"||identity.has_oauth===true),
        "Hostinger Git installation is not an active authorized owner connection");
      const repos=await call("GET",GIT_INSTALLATION_REPOS);
      const entries=Array.isArray(repos)?repos:repos.data;
      insist(Array.isArray(entries)&&entries.some(x=>
        x?.full_name==="ishinaillab/ishikeit"&&
        x.owner==="ishinaillab"&&x.name==="ishikeit"&&
        x.default_branch==="main"),
        "Hostinger Git installation cannot prove access to approved repository");
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
    async disableAutoDeploy(){
      // Hostinger may re-enable push-triggered auto-deploy as a side effect
      // of Git-sourced Node.js build admission. A protected runtime release
      // must restore manual-only mode BEFORE accepting its hosted outcome.
      // The documented DELETE preserves the already deployed files.
      await call("DELETE",AUTODEPLOY);
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
/** A historical Hostinger build may have completed immediately before a
 * protected pull-request merge changed main. We NEVER relax current HEAD
 * validation. Instead check a bounded, single-parent immutable Git history
 * from the current authenticated main SHA to the exact historical held SHA.
 */
export async function assertHistoricalGitAncestry(fetcher,token,cfg){
  insist(typeof token==="string"&&token.length>=16,
    "GitHub historical ancestry credential unavailable");
  insist(shaPattern.test(cfg.heldAppSha)&&cfg.heldAppSha!==cfg.appSha,
    "Historical held source identity invalid");
  let sha=cfg.appSha;
  const seen=new Set();
  for(let i=0;i<16;i++){
    insist(!seen.has(sha),"GitHub ancestry cycle detected");
    seen.add(sha);
    const res=await fetcher(
      "https://api.github.com/repos/ishinaillab/ishikeit/git/commits/"+sha,{
        method:"GET",redirect:"error",signal:AbortSignal.timeout(20000),
        headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
          "User-Agent":"ishikeit-protected-release",
          "X-GitHub-Api-Version":"2022-11-28"}
      });
    insist(res.status===200,"Protected GitHub ancestry readback unavailable");
    const commit=await res.json();
    insist(commit?.sha===sha&&Array.isArray(commit.parents)&&
      commit.parents.length===1&&shaPattern.test(commit.parents[0]?.sha),
      "Protected historical GitHub ancestry unverified");
    const parent=commit.parents[0].sha;
    if(parent===cfg.heldAppSha)return;
    sha=parent;
  }
  throw Error("Historical held SHA not reachable within protected GitHub main history");
}

/** The only allowed historical hold settlement is a fully verified exact
 * hosted build: same SHA, Git installation, completion and build timestamp
 * immediately following the original external-step arm. Never "fix" the
 * hold by changing its app SHA to the current main branch.
 */
export async function reconcileHistoricalExternalStep(query,cfg,build){
  insist(build?.uuid===cfg.oldUuid&&build?.sha===cfg.heldAppSha&&
    build?.status==="completed","Historical Hostinger build identity mismatch");
  assertBuildOrigin(build,true);
  insist(typeof build.createdAt==="string"&&
    Number.isFinite(Date.parse(build.createdAt)),
    "Historical Hostinger build creation timestamp missing");
  const read=await query(
    "SELECT generation,app_main_sha,db_main_sha,pending_external_step,"+
    "pending_external_step_at,pending_external_step_at::text AS pending_external_step_at_exact,"+
    "expires_at<=clock_timestamp() AS expired "+
    "FROM public.ishikeit_release_ownership WHERE scope=$1",[SCOPE]);
  insist(read.rows.length===1,"Historical release hold unavailable");
  const hold=read.rows[0];
  insist(hold.app_main_sha===cfg.heldAppSha&&hold.db_main_sha===cfg.dbSha&&
    hold.pending_external_step==="app_deploy"&&hold.expired===true,
    "Historical release hold is not the exact expired app_deploy step");
  const generation=Number(hold.generation);
  // node-postgres parses timestamptz into JS Date at millisecond resolution,
  // silently truncating PostgreSQL's microseconds. Use that Date ONLY for
  // the 15-second time-window check; bind the server's exact ::text value
  // back as timestamptz in the immutable CAS to retain all six digits.
  const pendingAtExact=hold.pending_external_step_at_exact;
  insist(typeof pendingAtExact==="string"&&pendingAtExact.length>19,
    "Historical pending timestamp precision unavailable");
  const pendingAt=Date.parse(hold.pending_external_step_at);
  insist(Number.isSafeInteger(generation)&&generation>0&&
    Number.isFinite(pendingAt)&&
    Math.abs(Date.parse(build.createdAt)-pendingAt)<=15000,
    "Historical build creation did not match the armed external-step timestamp");
  const updated=await query(
    "UPDATE public.ishikeit_release_ownership SET "+
    "pending_external_step=NULL,pending_external_step_at=NULL,"+
    "verified_app_deploy_at=clock_timestamp(),holder_digest=NULL,"+
    "generation=generation+1,expires_at=clock_timestamp(),"+
    "updated_at=clock_timestamp() "+
    "WHERE scope=$1 AND app_main_sha=$2 AND db_main_sha=$3 "+
    "AND generation=$4 AND pending_external_step_at=$5::timestamptz "+
    "AND pending_external_step='app_deploy' "+
    "AND expires_at<=clock_timestamp() RETURNING generation",
    [SCOPE,cfg.heldAppSha,cfg.dbSha,generation,pendingAtExact]);
  insist(updated.rows.length===1,
    "Historical external-step CAS changed; retain pending release hold");
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
    const res=await fetcher("https://api.github.com/repos/ishinaillab/"+name+"/git/ref/heads/main",{
      method:"GET",redirect:"error",signal:AbortSignal.timeout(20000),
      headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
        "User-Agent":"ishikeit-protected-release",
        "X-GitHub-Api-Version":"2022-11-28"}
    });
    insist(res.status===200,"GitHub protected branch readback unavailable");
    const data=await res.json();
    insist(data?.ref==="refs/heads/main"&&data?.object?.type==="commit"&&
      data.object.sha===expected,"Protected GitHub HEAD drifted: "+name);
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
// The protected Hostinger build must not be admitted against the old
// 44-migration schema or an untrusted/dormant trigger. Check actual PG17
// catalog state and exact migration provenance; no DDL or lease is performed.
export async function assertProtectedNativeSchema(db){
// A 44-migration baseline is NOT safe for the updated native outbox
// worker boundary. Require the exact 45th migration and a live enabled,
// least-privileged trigger, not a version count alone. This query is
// read-only and must complete before acquiring any lease or Hostinger POST.
const migration=await db.query(
  "SELECT (SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS total,"+
  "EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations "+
  "WHERE version='20261118222000') AS guard_version,"+
  "EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t "+
  "JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid "+
  "WHERE t.tgrelid=to_regclass('public.outbox') "+
  "AND t.tgname='ishikeit_native_outbox_write_fence' "+
  "AND t.tgenabled='O' AND NOT t.tgisinternal "+
  "AND p.oid=to_regprocedure('public.ishikeit_guard_native_outbox_write()') "+
  "AND NOT p.prosecdef "+
  "AND NOT has_function_privilege('anon',p.oid,'EXECUTE') "+
  "AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')) "+
  "AS guard_enabled");
insist(Number(migration.rows[0]?.total)===45&&
  migration.rows[0]?.guard_version===true&&
  migration.rows[0]?.guard_enabled===true,
  "Production native outbox write-fence migration 45/45 is absent or disabled");
}
const pause=ms=>delay(ms);
export async function run({cfg,db,api,fetcher=globalThis.fetch,githubToken,
  sleep=pause,maxPolls=160,log=console.log}){
  const fence=createReleaseFence((...args)=>db.query(...args));
  let didArm=false,finished=false;
  // Fixed, non-sensitive stage identifiers only. Never log provider or DB
  // error text, bearer credentials, OAuth codes or response bodies.
  const historicalStage=stage=>{
    if(cfg.mode==="reconcile-historical")
      log("Priority 3 historical reconciliation stage: "+stage);
  };
  try{
    historicalStage("github_ref_initial");
    await assertGitHeads(fetcher,githubToken,cfg);
    historicalStage("hostinger_auto_deploy_initial");
    await api.assertAutoOff();
    historicalStage("hostinger_installation_initial");
    await api.assertGitInstallationAccess();
    historicalStage("hostinger_settings_initial");
    await api.assertBuildSettings();
    historicalStage("hostinger_latest_initial");
    const old=await api.latest();
    assertBuildOrigin(old,["reconcile","reconcile-historical"].includes(cfg.mode));
    if(cfg.mode!=="reconcile"){
      insist(old.uuid===cfg.oldUuid&&old.sha===cfg.oldSha&&old.status==="completed",
        "Hostinger current live build does not match expected old source");
      // Admission must not report success when the existing service is down.
      // Check before acquiring any release lease or preparing a hosted action.
      historicalStage("health_admission");
      await assertHealth(fetcher);
    }
    if(cfg.mode==="provider-preflight"){
      // Before schema migration 45, prove the Hostinger API credential,
      // owner-approved Git installation, saved build settings and immutable
      // existing deployment. This read-only gate never touches PostgreSQL
      // or attempts a Hostinger build.
      await assertGitHeads(fetcher,githubToken,cfg);
      await api.assertAutoOff();
      await api.assertGitInstallationAccess();
      await api.assertBuildSettings();
      const current=await api.latest();
      assertBuildOrigin(current);
      insist(current.uuid===cfg.oldUuid&&current.sha===cfg.oldSha&&
        current.status==="completed",
        "Hostinger current build changed during provider-only preflight");
      await assertHealth(fetcher);
      finished=true;
      log("Protected Hostinger provider-only preflight passed; no database access or deployment");
      return {mode:"provider-preflight",buildUuid:null};
    }
    historicalStage("schema_readback");
    await assertProtectedNativeSchema(db);
    historicalStage("native_account_counts");
    const n=await db.query("SELECT "+
      "(SELECT count(*) FROM public.ishikeit_account_connections)::int AS links,"+
      "(SELECT count(*) FROM public.ishikeit_active_disconnect_cleanup)::int AS cleanup");
    insist(Number(n.rows[0]?.links)===0&&Number(n.rows[0]?.cleanup)===0,
      "Live native connections/cleanup require separate release treatment");
    if(cfg.mode==="reconcile-historical"){
      insist(old.uuid===cfg.oldUuid&&old.sha===cfg.heldAppSha&&
        old.status==="completed","Historical completed hosted build mismatch");
      historicalStage("git_ancestry");
      await assertHistoricalGitAncestry(fetcher,githubToken,cfg);
      historicalStage("health_final");
      await assertHealth(fetcher);
      historicalStage("github_ref_final");
      await assertGitHeads(fetcher,githubToken,cfg);
      historicalStage("hostinger_auto_deploy_final");
      await api.assertAutoOff();
      historicalStage("hostinger_installation_final");
      await api.assertGitInstallationAccess();
      historicalStage("hostinger_settings_final");
      await api.assertBuildSettings();
      historicalStage("hostinger_latest_final");
      const after=await api.latest();
      assertBuildOrigin(after,true);
      insist(after.status==="completed"&&after.uuid===old.uuid&&
        after.sha===cfg.heldAppSha&&after.createdAt===old.createdAt,
        "Historical Hostinger build changed during protected readback");
      historicalStage("hold_cas");
      await reconcileHistoricalExternalStep((...args)=>db.query(...args),cfg,after);
      historicalStage("hold_reconciled");
      finished=true;
      log("Historical protected Hostinger external step independently verified and reconciled");
      return {mode:"reconciled-historical",buildUuid:after.uuid};
    }
    if(cfg.mode==="reconcile"){
      insist(old.status==="completed"&&old.sha===cfg.appSha,
        "No completed deployed Hostinger build matching protected SHA");
      await assertHealth(fetcher);
      await assertGitHeads(fetcher,githubToken,cfg);
      await api.assertAutoOff();
      await api.assertGitInstallationAccess();
      await api.assertBuildSettings();
      const after=await api.latest();
      assertBuildOrigin(after,true);
      insist(after.status==="completed"&&after.uuid===old.uuid&&after.sha===cfg.appSha,
        "Hosted build changed during authoritative readback");
      await reconcileCompletedExternalStep((...args)=>db.query(...args),cfg);
      finished=true;
      log("Previously uncertain external Hostinger step verified and reconciled");
      return {mode:"reconciled",buildUuid:old.uuid};
    }
    if(cfg.mode==="preflight"){
      // Preflight never writes to PostgreSQL. It can only report whether a
      // lease appears available; deploy itself must acquire the actual CAS lease.
      const status=await db.query(
        "SELECT count(*)::int AS busy FROM public.ishikeit_release_ownership "+
        "WHERE scope=$1 AND (pending_external_step IS NOT NULL OR "+
        "(holder_digest IS NOT NULL AND expires_at>clock_timestamp()))",
        [SCOPE]);
      insist(Number(status.rows[0]?.busy)===0,
        "Protected release lease is held or an external action is unresolved");
      await assertGitHeads(fetcher,githubToken,cfg);
      await api.assertAutoOff();
      await api.assertGitInstallationAccess();
      await api.assertBuildSettings();
      const checked=await api.latest();
      assertBuildOrigin(checked);
      insist(checked.uuid===cfg.oldUuid&&checked.sha===cfg.oldSha&&
        checked.status==="completed",
        "Hostinger deployment changed during admission");
      finished=true;
      log("Protected Hostinger read-only preflight passed; no DB writes or deployment");
      return {mode:"preflight",buildUuid:null};
    }
    await fence.acquire(cfg);
    await assertGitHeads(fetcher,githubToken,cfg);
    await fence.check(cfg);
    await api.assertAutoOff();
    await api.assertGitInstallationAccess();
    await api.assertBuildSettings();
    const oldAgain=await api.latest();
    assertBuildOrigin(oldAgain);
    insist(oldAgain.uuid===cfg.oldUuid&&oldAgain.sha===cfg.oldSha&&
      oldAgain.status==="completed",
      "Hostinger deployment changed during admission");
    await assertHealth(fetcher);
    // Complete the last fallible GitHub check BEFORE arming the durable
    // hosted step. A pre-POST readback failure otherwise strands an
    // unresolved hold even though no build request has been submitted.
    await assertGitHeads(fetcher,githubToken,cfg);
    // Persist a hard stop before POST; a timeout after this may have built.
    await fence.arm(cfg);didArm=true;
    const uuid=await api.start();
    // The build endpoint may turn on Git push auto-deploy. Disable immediately
    // under this exclusive lease; any error keeps the armed external-step hold.
    await api.disableAutoDeploy();
    await api.assertAutoOff();
    log("Hostinger build admitted; auto-deploy disabled; step remains fenced");
    for(let i=0;i<maxPolls;i++){
      await fence.renew(cfg);
      const b=await api.get(uuid);
      assertBuildOrigin(b,true);
      if(b.status==="failed")throw Error("Hostinger build failed; owner reconciliation required");
      if(b.status==="completed"){
        insist(b.sha===cfg.appSha,"Built commit differs from authorized main");
        await assertGitHeads(fetcher,githubToken,cfg);
        const active=await api.latest();
        assertBuildOrigin(active,true);
        insist(active.uuid===uuid&&active.sha===cfg.appSha&&active.status==="completed",
          "Latest deployed Hostinger build does not match authorized source");
        await assertHealth(fetcher);
        // Hostinger may restore Git push auto-deploy on build completion.
        // Disable under the still-armed lease BEFORE asserting it is off.
        await api.disableAutoDeploy();
        await api.assertAutoOff();
        await api.assertGitInstallationAccess();
        await api.assertBuildSettings();
        await api.assertAutoOff();
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
    mode:env.ISHIKEIT_RELEASE_OPERATION,
    ...(env.ISHIKEIT_RELEASE_OPERATION==="reconcile-historical"
      ?{heldAppSha:env.ISHIKEIT_HISTORICAL_HELD_APP_SHA}:{})
  });
  const api=createHostingerClient(globalThis.fetch,env.ISHIKEIT_HOSTINGER_API_TOKEN);
  if(cfg.mode==="provider-preflight"){
    // An independent, read-only provider gate can run before the live
    // 45th migration and does not need a production database credential.
    const result=await run({cfg,db:null,api,
      githubToken:env.ISHIKEIT_GITHUB_READBACK_TOKEN});
    console.log("Priority 3 release outcome: "+result.mode);
    return;
  }
  validateDatabaseUrl(env.ISHIKEIT_DATABASE_URL);
  const db=new pg.Client({connectionString:env.ISHIKEIT_DATABASE_URL,
    ssl:verifiedSupabaseSsl(),connectionTimeoutMillis:10000,
    application_name:"ishikeit_priority3_hostinger_release"});
  if(cfg.mode==="reconcile-historical")
    console.log("Priority 3 historical reconciliation stage: postgres_connect");
  await db.connect();
  if(cfg.mode==="reconcile-historical")
    console.log("Priority 3 historical reconciliation stage: postgres_connected");
  try{
    const result=await run({cfg,db,api,
      githubToken:env.ISHIKEIT_GITHUB_READBACK_TOKEN});
    console.log("Priority 3 release outcome: "+result.mode);
  }finally{await db.end()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error("Priority 3 release FAILED CLOSED; inspect approved Hostinger build and PostgreSQL lease privately");process.exitCode=1});
}
