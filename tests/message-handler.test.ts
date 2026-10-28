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
  it("creates provider-neutral ordered actions and records a handled outcome", async () => {
    const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
      handoff: false,
      parts: [
        { kind: "text", text: "Hi" },
        { kind: "image", source: { kind: "url", value: "https://cdn.example/reply.jpg" } }
      ]
    });
    const handler = new MessageReceivedHandler({ respond });

    const result = await handler.handle(stored);
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      turnId: stored.id,
      conversationId: "partition-1"
    }));
    expect(result.outcome).toBe("handled");
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      provider: "telegram",
      capability: "messaging",
      operation: "message.send",
      orderingKey: "partition-1",
      target: { channel: "bot", accountId: "bot-1", recipientId: "chat-1" },
      body: { part: { kind: "text", text: "Hi" } }
    });
    expect(result.actions[1]?.idempotencyKey).toBe(stored.id + ":reply:1");
  });

  it("preserves Meta provider message time in the durable reply for dispatch-time policy", async () => {
    const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
      handoff: false,
      parts: [{ kind: "text", text: "Hi" }]
    });
    const handler = new MessageReceivedHandler({ respond });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T08:00:00.000Z"));
    const result = await handler.handle({
      ...stored,
      event: {
        ...stored.event,
        provider: "meta",
        channel: "whatsapp",
        accountId: "phone-1",
        occurredAt: "2026-10-27T07:00:00.000Z"
      }
    });
    expect(result.actions[0]?.body).toEqual({
      part: { kind: "text", text: "Hi" },
      customerMessageAt: "2026-10-27T07:00:00.000Z"
    });
    vi.useRealTimers();
  });

  it("does not invoke the brain for stale or untimestamped Meta messages", async () => {
    const respond = vi.fn<BrainClient["respond"]>();
    const handler = new MessageReceivedHandler({ respond });
    const meta = { ...stored.event, provider: "meta", channel: "whatsapp" };
    await expect(handler.handle({ ...stored, event: meta })).resolves.toEqual({
      actions: [], outcome: "ignored"
    });
    await expect(handler.handle({
      ...stored,
      event: { ...meta, occurredAt: "2020-01-01T00:00:00.000Z" }
    })).resolves.toEqual({ actions: [], outcome: "ignored" });
    expect(respond).not.toHaveBeenCalled();
  });

  it("does not invoke AI while a Meta conversation is under durable human handoff", async () => {
    const respond = vi.fn<BrainClient["respond"]>();
    const isActive = vi.fn().mockResolvedValue(true);
    const handler = new MessageReceivedHandler({ respond }, { isActive });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T09:00:00.000Z"));
    try {
      const result = await handler.handle({
        ...stored,
        event: {
          ...stored.event,
          provider: "meta",
          channel: "messenger",
          occurredAt: "2026-10-28T08:59:00.000Z"
        }
      });
      expect(result).toEqual({ actions: [], outcome: "ignored" });
      expect(isActive).toHaveBeenCalledWith("partition-1");
      expect(respond).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles Meta customer postbacks inside the standard reply policy and handoff guard", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    try {
      const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
        handoff: false, parts: [{ kind: "text", text: "Booking options" }]
      });
      const isActive = vi.fn().mockResolvedValue(false);
      const handler = new MessageReceivedHandler({ respond }, { isActive });
      const event = {
        ...stored.event,
        provider: "meta", channel: "messenger", accountId: "page-1",
        eventType: "message.postback",
        identityId: "psid-1",
        occurredAt: "2026-10-28T10:59:00.000Z",
        content: [{ kind: "text" as const, text: "Book" }]
      };
      const result = await handler.handle({ ...stored, event });
      expect(result.outcome).toBe("handled");
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]?.target).toMatchObject({ channel: "messenger", recipientId: "psid-1" });
      expect(isActive).toHaveBeenCalledWith("partition-1");
      expect(respond).toHaveBeenCalledTimes(1);
      await expect(handler.handle({
        ...stored, event: { ...event, occurredAt: "2020-01-01T00:00:00.000Z" }
      })).resolves.toEqual({ actions: [], outcome: "ignored" });
      expect(respond).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates stable ordered, individually eligible Meta replies from long AI text", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    try {
      const text = "Nail service details. ".repeat(95);
      const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
        handoff: false, parts: [{ kind: "text", text }]
      });
      const handler = new MessageReceivedHandler({ respond });
      const event = {
        ...stored.event, provider: "meta", channel: "instagram",
        accountId: "ig-1", identityId: "ig-customer",
        occurredAt: "2026-10-28T10:59:00.000Z"
      };
      const result = await handler.handle({ ...stored, event });
      expect(result.outcome).toBe("handled");
      expect(result.actions.length).toBeGreaterThan(1);
      expect(result.actions.map((a) => a.idempotencyKey)).toEqual(
        result.actions.map((_, index) => stored.id + ":reply:" + index)
      );
      expect(result.actions.every((a) => a.orderingKey === stored.partitionKey)).toBe(true);
      expect(result.actions.every((a) => a.body.customerMessageAt === event.occurredAt)).toBe(true);
      expect(result.actions.map((a) => a.body.part.kind === "text" ? a.body.part.text : "").join("")).toBe(text);
      const repeated = await handler.handle({ ...stored, event });
      expect(repeated.actions).toEqual(result.actions);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands off an excessively long Meta AI reply without sending partial chunks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    try {
      const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
        handoff: false, parts: [{ kind: "text", text: "A".repeat(9600) }]
      });
      const handler = new MessageReceivedHandler({ respond });
      const result = await handler.handle({
        ...stored,
        event: {
          ...stored.event, provider: "meta", channel: "instagram",
          occurredAt: "2026-10-28T10:59:00.000Z"
        }
      });
      expect(result).toEqual({
        outcome: "handoff", handoffReason: "reply_too_long", actions: []
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a human handoff with a durable reason and no outbound action", async () => {
    const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
      handoff: true,
      handoffReason: "customer_requested_human",
      parts: []
    });
    const handler = new MessageReceivedHandler({ respond });

    await expect(handler.handle(stored)).resolves.toEqual({
      actions: [],
      outcome: "handoff",
      handoffReason: "customer_requested_human"
    });
  });

  it("uses an explicit fallback reason when a handoff has no reason", async () => {
    const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
      handoff: true,
      parts: []
    });
    const handler = new MessageReceivedHandler({ respond });

    await expect(handler.handle(stored)).resolves.toEqual({
      actions: [],
      outcome: "handoff",
      handoffReason: "unspecified"
    });
  });

  it("does not persist free-form handoff text as an operational reason", async () => {
    const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
      handoff: true,
      handoffReason: "Needs a human right now",
      parts: []
    });
    const handler = new MessageReceivedHandler({ respond });

    await expect(handler.handle(stored)).resolves.toEqual({
      actions: [],
      outcome: "handoff",
      handoffReason: "unspecified"
    });
  });

  it("does not claim unrelated future capabilities", () => {
    const handler = new MessageReceivedHandler({ respond: vi.fn<BrainClient["respond"]>() });
    expect(handler.canHandle({
      ...stored,
      event: { ...stored.event, capability: "marketing", eventType: "lead.created" }
    })).toBe(false);
  });

  it("does not claim routing standby or handover events", () => {
    const handler = new MessageReceivedHandler({ respond: vi.fn<BrainClient["respond"]>() });

    for (const eventType of ["standby.message", "handover.pass"]) {
      expect(handler.canHandle({
        ...stored,
        event: { ...stored.event, capability: "routing", eventType }
      })).toBe(false);
    }
  });
});
