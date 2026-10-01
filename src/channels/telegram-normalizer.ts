import { createHash } from "node:crypto";
import type { ContentPart } from "../domain/content.js";
import type { CanonicalEvent, IngressIdentity } from "../domain/events.js";

function hash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function integerString(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string" && /^-?[0-9]+$/.test(value)
      ? value
      : undefined;
}

function isoFromSeconds(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : undefined;
}

function mediaPart(
  kind: "image" | "video" | "audio" | "document",
  value: unknown,
  caption?: string,
  forcedMimeType?: string
): ContentPart | undefined {
  const media = record(value);
  if (media === undefined || typeof media.file_id !== "string") return undefined;
  const fileSize = typeof media.file_size === "number" && Number.isFinite(media.file_size)
    ? media.file_size
    : undefined;

  return {
    kind,
    source: { kind: "provider", value: media.file_id },
    ...(forcedMimeType !== undefined
      ? { mimeType: forcedMimeType }
      : typeof media.mime_type === "string" ? { mimeType: media.mime_type } : {}),
    ...(typeof media.file_name === "string" ? { filename: media.file_name } : {}),
    ...(caption === undefined || caption.length === 0 ? {} : { caption }),
    ...(fileSize === undefined ? {} : { sizeBytes: fileSize })
  };
}

function largestPhoto(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) return undefined;
  let best: Record<string, unknown> | undefined;
  let bestScore = -1;
  for (const item of value) {
    const photo = record(item);
    if (photo === undefined || typeof photo.file_id !== "string") continue;
    const fileSize = typeof photo.file_size === "number" && Number.isFinite(photo.file_size)
      ? photo.file_size
      : 0;
    const width = typeof photo.width === "number" && Number.isFinite(photo.width) ? photo.width : 0;
    const height = typeof photo.height === "number" && Number.isFinite(photo.height) ? photo.height : 0;
    const score = fileSize > 0 ? fileSize : width * height;
    if (score >= bestScore) {
      best = photo;
      bestScore = score;
    }
  }
  return best;
}

function telegramContent(message: Record<string, unknown>): ContentPart[] {
  const content: ContentPart[] = [];
  if (typeof message.text === "string" && message.text.length > 0) {
    content.push({ kind: "text", text: message.text });
  }

  const caption = typeof message.caption === "string" ? message.caption : undefined;
  const photo = largestPhoto(message.photo);
  if (photo !== undefined) {
    const part = mediaPart("image", photo, caption, "image/jpeg");
    if (part !== undefined) content.push(part);
  }

  for (const [field, kind] of [
    ["video", "video"],
    ["animation", "video"],
    ["video_note", "video"],
    ["audio", "audio"],
    ["voice", "audio"],
    ["document", "document"]
  ] as const) {
    const part = mediaPart(
      kind,
      message[field],
      caption,
      field === "video_note" ? "video/mp4" : undefined
    );
    if (part !== undefined) content.push(part);
  }

  if (content.length === 0) {
    for (const field of ["sticker", "contact", "location", "venue", "poll", "dice"] as const) {
      if (message[field] !== undefined) {
        content.push({
          kind: "structured",
          format: "telegram." + field,
          data: message[field]
        });
        break;
      }
    }
  }

  return content;
}

function makeEvent(input: {
  botId: string;
  eventType: string;
  providerEventId: string;
  providerMessageId?: string;
  identityId?: string;
  occurredAt?: string;
  receivedAt: string;
  content: ContentPart[];
  data: unknown;
}): CanonicalEvent {
  const source = "urn:ishikeit:source:telegram:bot:" + encodeURIComponent(input.botId);
  return {
    schemaVersion: 2,
    specversion: "1.0",
    id: input.providerEventId,
    source,
    type: "com.ishikeit.messaging." + input.eventType,
    provider: "telegram",
    channel: "bot",
    capability: "messaging",
    accountId: input.botId,
    eventType: input.eventType,
    providerEventId: input.providerEventId,
    ...(input.providerMessageId === undefined ? {} : { providerMessageId: input.providerMessageId }),
    ...(input.identityId === undefined ? {} : { identityId: input.identityId }),
    ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    receivedAt: input.receivedAt,
    content: input.content,
    data: input.data
  };
}

function chatIdFromMessage(message: Record<string, unknown> | undefined): string | undefined {
  return integerString(record(message?.chat)?.id);
}

export function normalizeTelegramUpdate(
  value: unknown,
  botId: string,
  receivedAt = new Date().toISOString()
): CanonicalEvent[] {
  const update = record(value);
  if (update === undefined) throw new Error("invalid Telegram update");

  const updateId = integerString(update.update_id);
  if (updateId === undefined) throw new Error("Telegram update has no valid update_id");
  const providerEventId = "update:" + updateId;

  const message = record(update.message);
  if (message !== undefined) {
    const messageId = integerString(message.message_id);
    const chatId = chatIdFromMessage(message);
    if (messageId === undefined || chatId === undefined) {
      throw new Error("Telegram message has no valid message_id or chat.id");
    }
    const occurredAt = isoFromSeconds(message.date);

    return [makeEvent({
      botId,
      eventType: "message.received",
      providerEventId,
      providerMessageId: messageId,
      identityId: chatId,
      ...(occurredAt === undefined ? {} : { occurredAt }),
      receivedAt,
      content: telegramContent(message),
      data: { update }
    })];
  }

  const editedMessage = record(update.edited_message);
  if (editedMessage !== undefined) {
    const chatId = chatIdFromMessage(editedMessage);
    const messageId = integerString(editedMessage.message_id);
    const occurredAt = isoFromSeconds(editedMessage.edit_date ?? editedMessage.date);
    return [makeEvent({
      botId,
      eventType: "message.edited",
      providerEventId,
      ...(messageId === undefined ? {} : { providerMessageId: messageId }),
      ...(chatId === undefined ? {} : { identityId: chatId }),
      ...(occurredAt === undefined ? {} : { occurredAt }),
      receivedAt,
      content: [],
      data: { update }
    })];
  }

  const updateType = Object.keys(update).find((key) => key !== "update_id") ?? "unknown";
  const callbackMessage = record(record(update.callback_query)?.message);
  const callbackChatId = chatIdFromMessage(callbackMessage);

  return [makeEvent({
    botId,
    eventType: "update." + updateType.replaceAll("_", "."),
    providerEventId,
    ...(callbackChatId === undefined ? {} : { identityId: callbackChatId }),
    receivedAt,
    content: [],
    data: { update }
  })];
}

export function telegramIngressIdentity(event: CanonicalEvent): IngressIdentity {
  if (event.provider !== "telegram" || event.channel !== "bot") {
    throw new Error("Telegram ingress identity requires a Telegram bot event");
  }

  return {
    deduplicationKey: hash([
      "telegram-event-v1",
      event.accountId,
      event.providerEventId ?? event.id
    ]),
    partitionKey: hash([
      "conversation-v1",
      event.channel,
      event.accountId,
      event.identityId ?? event.providerMessageId ?? event.providerEventId ?? event.id
    ])
  };
}
