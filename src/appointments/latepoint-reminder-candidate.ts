import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * A non-sending reminder candidate. It is NOT a provider action or durable
 * scheduler. Only a separately authenticated LatePoint booking source may
 * populate this model. No implicit consent is inferred from the booking.
 */
const bookingSchema = z.object({
  bookingId: z.string().regex(/^[1-9][0-9]{0,17}$/),
  status: z.enum(["approved", "pending", "cancelled", "no_show", "completed"]),
  /** Must include a numeric UTC offset; never parse a WP-local naive time. */
  startsAt: z.string().datetime({ offset: true }),
  customerFirstName: z.string().trim().min(1).max(80),
  /** Canonical Philippine international destination without the '+' sign. */
  whatsappRecipientId: z.string().regex(/^639\d{9}$/),
  /** The booking's source of truth must be Manila local, not the client browser. */
  timeZone: z.literal("Asia/Manila")
}).strict();

export type LatePointBookingSnapshot = z.input<typeof bookingSchema>;
export type ReminderCandidate =
  | { eligible: false; reason: "invalid_booking" | "not_approved" | "already_due" | "too_far_away" | "outside_reminder_window" }
  | {
      eligible: true;
      bookingId: string;
      recipientId: string;
      scheduledFor: string;
      appointmentStartsAt: string;
      templateName: "ishi_appointment_reminder_v1";
      templateLanguage: "en_US";
      templateParameters: readonly [string, string, string];
      idempotencyKey: string;
      /** Must be rechecked against the latest source booking before dispatch. */
      requiresLatestBookingRecheck: true;
      /** Must be rechecked using signed customer consent at dispatch time. */
      requiresCurrentConsent: true;
      /** Sender is hard-disabled until the exact template is approved by Meta. */
      requiresProviderTemplateApproval: true;
    };

const manilaDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  month: "long",
  day: "numeric",
  year: "numeric"
});
const manilaTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
  hour12: true
});

/**
 * Conservative draft scheduling: 24h in advance, never catch-up-send
 * an overdue reminder, never schedule beyond the 90-day forward horizon.
 * Cancellation/rescheduling must revoke the older job in the eventual
 * scheduler; this function intentionally cannot enqueue/send anything.
 */
export function latePointReminderCandidate(
  booking: unknown,
  options: { now: Date; hoursBefore?: 24 | 2 }
): ReminderCandidate {
  const input = bookingSchema.safeParse(booking);
  if (!input.success) return { eligible: false, reason: "invalid_booking" };
  if (input.data.status !== "approved") return { eligible: false, reason: "not_approved" };
  const now = options.now.getTime();
  const start = Date.parse(input.data.startsAt);
  if (!Number.isFinite(now) || !Number.isFinite(start)) {
    return { eligible: false, reason: "invalid_booking" };
  }
  if (start <= now) return { eligible: false, reason: "already_due" };
  if (start - now > 90 * 24 * 60 * 60 * 1000) {
    return { eligible: false, reason: "too_far_away" };
  }
  const leadHours = options.hoursBefore ?? 24;
  const scheduledAt = start - leadHours * 60 * 60 * 1000;
  if (scheduledAt <= now) {
    return { eligible: false, reason: "outside_reminder_window" };
  }
  const idempotencyKey = createHash("sha256").update(JSON.stringify([
    "latepoint-reminder-v1",
    input.data.bookingId,
    input.data.startsAt,
    String(leadHours)
  ])).digest("hex");
  const time = new Date(start);
  return {
    eligible: true,
    bookingId: input.data.bookingId,
    recipientId: input.data.whatsappRecipientId,
    scheduledFor: new Date(scheduledAt).toISOString(),
    appointmentStartsAt: time.toISOString(),
    templateName: "ishi_appointment_reminder_v1",
    templateLanguage: "en_US",
    templateParameters: [
      input.data.customerFirstName,
      manilaDate.format(time),
      manilaTime.format(time)
    ],
    idempotencyKey,
    requiresLatestBookingRecheck: true,
    requiresCurrentConsent: true,
    requiresProviderTemplateApproval: true
  };
}
