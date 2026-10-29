import { describe, expect, it, vi } from "vitest";
import { PostgresOutboxStore, ACTION_DISPATCH_TOPIC, type OutboxJob } from "../src/persistence/outbox.js";
import type { PostgresDatabase } from "../src/persistence/postgres.js";

const job: OutboxJob = {
  id: "11111111-1111-4111-8111-111111111111",
  topic: ACTION_DISPATCH_TOPIC,
  partitionKey: "partition-fence",
  payload: {},
  attemptCount: 0,
  leaseToken: "22222222-2222-4222-8222-222222222222"
};

describe("durable Meta outbound POST fence", () => {
  it("commits the pre-send fence only for the current live lease and allowed Meta operations", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ id: job.id }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresOutboxStore({ query } as unknown as PostgresDatabase);
    expect(await store.prepareMetaSend(job)).toBe(true);
    expect(await store.prepareMetaSend(job)).toBe(false);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("SET meta_send_started_at = now()");
    expect(sql).toContain("lease_token = $2::uuid");
    expect(sql).toContain("lease_expires_at > now()");
    expect(sql).toContain("meta_send_started_at IS NULL");
    expect(sql).toContain("'message.send','message.template.send'");
    expect(params).toEqual([job.id, job.leaseToken]);
  });

  it("quarantines expired armed sends before claiming new work and excludes armed jobs", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresOutboxStore({ query } as unknown as PostgresDatabase);
    expect(await store.claimNext(ACTION_DISPATCH_TOPIC, 30000)).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    const [quarantine] = query.mock.calls[0] as [string];
    const [claim] = query.mock.calls[1] as [string];
    expect(quarantine).toContain("FOR UPDATE OF o SKIP LOCKED");
    expect(quarantine).toContain("provider_outcome_unknown");
    expect(quarantine).toContain("manual_reconciliation_required=true");
    expect(quarantine).toContain("INSERT INTO outbox_attempts");
    expect(quarantine).toContain("lease_expires_at <= now()");
    expect(claim).toContain("AND o.meta_send_started_at IS NULL");
    expect(claim).toContain("FOR UPDATE OF o SKIP LOCKED");
  });

  it("clears a Meta fence only on definitive 429 retries, preserving it for other failures", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ outbox_id: job.id }] });
    const store = new PostgresOutboxStore({ query } as unknown as PostgresDatabase);
    await store.retry(job, new Date("2026-10-29T00:00:00.000Z"), {
      provider: "meta", capability: "messaging", operation: "message.send",
      retryable: true, ambiguous: false, httpStatus: 429, errorClass: "throttled"
    });
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("meta_send_started_at = CASE");
    expect(sql).toContain("$10::boolean = FALSE AND $11::integer = 429");
    expect(values[9]).toBe(false);
    expect(values[10]).toBe(429);
  });
});
