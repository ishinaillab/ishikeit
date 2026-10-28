import { describe, expect, it, vi } from "vitest";
import { MetaMessagingAdapter } from "../src/adapters/meta/messaging.js";
import { MetaSender } from "../src/channels/meta-send.js";
import type { ActionEnvelope } from "../src/domain/actions.js";

const action: ActionEnvelope = {
  schemaVersion: 1,
  idempotencyKey: "reply-1",
  provider: "meta",
  capability: "messaging",
  operation: "message.send",
  orderingKey: "conversation-1",
  target: { channel: "whatsapp", accountId: "phone-1", recipientId: "customer-1" },
  body: { part: { kind: "text", text: "Hello" } }
};

describe("MetaMessagingAdapter standard reply policy", () => {
  it("prevents a previously queued reply from sending once human handoff is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    try {
      const fetchImpl = vi.fn<typeof fetch>();
      const isActive = vi.fn().mockResolvedValue(true);
      const sender = new MetaSender({
        graphApiVersion: "v26.0", whatsappAccessToken: "test-token",
        instagramGraphHost: "graph.instagram.com", fetchImpl
      });
      const adapter = new MetaMessagingAdapter(sender, { isActive });
      await expect(adapter.execute({
        ...action,
        orderingKey: "a".repeat(64),
        body: { part: { kind: "text", text: "Reply queued before handoff" },
          customerMessageAt: "2026-10-28T10:59:00.000Z" }
      })).rejects.toMatchObject({
        retryable: false,
        message: "Meta conversation is under human handoff"
      });
      expect(isActive).toHaveBeenCalledWith("a".repeat(64));
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows still-eligible replies without human handoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "wamid-ok" }] }), { status: 200 })
      );
      const isActive = vi.fn().mockResolvedValue(false);
      const sender = new MetaSender({
        graphApiVersion: "v26.0", whatsappAccessToken: "test-token",
        instagramGraphHost: "graph.instagram.com", fetchImpl
      });
      const adapter = new MetaMessagingAdapter(sender, { isActive });
      await expect(adapter.execute({
        ...action,
        orderingKey: "b".repeat(64),
        body: { part: { kind: "text", text: "Fresh response" },
          customerMessageAt: "2026-10-28T10:59:00.000Z" }
      })).resolves.toEqual({ providerResourceId: "wamid-ok" });
      expect(isActive).toHaveBeenCalledWith("b".repeat(64));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects legacy queued actions without a provider timestamp before send", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new MetaSender({ graphApiVersion: "v26.0", whatsappAccessToken: "test-token", instagramGraphHost: "graph.instagram.com", fetchImpl });
    const adapter = new MetaMessagingAdapter(sender);
    await expect(adapter.execute(action)).rejects.toMatchObject({
      retryable: false,
      message: "Meta standard reply is not eligible: missing_timestamp"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects stale customer replies before send", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new MetaSender({ graphApiVersion: "v26.0", whatsappAccessToken: "test-token", instagramGraphHost: "graph.instagram.com", fetchImpl });
    const adapter = new MetaMessagingAdapter(sender);
    await expect(adapter.execute({
      ...action,
      body: { part: { kind: "text", text: "Hello" }, customerMessageAt: "2020-01-01T00:00:00.000Z" }
    })).rejects.toMatchObject({ retryable: false, message: "Meta standard reply is not eligible: outside_window" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
