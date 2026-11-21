#!/usr/bin/env node
// Priority 3 manually owner-approved PostgreSQL schema release controller.
// No application route or automated trigger may call this. A hosted migration
// can outlive its client/lease; pending_external_step must persist until
// genuinely verified. Never retry an ambiguous hosted mutation.
import {randomBytes,createHash} from "node:crypto";
import {Buffer} from "node:buffer";
import {readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {spawn} from "node:child_process";
import pg from "pg";
import {assertGitHeads,assertProtectedNativeSchema,validateDatabaseUrl}
  from "./priority3-protected-hostinger-release.mjs";

const SCOPE="ishikeit_priority3_production";
const GUARD_VERSION="20261118222000";
const sha=/^[0-9a-f]{40}$/u;
function insist(ok,reason){if(!ok)throw Error(reason);}
export function validateSchemaReleaseConfig(cfg){
  insist(cfg&&typeof cfg==="object"&&
    sha.test(cfg.appSha)&&sha.test(cfg.dbSha),
  "Protected schema release exact app/DB SHA missing");
  insist(["apply","reconcile"].includes(cfg.operation),
    "Unsupported schema migration release action");
  return cfg;
}
export async function expectedMigrationVersions(dbReleaseDir){
  const dir=resolve(dbReleaseDir,"supabase/migrations");
  const files=await readdir(dir);
  const names=files.filter(x=>x.endsWith(".sql"));
  insist(names.length===45,"Expected exactly 45 protected database SQL files");
  const versions=[];
  for(const name of names){
    const m=/^([0-9]{14})_[a-z][a-z0-9_]*\.sql$/u.exec(name);
    insist(m!==null,"Malformed protected database SQL version");
    versions.push(m[1]);
  }
  versions.sort();
  insist(new Set(versions).size===45&&versions.at(-1)===GUARD_VERSION,
    "Protected database SQL migration history invalid");
  return versions;
}
export async function assertExactRemotePrefix(db,versions,count){
  insist(Array.isArray(versions)&&versions.length===45&&[44,45].includes(count),
    "Protected schema migration expected-version list invalid");
  const result=await db.query(
    "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version");
  insist(result?.rows?.length===count&&result.rows.every(
    (row,i)=>row.version===versions[i]),
    "Hosted database migration history/prefix mismatched");
}
// A readback that proves only that the CLI exited zero is NOT sufficient.
export async function assertLiveMigrationAccepted(db,versions){
  await assertExactRemotePrefix(db,versions,45);
  await assertProtectedNativeSchema(db);
}
function digestSecret(secret){
  return createHash("sha256").update(Buffer.from(secret,"base64url")).digest();
}
async function resolveCurrentOwner(db,cfg,secret,generation){
  const result=await db.query(
    "UPDATE public.ishikeit_release_ownership "+
    "SET pending_external_step=NULL,pending_external_step_at=NULL,"+
    "verified_schema_migration_at=clock_timestamp(),holder_digest=NULL,"+
    "generation=generation+1,expires_at=clock_timestamp(),updated_at=clock_timestamp() "+
    "WHERE scope=$1 AND app_main_sha=$2 AND db_main_sha=$3 "+
    "AND holder_digest=$4 AND generation=$5 AND expires_at>clock_timestamp() "+
    "AND pending_external_step='schema_migration' RETURNING generation",
    [SCOPE,cfg.appSha,cfg.dbSha,digestSecret(secret),generation]);
  insist(result.rows.length===1,
    "Completed schema migration cannot be reconciled by stale release owner");
}
export async function reconcileExpiredSchemaHold(db,cfg){
  const result=await db.query(
    "UPDATE public.ishikeit_release_ownership "+
    "SET pending_external_step=NULL,pending_external_step_at=NULL,"+
    "verified_schema_migration_at=clock_timestamp(),holder_digest=NULL,"+
    "generation=generation+1,expires_at=clock_timestamp(),updated_at=clock_timestamp() "+
    "WHERE scope=$1 AND app_main_sha=$2 AND db_main_sha=$3 "+
    "AND pending_external_step='schema_migration' "+
    "AND expires_at<=clock_timestamp() RETURNING generation",
    [SCOPE,cfg.appSha,cfg.dbSha]);
  insist(result.rows.length===1,
    "No expired matching schema release hold; active owner or mismatch");
}
export async function runProtectedSchemaRelease({
  cfg,db,fence,versions,applyMigration,readbackHeads
}){
  validateSchemaReleaseConfig(cfg);
  insist(typeof applyMigration==="function"&&typeof readbackHeads==="function",
    "Protected schema release dependencies unavailable");
  await readbackHeads();
  if(cfg.operation==="reconcile"){
    // No provider re-submission. A stopped, timed-out or ambiguous migration
    // is reconciled only after an independent exact live schema readback.
    await assertLiveMigrationAccepted(db,versions);
    await readbackHeads();
    await reconcileExpiredSchemaHold(db,cfg);
    return {status:"reconciled"};
  }
  const holderSecret=randomBytes(32).toString("base64url");
  const cmd={scope:SCOPE,holderSecret,appMainSha:cfg.appSha,
    dbMainSha:cfg.dbSha,ttlSeconds:900};
  let owned=null,armed=false;
  // Refuse stale remote prefix BEFORE admission; script may run only once for
  // the exact un-applied reviewed 45th migration, never an arbitrary set.
  await assertExactRemotePrefix(db,versions,44);
  try{
    owned=await fence.acquire(cmd);
    insist(owned!==undefined,"Another release owns the schema migration lease");
    const ticket={...cmd,generation:owned.generation};
    await readbackHeads();
    await assertExactRemotePrefix(db,versions,44);
    insist(await fence.check(ticket),"Protected schema release lease stale");
    // Check external heads BEFORE persistently arming the step: a GitHub
    // outage before any submitted migration must not strand the ownership
    // row with an unresolvable yet never-started hosted operation.
    await readbackHeads();
    insist(await fence.beginExternalStep({...ticket,step:"schema_migration"}),
      "Could not durably arm hosted schema mutation");
    armed=true;
    // From here, all failures preserve an unresolved external-step record.
    // A missing CLI response, timeout or job crash is NOT proof of failure.
    await applyMigration();
    await assertLiveMigrationAccepted(db,versions);
    await readbackHeads();
    insist(await fence.renew(ticket)!==undefined,
      "Schema release lease expired; authorized readback reconciliation required");
    await resolveCurrentOwner(db,cfg,holderSecret,owned.generation);
    return {status:"applied"};
  }finally{
    if(owned!=null&&!armed){
      // Never discard an armed hosted operation, even after a timeout.
      await fence.release({...cmd,generation:owned.generation});
    }
  }
}
// Only the externally owner-approved GitHub Actions runner invokes this.
// The Supabase CLI command itself has no source write permissions and never
// prints credentials or provider response bodies into the release log.
// A child process must not inherit other privileged owner credentials.
// The explicit already-validated --remote argument is its only DB target.
export function migrationCliEnvironment(parent=process.env){
  const allowed=[
    "PATH","Path","HOME","USERPROFILE","TMP","TEMP","TMPDIR",
    "LANG","LC_ALL","SSL_CERT_FILE","SSL_CERT_DIR",
    "CI","GITHUB_ACTIONS","RUNNER_TEMP","RUNNER_TOOL_CACHE","SystemRoot"
  ];
  const child={};
  for(const key of allowed){
    if(typeof parent[key]==="string"&&parent[key].length>0)
      child[key]=parent[key];
  }
  child.PGSSLMODE="require";
  return child;
}
export function pushReviewedMigration(dbReleaseDir,databaseUrl,{
  spawnProcess=spawn,environment=process.env
}={}){
  return new Promise((resolveDone,reject)=>{
    const child=spawnProcess("supabase",
      ["db","push","--yes","--skip-vault","--remote="+databaseUrl],{
        cwd:dbReleaseDir,shell:false,windowsHide:true,
        stdio:"ignore",signal:AbortSignal.timeout(14*60*1000),
        env:migrationCliEnvironment(environment)
      });
    child.once("error",()=>reject(Error("Protected Supabase CLI execution failed")));
    child.once("close",(code,signal)=>{
      if(code===0&&signal===null)resolveDone();
      else reject(Error("Protected Supabase CLI result unknown; reconcile after readback"));
    });
  });
}
export async function main(env=process.env){
  const cfg=validateSchemaReleaseConfig({
    appSha:env.ISHIKEIT_RELEASE_APP_SHA,
    dbSha:env.ISHIKEIT_RELEASE_DB_SHA,
    operation:env.OPERATION
  });
  validateDatabaseUrl(env.DATABASE_URL);
  const dbReleaseDir=resolve(process.cwd(),"db-release");
  const versions=await expectedMigrationVersions(dbReleaseDir);
  const db=new pg.Client({connectionString:env.DATABASE_URL,
    ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,
    application_name:"ishikeit_priority3_schema_release"});
  await db.connect();
  try{
    // Build artifacts originate exclusively from this exact protected
    // reviewed app main revision after CI and independent owner approval.
    const {PostgresPriority3ReleaseFence}=await import(
      "../dist/operations/priority3-release-fence.js");
    const fence=new PostgresPriority3ReleaseFence(db);
    const result=await runProtectedSchemaRelease({
      cfg,db,fence,versions,
      readbackHeads:()=>assertGitHeads(globalThis.fetch,
        env.ISHIKEIT_GITHUB_READBACK_TOKEN,cfg),
      applyMigration:()=>pushReviewedMigration(dbReleaseDir,env.DATABASE_URL)
    });
    console.log("Protected schema release "+result.status+
      " with exact 45-migration source and fenced readback");
  }finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{
    console.error("Protected schema release FAILED CLOSED; inspect pending "+
      "external migration step through owner-approved reconciliation");
    process.exitCode=1;
  });
}
