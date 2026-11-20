import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import pg from "pg";
import {runProtectedSchemaRelease} from "./priority3-protected-schema-lease.mjs";

// Never run against a hosted or shared DB: this owns temporary SQL catalogs.
const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(url!==undefined){
  const u=new URL(url);
  if(!["postgres:","postgresql:"].includes(u.protocol)||
    !["localhost","127.0.0.1","::1"].includes(u.hostname)||
    u.pathname!=="/ishikeit_outbox_test")
    throw Error("Refusing protected schema end-to-end tests outside disposable PG17");
}
if(url===undefined){
  test("protected schema release e2e needs local PG17",{skip:true},()=>{});
}else{
  const pool=new pg.Pool({connectionString:url,max:3,connectionTimeoutMillis:5000});
  const cfg={appSha:"a".repeat(40),dbSha:"b".repeat(40),operation:"apply"};
  const scope="ishikeit_priority3_production";
  const lastVersion="20261118222000";
  const versions=[...Array.from({length:44},(_,i)=>
    "202610"+String(i+1).padStart(8,"0")),lastVersion];
  let Fence;
  let createdRoles=[];
  const sql={
    query:(query,params)=>pool.query(query,params)
  };
  before(async()=>{
    const known=await pool.query(
      "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])",
      [["anon","authenticated"]]);
    const existing=new Set(known.rows.map(x=>x.rolname));
    for(const role of ["anon","authenticated"]){
      if(existing.has(role))continue;
      await pool.query("CREATE ROLE "+role+" NOLOGIN");
      createdRoles.push(role);
    }
    for(const name of [
      "0001_foundation.sql",
      "0010_ishikeit_workspace_connections.sql",
      "0012_ishikeit_event_tenant_provenance.sql",
      "0025_priority3_release_ownership_fence.sql",
      "0027_priority3_tenant_send_generation_fence.sql",
      "0028_priority3_release_external_step_hold.sql",
      "0029_priority3_native_outbox_write_fence.sql"
    ])await pool.query(await readFile("migrations/"+name,"utf8"));
    await pool.query("CREATE SCHEMA supabase_migrations");
    await pool.query(
      "CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY)");
    await pool.query(
      "INSERT INTO supabase_migrations.schema_migrations(version) SELECT unnest($1::text[])",
      [versions.slice(0,44)]);
    ({PostgresPriority3ReleaseFence:Fence}=await import(
      "../dist/operations/priority3-release-fence.js"));
  });
  beforeEach(async()=>{
    await pool.query("TRUNCATE public.ishikeit_release_ownership");
    await pool.query("DELETE FROM supabase_migrations.schema_migrations WHERE version=$1",
      [lastVersion]);
    await pool.query(
      "ALTER TABLE public.outbox ENABLE TRIGGER ishikeit_native_outbox_write_fence");
  });
  after(async()=>{
    try{
      await pool.query("DROP SCHEMA IF EXISTS supabase_migrations CASCADE");
      await pool.query(
        "DROP TABLE IF EXISTS public.ishikeit_release_ownership,"+
        "public.outbox,public.inbound_events,public.ishikeit_connection_audit,"+
        "public.ishikeit_account_connections,public.ishikeit_provider_accounts,"+
        "public.ishikeit_workspace_memberships,public.ishikeit_workspaces CASCADE");
      await pool.query(
        "DROP FUNCTION IF EXISTS public.ishikeit_guard_native_outbox_write()");
      for(const role of createdRoles.reverse())await pool.query("DROP ROLE "+role);
    }finally{await pool.end();}
  });
  test("real PG17 fences hosted migration, rechecks exact 45 and releases only after verified schema",async()=>{
    const fence=new Fence(sql),events=[];
    const result=await runProtectedSchemaRelease({
      cfg,db:sql,fence,versions,readbackHeads:async()=>{events.push("heads");},
      applyMigration:async()=>{
        events.push("provider-submit");
        const hold=await pool.query(
          "SELECT pending_external_step FROM public.ishikeit_release_ownership WHERE scope=$1",
          [scope]);
        assert.equal(hold.rows[0]?.pending_external_step,"schema_migration");
        assert.equal(await fence.acquire({
          scope,holderSecret:randomBytes(32).toString("base64url"),appMainSha:cfg.appSha,
          dbMainSha:cfg.dbSha,ttlSeconds:120}),undefined);
        await pool.query(
          "INSERT INTO supabase_migrations.schema_migrations(version) VALUES($1)",
          [lastVersion]);
      }
    });
    assert.deepEqual(result,{status:"applied"});
    assert.equal(events.filter(x=>x==="provider-submit").length,1);
    const row=await pool.query(
      "SELECT generation,pending_external_step,holder_digest,"+
      "verified_schema_migration_at IS NOT NULL AS verified "+
      "FROM public.ishikeit_release_ownership WHERE scope=$1",[scope]);
    assert.equal(row.rows[0]?.pending_external_step,null);
    assert.equal(row.rows[0]?.holder_digest,null);
    assert.equal(row.rows[0]?.verified,true);
    assert.ok(Number(row.rows[0]?.generation)>1);
  });

  test("real PG17 retains unknown migration outcome even after lease expiry",async()=>{
    const fence=new Fence(sql);
    await assert.rejects(runProtectedSchemaRelease({
      cfg,db:sql,fence,versions,readbackHeads:async()=>{},
      applyMigration:async()=>{
        await pool.query(
          "INSERT INTO supabase_migrations.schema_migrations(version) VALUES($1)",
          [lastVersion]);
        throw Error("synthetic lost response after remote committed");
      }
    }),/synthetic lost response/i);
    const q=await pool.query(
      "SELECT pending_external_step FROM public.ishikeit_release_ownership WHERE scope=$1",
      [scope]);
    assert.equal(q.rows[0]?.pending_external_step,"schema_migration");
    await pool.query(
      "UPDATE public.ishikeit_release_ownership "+
      "SET expires_at=clock_timestamp()-interval '1 second' WHERE scope=$1",[scope]);
    assert.equal(await fence.acquire({
      scope,holderSecret:randomBytes(32).toString("base64url"),appMainSha:cfg.appSha,
      dbMainSha:cfg.dbSha,ttlSeconds:120}),undefined);
    const recovered=await runProtectedSchemaRelease({
      cfg:{...cfg,operation:"reconcile"},db:sql,fence,versions,
      readbackHeads:async()=>{},
      applyMigration:async()=>{throw Error("Reconciliation must never resubmit migration");}
    });
    assert.deepEqual(recovered,{status:"reconciled"});
    const end=await pool.query(
      "SELECT pending_external_step,verified_schema_migration_at IS NOT NULL AS verified "+
      "FROM public.ishikeit_release_ownership WHERE scope=$1",[scope]);
    assert.deepEqual(end.rows[0],{
      pending_external_step:null,verified:true
    });
  });
  test("real PG17 refuses reconciliation while trigger disabled even if ledger says migrated",async()=>{
    const fence=new Fence(sql);
    await assert.rejects(runProtectedSchemaRelease({
      cfg,db:sql,fence,versions,readbackHeads:async()=>{},
      applyMigration:async()=>{
        await pool.query(
          "INSERT INTO supabase_migrations.schema_migrations(version) VALUES($1)",
          [lastVersion]);
        await pool.query(
          "ALTER TABLE public.outbox DISABLE TRIGGER ishikeit_native_outbox_write_fence");
        throw Error("synthetic interrupted provider operation");
      }
    }),/interrupted provider operation/i);
    await pool.query(
      "UPDATE public.ishikeit_release_ownership "+
      "SET expires_at=clock_timestamp()-interval '1 second' WHERE scope=$1",[scope]);
    await assert.rejects(runProtectedSchemaRelease({
      cfg:{...cfg,operation:"reconcile"},db:sql,fence,versions,
      readbackHeads:async()=>{},
      applyMigration:async()=>{throw Error("Must never retry");}
    }),/native outbox/i);
    const pending=await pool.query(
      "SELECT pending_external_step FROM public.ishikeit_release_ownership WHERE scope=$1",
      [scope]);
    assert.equal(pending.rows[0]?.pending_external_step,"schema_migration");
  });
}
