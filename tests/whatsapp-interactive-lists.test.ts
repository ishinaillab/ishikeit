import { describe, expect, it, vi } from "vitest";
import { interactiveListSchema } from "../src/domain/interactive-lists.js";
import { MetaSender } from "../src/channels/meta-send.js";
import { MetaMessagingAdapter } from "../src/adapters/meta/messaging.js";
import type { MetaOutboundPayload } from "../src/domain/outbound.js";
import type { ActionEnvelope } from "../src/domain/actions.js";

const menu = {
  button: "View nail services",
  sections: [{
    title: "Nail services",
    rows: [
      { id: "biab", title: "BIAB", description: "Builder gel reinforcement" },
      { id: "overlay", title: "Gel overlay", description: "Structured gel" },
      { id: "extensions", title: "Nail extensions" },
      { id: "art", title: "Nail art" }
    ]
  }]
};

const payload: MetaOutboundPayload = {
  schemaVersion: 2,
  channel: "whatsapp",
  accountId: "123456789012",
  recipientId: "639123456789",
  message: { kind: "text", text: "Which service interests you?" },
  interactiveList: menu
};

function sender(fetchImpl: typeof fetch) {
  return new MetaSender({
    graphApiVersion: "v26.0", whatsappAccessToken: "wa-token",
    messengerAccessToken: "page-token",
    instagramGraphHost: "graph.instagram.com", fetchImpl
  });
}

describe("WhatsApp native interactive list menus", () => {
  it("sends a customer-initiated services menu in the official Cloud API list shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ messages: [{ id: "wamid-menu" }] }), { status: 200 }
    ));
    await expect(sender(fetchImpl).send(payload)).resolves.toEqual({ providerMessageId: "wamid-menu" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v26.0/123456789012/messages");
    expect(init?.redirect).toBe("error");
    if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp", recipient_type: "individual",
      to: "639123456789", type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Which service interests you?" },
        action: {
          button: "View nail services",
          sections: menu.sections
        }
      }
    });
  });

  it("rejects invalid sections, duplicate identifiers, overlong values and row-count overflow", () => {
    expect(interactiveListSchema.safeParse(menu).success).toBe(true);
    expect(interactiveListSchema.safeParse({ ...menu, button: "x".repeat(21) }).success).toBe(false);
    expect(interactiveListSchema.safeParse({ ...menu, sections: [] }).success).toBe(false);
    expect(interactiveListSchema.safeParse({ ...menu, sections: [{
      title: "Services", rows: [{ id: "same", title: "One" }, { id: "same", title: "Two" }]
    }] }).success).toBe(false);
    expect(interactiveListSchema.safeParse({ ...menu, sections: [{
      title: "Services", rows: Array.from({ length: 11 }, (_, i) => ({ id: String(i), title: "Service" }))
    }] }).success).toBe(false);
    expect(interactiveListSchema.safeParse({ ...menu, sections: [
      { title: "One", rows: Array.from({ length: 6 }, (_, i) => ({ id: "a" + i, title: "A" })) },
      { title: "Two", rows: Array.from({ length: 5 }, (_, i) => ({ id: "b" + i, title: "B" })) }
    ] }).success).toBe(false);
  });

  it("refuses lists on other channels or alongside buttons/media before Graph calls", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const api = sender(fetchImpl);
    const invalid: MetaOutboundPayload[] = [
      { ...payload, channel: "messenger" },
      { ...payload, quickReplies: [{ title: "BIAB", payload: "biab" }] },
      { ...payload, message: { kind: "image", source: { kind: "url", value: "https://example.test/a.jpg" } } },
      { ...payload, interactiveList: { ...menu, sections: [{ title: "x", rows: [] }] } },
      { ...payload, message: { kind: "text", text: "x".repeat(1025) } }
    ];
    for (const input of invalid) {
      await expect(api.send(input)).rejects.toMatchObject({ retryable: false });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts the maximum 1024-character WhatsApp list prompt", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid-boundary" }] }), { status: 200 })
    );
    await expect(sender(fetchImpl).send({
      ...payload, message: { kind: "text", text: "x".repeat(1024) }
    })).resolves.toEqual({ providerMessageId: "wamid-boundary" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("remains subject to the 24-hour window and private handoff block", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "wamid-menu" }] }), { status: 200 })
      );
      const isActive = vi.fn().mockResolvedValue(false);
      const adapter = new MetaMessagingAdapter(sender(fetchImpl), { isActive });
      const action: ActionEnvelope = {
        schemaVersion: 1, idempotencyKey: "reply-menu-1",
        provider: "meta", capability: "messaging", operation: "message.send",
        orderingKey: "b".repeat(64),
        target: { channel: "whatsapp", accountId: "123456789012", recipientId: "639123456789" },
        body: {
          part: payload.message,
          interactiveList: menu,
          customerMessageAt: "2026-10-28T10:59:00.000Z"
        }
      };
      await expect(adapter.execute(action)).resolves.toEqual({ providerResourceId: "wamid-menu" });
      expect(isActive).toHaveBeenCalledWith("b".repeat(64));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await expect(adapter.execute({ ...action, body: {
        part: payload.message, interactiveList: menu,
        customerMessageAt: "2020-01-01T00:00:00.000Z"
      } })).rejects.toMatchObject({ retryable: false, message: "Meta standard reply is not eligible: outside_window" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
