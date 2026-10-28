import { createHmac, randomUUID } from "node:crypto";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent, IngressIdentity } from "../src/domain/events.js";
import { buildServer } from "../src/http/server.js";
import { MessageReceivedHandler } from "../src/processing/message-handler.js";
import type { InboundStore, StoredInboundEvent } from "../src/persistence/inbound.js";
import type { BrainClient } from "../src/brain/types.js";

const secret = "integration-test-app-secret";
const postbackMid = "mid_postback_20261029";

function signedHeaders(payload: string) {
  return {
    "content-type": "application/json",
    "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(payload).digest("hex")
  };
}

function makeHarness() {
  const seen = new Map<string, { event: CanonicalEvent; identity: IngressIdentity }>();
  const store: InboundStore = {
    ingest(event, identity) {
      if (seen.has(identity.deduplicationKey)) return Promise.resolve("duplicate" as const);
      seen.set(identity.deduplicationKey, { event, identity });
      return Promise.resolve("created" as const);
    }
  };
  const server = buildServer({
    logger: pino({ level: "silent" }),
    ready: () => Promise.resolve(true),
    inbound: store,
    appSecret: secret,
    verifyToken: "integration-verify-token"
  });
  return { server, seen };
}

describe("signed Meta interactive canaries: in-process, no provider/customer traffic", () => {
  it.each(["page", "instagram"] as const)(
    "accepts real-shaped %s postback with a stable mid and safely generates a reply",
    async (object) => {
      const { server, seen } = makeHarness();
      const timestamp = Date.now() - 30_000;
      const accountId = object === "page" ? "123456789012" : "17841430000000000";
      const senderId = object === "page" ? "psid-customer" : "igsid-customer";
      const original = JSON.stringify({
        object,
        entry: [{
          id: accountId,
          messaging: [{
            sender: { id: senderId }, recipient: { id: accountId },
            timestamp,
            postback: { mid: postbackMid, title: "Book an appointment", payload: "open_booking" }
          }]
        }]
      });
      try {
        const response = await server.inject({
          method: "POST", url: "/ishikeit/webhooks/meta",
          headers: signedHeaders(original), payload: original
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ status: "accepted" });
        expect(seen.size).toBe(1);
        const first = [...seen.values()][0]!;
        expect(first.event).toMatchObject({
          eventType: "message.postback",
          provider: "meta", accountId, identityId: senderId,
          providerEventId: "postback:" + postbackMid,
          providerMessageId: postbackMid
        });
        const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
          handoff: false,
          parts: [{ kind: "text", text: "Here's how to book." }]
        });
        const handler = new MessageReceivedHandler({ respond }, {
          isActive: () => Promise.resolve(false)
        });
        const saved: StoredInboundEvent = {
          id: randomUUID(), partitionKey: first.identity.partitionKey,
          status: "persisted", event: first.event
        };
        expect(handler.canHandle(saved)).toBe(true);
        const handled = await handler.handle(saved);
        expect(handled.outcome).toBe("handled");
        expect(handled.actions).toHaveLength(1);
        expect(handled.actions[0]).toMatchObject({
          operation: "message.send",
          target: {
            channel: object === "page" ? "messenger" : "instagram",
            accountId, recipientId: senderId
          },
          body: {
            customerMessageAt: new Date(timestamp).toISOString(),
            part: { kind: "text", text: "Here's how to book." }
          }
        });
        expect(respond).toHaveBeenCalledTimes(1);

        // A provider redelivery can alter its timestamp/auxiliary metadata
        // while preserving the immutable postback mid.
        const retry = JSON.stringify({
          object, entry: [{ id: accountId, messaging: [{
            sender: { id: senderId }, recipient: { id: accountId },
            timestamp: timestamp + 1000,
            postback: {
              mid: postbackMid, title: "Book an appointment",
              payload: "open_booking", auxiliary: "retry"
            }
          }] }]
        });
        const duplicate = await server.inject({
          method: "POST", url: "/ishikeit/webhooks/meta",
          headers: signedHeaders(retry), payload: retry
        });
        expect(duplicate.statusCode).toBe(200);
        expect(duplicate.json()).toEqual({ status: "duplicate" });
        expect(seen.size).toBe(1);
      } finally {
        await server.close();
      }
    }
  );

  it("accepts Instagram seen and native handover events without creating customer AI messages", async () => {
    const { server, seen } = makeHarness();
    const timestamp = Date.now() - 5_000;
    const raw = JSON.stringify({
      object: "instagram",
      entry: [{
        id: "17841430000000000",
        messaging: [
          {
            sender: { id: "igsid-customer" },
            recipient: { id: "17841430000000000" },
            timestamp,
            read: { mid: "mid-sent-outbound" }
          },
          {
            sender: { id: "igsid-customer" },
            recipient: { id: "17841430000000000" },
            timestamp,
            pass_thread_control: { new_owner_app_id: "1042452472116584" }
          }
        ]
      }]
    });
    try {
      const response = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/meta",
        headers: signedHeaders(raw), payload: raw
      });
      expect(response.statusCode).toBe(200);
      expect([...seen.values()].map((v) => v.event.eventType).sort())
        .toEqual(["delivery.read", "handover.pass"]);
      const handler = new MessageReceivedHandler({ respond: vi.fn<BrainClient["respond"]>() });
      for (const { event, identity } of seen.values()) {
        expect(handler.canHandle({
          event, id: randomUUID(), status: "persisted", partitionKey: identity.partitionKey
        })).toBe(false);
      }
    } finally {
      await server.close();
    }
  });

  it("records Instagram self-postbacks but never routes them into the AI reply handler", async () => {
    const { server, seen } = makeHarness();
    const raw = JSON.stringify({
      object: "instagram",
      entry: [{ id: "17841430000000000", messaging: [{
        is_self: true,
        sender: { id: "17841430000000000" },
        recipient: { id: "igsid-customer" },
        timestamp: Date.now() - 1000,
        postback: { mid: "mid-self", title: "Start chatting", payload: "self_action" }
      }] }]
    });
    try {
      const result = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/meta",
        headers: signedHeaders(raw), payload: raw
      });
      expect(result.statusCode).toBe(200);
      const one = [...seen.values()][0]!;
      expect(one.event.eventType).toBe("message.self_postback");
      expect(new MessageReceivedHandler({ respond: vi.fn<BrainClient["respond"]>() })
        .canHandle({
          event: one.event, id: randomUUID(),
          status: "persisted", partitionKey: one.identity.partitionKey
        })).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("rejects an unsigned/incorrect signature before any normalization or storage", async () => {
    const { server, seen } = makeHarness();
    const raw = JSON.stringify({
      object: "page", entry: [{ id: "123456789012", messaging: [{
        sender: { id: "psid-customer" }, timestamp: Date.now(),
        postback: { mid: "must-not-be-ingested", title: "Book" }
      }] }]
    });
    try {
      const result = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/meta",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "f".repeat(64) },
        payload: raw
      });
      expect(result.statusCode).toBe(401);
      expect(seen.size).toBe(0);
    } finally {
      await server.close();
    }
  });
});
