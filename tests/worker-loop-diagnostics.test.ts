import { describe, expect, it } from "vitest";
import { LocalWorkerDiagnostics } from "../src/observability/worker-loop-diagnostics.js";

describe("local-only worker loop diagnostics", () => {
  it("distinguishes disabled workers and pre-start readiness", () => {
    let now = Date.parse("2026-11-01T00:00:00.000Z");
    const diag = new LocalWorkerDiagnostics(
      { inboundProcessor: true, outboundDispatcher: false }, () => now
    );
    const initial = diag.snapshot();
    expect(initial.scope).toBe("local_process");
    expect(initial.workers.map((w) => w.status)).toEqual(["not_started", "disabled"]);
    expect(initial.workers[0]?.totalIterations).toBe(0);
    now += 60_000;
    expect(diag.snapshot().workers[0]?.status).toBe("not_started");
  });

  it("tracks success, iteration failure, stalling and safe restart", () => {
    let now = Date.parse("2026-11-01T00:00:00.000Z");
    const diag = new LocalWorkerDiagnostics(
      { inboundProcessor: true, outboundDispatcher: true }, () => now
    );
    diag.record("inbound_processor", "started");
    diag.record("inbound_processor", "iteration_started");
    now += 1_000;
    expect(diag.snapshot().workers[0]).toMatchObject({
      status: "working", currentIterationMs: 1_000
    });
    diag.record("inbound_processor", "iteration_succeeded");
    expect(diag.snapshot().workers[0]).toMatchObject({
      status: "idle", totalIterations: 1, failedIterations: 0
    });
    now += 1_000;
    diag.record("inbound_processor", "iteration_started");
    diag.record("inbound_processor", "iteration_failed");
    expect(diag.snapshot().workers[0]).toMatchObject({
      totalIterations: 2, failedIterations: 1,
      lastFailureAt: new Date(now).toISOString()
    });
    now += 31_000;
    expect(diag.snapshot().workers[0]?.status).toBe("stalled");
    diag.record("inbound_processor", "stopped");
    expect(diag.snapshot().workers[0]?.status).toBe("stopped");
    diag.record("inbound_processor", "started");
    expect(diag.snapshot().workers[0]?.status).toBe("idle");
  });

  it("labels long running iterations without assuming they failed", () => {
    let now = Date.parse("2026-11-01T00:00:00.000Z");
    const diag = new LocalWorkerDiagnostics(
      { inboundProcessor: true, outboundDispatcher: false }, () => now
    );
    diag.record("inbound_processor", "started");
    diag.record("inbound_processor", "iteration_started");
    now += 125_000;
    expect(diag.snapshot().workers[0]).toMatchObject({
      status: "long_running", currentIterationMs: 125_000,
      totalIterations: 0, failedIterations: 0
    });
    diag.record("inbound_processor", "iteration_succeeded");
    expect(diag.snapshot().workers[0]?.status).toBe("idle");
  });

  it("never counts spurious, disabled or duplicate completion events", () => {
    const diag = new LocalWorkerDiagnostics(
      { inboundProcessor: true, outboundDispatcher: false }
    );
    diag.record("inbound_processor", "iteration_failed");
    diag.record("outbound_dispatcher", "started");
    diag.record("outbound_dispatcher", "iteration_started");
    diag.record("outbound_dispatcher", "iteration_succeeded");
    diag.record("inbound_processor", "started");
    diag.record("inbound_processor", "iteration_succeeded");
    expect(diag.snapshot().workers.map((w) => w.totalIterations)).toEqual([0, 0]);
  });
});


describe("protected process-scoped worker diagnostics HTTP endpoint", () => {
  it("requires an operator token and never caches or exposes message data", async () => {
    const { buildServer } = await import("../src/http/server.js");
    const { default: pino } = await import("pino");
    const { vi } = await import("vitest");
    const diagnostics = new LocalWorkerDiagnostics({
      inboundProcessor: true, outboundDispatcher: true
    });
    diagnostics.record("inbound_processor", "started");
    diagnostics.record("inbound_processor", "iteration_started");
    diagnostics.record("inbound_processor", "iteration_succeeded");
    const secret = "operator-test-token-that-must-remain-private";
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest: vi.fn() },
      appSecret: "app-secret-do-not-expose",
      verifyToken: "verify-token-do-not-expose",
      localWorkerDiagnostics: diagnostics,
      opsMetricsToken: secret
    });
    try {
      const anonymous = await server.inject({ method: "GET", url: "/ops/workers/local" });
      expect(anonymous.statusCode).toBe(401);
      const result = await server.inject({
        method: "GET", url: "/ops/workers/local",
        headers: { authorization: `Bearer ${secret}` }
      });
      expect(result.statusCode).toBe(200);
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(result.json()).toMatchObject({
        scope: "local_process",
        workers: [
          { name: "inbound_processor", status: "idle", totalIterations: 1 },
          { name: "outbound_dispatcher", status: "not_started", totalIterations: 0 }
        ]
      });
      expect(result.body).not.toContain(secret);
      expect(result.body).not.toContain("app-secret-do-not-expose");
    } finally {
      await server.close();
    }
  });

  it("does not register local worker diagnostics without an operator credential", async () => {
    const { buildServer } = await import("../src/http/server.js");
    const { default: pino } = await import("pino");
    const { vi } = await import("vitest");
    expect(() => buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest: vi.fn() },
      appSecret: "secret",
      verifyToken: "verify-token",
      localWorkerDiagnostics: new LocalWorkerDiagnostics({
        inboundProcessor: true, outboundDispatcher: false
      })
    })).toThrow("require an operational bearer token");
  });
});
