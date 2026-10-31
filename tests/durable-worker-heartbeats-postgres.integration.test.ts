import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { PostgresWorkerHeartbeatStore } from "../src/observability/durable-worker-heartbeats.js";
import { LocalWorkerDiagnostics } from "../src/observability/worker-loop-diagnostics.js";

const connectionString = process.env.PG_OUTBOX_TEST_DATABASE_URL;
if (connectionString !== undefined) {
  const target = new URL(connectionString);
  if ((target.protocol !== "postgres:" && target.protocol !== "postgresql:")
    || !["localhost", "127.0.0.1", "::1"].includes(target.hostname)
    || target.pathname !== "/ishikeit_outbox_test") {
    throw new Error("Refusing heartbeat integration tests outside isolated local PostgreSQL");
  }
}

describe.skipIf(connectionString === undefined)("durable heartbeat PostgreSQL integration", () => {
  it("preserves per-process identities, detects stale process loss and records clean shutdown", async () => {
    const db = new PostgresDatabase(connectionString!);
    const store = new PostgresWorkerHeartbeatStore(db);
    const diagnostic = new LocalWorkerDiagnostics({inboundProcessor:true,outboundDispatcher:false});
    const id = diagnostic.snapshot().instanceId;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS public.ishikeit_worker_heartbeats (
        instance_id uuid NOT NULL, worker_name text NOT NULL
          CHECK (worker_name IN ('inbound_processor','outbound_dispatcher')),
        worker_status text NOT NULL
          CHECK (worker_status IN ('disabled','not_started','stopped','idle','working','long_running','stalled')),
        observed_at timestamptz NOT NULL DEFAULT now(),
        last_completed_at timestamptz,
        total_iterations bigint NOT NULL DEFAULT 0 CHECK (total_iterations >= 0),
        failed_iterations bigint NOT NULL DEFAULT 0 CHECK (failed_iterations >= 0),
        PRIMARY KEY(instance_id,worker_name)
      )`);
      diagnostic.record("inbound_processor","started");
      diagnostic.record("inbound_processor","iteration_started");
      diagnostic.record("inbound_processor","iteration_succeeded");
      await store.report(diagnostic.snapshot());
      const snapshot = await store.snapshot();
      expect(snapshot.workers.filter(w=>w.instanceId===id).map(w=>w.status)).toEqual(["idle","disabled"]);
      expect(snapshot.workers.find(w=>w.instanceId===id && w.name==="inbound_processor")?.totalIterations).toBe(1);
      await db.query(`UPDATE public.ishikeit_worker_heartbeats
        SET observed_at=now()-interval '60 seconds'
        WHERE instance_id=$1::uuid AND worker_name='inbound_processor'`,[id]);
      const stale = await store.snapshot();
      expect(stale.workers.find(w=>w.instanceId===id && w.name==="inbound_processor")?.status).toBe("stale");
      expect(stale.warnings).toContainEqual({code:"stale_worker",worker:"inbound_processor",count:1});
      await store.report(diagnostic.snapshot());
      expect((await store.snapshot()).workers.find(w=>w.instanceId===id && w.name==="inbound_processor")?.status).toBe("idle");
      await store.stop(id);
      expect((await store.snapshot()).workers.find(w=>w.instanceId===id && w.name==="inbound_processor")?.status).toBe("stopped");
    } finally {
      await db.query("DELETE FROM public.ishikeit_worker_heartbeats WHERE instance_id=$1::uuid",[id]).catch(()=>{});
      await db.close();
    }
  });
  it("refuses impossible worker state records and does not affect production queues", async () => {
    const db = new PostgresDatabase(connectionString!);
    try {
      await expect(db.query(`INSERT INTO public.ishikeit_worker_heartbeats
       (instance_id,worker_name,worker_status)
       VALUES ($1::uuid,'unknown_worker','idle')`,[randomUUID()])).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
