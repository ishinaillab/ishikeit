import { describe, expect, it, vi } from "vitest";
import { MetaSender } from "../src/channels/meta-send.js";
import { quickReplyChoicesSchema } from "../src/domain/quick-replies.js";
import type { MetaOutboundPayload } from "../src/domain/outbound.js";

const choices = [
  { title: "BIAB", payload: "service_biab" },
  { title: "Gel overlay", payload: "service_overlay" }
];

function makeSender(fetchImpl: typeof fetch) {
  return new MetaSender({
    graphApiVersion: "v26.0",
    messengerAccessToken: "page-token",
    instagramAccessToken: "instagram-token",
    whatsappAccessToken: "wa-token",
    instagramGraphHost: "graph.instagram.com",
    fetchImpl
  });
}

const base: MetaOutboundPayload = {
  schemaVersion: 2,
  channel: "messenger",
  accountId: "page-1",
  recipientId: "customer-1",
  message: { kind: "text", text: "Which service interests you?" },
  quickReplies: choices
};

function parsedRequest(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  const call = fetchImpl.mock.calls[0];
  if (call === undefined) throw new Error("No request");
  const [url, init] = call;
  if (typeof init?.body !== "string") throw new Error("No JSON body");
  return { url, init, body: JSON.parse(init.body) as Record<string, unknown> };
}

describe("Meta native quick replies", () => {
  it.each(["messenger", "instagram"] as const)(
    "sends %s quick reply text buttons via the existing send API", async (channel) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ message_id: "mid-1" }), { status: 200 })
      );
      await expect(makeSender(fetchImpl).send({
        ...base, channel, accountId: channel === "instagram" ? "ig-1" : "page-1"
      })).resolves.toEqual({ providerMessageId: "mid-1" });
      const { url, init, body } = parsedRequest(fetchImpl);
      expect(url).toBe(channel === "instagram"
        ? "https://graph.instagram.com/v26.0/ig-1/messages"
        : "https://graph.facebook.com/v26.0/page-1/messages");
      expect(init?.redirect).toBe("error");
      expect(body).toMatchObject({
        recipient: { id: "customer-1" },
        message: {
          text: "Which service interests you?",
          quick_replies: [
            { content_type: "text", title: "BIAB", payload: "service_biab" },
            { content_type: "text", title: "Gel overlay", payload: "service_overlay" }
          ]
        }
      });
      if (channel === "messenger") expect(body.messaging_type).toBe("RESPONSE");
      else expect(body).not.toHaveProperty("messaging_type");
    }
  );

  it("fails closed on excessive WhatsApp buttons and media-only quick replies before networking", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = makeSender(fetchImpl);
    await expect(sender.send({
      ...base,
      channel: "whatsapp",
      quickReplies: [...choices, { title: "Nail art", payload: "service_art" },
        { title: "Extensions", payload: "service_extensions" }]
    })).rejects.toMatchObject({ retryable: false });
    await expect(sender.send({
      ...base, message: { kind: "image", source: { kind: "url", value: "https://example.test/a.jpg" } }
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates bounds, nonblank titles, duplicate choices and unsafe payloads", () => {
    expect(quickReplyChoicesSchema.safeParse(choices).success).toBe(true);
    expect(quickReplyChoicesSchema.safeParse([]).success).toBe(false);
    expect(quickReplyChoicesSchema.safeParse(Array(14).fill(choices[0])).success).toBe(false);
    expect(quickReplyChoicesSchema.safeParse([{ title: "a".repeat(21), payload: "x" }]).success).toBe(false);
    expect(quickReplyChoicesSchema.safeParse([{ title: " ", payload: "x" }]).success).toBe(false);
    expect(quickReplyChoicesSchema.safeParse([
      { title: "one", payload: "same" }, { title: "two", payload: "same" }
    ]).success).toBe(false);
    expect(quickReplyChoicesSchema.safeParse([{ title: "one", payload: "line\nbreak" }]).success).toBe(false);
  });
});
