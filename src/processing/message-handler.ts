import type { ActionEnvelope } from "../domain/actions.js";
import { normalizeHandoffReason, type EventHandlingResult } from "../domain/processing.js";
import type { BrainClient, BrainTurnResponse } from "../brain/types.js";
import { isWhatsAppTemplateOptOut, WHATSAPP_OPT_OUT_CONFIRMATION } from "../domain/meta-whatsapp-optout.js";
import { isWhatsAppAppointmentOptIn, WHATSAPP_APPOINTMENT_OPT_IN_CONFIRMATION } from "../domain/meta-whatsapp-optin.js";
import type { WhatsAppConsentReader } from "../persistence/whatsapp-consent.js";
import type { StoredInboundEvent } from "../persistence/inbound.js";
import type { MetaHandoffReader } from "../persistence/meta-handoff.js";
import { ProcessingFailure } from "./failure.js";
import type { EventHandler } from "./registry.js";
import { standardMetaReplyEligibility } from "../dispatch/meta-customer-window.js";
import { splitMetaReplyParts, type MetaTextChannel } from "./meta-reply-split.js";

/**
 * Defense in depth for historical events normalized before the self-message
 * classification fix. A business talking to itself must not invoke the AI.
 */
function isInstagramSelfMessage(stored: StoredInboundEvent): boolean {
  const event = stored.event;
  if (event.provider !== "meta" || event.channel !== "instagram") return false;
  if (typeof event.data !== "object" || event.data === null || Array.isArray(event.data)) {
    return false;
  }
  const data = event.data as Record<string, unknown>;
  if (data.selfOriginated === true) return true;
  const message = data.message;
  return typeof message === "object" && message !== null
    && !Array.isArray(message) && (message as Record<string, unknown>).is_self === true;
}


/**
 * Historic Instagram delete callbacks could be saved as message.received
 * before normalization distinguished tombstones. Never answer those records.
 */
function isInstagramDeletedMessage(stored: StoredInboundEvent): boolean {
  const event = stored.event;
  if (event.provider !== "meta" || event.channel !== "instagram") return false;
  if (typeof event.data !== "object" || event.data === null || Array.isArray(event.data)) {
    return false;
  }
  const message = (event.data as Record<string, unknown>).message;
  return typeof message === "object" && message !== null
    && !Array.isArray(message) && (message as Record<string, unknown>).is_deleted === true;
}

export class MessageReceivedHandler implements EventHandler {
  constructor(
    private readonly brain: BrainClient,
    private readonly metaHandoffs?: MetaHandoffReader,
    private readonly whatsappConsent?: WhatsAppConsentReader
  ) {}

  canHandle(stored: StoredInboundEvent): boolean {
    const event = stored.event;
    return !isInstagramSelfMessage(stored)
      && !isInstagramDeletedMessage(stored)
      && event.capability === "messaging"
      && (event.eventType === "message.received"
        || (event.provider === "meta"
          && (event.channel === "messenger" || event.channel === "instagram")
          && event.eventType === "message.postback"));
  }

  async handle(stored: StoredInboundEvent): Promise<EventHandlingResult> {
    const event = stored.event;
    // Defense in depth: a direct handler invocation must never turn an edit,
    // delivery, echo or unknown callback into a customer AI reply.
    if (!this.canHandle(stored)) {
      return { actions: [], outcome: "ignored" };
    }
    if (isInstagramSelfMessage(stored)) {
      return { actions: [], outcome: "ignored" };
    }
    if (event.provider === "meta" && standardMetaReplyEligibility(event.occurredAt) !== "eligible") {
      return { actions: [], outcome: "ignored" };
    }
    if (event.provider === "meta" && this.metaHandoffs !== undefined
      && await this.metaHandoffs.isActive(stored.partitionKey)) {
      return { actions: [], outcome: "ignored" };
    }
    if (event.identityId === undefined) {
      throw new ProcessingFailure("Inbound message has no reply identity", { retryable: false });
    }

    // A customer explicitly opting out of reminders receives only a concise
    // functional confirmation. Do not route STOP to a generative bot or
    // accidentally invite them to opt in again.
    const reply: BrainTurnResponse = isWhatsAppTemplateOptOut(event)
      ? {
          handoff: false,
          parts: [{ kind: "text", text: WHATSAPP_OPT_OUT_CONFIRMATION }]
        }
      : isWhatsAppAppointmentOptIn(event)
        ? {
            handoff: false,
            parts: [{
              kind: "text",
              text: this.whatsappConsent !== undefined
                && await this.whatsappConsent.hasActiveConsent(
                  event.accountId, event.identityId, "appointment_updates"
                )
                ? WHATSAPP_APPOINTMENT_OPT_IN_CONFIRMATION
                : "We couldn't activate WhatsApp appointment reminders. Please contact Ishi Nail Lab."
            }]
          }
        : await this.brain.respond({
            turnId: stored.id,
            conversationId: stored.partitionKey,
            event,
            input: event.content
          });

    if (reply.handoff) {
      return {
        actions: [],
        outcome: "handoff",
        handoffReason: normalizeHandoffReason(reply.handoffReason)
      };
    }

    // Meta Graph rejects whole oversized AI messages. Expand into bounded,
    // ordered durable chunks so retries are idempotent and no text is lost.
    // Extremely long responses go to a human rather than flooding customers.
    const isMetaTextChannel = event.channel === "messenger"
      || event.channel === "instagram" || event.channel === "whatsapp";
    const parts = event.provider === "meta" && isMetaTextChannel
      ? splitMetaReplyParts(reply.parts, event.channel as MetaTextChannel)
      : reply.parts;
    if (parts === undefined) {
      return { actions: [], outcome: "handoff", handoffReason: "reply_too_long" };
    }

    const actions: ActionEnvelope[] = parts.map((part, index) => ({
      schemaVersion: 1,
      idempotencyKey: `${stored.id}:reply:${index}`,
      provider: event.provider,
      capability: "messaging",
      operation: "message.send",
      orderingKey: stored.partitionKey,
      target: {
        channel: event.channel,
        accountId: event.accountId,
        recipientId: event.identityId
      },
      body: {
        part,
        ...(event.provider === "meta" && event.occurredAt !== undefined
          ? { customerMessageAt: event.occurredAt }
          : {})
      }
    }));

    return { actions, outcome: "handled" };
  }
}
