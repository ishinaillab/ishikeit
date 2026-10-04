import type { BrainClient } from "../brain/types.js";
import type { ActionEnvelope } from "../domain/actions.js";
import { normalizeHandoffReason, type EventHandlingResult } from "../domain/processing.js";
import type { StoredInboundEvent } from "../persistence/inbound.js";
import { ProcessingFailure } from "./failure.js";
import type { EventHandler } from "./registry.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

export class TikTokHighIntentCommentHandler implements EventHandler {
  constructor(private readonly brain: BrainClient) {}

  canHandle(stored: StoredInboundEvent): boolean {
    return stored.event.provider === "tiktok"
      && stored.event.channel === "business"
      && stored.event.capability === "messaging"
      && stored.event.eventType === "comment.high_intent.received";
  }

  async handle(stored: StoredInboundEvent): Promise<EventHandlingResult> {
    const event = stored.event;
    const commentId = record(event.data)?.commentId;
    if (typeof commentId !== "string" || commentId.length === 0) {
      throw new ProcessingFailure(
        "TikTok high-intent comment event has no Comment-to-Message target",
        { retryable: false }
      );
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
    if (reply.parts.length === 0) {
      return { actions: [], outcome: "handled" };
    }
    if (reply.parts.some((part) => part.kind !== "text")) {
      throw new ProcessingFailure(
        "TikTok Comment-to-Message AI response must contain text only",
        { retryable: false }
      );
    }

    const text = reply.parts
      .map((part) => part.kind === "text" ? part.text : "")
      .join("\n\n")
      .trim();
    if (text.length === 0) {
      return { actions: [], outcome: "handled" };
    }
    if (text.length > 6000) {
      throw new ProcessingFailure(
        "TikTok Comment-to-Message AI response exceeds the text limit",
        { retryable: false }
      );
    }

    const action: ActionEnvelope = {
      schemaVersion: 1,
      idempotencyKey: `${stored.id}:comment-to-message:reply`,
      provider: "tiktok",
      capability: "messaging",
      operation: "comment_to_message.reply",
      orderingKey: stored.partitionKey,
      target: {
        channel: "business",
        accountId: event.accountId,
        commentId
      },
      body: {
        part: { kind: "text", text }
      }
    };

    return { actions: [action], outcome: "handled" };
  }
}
