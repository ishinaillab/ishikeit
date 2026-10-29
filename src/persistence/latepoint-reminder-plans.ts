import type pg from "pg";
import type { PostgresDatabase, SqlExecutor } from "./postgres.js";
import {
  reminderSlotsForBooking,
  type BookingChangeForPlan
} from "../appointments/latepoint-reminder-plan.js";

/**
 * A non-sending durable two-slot scheduler. No recipient PII, provider tokens,
 * WhatsApp actions or consent inference are persisted.
 *
 * A per-booking transaction-level advisory lock serializes revisions. Older
 * callbacks cannot restore cancelled plans; same-timestamp conflicting events
 * quarantine the booking until a strictly later authoritative change arrives.
 */
export interface LatePointReminderPlanStore {
  apply(change: BookingChangeForPlan): Promise<"applied" | "stale" | "duplicate" | "conflicted">;
  applyInTransaction(tx: SqlExecutor, change: BookingChangeForPlan): Promise<"applied" | "stale" | "duplicate" | "conflicted">;
  suppressDue(now?: Date): Promise<number>;
}

interface StateRow extends pg.QueryResultRow {
  latest_event_id: string;
  occurred_at: Date;
  status: string;
  starts_at: Date | null;
  conflict: boolean;
}

export class PostgresLatePointReminderPlanStore implements LatePointReminderPlanStore {
  constructor(private readonly db: PostgresDatabase) {}

  async apply(change: BookingChangeForPlan): Promise<"applied" | "stale" | "duplicate" | "conflicted"> {
    return this.db.transaction(tx => this.applyInTransaction(tx, change));
  }

  async applyInTransaction(tx: SqlExecutor, change: BookingChangeForPlan): Promise<"applied" | "stale" | "duplicate" | "conflicted"> {
    const now = new Date();
    const occurredAt = change.occurredAt.getTime();
    if (!Number.isFinite(occurredAt) || occurredAt > now.getTime() + 300_000) {
      throw new Error("Booking revision timestamp is invalid or in the future");
    }
    await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        ["latepoint-reminder-plan-v1:" + change.bookingId]
      );
      const state = await tx.query<StateRow>(
        `SELECT latest_event_id,occurred_at,status,starts_at,conflict
           FROM public.latepoint_booking_states
           WHERE booking_id=$1 FOR UPDATE`,
        [change.bookingId]
      );
      const previous = state.rows[0];
      if (previous !== undefined) {
        const previousTime = new Date(previous.occurred_at).getTime();
        if (occurredAt < previousTime) return "stale";
        if (occurredAt === previousTime) {
          if (change.eventId === previous.latest_event_id) return "duplicate";
          // Equal timestamps with any different event are ambiguous:
          // fail closed even if their states happen to be equivalent.
          await tx.query(
            "UPDATE public.latepoint_booking_states SET conflict=true,updated_at=now() WHERE booking_id=$1",
            [change.bookingId]
          );
          await tx.query(
            `UPDATE public.latepoint_reminder_slots
              SET status='invalidated',reason='conflicting_revision',
                  due_at=NULL,updated_at=now()
              WHERE booking_id=$1`,
            [change.bookingId]
          );
          return "conflicted";
        }
      }
      await tx.query(
        `INSERT INTO public.latepoint_booking_states
          (booking_id,latest_event_id,occurred_at,status,starts_at,conflict)
          VALUES ($1,$2::uuid,$3,$4,$5,false)
          ON CONFLICT(booking_id) DO UPDATE
          SET latest_event_id=excluded.latest_event_id,
              occurred_at=excluded.occurred_at,
              status=excluded.status,
              starts_at=excluded.starts_at,
              conflict=false,updated_at=now()`,
        [change.bookingId, change.eventId, change.occurredAt,
          change.status, change.startsAt]
      );
      for (const slot of reminderSlotsForBooking(change, now)) {
        await tx.query(
          `INSERT INTO public.latepoint_reminder_slots
            (booking_id,lead_hours,revision_event_id,starts_at,due_at,status,reason)
            VALUES($1,$2,$3::uuid,$4,$5,$6,$7)
            ON CONFLICT(booking_id,lead_hours) DO UPDATE
            SET revision_event_id=excluded.revision_event_id,
                starts_at=excluded.starts_at,due_at=excluded.due_at,
                status=excluded.status,reason=excluded.reason,updated_at=now()`,
          [change.bookingId, slot.leadHours, change.eventId, change.startsAt,
            slot.dueAt, slot.status, slot.reason]
        );
      }
      return "applied";
  }

  /**
   * A periodic *non-sending* clock runner. Every due slot is irreversibly
   * suppressed for this revision (never catch-up-send). Revisions can create
   * new plans. Provider dispatch cannot be inferred from this method.
   */
  async suppressDue(now: Date = new Date()): Promise<number> {
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid scheduler time");
    const r = await this.db.query(
      `WITH due AS (
         SELECT s.booking_id,s.lead_hours
         FROM public.latepoint_reminder_slots AS s
         WHERE s.status='scheduled' AND s.due_at <= $1
         ORDER BY s.due_at,s.booking_id,s.lead_hours
         FOR UPDATE SKIP LOCKED LIMIT 100
       )
       UPDATE public.latepoint_reminder_slots AS s
       SET status='suppressed',reason='outbound_not_authorized',updated_at=now()
       FROM due
       WHERE s.booking_id=due.booking_id AND s.lead_hours=due.lead_hours
       RETURNING s.booking_id`,
      [now]
    );
    return r.rowCount ?? 0;
  }
}
