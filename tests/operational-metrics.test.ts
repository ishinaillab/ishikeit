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
          oldest_pending_ms: null,
          dead_letter_total: "11",
          dead_letter_window: "0"
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
      })
      .mockResolvedValueOnce({
        rows: [
          { channel: "whatsapp", event_type: "delivery.delivered", count: "4" },
          { channel: "whatsapp", event_type: "delivery.read", count: "2" }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          { channel: "whatsapp", status: "delivery.read", count: "2" },
          { channel: "messenger", status: "delivery.unconfirmed", count: "3" }
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
    expect(snapshot.queue).toEqual([{
      topic: "action.dispatch",
      pending: 0,
      oldestPendingMs: null,
      deadLetterTotal: 11,
      deadLettersInWindow: 0
    }]);
    expect(snapshot.delivery.byChannel).toEqual([
      { channel: "whatsapp", status: "delivered", count: 4 },
      { channel: "whatsapp", status: "read", count: 2 }
    ]);
    expect(snapshot.delivery.outboundLifecycle).toEqual([
      { channel: "whatsapp", status: "read", count: 2 },
      { channel: "messenger", status: "unconfirmed", count: 3 }
    ]);
    expect(query).toHaveBeenCalledTimes(6);
    expect(String(query.mock.calls[1]?.[0])).toContain("dead_lettered_at >= now()");
    expect(query.mock.calls[1]?.[1]).toEqual([60]);
    const reconciliationQuery = String(query.mock.calls[5]?.[0]);
    expect(reconciliationQuery).toContain("ie.account_id = sent.account_id");
    expect(reconciliationQuery).toContain("ie.provider_message_id = sent.provider_message_id");
    expect(reconciliationQuery).toContain("LEFT JOIN LATERAL");
    expect(String(query.mock.calls[0]?.[0]))
      .toContain("processed_at IS NOT NULL AND processing_outcome IS NULL");
  });
});
