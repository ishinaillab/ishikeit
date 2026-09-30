import { describe, expect, it, vi } from "vitest";
import type { PostgresDatabase } from "../src/persistence/postgres.js";
import { PostgresOperationalMetrics } from "../src/observability/operational-metrics.js";

describe("PostgresOperationalMetrics", () => {
  it("reports durable processing outcomes and handoff reasons without guessing unknown rows", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          received_count: "10",
          processed_count: "9",
          failed_current: "1",
          handled_count: "5",
          handoff_count: "2",
          ignored_count: "1",
          rollout_skipped_count: "1",
          unknown_outcome_count: "1",
          p50_ms: 120,
          p95_ms: 500,
          max_ms: 900
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          topic: "action.dispatch",
          pending: "0",
          oldest_pending_ms: null
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          topic: "action.dispatch",
          provider: "meta",
          capability: "messaging",
          operation: "message.send",
          outcome: "published",
          error_class: null,
          http_status: 200,
          provider_code: null,
          count: "3"
        }]
      })
      .mockResolvedValueOnce({
        rows: [
          { reason: "customer_requested_human", count: "1" },
          { reason: "unspecified", count: "1" }
        ]
      });

    const metrics = new PostgresOperationalMetrics({
      query
    } as unknown as PostgresDatabase);

    const snapshot = await metrics.snapshot(60);

    expect(snapshot.inbound).toMatchObject({
      received: 10,
      processed: 9,
      failedCurrent: 1,
      outcomes: {
        handled: 5,
        handoff: 2,
        ignored: 1,
        rolloutSkipped: 1,
        unknown: 1
      }
    });
    expect(snapshot.handoffs).toEqual({
      total: 2,
      byReason: [
        { reason: "customer_requested_human", count: 1 },
        { reason: "unspecified", count: 1 }
      ]
    });
    expect(snapshot.attempts.published).toBe(3);
    expect(query).toHaveBeenCalledTimes(4);
    expect(String(query.mock.calls[0]?.[0]))
      .toContain("processed_at IS NOT NULL AND processing_outcome IS NULL");
  });
});
