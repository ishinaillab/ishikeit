import type { ActionEnvelope } from "../domain/actions.js";
import { normalizeHandoffReason, type EventHandlingResult } from "../domain/processing.js";
import type { BrainClient } from "../brain/types.js";
import type { StoredInboundEvent } from "../persistence/inbound.js";
import type { MetaHandoffReader } from "../persistence/meta-handoff.js";
import { whatsappConsentIntent, type WhatsAppConsentReader } from "../persistence/whatsapp-consent.js";
import { ProcessingFailure } from "./failure.js";
import type { EventHandler } from "./registry.js";
import { standardMetaReplyEligibility } from "../dispatch/meta-customer-window.js";

export class MessageReceivedHandler implements EventHandler {
  constructor(
    private readonly brain: BrainClient,
    private readonly metaHandoffs?: MetaHandoffReader,
    private readonly whatsappConsents?: WhatsAppConsentReader
  ) {}

  canHandle(stored: StoredInboundEvent): boolean {
    const event = stored.event;
    return event.capability === "messaging"
      && (event.eventType === "message.received"
        || (event.provider === "meta"
          && (event.channel === "messenger" || event.channel === "instagram")
          && event.eventType === "message.postback"));
  }

  async handle(stored: StoredInboundEvent): Promise<EventHandlingResult> {
    const event = stored.event;
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

    // User-authored WhatsApp opt-in / STOP are deterministic, audited service
    // controls. Never have a language model infer or promise consent.
    const onlyPart = event.content.length === 1 ? event.content[0] : undefined;
    const intent = event.provider === "meta" && event.channel === "whatsapp"
      && onlyPart?.kind === "text" ? whatsappConsentIntent(onlyPart.text) : null;
    if (intent !== null) {
      if (this.whatsappConsents === undefined) {
        // Consent collection is not configured; do not falsely confirm an opt-in.
        return { actions: [], outcome: "ignored" };
      }
      if (intent === "opt_in"
        && !await this.whatsappConsents.hasActiveConsent(
          event.accountId, event.identityId, "appointment_updates"
        )) {
        return { actions: [], outcome: "ignored" };
      }
      const text = intent === "opt_in"
        ? "You're opted in to Ishi Nail Lab WhatsApp appointment updates. Reply STOP anytime to unsubscribe."
        : "You've unsubscribed from Ishi Nail Lab WhatsApp appointment updates. We won't send those updates unless you opt in again.";
      return {
        actions: [{
          schemaVersion: 1,
          idempotencyKey: `${stored.id}:reply:0`,
          provider: "meta",
          capability: "messaging",
          operation: "message.send",
          orderingKey: stored.partitionKey,
          target: {
            channel: "whatsapp", accountId: event.accountId,
            recipientId: event.identityId
          },
          body: {
            part: { kind: "text", text },
            ...(event.occurredAt === undefined ? {} : { customerMessageAt: event.occurredAt })
          }
        }],
        outcome: "handled"
      };
    }

    const reply = await this.brain.respond({
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

    const actions: ActionEnvelope[] = reply.parts.map((part, index) => ({
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
