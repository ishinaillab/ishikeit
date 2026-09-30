import { describe, expect, it, vi } from "vitest";
import type { BrainClient } from "../src/brain/types.js";
import type { StoredInboundEvent } from "../src/persistence/inbound.js";
import { MessageReceivedHandler } from "../src/processing/message-handler.js";

const stored: StoredInboundEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  partitionKey: "partition-1",
  status: "persisted",
  event: {
    schemaVersion: 2,
    specversion: "1.0",
    id: "telegram-message-1",
    source: "urn:ishikeit:source:telegram:bot:bot-1",
    type: "com.ishikeit.messaging.message.received",
    provider: "telegram",
    channel: "bot",
    capability: "messaging",
    accountId: "bot-1",
    eventType: "message.received",
    providerMessageId: "message-1",
    identityId: "chat-1",
    receivedAt: "2026-09-30T00:00:00.000Z",
    content: [{ kind: "text", text: "hello" }],
    data: {}
  }
};

describe("MessageReceivedHandler", () => {
  it("creates provider-neutral ordered actions for every rich reply part", async () => {
    const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
      handoff: false,
      parts: [
        { kind: "text", text: "Hi" },
        { kind: "image", source: { kind: "url", value: "https://cdn.example/reply.jpg" } }
      ]
    });
    const handler = new MessageReceivedHandler({ respond });

    const actions = await handler.handle(stored);
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      turnId: stored.id,
      conversationId: "partition-1"
    }));
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      provider: "telegram",
      capability: "messaging",
      operation: "message.send",
      orderingKey: "partition-1",
      target: { channel: "bot", accountId: "bot-1", recipientId: "chat-1" },
      body: { part: { kind: "text", text: "Hi" } }
    });
    expect(actions[1]?.idempotencyKey).toBe(stored.id + ":reply:1");
  });

  it("returns no outbound action on human handoff", async () => {
    const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({ handoff: true, parts: [] });
    const handler = new MessageReceivedHandler({ respond });
    await expect(handler.handle(stored)).resolves.toEqual([]);
  });

  it("does not claim unrelated future capabilities", () => {
    const handler = new MessageReceivedHandler({ respond: vi.fn<BrainClient["respond"]>() });
    expect(handler.canHandle({
      ...stored,
      event: { ...stored.event, capability: "marketing", eventType: "lead.created" }
    })).toBe(false);
  });
});
