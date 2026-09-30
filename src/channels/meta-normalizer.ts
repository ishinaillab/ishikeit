import { createHash } from "node:crypto";
import type { CanonicalEvent, IngressIdentity } from "../domain/events.js";
import type { ContentPart } from "../domain/content.js";

function isoFromMillis(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}

function isoFromSeconds(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  return new Date(Number(value) * 1000).toISOString();
}

function hash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function mediaPart(
  kind: "image" | "video" | "audio" | "document",
  value: unknown
): ContentPart | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const media = value as Record<string, unknown>;
  const providerId = typeof media.id === "string" ? media.id : undefined;
  const url = typeof media.url === "string" ? media.url : undefined;
  if (providerId === undefined && url === undefined) return undefined;

  return {
    kind,
    source: providerId !== undefined
      ? { kind: "provider", value: providerId }
      : { kind: "url", value: url! },
    ...(typeof media.mime_type === "string" ? { mimeType: media.mime_type } : {}),
    ...(typeof media.filename === "string" ? { filename: media.filename } : {}),
    ...(typeof media.caption === "string" ? { caption: media.caption } : {})
  };
}

function messengerContent(message: Record<string, unknown>): ContentPart[] {
  const content: ContentPart[] = [];
  if (typeof message.text === "string" && message.text.length > 0) {
    content.push({ kind: "text", text: message.text });
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  for (const raw of attachments) {
    if (typeof raw !== "object" || raw === null) continue;
    const attachment = raw as Record<string, unknown>;
    const providerType = typeof attachment.type === "string" ? attachment.type : "unknown";
    const payload = typeof attachment.payload === "object" && attachment.payload !== null
      ? attachment.payload as Record<string, unknown>
      : {};
    const ref = typeof payload.url === "string"
      ? { kind: "url", value: payload.url }
      : typeof payload.attachment_id === "string"
        ? { kind: "provider", value: payload.attachment_id }
        : undefined;

    const mappedKind = providerType === "image" || providerType === "video" || providerType === "audio"
      ? providerType
      : providerType === "file"
        ? "document"
        : undefined;

    if (mappedKind !== undefined && ref !== undefined) {
      content.push({
        kind: mappedKind,
        source: ref,
        ...(typeof payload.mime_type === "string" ? { mimeType: payload.mime_type } : {}),
        ...(typeof payload.name === "string" ? { filename: payload.name } : {})
      });
    } else {
      content.push({ kind: "structured", format: "meta.attachment", data: attachment });
    }
  }

  if (message.quick_reply !== undefined) {
    content.push({ kind: "structured", format: "meta.quick_reply", data: message.quick_reply });
  }
  return content;
}

function whatsappContent(message: Record<string, unknown>): ContentPart[] {
  const content: ContentPart[] = [];
  if (typeof message.text === "object" && message.text !== null) {
    const body = (message.text as Record<string, unknown>).body;
    if (typeof body === "string" && body.length > 0) content.push({ kind: "text", text: body });
  }

  const kind = typeof message.type === "string" ? message.type : undefined;
  if (kind === "image" || kind === "video" || kind === "audio") {
    const part = mediaPart(kind, message[kind]);
    if (part !== undefined) content.push(part);
  } else if (kind === "document") {
    const part = mediaPart("document", message.document);
    if (part !== undefined) content.push(part);
  } else if (kind !== undefined && kind !== "text") {
    const value = message[kind];
    if (value !== undefined) content.push({ kind: "structured", format: `meta.whatsapp.${kind}`, data: value });
  }

  return content;
}

function handoverEventType(item: Record<string, unknown>): string | undefined {
  if (item.pass_thread_control !== undefined) return "handover.pass";
  if (item.take_thread_control !== undefined) return "handover.take";
  if (item.request_thread_control !== undefined) return "handover.request";
  return undefined;
}

function standbyEventType(item: Record<string, unknown>): string {
  if (item.message !== undefined) return "standby.message";
  if (item.postback !== undefined) return "standby.postback";
  if (item.read !== undefined) return "standby.read";
  if (item.delivery !== undefined) return "standby.delivery";
  return "standby.unknown";
}

function makeEvent(input: {
  provider: string;
  channel: string;
  capability: string;
  accountId: string;
  eventType: string;
  providerEventId?: string;
  providerMessageId?: string;
  identityId?: string;
  occurredAt?: string;
  receivedAt: string;
  content: ContentPart[];
  data: unknown;
}): CanonicalEvent {
  const source = `urn:ishikeit:source:${encodeURIComponent(input.provider)}:${encodeURIComponent(input.channel)}:${encodeURIComponent(input.accountId)}`;
  const eventId = input.providerEventId ?? "sha256:" + hash([
    input.provider,
    input.channel,
    input.accountId,
    input.eventType,
    input.providerMessageId ?? null,
    input.identityId ?? null,
    input.occurredAt ?? null,
    input.data
  ]);

  return {
    schemaVersion: 2,
    specversion: "1.0",
    id: eventId,
    source,
    type: `com.ishikeit.${input.capability}.${input.eventType}`,
    provider: input.provider,
    channel: input.channel,
    capability: input.capability,
    accountId: input.accountId,
    eventType: input.eventType,
    ...(input.providerEventId === undefined ? {} : { providerEventId: input.providerEventId }),
    ...(input.providerMessageId === undefined ? {} : { providerMessageId: input.providerMessageId }),
    ...(input.identityId === undefined ? {} : { identityId: input.identityId }),
    ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    receivedAt: input.receivedAt,
    content: input.content,
    data: input.data
  };
}

export function normalizeMetaEnvelope(value: unknown, receivedAt = new Date().toISOString()): CanonicalEvent[] {
  if (typeof value !== "object" || value === null) throw new Error("invalid envelope");
  const body = value as Record<string, unknown>;
  const object = body.object;
  const entry = body.entry;
  if (!Array.isArray(entry)) throw new Error("missing entry");

  const events: CanonicalEvent[] = [];

  if (object === "page" || object === "instagram") {
    const channel = object === "page" ? "messenger" : "instagram";
    for (const rawEntry of entry) {
      if (typeof rawEntry !== "object" || rawEntry === null) continue;
      const e = rawEntry as Record<string, unknown>;
      const accountId = typeof e.id === "string" ? e.id : "";
      if (accountId === "") continue;
      const messaging = Array.isArray(e.messaging) ? e.messaging : [];
      const standby = Array.isArray(e.standby) ? e.standby : [];

      for (const rawItem of messaging) {
        if (typeof rawItem !== "object" || rawItem === null) continue;
        const item = rawItem as Record<string, unknown>;
        const sender = typeof item.sender === "object" && item.sender !== null
          ? item.sender as Record<string, unknown> : {};
        const recipient = typeof item.recipient === "object" && item.recipient !== null
          ? item.recipient as Record<string, unknown> : {};
        const message = typeof item.message === "object" && item.message !== null
          ? item.message as Record<string, unknown> : undefined;
        const senderId = typeof sender.id === "string" ? sender.id : undefined;
        const recipientId = typeof recipient.id === "string" ? recipient.id : undefined;
        const occurredAt = isoFromMillis(item.timestamp);
        const routingType = handoverEventType(item);

        if (routingType !== undefined) {
          events.push(makeEvent({
            provider: "meta",
            channel,
            capability: "routing",
            accountId,
            eventType: routingType,
            ...(senderId === undefined ? {} : { identityId: senderId }),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            content: [],
            data: { routing: "handover", item }
          }));
          continue;
        }

        if (message !== undefined) {
          const mid = typeof message.mid === "string" ? message.mid : undefined;
          const echo = message.is_echo === true;
          const providerEventId = mid === undefined ? undefined : "message:" + mid;
          events.push(makeEvent({
            provider: "meta",
            channel,
            capability: "messaging",
            accountId,
            eventType: echo ? "message.echo" : "message.received",
            ...(providerEventId === undefined ? {} : { providerEventId }),
            ...(mid === undefined ? {} : { providerMessageId: mid }),
            ...((echo ? recipientId : senderId) === undefined ? {} : { identityId: echo ? recipientId! : senderId! }),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            content: messengerContent(message),
            data: { message }
          }));
          continue;
        }

        const eventType = item.postback !== undefined
          ? "message.postback"
          : item.reaction !== undefined
            ? "message.reaction"
            : item.read !== undefined
              ? "delivery.read"
              : item.delivery !== undefined
                ? "delivery.delivered"
                : "unknown";

        events.push(makeEvent({
          provider: "meta",
          channel,
          capability: "messaging",
          accountId,
          eventType,
          ...(senderId === undefined ? {} : { identityId: senderId }),
          ...(occurredAt === undefined ? {} : { occurredAt }),
          receivedAt,
          content: [],
          data: item
        }));
      }

      for (const rawItem of standby) {
        if (typeof rawItem !== "object" || rawItem === null) continue;
        const item = rawItem as Record<string, unknown>;
        const sender = typeof item.sender === "object" && item.sender !== null
          ? item.sender as Record<string, unknown> : {};
        const message = typeof item.message === "object" && item.message !== null
          ? item.message as Record<string, unknown> : undefined;
        const senderId = typeof sender.id === "string" ? sender.id : undefined;
        const occurredAt = isoFromMillis(item.timestamp);
        const eventType = standbyEventType(item);
        const mid = message === undefined || typeof message.mid !== "string" ? undefined : message.mid;

        events.push(makeEvent({
          provider: "meta",
          channel,
          capability: "routing",
          accountId,
          eventType,
          ...(mid === undefined ? {} : {
            providerMessageId: mid,
            providerEventId: "standby:message:" + mid
          }),
          ...(senderId === undefined ? {} : { identityId: senderId }),
          ...(occurredAt === undefined ? {} : { occurredAt }),
          receivedAt,
          content: [],
          data: { routing: "standby", item }
        }));
      }
    }
    return events;
  }

  if (object === "whatsapp_business_account") {
    for (const rawEntry of entry) {
      if (typeof rawEntry !== "object" || rawEntry === null) continue;
      const e = rawEntry as Record<string, unknown>;
      const changes = Array.isArray(e.changes) ? e.changes : [];

      for (const rawChange of changes) {
        if (typeof rawChange !== "object" || rawChange === null) continue;
        const change = rawChange as Record<string, unknown>;
        if (change.field !== "messages" || typeof change.value !== "object" || change.value === null) continue;
        const v = change.value as Record<string, unknown>;
        const metadata = typeof v.metadata === "object" && v.metadata !== null
          ? v.metadata as Record<string, unknown> : {};
        const accountId = typeof metadata.phone_number_id === "string"
          ? metadata.phone_number_id
          : typeof e.id === "string" ? e.id : "";
        if (accountId === "") continue;

        for (const rawMessage of Array.isArray(v.messages) ? v.messages : []) {
          if (typeof rawMessage !== "object" || rawMessage === null) continue;
          const message = rawMessage as Record<string, unknown>;
          const mid = typeof message.id === "string" ? message.id : undefined;
          const occurredAt = isoFromSeconds(message.timestamp);
          events.push(makeEvent({
            provider: "meta",
            channel: "whatsapp",
            capability: "messaging",
            accountId,
            eventType: "message.received",
            ...(mid === undefined ? {} : { providerMessageId: mid, providerEventId: "message:" + mid }),
            ...(typeof message.from === "string" ? { identityId: message.from } : {}),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            content: whatsappContent(message),
            data: { message }
          }));
        }

        for (const rawStatus of Array.isArray(v.statuses) ? v.statuses : []) {
          if (typeof rawStatus !== "object" || rawStatus === null) continue;
          const statusItem = rawStatus as Record<string, unknown>;
          const mid = typeof statusItem.id === "string" ? statusItem.id : undefined;
          const status = typeof statusItem.status === "string" ? statusItem.status : "status";
          const occurredAt = isoFromSeconds(statusItem.timestamp);
          events.push(makeEvent({
            provider: "meta",
            channel: "whatsapp",
            capability: "messaging",
            accountId,
            eventType: "delivery." + status,
            ...(mid === undefined ? {} : {
              providerMessageId: mid,
              providerEventId: "status:" + status + ":" + mid
            }),
            ...(typeof statusItem.recipient_id === "string" ? { identityId: statusItem.recipient_id } : {}),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            content: [],
            data: { status: statusItem.status, errors: statusItem.errors }
          }));
        }
      }
    }
    return events;
  }

  throw new Error("unsupported Meta object");
}

export function metaIngressIdentity(event: CanonicalEvent): IngressIdentity {
  if (event.provider !== "meta") {
    throw new Error("Meta ingress identity requires a Meta canonical event");
  }

  const stable = event.providerEventId ?? event.id;
  return {
    deduplicationKey: hash(["meta-event-v1", event.channel, event.accountId, event.eventType, stable]),
    partitionKey: hash([
      "conversation-v1",
      event.channel,
      event.accountId,
      event.identityId ?? event.providerMessageId ?? "account"
    ])
  };
}
