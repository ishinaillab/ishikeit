import { describe, expect, it, vi } from "vitest";
import { PostgresLatePointReminderPlanStore } from "../src/persistence/latepoint-reminder-plans.js";
import type { PostgresDatabase, SqlExecutor } from "../src/persistence/postgres.js";
import type { BookingChangeForPlan } from "../src/appointments/latepoint-reminder-plan.js";

const now = new Date();
const start = new Date(now.getTime() + 7 * 86400_000);
const id = "11111111-1111-4111-8111-111111111111";
const change: BookingChangeForPlan = {
  bookingId: "1234", status: "approved", change: "updated",
  startsAt: start, occurredAt: now, eventId: id
};

function fixture(previous?: Record<string, unknown>) {
  const sqls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    sqls.push({ sql, values });
    if (sql.includes("SELECT latest_event_id,occurred_at")) {
      return { rows: previous === undefined ? [] : [previous], rowCount: previous === undefined ? 0 : 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const tx = { query } as unknown as SqlExecutor;
  const db = {
    transaction: async (fn: (q: SqlExecutor) => Promise<unknown>) => fn(tx),
    query
  } as unknown as PostgresDatabase;
  return { plans: new PostgresLatePointReminderPlanStore(db), tx, sqls, query };
}

describe("durable PII-free booking revision state machine", () => {
  it("projects two schedule slots in the inbound transaction, never outbox actions", async () => {
    const f = fixture();
    expect(await f.plans.applyInTransaction(f.tx, change)).toBe("applied");
    const slots = f.sqls.filter(x => x.sql.includes("INSERT INTO public.latepoint_reminder_slots"));
    expect(slots).toHaveLength(2);
    expect(slots.map(x => x.values?.[1])).toEqual([24, 2]);
    expect(slots.every(x => x.values?.[5] === "scheduled")).toBe(true);
    expect(f.sqls.some(x => x.sql.includes("outbox"))).toBe(false);
  });

  it("never lets a stale event replace newer state", async () => {
    const f = fixture({
      latest_event_id: "22222222-2222-4222-8222-222222222222",
      occurred_at: new Date(now.getTime() + 1000),
      status: "cancelled", starts_at: start, conflict: false
    });
    expect(await f.plans.applyInTransaction(f.tx, change)).toBe("stale");
    expect(f.sqls.some(x => x.sql.includes("INSERT INTO public.latepoint_booking_states"))).toBe(false);
  });

  it("quarantines equal-timestamp conflicting revisions and cancels both slots", async () => {
    const f = fixture({
      latest_event_id: "22222222-2222-4222-8222-222222222222",
      occurred_at: now, status: "approved", starts_at: start, conflict: false
    });
    expect(await f.plans.applyInTransaction(f.tx, change)).toBe("conflicted");
    expect(f.sqls.some(x => x.sql.includes("conflict=true"))).toBe(true);
    expect(f.sqls.some(x => x.sql.includes("reason='conflicting_revision'"))).toBe(true);
  });

  it("treats an identical revision as duplicate", async () => {
    const f = fixture({
      latest_event_id: id, occurred_at: now,
      status: "approved", starts_at: start, conflict: false
    });
    expect(await f.plans.applyInTransaction(f.tx, change)).toBe("duplicate");
    expect(f.sqls.some(x => x.sql.includes("UPDATE public.latepoint_reminder_slots"))).toBe(false);
  });

  it("invalidates old reminder plans on signed cancellation", async () => {
    const f = fixture();
    const cancelled = { ...change, status: "cancelled" as const };
    expect(await f.plans.applyInTransaction(f.tx, cancelled)).toBe("applied");
    expect(f.sqls.filter(x => x.sql.includes("INSERT INTO public.latepoint_reminder_slots"))
      .every(x => x.values?.[5] === "invalidated" && x.values?.[4] === null)).toBe(true);
  });

  it("only suppresses due slots, never dispatches any message", async () => {
    const f = fixture();
    expect(await f.plans.suppressDue(now)).toBe(1);
    expect(f.sqls).toHaveLength(1);
    expect(f.sqls[0]?.sql).toContain("outbound_not_authorized");
    expect(f.sqls[0]?.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(f.sqls[0]?.sql).not.toContain("action.dispatch");
  });

  it("rejects impossible future source event timestamps", async () => {
    const f = fixture();
    await expect(f.plans.applyInTransaction(f.tx, {
      ...change, occurredAt: new Date(Date.now() + 3600_000)
    })).rejects.toThrow();
  });
});
