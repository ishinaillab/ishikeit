import { describe, expect, it } from "vitest";
import {
  bookingChangeForPlan, reminderSlotsForBooking
} from "../src/appointments/latepoint-reminder-plan.js";
import type { CanonicalEvent } from "../src/domain/events.js";

const clock = new Date("2026-10-29T00:00:00.000Z");
const start = new Date("2026-11-05T08:00:00.000Z");
const snapshot = { status: "approved" as const, startsAt: start };

describe("signed LatePoint reminder plan projection (never sends)", () => {
  it("creates deterministic 24-hour and 2-hour deadline slots with UTC times", () => {
    expect(reminderSlotsForBooking(snapshot, clock)).toEqual([
      { leadHours: 24, dueAt: new Date("2026-11-04T08:00:00.000Z"),
        status: "scheduled", reason: "awaiting_due_time" },
      { leadHours: 2, dueAt: new Date("2026-11-05T06:00:00.000Z"),
        status: "scheduled", reason: "awaiting_due_time" }
    ]);
  });

  it.each(["pending","cancelled","no_show","completed","deleted"] as const)(
    "invalidates both slots on booking state %s",
    status => {
      const slots = reminderSlotsForBooking({ status, startsAt: status === "deleted" ? null : start }, clock);
      expect(slots.every(s => s.status === "invalidated" && s.dueAt === null)).toBe(true);
      expect(slots.every(s => s.reason === "not_approved")).toBe(true);
    }
  );

  it("never catch-up-sends a reminder after its due time", () => {
    const now = new Date("2026-11-04T09:00:00.000Z");
    const [first, second] = reminderSlotsForBooking(snapshot, now);
    expect(first).toMatchObject({ status: "invalidated", reason: "past_or_due", dueAt: null });
    expect(second).toMatchObject({ status: "scheduled", reason: "awaiting_due_time" });
  });

  it("rejects extremely distant appointments and invalid scheduler clock", () => {
    const distant = new Date(clock.getTime() + 91 * 86400_000);
    expect(reminderSlotsForBooking({ status: "approved", startsAt: distant }, clock)
      .every(s => s.reason === "beyond_horizon")).toBe(true);
    expect(() => reminderSlotsForBooking(snapshot, new Date("bad"))).toThrow();
  });

  it("refuses non-LatePoint events or malformed booking payloads", () => {
    const event: CanonicalEvent = {
      schemaVersion: 2, specversion: "1.0",
      id: "booking-test", source: "urn:ishikeit:source:latepoint:bookings:www.ishinaillab.com",
      type: "com.ishikeit.booking.booking.changed", provider: "latepoint", channel: "bookings",
      capability: "booking", accountId: "www.ishinaillab.com", eventType: "booking.changed",
      occurredAt: clock.toISOString(), receivedAt: clock.toISOString(),
      content: [],
      data: { bookingId: "123", change: "updated", status: "approved", startsAt: start.toISOString() }
    };
    expect(bookingChangeForPlan(event, "11111111-1111-4111-8111-111111111111"))
      .toMatchObject({ bookingId: "123", status: "approved", startsAt: start });
    expect(() => bookingChangeForPlan({ ...event, provider: "meta" }, "id")).toThrow();
    expect(() => bookingChangeForPlan({ ...event, data: { ...event.data as object, phone: "secret" } }, "id")).toThrow();
  });
});
