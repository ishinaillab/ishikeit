import { describe, expect, it } from "vitest";
import { latePointReminderCandidate } from "../src/appointments/latepoint-reminder-candidate.js";

const booking = {
  bookingId: "314",
  status: "approved",
  startsAt: "2026-11-03T11:00:00+08:00",
  customerFirstName: "Alex",
  whatsappRecipientId: "639123456789",
  timeZone: "Asia/Manila"
};

describe("LatePoint WhatsApp reminder candidate (planning only, no sending)", () => {
  const now = new Date("2026-10-29T06:00:00+08:00");

  it("plans only exact approved appointments in the studio timezone", () => {
    const candidate = latePointReminderCandidate(booking, { now });
    expect(candidate).toMatchObject({
      eligible: true,
      scheduledFor: "2026-11-02T03:00:00.000Z",
      appointmentStartsAt: "2026-11-03T03:00:00.000Z",
      templateName: "ishi_appointment_reminder_v1",
      templateLanguage: "en_US",
      templateParameters: ["Alex", "November 3, 2026", "11:00 AM"],
      requiresLatestBookingRecheck: true,
      requiresCurrentConsent: true,
      requiresProviderTemplateApproval: true
    });
    if (candidate.eligible) {
      const repeated = latePointReminderCandidate(booking, { now });
      expect(repeated).toEqual(candidate);
      expect(candidate.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("rescheduling generates a new candidate identifier but must invalidate the old job", () => {
    const first = latePointReminderCandidate(booking, { now });
    const next = latePointReminderCandidate({
      ...booking,
      startsAt: "2026-11-04T11:00:00+08:00"
    }, { now });
    expect(first.eligible).toBe(true);
    expect(next.eligible).toBe(true);
    if (first.eligible && next.eligible) {
      expect(first.idempotencyKey).not.toBe(next.idempotencyKey);
      expect(next.scheduledFor).toBe("2026-11-03T03:00:00.000Z");
    }
  });

  it.each(["pending", "cancelled", "no_show", "completed"])(
    "never schedules %s bookings",
    (status) => {
      expect(latePointReminderCandidate({ ...booking, status }, { now }))
        .toEqual({ eligible: false, reason: "not_approved" });
    }
  );

  it("never catches up with overdue reminders or sends after appointment time", () => {
    expect(latePointReminderCandidate(booking, {
      now: new Date("2026-11-02T12:00:00+08:00")
    })).toEqual({ eligible: false, reason: "outside_reminder_window" });
    expect(latePointReminderCandidate(booking, {
      now: new Date("2026-11-03T11:00:00+08:00")
    })).toEqual({ eligible: false, reason: "already_due" });
  });

  it("rejects malformed timestamps, implicit timezone, unrelated phones or future horizons", () => {
    expect(latePointReminderCandidate({ ...booking, startsAt: "2026-11-03 11:00:00" }, { now }))
      .toEqual({ eligible: false, reason: "invalid_booking" });
    expect(latePointReminderCandidate({ ...booking, timeZone: "UTC" }, { now }))
      .toEqual({ eligible: false, reason: "invalid_booking" });
    expect(latePointReminderCandidate({ ...booking, whatsappRecipientId: "09123456789" }, { now }))
      .toEqual({ eligible: false, reason: "invalid_booking" });
    expect(latePointReminderCandidate({
      ...booking, startsAt: "2027-03-03T11:00:00+08:00"
    }, { now })).toEqual({ eligible: false, reason: "too_far_away" });
  });

  it("handles a two-hour reminder offset as an explicit separate candidate", () => {
    const c = latePointReminderCandidate(booking, { now, hoursBefore: 2 });
    expect(c).toMatchObject({
      eligible: true, scheduledFor: "2026-11-03T01:00:00.000Z"
    });
  });

  it("cannot create an action from an untrusted free-form booking with extra fields", () => {
    const untrusted = { ...booking, customerFirstName: "Alex", consentAssumed: true };
    expect(latePointReminderCandidate(untrusted, { now }))
      .toEqual({ eligible: false, reason: "invalid_booking" });
  });
});
