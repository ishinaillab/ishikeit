import { describe, expect, it } from "vitest";
import {
  evaluateOperationalAlerts
} from "../src/observability/operational-alerts.js";
import type { OperationalMetricsSnapshot } from "../src/observability/operational-metrics.js";

const empty: OperationalMetricsSnapshot = {
  generatedAt: "2026-10-30T00:00:00.000Z",
  windowMinutes: 60,
  inbound: {
    received: 0, processed: 0, failedCurrent: 0,
    outcomes: { handled: 0, handoff: 0, ignored: 0, rolloutSkipped: 0, unknown: 0 },
    processingLatencyMs: { p50: null, p95: null, max: null }
  },
  delivery: { byChannel: [], outboundLifecycle: [] },
  handoffs: { total: 0, byReason: [] },
  queue: [],
  attempts: { published: 0, retries: 0, deadLetters: 0, byRoute: [] }
};

describe("read-only operational alerts", () => {
  it("reports healthy without inferring worker liveness from an empty queue", () => {
    const a = evaluateOperationalAlerts(empty);
    expect(a).toEqual({
      generatedAt: empty.generatedAt,
      windowMinutes: 60,
      status: "healthy",
      alerts: []
    });
  });

  it("flags five-minute queue lag and fifteen-minute critical lag", () => {
    const a = evaluateOperationalAlerts({
      ...empty,
      queue: [
        { topic: "inbound.event.accepted", pending: 2, oldestPendingMs: 6 * 60_000,
          deadLetterTotal: 0, deadLettersInWindow: 0 },
        { topic: "action.dispatch", pending: 3, oldestPendingMs: 16 * 60_000,
          deadLetterTotal: 0, deadLettersInWindow: 0 }
      ]
    });
    expect(a.status).toBe("critical");
    expect(a.alerts).toMatchObject([
      { code: "queue_lag", severity: "warning", topic: "inbound.event.accepted", count: 2 },
      { code: "queue_lag", severity: "critical", topic: "action.dispatch", count: 3 }
    ]);
  });

  it("does not signal stalled workers that were intentionally disabled", () => {
    const snapshot: OperationalMetricsSnapshot = {
      ...empty,
      queue: [{ topic: "action.dispatch", pending: 5, oldestPendingMs: 20 * 60_000,
        deadLetterTotal: 0, deadLettersInWindow: 0 }]
    };
    expect(evaluateOperationalAlerts(snapshot, {
      processorEnabled: true, actionDispatchEnabled: false
    }).alerts).toEqual([]);
  });

  it("reports failed inbound messages and recent dead letters without identities", () => {
    const a = evaluateOperationalAlerts({
      ...empty,
      inbound: { ...empty.inbound, failedCurrent: 5 },
      queue: [{
        topic: "action.dispatch", pending: 0, oldestPendingMs: null,
        deadLetterTotal: 100, deadLettersInWindow: 2
      }]
    });
    expect(a.status).toBe("critical");
    expect(a.alerts).toEqual([
      { code: "inbound_processing_failed", severity: "critical", count: 5 },
      { code: "recent_dead_letter", severity: "warning", count: 2 }
    ]);
    expect(JSON.stringify(a)).not.toContain("recipient");
  });

  it("does not include unrecognized queue labels in operator alerts", () => {
    const a = evaluateOperationalAlerts({
      ...empty,
      queue: [{
        topic: "sensitive-unexpected-queue-name", pending: 100,
        oldestPendingMs: 900_000, deadLetterTotal: 10, deadLettersInWindow: 10
      }]
    });
    expect(a.alerts).toEqual([]);
  });
});
