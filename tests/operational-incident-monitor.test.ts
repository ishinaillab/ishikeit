import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import { evaluateIncidents, HttpsOperatorWebhook, OperationalIncidentMonitor, type PostgresOperationalIncidentStore } from "../src/observability/operational-incident-monitor.js";
import type { OperationalMetricsSnapshot } from "../src/observability/operational-metrics.js";
import type { WorkerFleetSnapshot } from "../src/observability/durable-worker-heartbeats.js";
const metrics: OperationalMetricsSnapshot = {
  generatedAt: new Date().toISOString(), windowMinutes: 60,
  inbound: { received: 0, processed: 0, failedCurrent: 0,
    outcomes: { handled: 0, handoff: 0, ignored: 0, rolloutSkipped: 0, unknown: 0 },
    processingLatencyMs: { p50: null, p95: null, max: null } },
  delivery: { byChannel: [], outboundLifecycle: [] },
  handoffs: { total: 0, byReason: [] },
  queue: [],
  attempts: { published: 0, retries: 0, deadLetters: 0, byRoute: [] }
};
const fleet: WorkerFleetSnapshot = {
  scope: "observed_instances", generatedAt: new Date().toISOString(),
  staleAfterMs: 45000, observationWindowMinutes: 15, workers: [],
  warnings: [{code:"stale_worker",worker:"inbound_processor",count:1}]
};
describe("private operational incidents and delivery guard", () => {
  it("classifies backlog, provider rate limits, expired workers, OAuth failures", () => {
    const result = evaluateIncidents({
      ...metrics, inbound:{...metrics.inbound,failedCurrent:5},
      queue:[{topic:"action.dispatch",pending:2,oldestPendingMs:6*60_000,
        deadLetterTotal:1,deadLettersInWindow:1}],
      attempts:{...metrics.attempts,byRoute:[{
        topic:"action.dispatch", provider:"meta",capability:"messaging",operation:"message.send",
        outcome:"retry",errorClass:"throttled",httpStatus:429,providerCode:null,count:2
      }]}
    },fleet,1,{processorEnabled:true,actionDispatchEnabled:true});
    expect(result).toContainEqual({code:"inbound_processing_failed",count:5,severity:"critical"});
    expect(result).toContainEqual({code:"queue_lag",count:2,severity:"warning"});
    expect(result).toContainEqual({code:"recent_dead_letter",count:1,severity:"warning"});
    expect(result).toContainEqual({code:"graph_rate_limited",count:2,severity:"warning"});
    expect(result).toContainEqual({code:"stale_worker",count:1,severity:"critical"});
    expect(result).toContainEqual({code:"oauth_renewal_failed",count:1,severity:"warning"});
  });
  it("never sends operator alerts unless instantiated with approved HTTPS host and token", async () => {
    const fetchMock=vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    try {
      expect(()=>new HttpsOperatorWebhook("http://example.com/test","x".repeat(32),"example.com")).toThrow();
      expect(()=>new HttpsOperatorWebhook("https://localhost/a","x".repeat(32),"example.com")).toThrow();
      const delivery=new HttpsOperatorWebhook("https://example.com/alert","x".repeat(32),"example.com");
      await delivery.send({code:"stale_worker",severity:"critical",count:1,recovery:false});
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url,options]=fetchMock.mock.calls[0]!;
      expect(url).toBeInstanceOf(URL);
      if (!(url instanceof URL)) throw new Error("expected URL request");
      expect(url.href).toBe("https://example.com/alert");
      expect(options?.method).toBe("POST");
      expect(options?.redirect).toBe("error");
      const body = options?.body;
      if (typeof body !== "string") throw new Error("expected JSON body");
      expect(body).not.toContain("recipient");
      expect(body).not.toContain("x".repeat(32));
    } finally { vi.unstubAllGlobals(); }
  });
  it("operational scans do not throw when private delivery fails", async () => {
    const observe=vi.fn().mockResolvedValue([{code:"stale_worker",severity:"critical",count:1,recovery:false}]);
    const send=vi.fn().mockRejectedValue(new Error("secret webhook error"));
    const monitor=new OperationalIncidentMonitor(
      {snapshot:vi.fn().mockResolvedValue(metrics)},
      {snapshot:vi.fn().mockResolvedValue(fleet)},
      {observe} as unknown as PostgresOperationalIncidentStore,
      pino({level:"silent"}),{send}
    );
    await Promise.all([monitor.tick(),monitor.tick()]);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    await monitor.stop();
  });
  it("requires operator token and protects incident readback even during errors", async () => {
    const token="this-is-a-dedicated-test-token-of-sufficient-length";
    const snapshot=vi.fn().mockResolvedValue({scope:"durable_incidents",incidents:[]});
    const server=buildServer({logger:pino({level:"silent"}),
      ready:()=>Promise.resolve(true),inbound:{ingest:vi.fn()},
      appSecret:"secret",verifyToken:"verify",opsMetricsToken:token,
      incidentReadback:{snapshot}});
    try {
      expect((await server.inject({method:"GET",url:"/ops/incidents"})).statusCode).toBe(401);
      const response=await server.inject({method:"GET",url:"/ops/incidents",headers:{authorization:"Bearer "+token}});
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.body).not.toContain(token);
      snapshot.mockRejectedValueOnce(new Error("database URL secrets"));
      const unavailable=await server.inject({method:"GET",url:"/ops/incidents",headers:{authorization:"Bearer "+token}});
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.body).not.toContain("database URL secrets");
    } finally { await server.close(); }
  });
});
