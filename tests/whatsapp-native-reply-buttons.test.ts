import { describe, expect, it, vi } from "vitest";
import { MetaSender } from "../src/channels/meta-send.js";
import { MetaMessagingAdapter } from "../src/adapters/meta/messaging.js";
import type { MetaOutboundPayload } from "../src/domain/outbound.js";
import type { ActionEnvelope } from "../src/domain/actions.js";

const choices = [
  { title: "BIAB", payload: "service_biab" },
  { title: "Gel overlay", payload: "service_overlay" }
];

const base: MetaOutboundPayload = {
  schemaVersion: 2,
  channel: "whatsapp",
  accountId: "123456789012",
  recipientId: "639123456789",
  message: { kind: "text", text: "Which service would you prefer?" },
  quickReplies: choices
};

function sender(fetchImpl: typeof fetch) {
  return new MetaSender({
    graphApiVersion: "v26.0",
    whatsappAccessToken: "wa-token",
    instagramGraphHost: "graph.instagram.com",
    fetchImpl
  });
}

describe("WhatsApp native reply buttons", () => {
  it("uses the Cloud API interactive button contract and never follows redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ messages: [{ id: "wamid-interactive-1" }] }), { status: 200 }
    ));
    await expect(sender(fetchImpl).send({ ...base, replyTo: "wamid-customer" }))
      .resolves.toEqual({ providerMessageId: "wamid-interactive-1" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v26.0/123456789012/messages");
    expect(init?.redirect).toBe("error");
    if (typeof init?.body !== "string") throw new Error("Expected JSON body");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "639123456789",
      context: { message_id: "wamid-customer" },
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Which service would you prefer?" },
        action: { buttons: [
          { type: "reply", reply: { id: "service_biab", title: "BIAB" } },
          { type: "reply", reply: { id: "service_overlay", title: "Gel overlay" } }
        ] }
      }
    });
  });

  it("rejects provider limits and duplicate button titles before any request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const api = sender(fetchImpl);
    const invalidCases: MetaOutboundPayload[] = [
      { ...base, quickReplies: [...choices, { title: "Nail art", payload: "art" },
        { title: "Press-ons", payload: "pressons" }] },
      { ...base, quickReplies: [{ title: "BIAB", payload: "first" }, { title: "biab", payload: "second" }] },
      { ...base, quickReplies: [{ title: "BIAB", payload: "a".repeat(257) }] },
      { ...base, message: { kind: "text", text: "b".repeat(1025) } },
      { ...base, message: { kind: "image", source: { kind: "url", value: "https://example.test/nail.jpg" } } }
    ];
    for (const payload of invalidCases) {
      await expect(api.send(payload)).rejects.toMatchObject({ retryable: false });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends an explicitly queued interaction only with an eligible customer message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({ messages: [{ id: "wamid-out" }] }), { status: 200 }
      ));
      const isActive = vi.fn().mockResolvedValue(false);
      const adapter = new MetaMessagingAdapter(sender(fetchImpl), { isActive });
      const action: ActionEnvelope = {
        schemaVersion: 1, provider: "meta", capability: "messaging", operation: "message.send",
        idempotencyKey: "inbound-1:reply:0",
        orderingKey: "f".repeat(64),
        target: { channel: base.channel, accountId: base.accountId, recipientId: base.recipientId },
        body: {
          part: base.message,
          quickReplies: choices,
          customerMessageAt: "2026-10-28T10:58:00.000Z"
        }
      };
      await expect(adapter.execute(action)).resolves.toEqual({ providerResourceId: "wamid-out" });
      expect(isActive).toHaveBeenCalledWith("f".repeat(64));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await expect(adapter.execute({
        ...action,
        body: { part: base.message, quickReplies: choices, customerMessageAt: "2020-01-01T00:00:00.000Z" }
      })).rejects.toMatchObject({ retryable: false, message: "Meta standard reply is not eligible: outside_window" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
