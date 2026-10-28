import type { CanonicalEvent } from "./events.js";

/**
 * The customer's exact affirmative consent must identify the business,
 * channel, and message purpose. An ordinary chat or vague "yes" never opts in.
 */
export const WHATSAPP_APPOINTMENT_OPT_IN_PHRASE =
  "I CONSENT TO ISHI NAIL LAB WHATSAPP APPOINTMENT UPDATES";

export function isWhatsAppAppointmentOptIn(
  event: Pick<CanonicalEvent, "provider" | "channel" | "eventType" | "identityId" | "content">
): boolean {
  return event.provider === "meta"
    && event.channel === "whatsapp"
    && event.eventType === "message.received"
    && event.identityId !== undefined
    && event.content.some(
      (part) => part.kind === "text"
        && part.text.trim().toUpperCase() === WHATSAPP_APPOINTMENT_OPT_IN_PHRASE
    );
}

export const WHATSAPP_OPT_IN_SUCCESS_CONFIRMATION =
  "Your consent to Ishi Nail Lab WhatsApp appointment updates is recorded. Reply STOP REMINDERS anytime to opt out.";

export const WHATSAPP_OPT_IN_UNAVAILABLE_CONFIRMATION =
  "WhatsApp appointment-update enrollment is not available yet. Please contact Ishi Nail Lab for booking assistance.";
