import { describe, expect, it, vi } from "vitest";
import type { ActionEnvelope } from "../src/domain/actions.js";
import { MetaMessagingAdapter } from "../src/adapters/meta/messaging.js";
import { MetaSender } from "../src/channels/meta-send.js";

const action: ActionEnvelope = {
  schemaVersion: 1,
  idempotencyKey: "inbound-1:reply:0",
  provider: "meta",
  capability: "messaging",
  operation: "message.send",
  orderingKey: "a".repeat(64),
  target: { channel: "instagram", accountId: "ig-1", recipientId: "customer-1" },
  body: {
    part: { kind: "text", text: "Choose a service" },
    customerMessageAt: "2026-10-28T10:59:00.000Z",
    quickReplies: [
      { title: "BIAB", payload: "service_biab" },
      { title: "Gel overlay", payload: "service_overlay" }
    ]
  }
};

describe("Meta quick reply durable action authorization", () => {
  it("passes eligible customer prompt through the same Meta handoff and 24-hour controls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ message_id: "mid-1" }), { status: 200 })
      );
      const isActive = vi.fn().mockResolvedValue(false);
      const adapter = new MetaMessagingAdapter(
        new MetaSender({
          graphApiVersion: "v26.0", instagramAccessToken: "token",
          instagramGraphHost: "graph.instagram.com", fetchImpl
        }),
        { isActive }
      );
      await expect(adapter.execute(action)).resolves.toEqual({ providerResourceId: "mid-1" });
      expect(isActive).toHaveBeenCalledWith("a".repeat(64));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [, init] = fetchImpl.mock.calls[0]!;
      if (typeof init?.body !== "string") throw new Error("Expected JSON body");
      expect(JSON.parse(init.body)).toMatchObject({
        message: { quick_replies: [{ title: "BIAB" }, { title: "Gel overlay" }] }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send a quick reply after human takeover or an expired response window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    try {
      const fetchImpl = vi.fn<typeof fetch>();
      const isActive = vi.fn().mockResolvedValue(true);
      const adapter = new MetaMessagingAdapter(
        new MetaSender({ graphApiVersion: "v26.0", instagramAccessToken: "token",
          instagramGraphHost: "graph.instagram.com", fetchImpl }),
        { isActive }
      );
      await expect(adapter.execute(action)).rejects.toMatchObject({
        retryable: false, message: "Meta conversation is under human handoff"
      });
      await expect(adapter.execute({
        ...action,
        body: { ...action.body as object, customerMessageAt: "2026-10-26T10:59:00.000Z" }
      })).rejects.toMatchObject({ retryable: false, message: "Meta standard reply is not eligible: outside_window" });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never accepts malformed or non-Meta content as a standard quick reply", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new MetaMessagingAdapter(new MetaSender({
      graphApiVersion: "v26.0", messengerAccessToken: "token",
      instagramGraphHost: "graph.instagram.com", fetchImpl
    }));
    await expect(adapter.execute({
      ...action,
      target: { channel: "messenger", accountId: "page-1", recipientId: "customer-1" },
      body: { part: { kind: "text", text: "Choose" }, customerMessageAt: "2026-10-28T10:59:00.000Z",
        quickReplies: [{ title: "A", payload: "same" }, { title: "B", payload: "same" }] }
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
