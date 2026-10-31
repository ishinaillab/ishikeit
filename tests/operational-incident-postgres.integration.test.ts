import { describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { PostgresOperationalIncidentStore } from "../src/observability/operational-incident-monitor.js";

const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(url!==undefined){
  const u=new URL(url);
  if(!["postgres:","postgresql:"].includes(u.protocol)
    || !["localhost","127.0.0.1","::1"].includes(u.hostname)
    || u.pathname!=="/ishikeit_outbox_test"){
    throw new Error("Refusing incident integration test outside disposable localhost database");
  }
}
describe.skipIf(url===undefined)("durable operational incidents PostgreSQL integration",()=>{
  it("claims one alert across concurrent replicas, cooldowns repeats, and emits one recovery",async()=>{
    const db=new PostgresDatabase(url!);
    const db2=new PostgresDatabase(url!);
    const a=new PostgresOperationalIncidentStore(db);
    const b=new PostgresOperationalIncidentStore(db2);
    try{
      await db.query(`CREATE TABLE IF NOT EXISTS public.ishikeit_operational_incidents (
        code text PRIMARY KEY CHECK (code IN ('stale_worker','queue_lag','recent_dead_letter',
          'inbound_processing_failed','graph_rate_limited','oauth_renewal_failed')),
        severity text NOT NULL CHECK (severity IN ('warning','critical')),
        incident_count integer NOT NULL CHECK (incident_count >= 0),
        active boolean NOT NULL DEFAULT true,
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz NOT NULL DEFAULT now()
      )`);
      await db.query("DELETE FROM public.ishikeit_operational_incidents WHERE code='stale_worker'");
      const incident={code:"stale_worker",severity:"critical",count:1} as const;
      const results=await Promise.all([a.observe([incident]),b.observe([incident])]);
      expect(results.flat()).toHaveLength(1);
      expect((await a.snapshot()).incidents).toMatchObject([{
        code:"stale_worker",severity:"critical",count:1
      }]);
      expect(await a.observe([incident])).toEqual([]);
      const recovered=await b.observe([]);
      expect(recovered).toEqual([{...incident,count:0,recovery:true}]);
      expect((await b.snapshot()).incidents).toEqual([]);
      expect(await a.observe([])).toEqual([]);
      const newIncident=await a.observe([incident]);
      expect(newIncident).toEqual([{...incident,recovery:false}]);
    }finally{
      await db.query("DELETE FROM public.ishikeit_operational_incidents WHERE code='stale_worker'").catch(()=>{});
      await db.close();
      await db2.close();
    }
  });
});
