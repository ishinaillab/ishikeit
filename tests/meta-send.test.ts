import { describe, expect, it, vi } from "vitest";
import { MetaSendFailure, MetaSender } from "../src/channels/meta-send.js";
import type { MetaOutboundPayload } from "../src/domain/outbound.js";

const base: MetaOutboundPayload = {
  schemaVersion: 2,
  channel: "messenger",
  accountId: "page-1",
  recipientId: "user-1",
  message: { kind: "text", text: "hello" }
};

function bodyAsString(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") throw new Error("expected a string request body");
  return body;
}

function makeSender(fetchImpl: typeof fetch) {
  return new MetaSender({
    graphApiVersion: "v26.0",
    messengerAccessToken: "page-token",
    instagramAccessToken: "ig-token",
    whatsappAccessToken: "wa-token",
    instagramGraphHost: "graph.instagram.com",
    fetchImpl
  });
}

describe("MetaSender", () => {
  it("sends Messenger text through the versioned Page endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ recipient_id: "user-1", message_id: "m-1" }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    await expect(makeSender(fetchImpl).send(base)).resolves.toEqual({ providerMessageId: "m-1" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v26.0/page-1/messages");
    expect(JSON.parse(bodyAsString(init?.body))).toEqual({
      recipient: { id: "user-1" },
      messaging_type: "RESPONSE",
      message: { text: "hello" }
    });
  });

  it("sends Messenger image attachments by URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ message_id: "m-image" }), { status: 200 }
    ));
    await makeSender(fetchImpl).send({
      ...base,
      message: { kind: "image", source: { kind: "url", value: "https://example.test/photo.jpg" } }
    });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(bodyAsString(init?.body))).toMatchObject({
      message: { attachment: { type: "image", payload: { url: "https://example.test/photo.jpg" } } }
    });
  });

  it("uses the configured Instagram Graph host for document media", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ id: "ig-message-1" }), { status: 200 }
    ));
    await makeSender(fetchImpl).send({
      ...base,
      channel: "instagram",
      accountId: "ig-1",
      message: {
        kind: "document",
        source: { kind: "url", value: "https://example.test/file.pdf" },
        mimeType: "application/pdf"
      }
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://graph.instagram.com/v26.0/ig-1/messages");
    expect(JSON.parse(bodyAsString(init?.body))).toMatchObject({
      recipient: { id: "user-1" },
      message: { attachment: { type: "file", payload: { url: "https://example.test/file.pdf" } } }
    });
  });

  it("sends WhatsApp media using Cloud API media objects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }
    ));
    await expect(makeSender(fetchImpl).send({
      ...base,
      channel: "whatsapp",
      accountId: "phone-1",
      recipientId: "639000000000",
      message: {
        kind: "document",
        source: { kind: "url", value: "https://example.test/file.pdf" },
        filename: "file.pdf",
        caption: "Here it is"
      }
    })).resolves.toEqual({ providerMessageId: "wamid.1" });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(bodyAsString(init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "639000000000",
      type: "document",
      document: {
        link: "https://example.test/file.pdf",
        caption: "Here it is",
        filename: "file.pdf"
      }
    });
  });

  it("classifies throttling as retryable and honors Retry-After", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "slow down", code: 4, is_transient: true } }),
      { status: 429, headers: { "retry-after": "2" } }
    ));
    await expect(makeSender(fetchImpl).send(base)).rejects.toMatchObject({
      retryable: true,
      ambiguous: false,
      status: 429,
      graphCode: 4,
      retryAfterMs: 2000
    });
  });

  it("marks transport failures as retryable and delivery-ambiguous", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket reset"));
    await expect(makeSender(fetchImpl).send(base)).rejects.toBeInstanceOf(MetaSendFailure);
  });

  it("fails permanently when the selected channel credential is not configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const noInstagram = new MetaSender({
      graphApiVersion: "v26.0",
      messengerAccessToken: "page-token",
      whatsappAccessToken: "wa-token",
      instagramGraphHost: "graph.instagram.com",
      fetchImpl
    });

    await expect(noInstagram.send({
      ...base,
      channel: "instagram",
      accountId: "ig-1"
    })).rejects.toMatchObject({
      retryable: false,
      message: "No Meta access token is configured for instagram"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces provider text limits before making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(makeSender(fetchImpl).send({
      ...base,
      channel: "instagram",
      message: { kind: "text", text: "a".repeat(1001) }
    })).rejects.toMatchObject({ retryable: false });
    await expect(makeSender(fetchImpl).send({
      ...base,
      channel: "whatsapp",
      message: { kind: "text", text: "a".repeat(4097) }
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
