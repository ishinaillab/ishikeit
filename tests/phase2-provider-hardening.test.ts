import { createHmac } from "node:crypto";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import { normalizeMetaEnvelope } from "../src/channels/meta-normalizer.js";
import { isMetaAutomationOptOut, MessageReceivedHandler } from "../src/processing/message-handler.js";
import type { CanonicalEvent } from "../src/domain/events.js";
import type { StoredInboundEvent } from "../src/persistence/inbound.js";

const accountId = "studio-123";
function signed(body: string) {
  return {
    "content-type": "application/json",
    "x-hub-signature-256": "sha256=" + createHmac("sha256", "test-app-secret")
      .update(body).digest("hex")
  };
}

describe("Phase 2 official webhook/provider safety", () => {
  it.each(["field", "changes"])("retains Instagram %s comment notifications as non-AI engagement", (shape) => {
    const value = { id: "comment-77", text: "hello", from: { id: "commenter-13" } };
    const entry = shape === "field"
      ? { id: accountId, time: 1790000000, field: "comments", value }
      : { id: accountId, time: 1790000000, changes: [{ field: "comments", value }] };
    const payload = { object: "instagram", entry: [entry] };
    const first = normalizeMetaEnvelope(payload);
    const second = normalizeMetaEnvelope(payload);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      provider: "meta", channel: "instagram", capability: "engagement",
      accountId, eventType: "notification.comments", identityId: "commenter-13"
    });
    expect(first[0]?.providerEventId).toBe(second[0]?.providerEventId);
    expect(new MessageReceivedHandler({ respond: vi.fn() }).canHandle({
      id: "stored", status: "persisted", partitionKey: "a".repeat(64), event: first[0]!
    })).toBe(false);
  });

  it("preserves Instagram mentions and live comments without unauthorized replies", () => {
    const events = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{ id: accountId, changes: [
        { field: "mentions", value: { comment_id: "mention-1", media_id: "m-1" } },
        { field: "live_comments", value: { id: "comment-2", text: "hi" } }
      ] }]
    });
    expect(events.map((e) => e.eventType)).toEqual([
      "notification.mentions", "notification.live.comments"
    ]);
    expect(events.every((e) => e.capability === "engagement")).toBe(true);
  });

  it("allows signed 1.5MiB WhatsApp notifications through Meta's documented 3MB limit", async () => {
    const ingest = vi.fn().mockResolvedValue("created");
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "test-app-secret",
      verifyToken: "test-token-123456"
    });
    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "waba-1", changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "phone-1" },
          messages: [{
            id: "wamid-1", from: "15551234567", timestamp: "1790000000",
            type: "text", text: { body: "hello" }
          }]
        }
      }] }],
      ignored_padding: "x".repeat(1_600_000)
    });
    const response = await server.inject({
      method: "POST", url: "/ishikeit/webhooks/meta",
      headers: signed(payload), payload
    });
    expect(response.statusCode).toBe(200);
    expect(ingest).toHaveBeenCalledOnce();
    await server.close();
  });

  it("rejects payloads above Meta's 3MiB ceiling before normalization", async () => {
    const ingest = vi.fn();
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "test-app-secret",
      verifyToken: "test-token-123456"
    });
    const raw = JSON.stringify({
      object: "whatsapp_business_account", entry: [],
      padding: "x".repeat(3 * 1024 * 1024)
    });
    const response = await server.inject({
      method: "POST", url: "/ishikeit/webhooks/meta",
      headers: signed(raw), payload: raw
    });
    expect(response.statusCode).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
    await server.close();
  });

  it("persists exact Messenger/Instagram opt-out as a handoff without invoking AI", async () => {
    for (const channel of ["messenger", "instagram"] as const) {
      const event: CanonicalEvent = {
        schemaVersion: 2, specversion: "1.0",
        id: "event-1", type: "com.ishikeit.messaging.message.received",
        source: "urn:ishikeit:test", provider: "meta", channel, capability: "messaging",
        accountId, eventType: "message.received",
        identityId: "customer-1",
        receivedAt: new Date().toISOString(),
        occurredAt: new Date().toISOString(),
        content: [{ kind: "text", text: "stop automated replies" }], data: {}
      };
      const stored: StoredInboundEvent = {
        id: "test-event", status: "persisted", partitionKey: "a".repeat(64), event
      };
      expect(isMetaAutomationOptOut(stored)).toBe(true);
      const brain = { respond: vi.fn() };
      const result = await new MessageReceivedHandler(brain).handle(stored);
      expect(result).toMatchObject({
        outcome: "handoff", handoffReason: "customer_automation_opt_out",
        actions: [{
          idempotencyKey: "test-event:automation-optout-confirmation",
          provider: "meta", operation: "message.send",
          target: { channel, accountId, recipientId: "customer-1" }
        }]
      });
      expect(result.actions).toHaveLength(1);
      expect(brain.respond).not.toHaveBeenCalled();
      const unrelated = { ...stored, event: { ...event, content: [{ kind: "text" as const, text: "Stop by tomorrow" }] } };
      expect(isMetaAutomationOptOut(unrelated)).toBe(false);
    }
  });
});
