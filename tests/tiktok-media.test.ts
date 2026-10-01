import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../src/domain/events.js";
import { TikTokMediaResolver } from "../src/media/tiktok.js";

const event: CanonicalEvent = {
  schemaVersion: 2,
  specversion: "1.0",
  id: "message:msg-1",
  source: "urn:ishikeit:source:tiktok:business:business-1",
  type: "com.ishikeit.messaging.message.received",
  provider: "tiktok",
  channel: "business",
  capability: "messaging",
  accountId: "business-1",
  eventType: "message.received",
  providerEventId: "message:msg-1",
  providerMessageId: "msg-1",
  identityId: "conv-1",
  receivedAt: "2026-10-02T00:00:00.000Z",
  content: [],
  data: {}
};

function bodyAsJson(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("expected JSON body");
  return JSON.parse(body) as Record<string, unknown>;
}

describe("TikTokMediaResolver", () => {
  it("resolves a provider media ID and downloads bounded bytes", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        message: "OK",
        data: { download_url: "https://media.example.test/file" }
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "4" }
      }));

    const resolver = new TikTokMediaResolver({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      maxBytes: 1024,
      fetchImpl
    });

    const resolved = await resolver.resolve(event, {
      kind: "image",
      source: { kind: "provider", value: "media-1" }
    });

    expect(resolved.filename).toBe("tiktok-image-msg-1.jpg");
    expect(resolved.mimeType).toBe("image/jpeg");
    expect([...resolved.bytes]).toEqual([1, 2, 3, 4]);

    const [metadataUrl, metadataInit] = fetchImpl.mock.calls[0]!;
    expect(metadataUrl).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/message/media/download/"
    );
    expect(bodyAsJson(metadataInit?.body)).toEqual({
      business_id: "business-1",
      conversation_id: "conv-1",
      message_id: "msg-1",
      media_id: "media-1",
      media_type: "IMAGE"
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toEqual(new URL("https://media.example.test/file"));
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
      "x-user": "access-token-123456789"
    });
  });

  it("rejects non-provider and unsupported media before network I/O", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const resolver = new TikTokMediaResolver({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      maxBytes: 1024,
      fetchImpl
    });

    await expect(resolver.resolve(event, {
      kind: "image",
      source: { kind: "url", value: "https://example.test/image.jpg" }
    })).rejects.toMatchObject({ retryable: false });

    await expect(resolver.resolve(event, {
      kind: "audio",
      source: { kind: "provider", value: "media-audio" }
    })).rejects.toMatchObject({ retryable: false });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unsafe download URLs returned by metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: { download_url: "http://127.0.0.1/private" }
    }), { status: 200 }));
    const resolver = new TikTokMediaResolver({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      maxBytes: 1024,
      fetchImpl
    });

    await expect(resolver.resolve(event, {
      kind: "video",
      source: { kind: "provider", value: "media-video" }
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces the byte ceiling on downloaded media", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { download_url: "https://media.example.test/video" }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "4" }
      }));

    const resolver = new TikTokMediaResolver({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      maxBytes: 3,
      fetchImpl
    });

    await expect(resolver.resolve(event, {
      kind: "video",
      source: { kind: "provider", value: "media-video" }
    })).rejects.toMatchObject({ retryable: false });
  });
});
