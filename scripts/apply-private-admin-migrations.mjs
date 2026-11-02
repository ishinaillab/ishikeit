import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const files=[
  "migrations/0016_initial_owner_bootstrap_audit.sql",
  "migrations/0017_managed_platform_admin_provisioning.sql"
];
export function unwrapMigration(sql){
  const match=/^([\s\S]*?)\bBEGIN;([\s\S]*)\bCOMMIT;\s*$/u.exec(sql);
  if(!match||match[1].replace(/--[^\n]*/gu,"").trim()!=="")
    throw new Error("Expected versioned transactional SQL migration");
  return match[2];
}
export async function migratePrivateAdminSchema(db,read=readFile){
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(20261102, 17)");
    // The ledger itself is also server-private with no client grants.
    await client.query(`CREATE TABLE IF NOT EXISTS public.ishikeit_private_admin_migrations (
      filename text PRIMARY KEY,sha256 text NOT NULL
        CHECK(sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.ishikeit_private_admin_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.ishikeit_private_admin_migrations FROM PUBLIC;
    DO $private$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
          EXECUTE format('REVOKE ALL ON public.ishikeit_private_admin_migrations FROM %I',r);
        END IF;
      END LOOP;
    END
    $private$;`);
    const completed=[];
    for(const file of files){
      const sql=await read(file,"utf8");
      const hash=createHash("sha256").update(sql).digest("hex");
      const row=await client.query(
        "SELECT sha256 FROM public.ishikeit_private_admin_migrations WHERE filename=$1",
        [file]
      );
      if(row.rows.length!==0){
        if(row.rows[0].sha256!==hash)throw new Error("Applied migration checksum mismatch");
        completed.push({file,status:"already_applied"});
        continue;
      }
      const object=file.includes("0016")?"ishikeit_initial_owner_bootstrap"
        :"ishikeit_platform_administrators";
      const present=await client.query(
        "SELECT to_regclass($1) IS NOT NULL AS present",["public."+object]
      );
      if(present.rows[0]?.present)
        throw new Error("Migration schema already exists without a matching ledger");
      await client.query(unwrapMigration(sql));
      await client.query(
        "INSERT INTO public.ishikeit_private_admin_migrations(filename,sha256) VALUES($1,$2)",
        [file,hash]
      );
      completed.push({file,status:"applied"});
    }
    await client.query("COMMIT");
    return completed;
  }catch{
    await client.query("ROLLBACK");
    throw new Error("Private admin migration failed closed");
  }finally{client.release();}
}
if(process.argv[1]!==undefined && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]!=="--execute"||!process.env.DATABASE_URL||
     process.env.ISHIKEIT_ADMIN_MIGRATION_APPROVED!=="true"){
    process.stderr.write("Private admin migration requires trusted deployment approval.\n");
    process.exitCode=1;
  }else{
    const pool=new pg.Pool({
      connectionString:process.env.DATABASE_URL,max:1,
      connectionTimeoutMillis:5000,idleTimeoutMillis:5000
    });
    try {
      const result=await migratePrivateAdminSchema(pool);
      for(const step of result)process.stdout.write(
        step.file+" "+step.status+"\n"
      );
    }catch{
      process.stderr.write("Private admin schema migration rejected; no partial change committed.\n");
      process.exitCode=1;
    }finally{await pool.end();}
  }
}
