import type { ActionEnvelope } from "../domain/actions.js";
import { normalizeHandoffReason, type EventHandlingResult } from "../domain/processing.js";
import type { BrainClient, BrainTurnResponse } from "../brain/types.js";
import { isWhatsAppTemplateOptOut, WHATSAPP_OPT_OUT_CONFIRMATION } from "../domain/meta-whatsapp-optout.js";
import { isWhatsAppAppointmentOptIn, WHATSAPP_APPOINTMENT_OPT_IN_CONFIRMATION } from "../domain/meta-whatsapp-optin.js";
import type { WhatsAppConsentReader } from "../persistence/whatsapp-consent.js";
import type { StoredInboundEvent } from "../persistence/inbound.js";
import type { MetaHandoffReader } from "../persistence/meta-handoff.js";
import type { MetaDisclosureReader } from "../persistence/meta-disclosure.js";
import { ProcessingFailure } from "./failure.js";
import type { EventHandler } from "./registry.js";
import { standardMetaReplyEligibility } from "../dispatch/meta-customer-window.js";
import { splitMetaReplyParts, type MetaTextChannel } from "./meta-reply-split.js";
import { explicitLinks } from "./explicit-links.js";

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

/** Only explicit customer requests to stop automation; do not interpret unrelated text as consent. */
export function isMetaAutomationOptOut(stored: StoredInboundEvent): boolean {
  const event = stored.event;
  if (event.provider !== "meta"
    || (event.channel !== "messenger" && event.channel !== "instagram")
    || event.eventType !== "message.received") return false;
  return event.content.some((part) => part.kind === "text"
    && /^(?:stop|unsubscribe|opt[ -]?out|stop bot|stop automation|stop automated replies|turn off automated replies|disable bot)$/iu.test(part.text.trim()));
}

export class MessageReceivedHandler implements EventHandler {
  constructor(
    private readonly brain: BrainClient,
    private readonly metaHandoffs?: MetaHandoffReader,
    private readonly whatsappConsent?: WhatsAppConsentReader,
    private readonly metaDisclosure?: MetaDisclosureReader
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
    // Persist a durable account/customer-scoped handoff using the existing
    // meta_handoff_blocks transaction; never send another AI reply on this partition
    // until an authenticated operator explicitly releases the block.
    if (isMetaAutomationOptOut(stored)) {
      // Complete the inbound event and customer-initiated suppression atomically.
      // Do NOT queue an acknowledgement: all Meta outbound actions are deliberately
      // blocked as soon as the handoff is active, including previously queued AI replies.
      // A follow-up message must be deliberately sent by an authenticated human operator.
      return { actions: [], outcome: "handoff", handoffReason: "customer_automation_opt_out" };
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
    // The AI writes Markdown links, but the provider APIs below send plain
    // text (Telegram also deliberately omits parse_mode). Give customers an
    // explicit clickable URL instead of a literal [label](url) sequence.
    let disclosureRequired = false;
    if (event.provider === "meta"
      && (event.channel === "instagram" || event.channel === "messenger")
      && this.metaDisclosure !== undefined) {
      const previous = await this.metaDisclosure.hasRecentAutomatedReply(
        stored.partitionKey, new Date(event.receivedAt), stored.id
      );
      disclosureRequired = !previous;
    }

    // Meta recommends explicit automated-experience disclosure at first
    // contact and after a substantial lapse. It is derived from the durable,
    // account-scoped partition history, not from model self-identification.
    // Do not insert a duplicate if the AI already gave a clear disclosure.
    let acknowledged = false;
    const presentationParts = reply.parts.map((part) => {
      if (part.kind !== "text") return part;
      let text = explicitLinks(part.text);
      if (disclosureRequired && !acknowledged) {
        acknowledged = true;
        if (!/Ishi Nail Lab(?:'s|’s)? AI assistant/iu.test(text.slice(0, 250))) {
          text = "I'm Ishi Nail Lab's AI assistant.\\n\\n" + text;
        }
      }
      return { ...part, text };
    });
    if (disclosureRequired && !acknowledged) {
      presentationParts.unshift({ kind: "text", text: "I'm Ishi Nail Lab's AI assistant." });
    }
    const parts = event.provider === "meta" && isMetaTextChannel
      ? splitMetaReplyParts(presentationParts, event.channel as MetaTextChannel)
      : presentationParts;
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
        recipientId: event.identityId,
        ...(event.provider === "telegram" && typeof event.data === "object"
          && event.data !== null && !Array.isArray(event.data)
          && typeof (event.data as Record<string, unknown>).businessConnectionId === "string"
          ? { businessConnectionId: (event.data as Record<string, unknown>).businessConnectionId }
          : {})
      },
      body: {
        part,
        ...((event.provider === "meta" || (event.provider === "telegram"
          && typeof event.data === "object" && event.data !== null
          && !Array.isArray(event.data)
          && typeof (event.data as Record<string, unknown>).businessConnectionId === "string"))
          && event.occurredAt !== undefined
          ? { customerMessageAt: event.occurredAt }
          : {})
      }
    }));

    return { actions, outcome: "handled" };
  }
}
