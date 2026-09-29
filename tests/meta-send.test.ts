import { describe, expect, it, vi } from "vitest";
import { MetaSendFailure, MetaSender } from "../src/channels/meta-send.js";
import type { MetaOutboundPayload } from "../src/domain/outbound.js";

const base: MetaOutboundPayload = {
  schemaVersion: 1,
  channel: "messenger",
  accountId: "page-1",
  recipientId: "user-1",
  message: { type: "text", text: "hello" }
};

describe("MetaSender", () => {
  it("sends Messenger responses through the versioned Page endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ recipient_id: "user-1", message_id: "m-1" }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const sender = new MetaSender({
      graphApiVersion: "v26.0",
      messengerAccessToken: "page-token",
      instagramAccessToken: "ig-token",
      instagramGraphHost: "graph.instagram.com",
      fetchImpl
    });

    await expect(sender.send(base)).resolves.toEqual({ providerMessageId: "m-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v26.0/page-1/messages");
    expect(init?.headers).toEqual({
      authorization: "Bearer page-token",
      "content-type": "application/json"
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: "user-1" },
      messaging_type: "RESPONSE",
      message: { text: "hello" }
    });
  });

  it("uses the configured Instagram Graph host", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ id: "ig-message-1" }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const sender = new MetaSender({
      graphApiVersion: "v26.0",
      messengerAccessToken: "page-token",
      instagramAccessToken: "ig-token",
      instagramGraphHost: "graph.instagram.com",
      fetchImpl
    });

    const payload: MetaOutboundPayload = {
      ...base,
      channel: "instagram",
      accountId: "ig-1"
    };
    await expect(sender.send(payload)).resolves.toEqual({ providerMessageId: "ig-message-1" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://graph.instagram.com/v26.0/ig-1/messages");
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: "user-1" },
      message: { text: "hello" }
    });
  });

  it("classifies throttling as retryable and honors Retry-After", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "slow down", code: 4, is_transient: true } }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": "2" } }
    ));
    const sender = new MetaSender({
      graphApiVersion: "v26.0",
      messengerAccessToken: "page-token",
      instagramAccessToken: "ig-token",
      instagramGraphHost: "graph.instagram.com",
      fetchImpl
    });

    try {
      await sender.send(base);
      throw new Error("expected send failure");
    } catch (error) {
      expect(error).toBeInstanceOf(MetaSendFailure);
      const failure = error as MetaSendFailure;
      expect(failure.retryable).toBe(true);
      expect(failure.ambiguous).toBe(false);
      expect(failure.status).toBe(429);
      expect(failure.graphCode).toBe(4);
      expect(failure.retryAfterMs).toBe(2000);
    }
  });

  it("classifies deterministic Graph validation failures as permanent", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "invalid recipient", code: 100 } }),
      { status: 400, headers: { "content-type": "application/json" } }
    ));
    const sender = new MetaSender({
      graphApiVersion: "v26.0",
      messengerAccessToken: "page-token",
      instagramAccessToken: "ig-token",
      instagramGraphHost: "graph.instagram.com",
      fetchImpl
    });

    await expect(sender.send(base)).rejects.toMatchObject({
      retryable: false,
      ambiguous: false,
      status: 400,
      graphCode: 100
    });
  });

  it("marks transport failures as retryable but delivery-ambiguous", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket reset"));
    const sender = new MetaSender({
      graphApiVersion: "v26.0",
      messengerAccessToken: "page-token",
      instagramAccessToken: "ig-token",
      instagramGraphHost: "graph.instagram.com",
      fetchImpl
    });

    await expect(sender.send(base)).rejects.toMatchObject({
      retryable: true,
      ambiguous: true
    });
  });

  it("rejects Instagram text over 1000 UTF-8 bytes before calling Meta", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new MetaSender({
      graphApiVersion: "v26.0",
      messengerAccessToken: "page-token",
      instagramAccessToken: "ig-token",
      instagramGraphHost: "graph.instagram.com",
      fetchImpl
    });

    await expect(sender.send({
      ...base,
      channel: "instagram",
      message: { type: "text", text: "a".repeat(1001) }
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
