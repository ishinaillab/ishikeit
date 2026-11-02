import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { verifyOfficialAdminMigrations } from "./verify-official-admin-migrations.mjs";

const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(!url)throw new Error("Disposable test database not configured");
const target=new URL(url);
if(!["postgres:","postgresql:"].includes(target.protocol)
  || !["127.0.0.1","localhost","::1"].includes(target.hostname)
  || target.pathname!=="/ishikeit_outbox_test")
  throw new Error("Refusing to test migrations against a non-disposable PostgreSQL database");

const records=[
  {file:"0016_initial_owner_bootstrap_audit.sql",
    name:"ishikeit_initial_owner_bootstrap_audit",version:"20261102105740"},
  {file:"0017_managed_platform_admin_provisioning.sql",
    name:"ishikeit_managed_platform_admin_provisioning",version:"20261102105818"},
  {file:"0018_workspace_member_invitations.sql",
    name:"ishikeit_workspace_member_invitations",version:"20261102105835"}
];
const pool=new pg.Pool({connectionString:url,max:2});
let started=false;
try{
  // Fixture only. Real production migrations MUST go via the supported
  // Supabase migration API/CLI, never by this disposable test.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY)`);
  await pool.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
  started=true;
  await pool.query(`CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations (
      version text PRIMARY KEY,name text,statements text[]
    )`);
  for(const {file,name,version} of records){
    const sql=await readFile("migrations/"+file,"utf8");
    await pool.query(sql);
    await pool.query(
      `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
       VALUES($1,$2,ARRAY[$3])`,
      [version,name,sql]
    );
  }
  const rows=await pool.query(`
    SELECT (SELECT count(*)::int FROM public.ishikeit_initial_owner_bootstrap) audits,
      (SELECT count(*)::int FROM public.ishikeit_initial_admin_provisioning) pending,
      (SELECT count(*)::int FROM public.ishikeit_platform_administrators) admins,
      (SELECT count(*)::int FROM public.ishikeit_workspace_invitations) invitations,
      (SELECT count(*)::int FROM supabase_migrations.schema_migrations) migrations`);
  assert.deepEqual(rows.rows[0],{
    audits:0,pending:0,admins:0,invitations:0,migrations:3
  },"Applying versioned schema cannot auto-create identities or roles");
  assert.deepEqual(await verifyOfficialAdminMigrations(pool),
    records.map(r=>r.name));

  await assert.rejects(
    verifyOfficialAdminMigrations(pool,async(file,encoding)=>{
      const text=await readFile(file,encoding);
      return file.includes("0018")?text+"\n--unauthorized change":text;
    }),
    /migration verification failed closed/i
  );
  await pool.query(`UPDATE supabase_migrations.schema_migrations
    SET statements=ARRAY['different SQL'] WHERE name=$1`,
    [records[2].name]
  );
  await assert.rejects(verifyOfficialAdminMigrations(pool),
    /migration verification failed closed/i);
  const right=await readFile("migrations/"+records[2].file,"utf8");
  await pool.query(
    "UPDATE supabase_migrations.schema_migrations SET statements=ARRAY[$1] WHERE name=$2",
    [right,records[2].name]
  );
  await pool.query("ALTER TABLE public.ishikeit_workspace_invitations DISABLE ROW LEVEL SECURITY");
  await assert.rejects(verifyOfficialAdminMigrations(pool),
    /migration verification failed closed/i);
  await pool.query("ALTER TABLE public.ishikeit_workspace_invitations ENABLE ROW LEVEL SECURITY");
  await pool.query("GRANT SELECT ON public.ishikeit_workspace_invitations TO PUBLIC");
  await assert.rejects(verifyOfficialAdminMigrations(pool),
    /migration verification failed closed/i);
  await pool.query("REVOKE SELECT ON public.ishikeit_workspace_invitations FROM PUBLIC");
  assert.equal((await verifyOfficialAdminMigrations(pool)).length,3);
  process.stdout.write(
    "Official Supabase tracked SQL, missing identity grants, drift, RLS and public ACL rejection verified on disposable PostgreSQL 17.\n"
  );
}finally{
  if(started){
    await pool.query(`DROP TABLE IF EXISTS
      public.ishikeit_workspace_invitations,
      public.ishikeit_platform_administrators,
      public.ishikeit_initial_admin_provisioning,
      public.ishikeit_initial_owner_bootstrap,
      public.ishikeit_connection_audit,
      public.ishikeit_account_connections,
      public.ishikeit_provider_accounts,
      public.ishikeit_workspace_memberships,
      public.ishikeit_workspaces`);
  }
  await pool.query("DROP TABLE IF EXISTS supabase_migrations.schema_migrations");
  await pool.query("DROP SCHEMA IF EXISTS supabase_migrations");
  await pool.query("DROP TABLE IF EXISTS auth.users");
  await pool.query("DROP SCHEMA IF EXISTS auth");
  await pool.end();
}
