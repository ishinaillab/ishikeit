import { createHash } from "node:crypto";
import type { ContentPart } from "../domain/content.js";
import { conversationOrderingKey } from "../domain/actions.js";
import type { CanonicalEvent, IngressIdentity } from "../domain/events.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function timestampIso(value: unknown, fallbackSeconds: unknown): string | undefined {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof fallbackSeconds === "number" && Number.isFinite(fallbackSeconds)
      ? fallbackSeconds * 1000
      : undefined;
  return raw === undefined ? undefined : new Date(raw).toISOString();
}

function contentParts(message: Record<string, unknown>): ContentPart[] {
  const type = stringValue(message.type)?.toLowerCase();
  if (type === "text") {
    const body = stringValue(record(message.text)?.body);
    return body === undefined ? [] : [{ kind: "text", text: body }];
  }

  if (type === "image") {
    const mediaId = stringValue(record(message.image)?.media_id);
    return mediaId === undefined
      ? []
      : [{ kind: "image", source: { kind: "provider", value: mediaId } }];
  }

  if (type === "video") {
    const mediaId = stringValue(record(message.video)?.media_id);
    return mediaId === undefined
      ? []
      : [{ kind: "video", source: { kind: "provider", value: mediaId } }];
  }

  if (type === "share_post") {
    return [{ kind: "structured", format: "tiktok.share_post", data: message.share_post }];
  }

  if (type !== undefined) {
    return [{ kind: "structured", format: "tiktok." + type.replaceAll("_", "."), data: message[type] ?? message }];
  }

  return [];
}

function parsedContent(envelope: Record<string, unknown>): Record<string, unknown> {
  const raw = envelope.content;
  if (typeof raw === "string") {
    const parsed: unknown = JSON.parse(raw);
    const result = record(parsed);
    if (result === undefined) throw new Error("TikTok webhook content is not an object");
    return result;
  }
  const result = record(raw);
  if (result === undefined) throw new Error("TikTok webhook content is missing");
  return result;
}

function hash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function normalizeTikTokBusinessWebhook(
  value: unknown,
  configuredAppId: string,
  businessId: string,
  receivedAt = new Date().toISOString()
): CanonicalEvent[] {
  const envelope = record(value);
  if (envelope === undefined) throw new Error("invalid TikTok webhook");

  const suppliedAppId = stringValue(envelope.client_key) ?? stringValue(envelope.app_id);
  if (suppliedAppId !== undefined && suppliedAppId !== configuredAppId) {
    throw new Error("TikTok webhook app identity does not match configuration");
  }

  const suppliedBusinessId = stringValue(envelope.user_openid);
  if (suppliedBusinessId !== undefined && suppliedBusinessId !== businessId) {
    throw new Error("TikTok webhook Business Account does not match configuration");
  }

  const providerEventType = stringValue(envelope.event);
  if (providerEventType === undefined) throw new Error("TikTok webhook event is missing");

  const message = parsedContent(envelope);
  const conversationId = stringValue(message.conversation_id);
  const messageId = stringValue(message.message_id);
  const commentId = stringValue(message.comment_id);
  const uniqueIdentifier = stringValue(message.unique_identifier);
  const occurredAt = timestampIso(message.timestamp, envelope.create_time);
  const incoming = providerEventType === "im_receive_msg";
  const outgoing = providerEventType === "im_send_msg";
  const highIntentComment = providerEventType === "im_receive_high_intent_comment";

  if ((incoming || outgoing) && (conversationId === undefined || messageId === undefined)) {
    throw new Error("TikTok message webhook is missing conversation_id or message_id");
  }
  if (highIntentComment && commentId === undefined) {
    throw new Error("TikTok high-intent comment webhook is missing comment_id");
  }

  const providerEventId = highIntentComment
    ? "comment:" + commentId!
    : messageId === undefined
      ? "event:" + hash([configuredAppId, businessId, providerEventType, envelope.create_time, message])
      : "message:" + messageId;

  const eventType = incoming
    ? "message.received"
    : outgoing
      ? "message.sent"
      : highIntentComment
        ? "comment.high_intent.received"
        : "event." + providerEventType.replaceAll("_", ".");

  const content = incoming
    ? contentParts(message)
    : highIntentComment && stringValue(message.comment_text) !== undefined
      ? [{ kind: "text" as const, text: stringValue(message.comment_text)! }]
      : [];
  const identityId = highIntentComment
    ? uniqueIdentifier ?? stringValue(record(message.from_user)?.id) ?? commentId
    : conversationId;

  return [{
    schemaVersion: 2,
    specversion: "1.0",
    id: providerEventId,
    source: "urn:ishikeit:source:tiktok:business:" + encodeURIComponent(businessId),
    type: "com.ishikeit.messaging." + eventType,
    provider: "tiktok",
    channel: "business",
    capability: "messaging",
    accountId: businessId,
    eventType,
    providerEventId,
    ...(messageId === undefined ? {} : { providerMessageId: messageId }),
    ...(identityId === undefined ? {} : { identityId }),
    ...(occurredAt === undefined ? {} : { occurredAt }),
    receivedAt,
    content,
    data: highIntentComment
      ? {
          event: providerEventType,
          appId: suppliedAppId ?? configuredAppId,
          commentId: commentId!,
          isFollower: message.is_follower === true,
          content: message
        }
      : {
          event: providerEventType,
          appId: suppliedAppId ?? configuredAppId,
          content: message
        }
  }];
}

export function tiktokBusinessIngressIdentity(event: CanonicalEvent): IngressIdentity {
  if (event.provider !== "tiktok" || event.channel !== "business") {
    throw new Error("TikTok ingress identity requires a TikTok business event");
  }
  return {
    deduplicationKey: hash([
      "tiktok-business-event-v1",
      event.accountId,
      event.providerEventId ?? event.id
    ]),
    partitionKey: conversationOrderingKey({
      provider: event.provider,
      channel: event.channel,
      accountId: event.accountId,
      identityId: event.identityId ?? event.providerMessageId ?? event.providerEventId ?? event.id
    })
  };
}
