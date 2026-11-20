import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {assertProtectedNativeSchema} from "./priority3-protected-hostinger-release.mjs";

// These tests MUST use a disposable PostgreSQL 17 lab, never production.
const connectionString=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(connectionString!==undefined){
  const u=new URL(connectionString);
  if(!["postgres:","postgresql:"].includes(u.protocol)||
     !["127.0.0.1","localhost","::1"].includes(u.hostname)||
     u.pathname!=="/ishikeit_outbox_test")
    throw Error("Refusing protected release schema tests outside disposable local PG17");
}
if(connectionString===undefined){
  test("protected release schema SQL integration requires isolated PG17",
    {skip:true},()=>{});
}else{
  const pool=new pg.Pool({connectionString,max:2,connectionTimeoutMillis:5000});
  const exec={query:(sql,params)=>pool.query(sql,params)};
  const migrationVersion="20261118222000";
  const createdRoles=[];
  before(async()=>{
    for(const name of ["0001_foundation.sql",
      "0010_ishikeit_workspace_connections.sql",
      "0012_ishikeit_event_tenant_provenance.sql",
      "0027_priority3_tenant_send_generation_fence.sql",
      "0029_priority3_native_outbox_write_fence.sql"]){
      await pool.query(await readFile("migrations/"+name,"utf8"));
    }
    const roles=await pool.query(
      "SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])",
      [["anon","authenticated"]]);
    const existing=new Set(roles.rows.map(r=>r.rolname));
    for(const role of ["anon","authenticated"]){
      if(existing.has(role))continue;
      await pool.query("CREATE ROLE "+role+" NOLOGIN");
      createdRoles.push(role);
    }
    await pool.query("CREATE SCHEMA supabase_migrations");
    await pool.query(
      "CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY)");
    const previous=Array.from({length:44},(_,i)=>
      "202610"+String(i+1).padStart(8,"0"));
    await pool.query(
      "INSERT INTO supabase_migrations.schema_migrations(version) SELECT unnest($1::text[])",
      [[...previous,migrationVersion]]);
  });
  after(async()=>{
    try{
      await pool.query("DROP SCHEMA IF EXISTS supabase_migrations CASCADE");
      await pool.query("DROP TABLE IF EXISTS public.inbound_events,public.outbox,"+
        "public.ishikeit_connection_audit,public.ishikeit_account_connections,"+
        "public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,"+
        "public.ishikeit_workspaces CASCADE");
      await pool.query(
        "DROP FUNCTION IF EXISTS public.ishikeit_guard_native_outbox_write()");
      // Avoid contaminating sequential PostgreSQL integration suites that
      // create the same disposable client roles with CREATE ROLE.
      for(const role of createdRoles.reverse())
        await pool.query("DROP ROLE "+role);
    }finally{await pool.end();}
  });

  test("exact 45th migration and least-privileged enabled native trigger admit release readback",async()=>{
    await assert.doesNotReject(assertProtectedNativeSchema(exec));
  });
  test("old 44-migration production schema cannot admit protected Hostinger deployment",async()=>{
    await pool.query("DELETE FROM supabase_migrations.schema_migrations WHERE version=$1",
      [migrationVersion]);
    try{
      await assert.rejects(assertProtectedNativeSchema(exec),/45\/45|native outbox/i);
    }finally{
      await pool.query(
        "INSERT INTO supabase_migrations.schema_migrations(version) VALUES($1)",
        [migrationVersion]);
    }
  });
  test("46th unreviewed migration cannot silently pass exact release fence",async()=>{
    await pool.query(
      "INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261201000000')");
    try{
      await assert.rejects(assertProtectedNativeSchema(exec),/45\/45|native outbox/i);
    }finally{
      await pool.query(
        "DELETE FROM supabase_migrations.schema_migrations WHERE version='20261201000000'");
    }
  });
  test("disabled native trigger cannot admit protected deployment",async()=>{
    await pool.query(
      "ALTER TABLE public.outbox DISABLE TRIGGER ishikeit_native_outbox_write_fence");
    try{
      await assert.rejects(assertProtectedNativeSchema(exec),/45\/45|native outbox/i);
    }finally{
      await pool.query(
        "ALTER TABLE public.outbox ENABLE TRIGGER ishikeit_native_outbox_write_fence");
    }
  });
  test("public executable native guard function fails closed",async()=>{
    await pool.query(
      "GRANT EXECUTE ON FUNCTION public.ishikeit_guard_native_outbox_write() TO PUBLIC");
    try{
      await assert.rejects(assertProtectedNativeSchema(exec),/45\/45|native outbox/i);
    }finally{
      await pool.query(
        "REVOKE ALL ON FUNCTION public.ishikeit_guard_native_outbox_write() FROM PUBLIC");
    }
  });
  test("security-definer guard cannot be accepted as trusted invoker",async()=>{
    await pool.query(
      "ALTER FUNCTION public.ishikeit_guard_native_outbox_write() SECURITY DEFINER");
    try{
      await assert.rejects(assertProtectedNativeSchema(exec),/45\/45|native outbox/i);
    }finally{
      await pool.query(
        "ALTER FUNCTION public.ishikeit_guard_native_outbox_write() SECURITY INVOKER");
    }
  });
}
