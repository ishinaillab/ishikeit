import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../src/domain/events.js";
import type { MediaContentPart } from "../src/domain/content.js";
import { MetaMediaResolver } from "../src/media/meta.js";

const event: CanonicalEvent = {
  schemaVersion: 2,
  specversion: "1.0",
  id: "message:wamid-1",
  source: "urn:ishikeit:source:meta:whatsapp:phone-1",
  type: "com.ishikeit.messaging.message.received",
  provider: "meta",
  channel: "whatsapp",
  capability: "messaging",
  accountId: "phone-1",
  eventType: "message.received",
  providerMessageId: "wamid-1",
  identityId: "639000000000",
  receivedAt: "2026-09-30T00:00:00.000Z",
  content: [],
  data: {}
};

const imagePart: MediaContentPart = {
  kind: "image",
  source: { kind: "url", value: "https://scontent.xx.fbcdn.net/photo.jpg" }
};

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.toString();
  if (typeof input === "string") return input;
  return input.url;
}

function resolver(fetchImpl: typeof fetch, maxBytes = 1024) {
  return new MetaMediaResolver({
    graphApiVersion: "v26.0",
    whatsappAccessToken: "wa-token",
    maxBytes,
    fetchImpl
  });
}

describe("MetaMediaResolver", () => {
  it("downloads a direct Meta-hosted media URL without provider credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      new Uint8Array([1, 2, 3]),
      { status: 200, headers: { "content-type": "image/jpeg", "content-length": "3" } }
    ));

    await expect(resolver(fetchImpl).resolve(event, imagePart)).resolves.toMatchObject({
      filename: "photo.jpg",
      mimeType: "image/jpeg"
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(requestUrl(url)).toBe("https://scontent.xx.fbcdn.net/photo.jpg");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual({});
  });

  it("rejects non-Meta media URLs before making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(resolver(fetchImpl).resolve(event, {
      ...imagePart,
      source: { kind: "url", value: "https://example.com/photo.jpg" }
    })).rejects.toMatchObject({ retryable: false });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revalidates every redirect target", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/file.jpg" }
    }));

    await expect(resolver(fetchImpl).resolve(event, imagePart))
      .rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces declared and actual media byte limits", async () => {
    const declaredFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      new Uint8Array([1]),
      { status: 200, headers: { "content-length": "2048" } }
    ));
    await expect(resolver(declaredFetch).resolve(event, imagePart))
      .rejects.toMatchObject({ retryable: false });

    const actualFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      new Uint8Array(1025),
      { status: 200 }
    ));
    await expect(resolver(actualFetch).resolve(event, imagePart))
      .rejects.toMatchObject({ retryable: false });
  });

  it("resolves WhatsApp provider media IDs through metadata then authenticated download", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/file",
        mime_type: "application/pdf",
        file_size: "4"
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(
        new Uint8Array([1, 2, 3, 4]),
        { status: 200, headers: { "content-type": "application/pdf" } }
      ));

    await expect(resolver(fetchImpl).resolve(event, {
      kind: "document",
      source: { kind: "provider", value: "media-1" },
      filename: "reference.pdf"
    })).resolves.toMatchObject({
      filename: "reference.pdf",
      mimeType: "application/pdf"
    });

    expect(requestUrl(fetchImpl.mock.calls[0]![0]))
      .toBe("https://graph.facebook.com/v26.0/media-1?phone_number_id=phone-1");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers)
      .toEqual({ authorization: "Bearer wa-token" });
    expect(requestUrl(fetchImpl.mock.calls[1]![0]))
      .toBe("https://lookaside.fbsbx.com/whatsapp_business/attachments/file");
    expect(fetchImpl.mock.calls[1]?.[1]?.headers)
      .toEqual({ authorization: "Bearer wa-token" });
  });

  it.each([
    ["image", "image/png", "png"],
    ["audio", "audio/mpeg", "mp3"],
    ["video", "video/mp4", "mp4"]
  ] as const)(
    "adds a trusted MIME extension for WhatsApp %s media without filenames",
    async (kind, mimeType, extension) => {
      const fetchImpl = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/file",
          mime_type: mimeType,
          file_size: "4"
        }), { status: 200, headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(
          new Uint8Array([1, 2, 3, 4]),
          { status: 200, headers: { "content-type": mimeType } }
        ));

      await expect(resolver(fetchImpl).resolve(event, {
        kind,
        source: { kind: "provider", value: "media-1" }
      })).resolves.toMatchObject({
        filename: "file." + extension,
        mimeType
      });
    }
  );

  it("classifies provider throttling and server failures as retryable", async () => {
    const throttled = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
    await expect(resolver(throttled).resolve(event, imagePart))
      .rejects.toMatchObject({ retryable: true });

    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(resolver(unavailable).resolve(event, imagePart))
      .rejects.toMatchObject({ retryable: true });
  });
});
