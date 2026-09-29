import { createHash } from "node:crypto";
import type { CanonicalEvent, IngressIdentity } from "../domain/events.js";

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
      const messaging = Array.isArray(e.messaging) ? e.messaging : [];

      for (const rawItem of messaging) {
        if (typeof rawItem !== "object" || rawItem === null) continue;
        const item = rawItem as Record<string, unknown>;
        const sender = typeof item.sender === "object" && item.sender !== null
          ? item.sender as Record<string, unknown>
          : {};
        const message = typeof item.message === "object" && item.message !== null
          ? item.message as Record<string, unknown>
          : undefined;
        const identityId = typeof sender.id === "string" ? sender.id : undefined;
        const occurredAt = isoFromMillis(item.timestamp);

        if (message?.is_echo === true) {
          const mid = typeof message.mid === "string" ? message.mid : undefined;
          events.push({
            schemaVersion: 1,
            channel,
            accountId,
            eventType: "message.echo",
            ...(mid === undefined ? {} : { providerMessageId: mid }),
            ...(identityId === undefined ? {} : { identityId }),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            payload: { message }
          });
          continue;
        }

        if (message !== undefined) {
          const mid = typeof message.mid === "string" ? message.mid : undefined;
          events.push({
            schemaVersion: 1,
            channel,
            accountId,
            eventType: "message.received",
            ...(mid === undefined ? {} : { providerMessageId: mid, providerEventId: "message:" + mid }),
            ...(identityId === undefined ? {} : { identityId }),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            payload: { message }
          });
          continue;
        }

        const eventType = item.postback
          ? "message.postback"
          : item.reaction
            ? "message.reaction"
            : item.read
              ? "delivery.read"
              : item.delivery
                ? "delivery.delivered"
                : "unknown";

        events.push({
          schemaVersion: 1,
          channel,
          accountId,
          eventType,
          ...(identityId === undefined ? {} : { identityId }),
          ...(occurredAt === undefined ? {} : { occurredAt }),
          receivedAt,
          payload: item
        });
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
          ? v.metadata as Record<string, unknown>
          : {};
        const accountId = typeof metadata.phone_number_id === "string"
          ? metadata.phone_number_id
          : typeof e.id === "string"
            ? e.id
            : "";

        for (const rawMessage of Array.isArray(v.messages) ? v.messages : []) {
          if (typeof rawMessage !== "object" || rawMessage === null) continue;
          const m = rawMessage as Record<string, unknown>;
          const mid = typeof m.id === "string" ? m.id : undefined;
          const occurredAt = isoFromSeconds(m.timestamp);

          events.push({
            schemaVersion: 1,
            channel: "whatsapp",
            accountId,
            eventType: "message.received",
            ...(mid === undefined ? {} : { providerMessageId: mid, providerEventId: "message:" + mid }),
            ...(typeof m.from === "string" ? { identityId: m.from } : {}),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            payload: {
              type: m.type,
              text: m.text,
              image: m.image,
              video: m.video,
              audio: m.audio,
              document: m.document,
              interactive: m.interactive
            }
          });
        }

        for (const rawStatus of Array.isArray(v.statuses) ? v.statuses : []) {
          if (typeof rawStatus !== "object" || rawStatus === null) continue;
          const s = rawStatus as Record<string, unknown>;
          const mid = typeof s.id === "string" ? s.id : undefined;
          const status = typeof s.status === "string" ? s.status : "status";
          const occurredAt = isoFromSeconds(s.timestamp);

          events.push({
            schemaVersion: 1,
            channel: "whatsapp",
            accountId,
            eventType: "delivery." + status,
            ...(mid === undefined ? {} : { providerMessageId: mid, providerEventId: "status:" + status + ":" + mid }),
            ...(typeof s.recipient_id === "string" ? { identityId: s.recipient_id } : {}),
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt,
            payload: { status: s.status, errors: s.errors }
          });
        }
      }
    }

    return events;
  }

  throw new Error("unsupported Meta object");
}

export function ingressIdentity(event: CanonicalEvent): IngressIdentity {
  const stable = event.providerEventId ?? hash([
    event.channel,
    event.accountId,
    event.eventType,
    event.providerMessageId ?? null,
    event.identityId ?? null,
    event.occurredAt ?? null,
    event.payload
  ]);

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
