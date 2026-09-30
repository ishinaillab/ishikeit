import type { ActionEnvelope } from "../domain/actions.js";
import type { BrainClient } from "../brain/types.js";
import type { StoredInboundEvent } from "../persistence/inbound.js";
import { ProcessingFailure } from "./failure.js";
import type { EventHandler } from "./registry.js";

export class MessageReceivedHandler implements EventHandler {
  constructor(private readonly brain: BrainClient) {}

  canHandle(stored: StoredInboundEvent): boolean {
    return stored.event.capability === "messaging" && stored.event.eventType === "message.received";
  }

  async handle(stored: StoredInboundEvent): Promise<ActionEnvelope[]> {
    const event = stored.event;
    if (event.identityId === undefined) {
      throw new ProcessingFailure("Inbound message has no reply identity", { retryable: false });
    }

    const reply = await this.brain.respond({
      turnId: stored.id,
      conversationId: stored.partitionKey,
      event,
      input: event.content
    });

    if (reply.handoff) return [];

    return reply.parts.map((part, index) => ({
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
      body: { part }
    }));
  }
}
