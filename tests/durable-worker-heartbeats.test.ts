import { randomUUID } from "node:crypto";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import { LocalWorkerDiagnostics } from "../src/observability/worker-loop-diagnostics.js";
import { classifyFleetHeartbeats, DurableWorkerHeartbeatMonitor, type PostgresWorkerHeartbeatStore, type WorkerFleetSnapshot } from "../src/observability/durable-worker-heartbeats.js";

function row(status: "idle" | "disabled" | "working", secondsAgo: number) {
  return {
    instance_id: randomUUID(), worker_name: "inbound_processor" as const,
    worker_status: status, observed_at: new Date(Date.now() - secondsAgo * 1000),
    last_completed_at: null, total_iterations: "1", failed_iterations: "0"
  };
}
const empty: WorkerFleetSnapshot = {
  scope: "observed_instances", generatedAt: new Date().toISOString(),
  staleAfterMs: 45000, observationWindowMinutes: 15, workers: [], warnings: []
};

describe("durable, instance-aware worker observation", () => {
  it("distinguishes fresh idle workers, crashed workers, and intentionally disabled workers", () => {
    const now = new Date();
    const result = classifyFleetHeartbeats([row("idle", 5), row("working", 50), row("disabled", 100)], now);
    expect(result.workers.map(w => w.status)).toEqual(["idle","stale","disabled"]);
    expect(result.warnings).toEqual([{ code: "stale_worker", count: 1, worker: "inbound_processor" }]);
    expect(result.scope).toBe("observed_instances");
    expect(JSON.stringify(result)).not.toContain("recipient");
  });

  it("coalesces concurrent heartbeat ticks and swallows persistence failure", async () => {
    const local = new LocalWorkerDiagnostics({ inboundProcessor: true, outboundDispatcher: false });
    const report = vi.fn().mockRejectedValue(new Error("secret database connection string"));
    const stop = vi.fn().mockResolvedValue(undefined);
    const store = { report, stop } as unknown as PostgresWorkerHeartbeatStore;
    const monitor = new DurableWorkerHeartbeatMonitor(store, local, pino({ level: "silent" }));
    await Promise.all([monitor.tick(), monitor.tick()]);
    expect(report).toHaveBeenCalledTimes(1);
    await monitor.stop();
    expect(stop).toHaveBeenCalledWith(local.snapshot().instanceId);
  });

  it("authenticates fleet readback, never caches it, and returns safe failures", async () => {
    const secret = "operator-test-token-for-read-only-heartbeats";
    const snapshot = vi.fn().mockResolvedValue(empty);
    const server = buildServer({
      logger: pino({ level: "silent" }), ready: () => Promise.resolve(true),
      inbound: { ingest: vi.fn() },
      appSecret: "test-app-secret", verifyToken: "test-verification-token",
      opsMetricsToken: secret, workerFleet: { snapshot }
    });
    try {
      const denied = await server.inject({ method:"GET", url:"/ops/workers/fleet" });
      expect(denied.statusCode).toBe(401);
      expect(snapshot).not.toHaveBeenCalled();
      const allowed = await server.inject({
        method:"GET", url:"/ops/workers/fleet",
        headers:{ authorization: "Bearer " + secret }
      });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.headers["cache-control"]).toBe("private, no-store");
      expect(allowed.json()).toMatchObject({ scope:"observed_instances", workers:[] });
      expect(allowed.body).not.toContain(secret);
      snapshot.mockRejectedValueOnce(new Error("secret Postgres credentials"));
      const unavailable = await server.inject({
        method:"GET", url:"/ops/workers/fleet",
        headers:{ authorization: "Bearer " + secret }
      });
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.body).toBe('{"status":"worker_fleet_unavailable"}');
    } finally {
      await server.close();
    }
  });
  it("refuses to register fleet endpoint without operator credentials", () => {
    expect(() => buildServer({
      logger:pino({level:"silent"}), ready:()=>Promise.resolve(true),
      inbound:{ingest:vi.fn()},
      appSecret:"secret", verifyToken:"verify",
      workerFleet:{snapshot:()=>Promise.resolve(empty)}
    })).toThrow("worker fleet diagnostics require an operational bearer token");
  });
});
