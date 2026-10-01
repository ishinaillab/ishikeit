import { describe, expect, it, vi } from "vitest";
import { AccessTokenError } from "../src/auth/token-provider.js";
import { TikTokBusinessSender } from "../src/channels/tiktok-send.js";

function bodyAsJson(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("expected JSON body");
  return JSON.parse(body) as Record<string, unknown>;
}

describe("TikTokBusinessSender", () => {
  it("sends text to a conversation and returns the provider message ID", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ code: 0, message: "OK", data: { message: { message_id: "tt-msg-1" } } }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });

    await expect(sender.send("conv-1", { kind: "text", text: "hello" }))
      .resolves.toEqual({ providerMessageId: "tt-msg-1" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/message/send/"
    );
    expect(init?.headers).toMatchObject({ "Access-Token": "access-token-123456789" });
    expect(bodyAsJson(init?.body)).toEqual({
      business_id: "business-1",
      recipient_type: "CONVERSATION",
      recipient: "conv-1",
      message_type: "TEXT",
      text: { body: "hello" }
    });
  });

  it("passes reply identity when provided", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ code: 0, message: "OK", data: {} }),
      { status: 200 }
    ));
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });
    await sender.send("conv-1", { kind: "text", text: "reply" }, "msg-1");
    expect(bodyAsJson(fetchImpl.mock.calls[0]?.[1]?.body)).toMatchObject({
      referenced_message_info: { referenced_message_id: "msg-1" }
    });
  });

  it("rejects non-text generic outbound content before provider I/O", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });
    await expect(sender.send("conv-1", {
      kind: "image",
      source: { kind: "url", value: "https://example.test/image.jpg" }
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects text above the documented limit before provider I/O", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });
    await expect(sender.send("conv-1", {
      kind: "text",
      text: "x".repeat(6001)
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not retry an authorization-required token failure before provider I/O", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessTokenProvider: {
        getAccessToken: () => Promise.reject(new AccessTokenError(
          "reauthorization required",
          { retryable: false }
        ))
      },
      fetchImpl
    });

    await expect(sender.send("conv-1", { kind: "text", text: "hello" }))
      .rejects.toMatchObject({ retryable: false, ambiguous: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies transport errors as retryable and delivery-ambiguous", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket reset"));
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });
    await expect(sender.send("conv-1", { kind: "text", text: "hello" }))
      .rejects.toMatchObject({ retryable: true, ambiguous: true });
  });

  it("classifies TikTok throttling codes as retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ code: 40100, message: "rate limited", data: {} }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });
    await expect(sender.send("conv-1", { kind: "text", text: "hello" }))
      .rejects.toMatchObject({
        retryable: true,
        ambiguous: false,
        providerCode: "40100"
      });
  });
});
