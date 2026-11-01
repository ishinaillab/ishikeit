import { createHash } from "node:crypto";
import type { CanonicalEvent, IngressIdentity } from "../domain/events.js";
import type { ContentPart } from "../domain/content.js";

function isoFromMillis(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : undefined;
}

function isoFromSeconds(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{1,13}$/u.test(value)) return undefined;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return undefined;
  return isoFromMillis(seconds * 1000);
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
  // Meta temporarily sent both "share" and "ig_post" for the same post.
  // Keep the provider metadata for audit, but don't feed its caption to the
  // conversational model twice.
  const seenSharedPreviews = new Set<string>();
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
    } else if (providerType === "sticker") {
      // Since August 30, 2026, Messenger sends only "sticker", not the
      // former duplicate "image" attachment. Treat the documented URL as
      // image content, but preserve the sticker_id (which is not a media ID)
      // in its original structured payload for UI and audit.
      if (ref?.kind === "url") content.push({ kind: "image", source: ref });
      content.push({ kind: "structured", format: "meta.attachment", data: attachment });
    } else if (["post", "ig_post", "reel", "ig_reel", "share"].includes(providerType)) {
      // The Apr 2026 Instagram post-share migration replaced "share" with
      // "ig_post". This is social metadata, NOT a downloadable image/file.
      // Pass a bounded visible title to conversation handling while keeping
      // the original metadata (post ID, URL, title) untouched.
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      if (title.length > 0) {
        const stableId = typeof payload.ig_post_media_id === "string"
          ? payload.ig_post_media_id
          : typeof payload.id === "string" ? payload.id
          : typeof payload.url === "string" ? payload.url : title;
        if (!seenSharedPreviews.has(stableId)) {
          seenSharedPreviews.add(stableId);
          const typeLabel = providerType === "reel" || providerType === "ig_reel"
            ? "Shared reel" : providerType === "share" ? "Shared content" : "Shared post";
          content.push({ kind: "text", text: typeLabel + ": " + title.slice(0, 1024) });
        }
      }
      content.push({ kind: "structured", format: "meta.attachment", data: attachment });
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
  } else if (kind === "interactive" || kind === "button") {
    // A customer tapping an interactive control is a genuine inbound message.
    // Pass the visible selection text to the brain while retaining the exact
    // original structured payload for future button/list workflow routing.
    const raw = message[kind];
    if (raw !== undefined && typeof raw === "object" && raw !== null) {
      const details = raw as Record<string, unknown>;
      const reply = kind === "interactive"
        ? details.button_reply ?? details.list_reply
        : details;
      const choice = reply !== null && typeof reply === "object"
        ? reply as Record<string, unknown>
        : {};
      const candidate = kind === "button" ? choice.text : choice.title;
      if (typeof candidate === "string" && candidate.trim().length > 0
        && candidate.length <= 2048) {
        content.push({ kind: "text", text: candidate.trim() });
      }
      content.push({ kind: "structured", format: `meta.whatsapp.${kind}`, data: raw });
    }
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
      if (channel === "instagram") {
        // Meta documents both Business Login entry.field/value and Facebook Login
        // entry.changes[] webhook shapes. Preserve them as non-AI events.
        // Subscribing to a field does not itself authorize automated replies.
        const notifications: { field: unknown; value: unknown }[] = [];
        if (typeof e.field === "string" && e.value !== undefined) {
          notifications.push({ field: e.field, value: e.value });
        }
        if (Array.isArray(e.changes)) {
          for (const rawChange of e.changes) {
            if (typeof rawChange === "object" && rawChange !== null
              && !Array.isArray(rawChange)) {
              const change = rawChange as Record<string, unknown>;
              notifications.push({ field: change.field, value: change.value });
            }
          }
        }
        for (const notice of notifications) {
          if (typeof notice.field !== "string"
            || !/^[a-z_]{1,64}$/u.test(notice.field)) continue;
          const value = typeof notice.value === "object" && notice.value !== null
            ? notice.value as Record<string, unknown> : {};
          const sender = typeof value.from === "object" && value.from !== null
            ? value.from as Record<string, unknown> : {};
          const identityId = typeof sender.id === "string" ? sender.id : undefined;
          const seenAt = isoFromMillis(typeof e.time === "number" ? e.time * 1000 : undefined);
          const valueHash = hash([notice.field, notice.value]);
          // A stable content hash handles repeated deliveries and revisions
          // without disclosing comment/message contents in the event key.
          events.push(makeEvent({
            provider: "meta",
            channel: "instagram",
            capability: "engagement",
            accountId,
            eventType: "notification." + notice.field.replaceAll("_", "."),
            providerEventId: "change:" + notice.field + ":" + valueHash,
            ...(identityId === undefined ? {} : { identityId }),
            ...(seenAt === undefined ? {} : { occurredAt: seenAt }),
            receivedAt,
            content: [{ kind: "structured", format: "meta.instagram." + notice.field, data: notice.value }],
            data: { field: notice.field, value: notice.value }
          }));
        }
      }
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

        // Meta's Instagram message_edit webhook refers to an existing message.
        // Persist the revision for UI/audit correlation, never as a new
        // customer-originated message that would trigger the AI reply handler.
        if (channel === "instagram" && typeof item.message_edit === "object"
          && item.message_edit !== null && !Array.isArray(item.message_edit)) {
          const edit = item.message_edit as Record<string, unknown>;
          const mid = typeof edit.mid === "string" && edit.mid.length > 0
            && edit.mid.length <= 2048 ? edit.mid : undefined;
          const revision = typeof edit.num_edit === "number"
            && Number.isSafeInteger(edit.num_edit) && edit.num_edit >= 0
            ? edit.num_edit : undefined;
          // A reliable revision is part of the provider event identity.
          // Without both fields, fall back to the full-payload content hash
          // rather than accidentally deduplicating separate edits.
          const providerEventId = mid !== undefined && revision !== undefined
            ? `edit:${mid}:${revision}` : undefined;
          events.push(makeEvent({
            provider: "meta",
            channel,
            capability: "messaging",
            accountId,
            eventType: "message.edited",
            ...(providerEventId === undefined ? {} : { providerEventId }),
            ...(mid === undefined ? {} : { providerMessageId: mid }),
            ...(senderId === undefined ? {} : { identityId: senderId }),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            content: [{ kind: "structured", format: "meta.message_edit", data: edit }],
            data: { message_edit: edit }
          }));
          continue;
        }

        if (message !== undefined) {
          const mid = typeof message.mid === "string" ? message.mid : undefined;
          const echo = message.is_echo === true;
          // Meta's Instagram self-messaging webhooks can mark the messaging
          // item OR its message as is_self. Even without is_echo, these are
          // never customer-originated requests for an automated reply.
          const selfOriginated = channel === "instagram"
            && (item.is_self === true || message.is_self === true);
          // A deleted Instagram message is a tombstone notification, not a
          // fresh customer turn. Keep its original ID for UI/audit correlation,
          // but never expose any text/attachment content to AI processing.
          const deleted = channel === "instagram" && message.is_deleted === true;
          const providerEventId = mid === undefined ? undefined
            : (deleted ? "delete:" : "message:") + mid;
          events.push(makeEvent({
            provider: "meta",
            channel,
            capability: "messaging",
            accountId,
            eventType: deleted ? "message.deleted" : echo ? "message.echo" : selfOriginated ? "message.self" : "message.received",
            ...(providerEventId === undefined ? {} : { providerEventId }),
            ...(mid === undefined ? {} : { providerMessageId: mid }),
            ...((echo ? recipientId : senderId) === undefined ? {} : { identityId: echo ? recipientId! : senderId! }),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            content: deleted ? [] : messengerContent(message),
            data: { message, ...(selfOriginated ? { selfOriginated: true } : {}) }
          }));
          continue;
        }

        // Messenger delivery events can acknowledge multiple message IDs in one
        // webhook. Preserve each ID separately for precise outbound correlation.
        if (item.delivery !== undefined && typeof item.delivery === "object" && item.delivery !== null) {
          const delivery = item.delivery as Record<string, unknown>;
          const messageIds = Array.isArray(delivery.mids)
            ? [...new Set(delivery.mids.filter((id): id is string =>
                typeof id === "string" && id.length > 0 && id.length <= 2048))]
            : [];
          const watermark = typeof delivery.watermark === "number" && Number.isFinite(delivery.watermark)
            ? String(delivery.watermark)
            : occurredAt ?? "";
          for (const messageId of messageIds.slice(0, 100)) {
            events.push(makeEvent({
              provider: "meta",
              channel,
              capability: "messaging",
              accountId,
              eventType: "delivery.delivered",
              providerEventId: `delivery:${messageId}:${watermark}`,
              providerMessageId: messageId,
              ...(senderId === undefined ? {} : { identityId: senderId }),
              ...(occurredAt === undefined ? {} : { occurredAt }),
              receivedAt,
              content: [],
              data: { delivery }
            }));
          }
          if (messageIds.length > 0) continue;
        }

        // Instagram messaging_seen can identify an exact message via read.mid.
        // Preserve this ID for outbound receipt correlation. Messenger watermark-
        // only reads remain aggregate because they name no individual message.
        if (item.read !== undefined && typeof item.read === "object" && item.read !== null) {
          const read = item.read as Record<string, unknown>;
          const ids = [
            ...(typeof read.mid === "string" ? [read.mid] : []),
            ...(Array.isArray(read.mids)
              ? read.mids.filter((id): id is string => typeof id === "string")
              : [])
          ];
          const distinctIds = [...new Set(ids.filter((id) => id.length > 0 && id.length <= 2048))];
          const watermark = typeof read.watermark === "number" && Number.isFinite(read.watermark)
            ? String(read.watermark)
            : occurredAt ?? "";
          for (const messageId of distinctIds.slice(0, 100)) {
            events.push(makeEvent({
              provider: "meta",
              channel,
              capability: "messaging",
              accountId,
              eventType: "delivery.read",
              providerEventId: `read:${messageId}:${watermark}`,
              providerMessageId: messageId,
              ...(senderId === undefined ? {} : { identityId: senderId }),
              ...(occurredAt === undefined ? {} : { occurredAt }),
              receivedAt,
              content: [],
              data: { read }
            }));
          }
          if (distinctIds.length > 0) continue;
        }

        if (item.postback !== undefined && typeof item.postback === "object"
          && item.postback !== null) {
          const postback = item.postback as Record<string, unknown>;
          const title = typeof postback.title === "string" ? postback.title.trim() : "";
          const content: ContentPart[] = [];
          if (title.length > 0 && title.length <= 2048) {
            content.push({ kind: "text", text: title });
          }
          content.push({ kind: "structured", format: "meta.postback", data: postback });
          // Instagram self-messaging events (is_self=true) originate from
          // the Professional account operator, not a customer. Store them
          // for audit, but never let the customer reply handler auto-answer.
          // Keep the provider postback mid so retries remain idempotent even
          // when Meta redelivers with altered timestamps or extra metadata.
          const mid = typeof postback.mid === "string"
            && postback.mid.length > 0 && postback.mid.length <= 2048
            ? postback.mid : undefined;
          events.push(makeEvent({
            provider: "meta",
            channel,
            capability: "messaging",
            accountId,
            eventType: channel === "instagram" && item.is_self === true
              ? "message.self_postback" : "message.postback",
            ...(mid === undefined ? {} : {
              providerMessageId: mid,
              providerEventId: "postback:" + mid
            }),
            ...(senderId === undefined ? {} : { identityId: senderId }),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            content,
            data: { postback }
          }));
          continue;
        }

        // Instagram message_reactions includes the MID of the original
        // message. Keep the callback non-reply but provide this correlation
        // without inventing a unique provider event ID: repeated react/unreact
        // cycles need distinct event identities based on their full payload.
        if (channel === "instagram" && typeof item.reaction === "object"
          && item.reaction !== null && !Array.isArray(item.reaction)) {
          const reaction = item.reaction as Record<string, unknown>;
          const mid = typeof reaction.mid === "string" && reaction.mid.length > 0
            && reaction.mid.length <= 2048 ? reaction.mid : undefined;
          events.push(makeEvent({
            provider: "meta",
            channel,
            capability: "messaging",
            accountId,
            eventType: "message.reaction",
            ...(mid === undefined ? {} : { providerMessageId: mid }),
            ...(senderId === undefined ? {} : { identityId: senderId }),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            content: [{ kind: "structured", format: "meta.reaction", data: reaction }],
            data: item
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

/** Stable per-customer Meta conversation key, excluding raw identifiers at rest. */
export function metaConversationPartitionKey(channel: string, accountId: string, identityId: string): string {
  return hash(["conversation-v1", channel, accountId, identityId]);
}

export function metaIngressIdentity(event: CanonicalEvent): IngressIdentity {
  if (event.provider !== "meta") {
    throw new Error("Meta ingress identity requires a Meta canonical event");
  }

  const stable = event.providerEventId ?? event.id;
  return {
    deduplicationKey: hash(["meta-event-v1", event.channel, event.accountId, event.eventType, stable]),
    partitionKey: metaConversationPartitionKey(
      event.channel,
      event.accountId,
      event.identityId ?? event.providerMessageId ?? "account"
    )
  };
}
