import { readFile } from "node:fs/promises";
import pg from "pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Read-only release gate for migrations already applied via Supabase's
 * official migration history (MCP apply_migration / CLI).
 *
 * Never executes migrations or creates an independent shadow ledger.
 * This prevents double-application and catches drift in the exact SQL
 * actually recorded by the trusted Supabase migration system.
 */
const definitions=[
  {file:"migrations/0016_initial_owner_bootstrap_audit.sql",
    name:"ishikeit_initial_owner_bootstrap_audit",
    tables:["ishikeit_initial_owner_bootstrap"]},
  {file:"migrations/0017_managed_platform_admin_provisioning.sql",
    name:"ishikeit_managed_platform_admin_provisioning",
    tables:["ishikeit_initial_admin_provisioning","ishikeit_platform_administrators"]},
  {file:"migrations/0018_workspace_member_invitations.sql",
    name:"ishikeit_workspace_member_invitations",
    tables:["ishikeit_workspace_invitations"]}
];
export async function verifyOfficialAdminMigrations(db,load=readFile){
  const client=await db.connect();
  try{
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '12000ms'");
    const verified=[];
    for(const {file,name,tables} of definitions){
      const contents=await load(file,"utf8");
      const history=await client.query(
        `SELECT version,statements FROM supabase_migrations.schema_migrations
         WHERE name=$1 ORDER BY version DESC LIMIT 2`,[name]
      );
      if(history.rows.length!==1 ||
        !Array.isArray(history.rows[0].statements) ||
        history.rows[0].statements.length!==1 ||
        history.rows[0].statements[0]!==contents){
        throw new Error("Official migration history does not match source");
      }
      for(const table of tables){
        const status=await client.query(
          `SELECT c.relrowsecurity,
             NOT EXISTS (
               SELECT 1 FROM aclexplode(
                 coalesce(c.relacl,acldefault('r',c.relowner))
               ) acl WHERE acl.privilege_type IN
                 ('SELECT','INSERT','UPDATE','DELETE')
                 AND (acl.grantee=0 OR acl.grantee IN (
                   SELECT oid FROM pg_roles
                   WHERE rolname IN ('anon','authenticated')
                 ))
             ) AS client_closed
           FROM pg_class c
           JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r'
             AND c.relname=$1`,[table]
        );
        if(status.rows.length!==1 ||
          status.rows[0].relrowsecurity!==true ||
          status.rows[0].client_closed!==true)
          throw new Error("Official migration private-table RLS/grant invariant failed");
      }
      verified.push(name);
    }
    await client.query("COMMIT");
    return verified;
  }catch{
    await client.query("ROLLBACK").catch(()=>undefined);
    throw new Error("Trusted Supabase migration verification failed closed");
  }finally{client.release();}
}

if(process.argv[1]!==undefined &&
   import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.env.DATABASE_URL){
    process.stderr.write("Trusted database connection is required.\n");
    process.exitCode=1;
  }else{
    const pool=new pg.Pool({
      connectionString:process.env.DATABASE_URL,max:1,
      connectionTimeoutMillis:5000,idleTimeoutMillis:5000
    });
    try{
      const verified=await verifyOfficialAdminMigrations(pool);
      process.stdout.write(
        "Verified official Supabase migrations: "+verified.length+"\n"
      );
    }catch{
      process.stderr.write(
        "Supabase migration history or private-schema integrity rejected.\n"
      );
      process.exitCode=1;
    }finally{await pool.end();}
  }
}
