import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {reconcileExpiredSchemaHold} from "./priority3-protected-schema-lease.mjs";

// Only disposable 127.0.0.1/ishikeit_outbox_test PostgreSQL17. Never remote.
const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(url!==undefined){
  const c=new URL(url);
  if(!["postgres:","postgresql:"].includes(c.protocol)||
    !["127.0.0.1","localhost","::1"].includes(c.hostname)||
    c.pathname!=="/ishikeit_outbox_test")
    throw Error("Refusing to test production release leases on a non-disposable PG database");
}
if(url===undefined){
  test("protected schema migration lease PG17 requires an isolated database",
    {skip:true},()=>{});
}else{
  const pool=new pg.Pool({connectionString:url,max:3,connectionTimeoutMillis:5000});
  const appSha="a".repeat(40),dbSha="b".repeat(40);
  const cfg={appSha,dbSha};
  const scope="ishikeit_priority3_production";
  const cmd=()=>({
    scope,holderSecret:randomBytes(32).toString("base64url"),
    appMainSha:appSha,dbMainSha:dbSha,ttlSeconds:120
  });
  let ReleaseFence;
  before(async()=>{
    for(const file of [
      "0025_priority3_release_ownership_fence.sql",
      "0028_priority3_release_external_step_hold.sql"
    ])await pool.query(await readFile("migrations/"+file,"utf8"));
    ({PostgresPriority3ReleaseFence:ReleaseFence}=await import(
      "../dist/operations/priority3-release-fence.js"));
  });
  beforeEach(async()=>{await pool.query(
    "TRUNCATE public.ishikeit_release_ownership");});
  after(async()=>{
    try{
      await pool.query("DROP TABLE IF EXISTS public.ishikeit_release_ownership");
    }finally{await pool.end();}
  });
  test("external schema migration arm persists and excludes an independent competing owner",async()=>{
    const f=new ReleaseFence(pool),first=cmd(),second=cmd();
    const claim=await f.acquire(first);
    assert.ok(claim);
    const owned={...first,generation:claim.generation};
    assert.equal(await f.beginExternalStep({...owned,step:"schema_migration"}),true);
    assert.equal(await f.release(owned),false);
    assert.equal(await f.acquire(second),undefined);
    const observed=await pool.query(
      "SELECT pending_external_step,verified_schema_migration_at "+
      "FROM public.ishikeit_release_ownership WHERE scope=$1",[scope]);
    assert.deepEqual(observed.rows[0],{
      pending_external_step:"schema_migration",
      verified_schema_migration_at:null
    });
    const status=await f.inspect(scope);
    assert.equal(status.pendingExternalStep,"schema_migration");
  });
  test("only expired, matching schema hold can be resolved after separately proved success",async()=>{
    const f=new ReleaseFence(pool),first=cmd();
    const claim=await f.acquire(first);
    const owned={...first,generation:claim.generation};
    await f.beginExternalStep({...owned,step:"schema_migration"});
    await assert.rejects(reconcileExpiredSchemaHold(pool,cfg),
      /expired matching schema release hold/u);
    await pool.query(
      "UPDATE public.ishikeit_release_ownership "+
      "SET expires_at=clock_timestamp()-interval '1 second' WHERE scope=$1",
      [scope]);
    await assert.rejects(
      reconcileExpiredSchemaHold(pool,{appSha:"f".repeat(40),dbSha}),
      /expired matching schema release hold/u);
    assert.equal((await f.inspect(scope)).pendingExternalStep,"schema_migration");
    await assert.doesNotReject(reconcileExpiredSchemaHold(pool,cfg));
    const observed=await pool.query(
      "SELECT pending_external_step,holder_digest,"+
      "verified_schema_migration_at IS NOT NULL AS verified "+
      "FROM public.ishikeit_release_ownership WHERE scope=$1",[scope]);
    assert.deepEqual(observed.rows[0],{
      pending_external_step:null,holder_digest:null,verified:true
    });
    assert.equal(await f.check(owned),false);
    assert.ok(await f.acquire(cmd()));
  });
  test("expired app deployment hold cannot be mistaken for completed schema migration",async()=>{
    const f=new ReleaseFence(pool),owner=cmd(),claim=await f.acquire(owner);
    await f.beginExternalStep({...owner,generation:claim.generation,step:"app_deploy"});
    await pool.query(
      "UPDATE public.ishikeit_release_ownership "+
      "SET expires_at=clock_timestamp()-interval '1 second' WHERE scope=$1",[scope]);
    await assert.rejects(reconcileExpiredSchemaHold(pool,cfg),
      /expired matching schema release hold/u);
    assert.equal((await f.inspect(scope)).pendingExternalStep,"app_deploy");
  });
}
