import type { CanonicalEvent } from "./events.js";

/** Only signed, durable WhatsApp customer messages may revoke template consent. */
export function isWhatsAppTemplateOptOut(
  event: Pick<CanonicalEvent, "provider" | "channel" | "eventType" | "identityId" | "content">
): boolean {
  return event.provider === "meta"
    && event.channel === "whatsapp"
    && event.eventType === "message.received"
    && event.identityId !== undefined
    && event.content.some(
      (part) => part.kind === "text"
        && /^(?:stop|unsubscribe|stop reminders)$/iu.test(part.text.trim())
    );
}

/**
 * One functional, non-promotional opt-out acknowledgment inside the normal
 * customer-service window; never a marketing template or re-opt-in prompt.
 */
export const WHATSAPP_OPT_OUT_CONFIRMATION =
  "Understood. We won't send you appointment reminders unless you opt in again.";
