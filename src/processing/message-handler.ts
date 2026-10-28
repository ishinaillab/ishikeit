import type { ActionEnvelope } from "../domain/actions.js";
import { normalizeHandoffReason, type EventHandlingResult } from "../domain/processing.js";
import type { BrainClient } from "../brain/types.js";
import type { StoredInboundEvent } from "../persistence/inbound.js";
import type { MetaHandoffReader } from "../persistence/meta-handoff.js";
import { ProcessingFailure } from "./failure.js";
import type { EventHandler } from "./registry.js";
import { standardMetaReplyEligibility } from "../dispatch/meta-customer-window.js";
import { splitMetaReplyParts, type MetaTextChannel } from "./meta-reply-split.js";

export class MessageReceivedHandler implements EventHandler {
  constructor(
    private readonly brain: BrainClient,
    private readonly metaHandoffs?: MetaHandoffReader
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
