import type { CanonicalEvent } from "./events.js";
import { standardMetaReplyEligibility } from "../dispatch/meta-customer-window.js";

/**
 * The entire customer-authored text must identify both the business and
 * the specific WhatsApp message category; no implicit consent from a DM,
 * appointment booking, or generic "yes" is accepted.
 */
export const WHATSAPP_APPOINTMENT_OPT_IN_PHRASE =
  "I agree to receive WhatsApp appointment reminders from Ishi Nail Lab. Reply STOP REMINDERS to opt out.";

export const WHATSAPP_APPOINTMENT_OPT_IN_CONFIRMATION =
  "You’re opted in to Ishi Nail Lab appointment reminders on WhatsApp. Reply STOP REMINDERS anytime to unsubscribe.";

export function isWhatsAppAppointmentOptIn(
  event: Pick<CanonicalEvent, "provider" | "channel" | "eventType" | "identityId" | "occurredAt" | "content">
): boolean {
  return event.provider === "meta"
    && event.channel === "whatsapp"
    && event.eventType === "message.received"
    && event.identityId !== undefined
    && standardMetaReplyEligibility(event.occurredAt) === "eligible"
    && event.content.some(
      (part) => part.kind === "text"
        && part.text.trim().toLowerCase() === WHATSAPP_APPOINTMENT_OPT_IN_PHRASE.toLowerCase()
    );
}
