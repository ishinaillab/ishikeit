import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";

const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(url!==undefined){
  const p=new URL(url);
  if(!["localhost","127.0.0.1","::1"].includes(p.hostname)
    ||p.pathname!=="/ishikeit_outbox_test"
    ||!["postgres:","postgresql:"].includes(p.protocol)){
    throw new Error("Disposable PostgreSQL test must use only localhost/ishikeit_outbox_test");
  }
}
describe.skipIf(url===undefined)("ephemeral one-time claim real PostgreSQL",()=>{
  it("enforces a single durable claim, private roles and bounded state",async()=>{
    const db=new PostgresDatabase(url!);
    const b=new PostgresDatabase(url!);
    try{
      await db.query("CREATE ROLE anon");
      await db.query("CREATE ROLE authenticated");
      await db.query("DROP TABLE IF EXISTS public.ishikeit_instagram_renewal_once");
      const sql=await readFile(new URL("../migrations/0010_instagram_renewal_once.sql",import.meta.url),"utf8");
      await db.query(sql);
      const insert=`INSERT INTO public.ishikeit_instagram_renewal_once(run_id,outcome)
                    VALUES($1,'claimed') ON CONFLICT(run_id) DO NOTHING RETURNING run_id`;
      const id="ishikeit-2026-11-01-owner-approved-instagram-once";
      expect((await db.query(insert,[id])).rowCount).toBe(1);
      expect((await b.query(insert,[id])).rowCount).toBe(0);
      const clients=await db.query<{
        rls:boolean,anon:boolean,authenticated:boolean
      } & import("pg").QueryResultRow>(`SELECT c.relrowsecurity AS rls,
        has_table_privilege('anon','public.ishikeit_instagram_renewal_once','SELECT') AS anon,
        has_table_privilege('authenticated','public.ishikeit_instagram_renewal_once','SELECT') AS authenticated
        FROM pg_class c WHERE c.oid='public.ishikeit_instagram_renewal_once'::regclass`);
      expect(clients.rows[0]).toMatchObject({rls:true,anon:false,authenticated:false});
    }finally{
      await b.close();
      await db.close();
    }
  });
});
