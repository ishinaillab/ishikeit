import { z } from "zod";
import type { CanonicalEvent } from "../domain/events.js";

const change = z.object({
  bookingId: z.string().regex(/^[1-9][0-9]{0,17}$/),
  change: z.enum(["created", "updated", "deleted"]),
  status: z.enum(["approved", "pending", "cancelled", "no_show", "completed", "deleted"]),
  startsAt: z.string().datetime({ offset: true }).nullable()
}).strict().superRefine((value, ctx) => {
  if ((value.status === "deleted") !== (value.change === "deleted")) {
    ctx.addIssue({ code: "custom", message: "deleted state must be a tombstone" });
  }
  if ((value.status === "deleted") !== (value.startsAt === null)) {
    ctx.addIssue({ code: "custom", message: "only deleted bookings may omit their start" });
  }
});

export const REMINDER_LEAD_HOURS = [24, 2] as const;
export type ReminderLeadHours = typeof REMINDER_LEAD_HOURS[number];

export interface BookingChangeForPlan {
  bookingId: string;
  status: "approved" | "pending" | "cancelled" | "no_show" | "completed" | "deleted";
  change: "created" | "updated" | "deleted";
  startsAt: Date | null;
  occurredAt: Date;
  eventId: string;
}

export interface ReminderSlotProjection {
  leadHours: ReminderLeadHours;
  dueAt: Date | null;
  status: "scheduled" | "invalidated";
  reason: "awaiting_due_time" | "not_approved" | "past_or_due" | "beyond_horizon";
}

/** Strictly signed, normalized and customer-free LatePoint event only. */
export function bookingChangeForPlan(event: CanonicalEvent, eventId: string): BookingChangeForPlan {
  if (event.provider !== "latepoint" || event.channel !== "bookings"
    || event.capability !== "booking" || event.eventType !== "booking.changed"
    || event.accountId !== "www.ishinaillab.com" || event.occurredAt === undefined) {
    throw new Error("Not a canonical LatePoint booking change");
  }
  const d = change.parse(event.data);
  const occurredAt = new Date(event.occurredAt);
  const startsAt = d.startsAt === null ? null : new Date(d.startsAt);
  if (!Number.isFinite(occurredAt.getTime())
    || (startsAt !== null && !Number.isFinite(startsAt.getTime()))) {
    throw new Error("Invalid booking change timestamp");
  }
  return { bookingId: d.bookingId, status: d.status, change: d.change,
    startsAt, occurredAt, eventId };
}

/**
 * A schedule is a *plan*, never an authorization to send.
 * 24h and 2h candidates outside the forward horizon or already due
 * are invalidated, not sent late. No phone, names or template text in storage.
 */
export function reminderSlotsForBooking(
  booking: Pick<BookingChangeForPlan, "status" | "startsAt">,
  now: Date
): ReminderSlotProjection[] {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid scheduler clock");
  return REMINDER_LEAD_HOURS.map((leadHours) => {
    if (booking.status !== "approved" || booking.startsAt === null) {
      return { leadHours, dueAt: null, status: "invalidated", reason: "not_approved" };
    }
    const start = booking.startsAt.getTime();
    const due = start - leadHours * 60 * 60 * 1000;
    if (start <= now.getTime() || due <= now.getTime()) {
      return { leadHours, dueAt: null, status: "invalidated", reason: "past_or_due" };
    }
    if (start > now.getTime() + 90 * 86400_000) {
      return { leadHours, dueAt: null, status: "invalidated", reason: "beyond_horizon" };
    }
    return {
      leadHours,
      dueAt: new Date(due),
      status: "scheduled",
      reason: "awaiting_due_time"
    };
  });
}
