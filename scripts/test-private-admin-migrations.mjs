import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migratePrivateAdminSchema } from "./apply-private-admin-migrations.mjs";

const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(!url)throw new Error("Disposable test database not configured");
const target=new URL(url);
if(!["postgres:","postgresql:"].includes(target.protocol) ||
  !["127.0.0.1","localhost","::1"].includes(target.hostname)
  || target.pathname!=="/ishikeit_outbox_test")
  throw new Error("Refusing to test migrations against a non-disposable PostgreSQL database");
const pool=new pg.Pool({connectionString:url,max:2});
let started=false;
try{
  await pool.query(`CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);`);
  await pool.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
  started=true;
  const first=await migratePrivateAdminSchema(pool);
  assert.equal(first.length,3);
  assert.ok(first.every(x=>x.status==="applied"));
  const repeat=await migratePrivateAdminSchema(pool);
  assert.ok(repeat.every(x=>x.status==="already_applied"));
  const rows=await pool.query(`
    SELECT (SELECT count(*)::int FROM public.ishikeit_private_admin_migrations) migrations,
      (SELECT count(*)::int FROM public.ishikeit_initial_owner_bootstrap) owners,
      (SELECT count(*)::int FROM public.ishikeit_initial_admin_provisioning) pending,
      (SELECT count(*)::int FROM public.ishikeit_platform_administrators) admins`);
  assert.deepEqual(rows.rows[0],{migrations:3,owners:0,pending:0,admins:0});
  let rejected=false;
  try{
    await migratePrivateAdminSchema(pool,async(path,encoding)=>{
      const value=await readFile(path,encoding);
      return path.includes("0017")?value+"\n--modified":value;
    });
  }catch{rejected=true;}
  assert.equal(rejected,true,"A changed migration checksum must be rejected");
  const rls=await pool.query(`
    SELECT c.relname,c.relrowsecurity,
      EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        WHERE a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
          AND (a.grantee=0 OR a.grantee IN (
            SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated')
          ))) AS client_access
      FROM pg_class c WHERE c.oid IN (
        'public.ishikeit_workspace_invitations'::regclass,
        'public.ishikeit_platform_administrators'::regclass,
        'public.ishikeit_initial_admin_provisioning'::regclass,
        'public.ishikeit_private_admin_migrations'::regclass
      )`);
  assert.equal(rls.rows.length,4);
  assert.ok(rls.rows.every(x=>x.relrowsecurity===true && x.client_access===false));
  process.stdout.write("Private admin migration: initial application, replay, checksum and RLS verified.\n");
}finally{
  if(started){
    await pool.query(`DROP TABLE IF EXISTS
      public.ishikeit_workspace_invitations,
      public.ishikeit_platform_administrators,
      public.ishikeit_initial_admin_provisioning,
      public.ishikeit_initial_owner_bootstrap,
      public.ishikeit_private_admin_migrations,
      public.ishikeit_connection_audit,
      public.ishikeit_account_connections,
      public.ishikeit_provider_accounts,
      public.ishikeit_workspace_memberships,
      public.ishikeit_workspaces;`);
  }
  await pool.query("DROP TABLE IF EXISTS auth.users");
  await pool.query("DROP SCHEMA IF EXISTS auth");
  await pool.end();
}
