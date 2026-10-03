import { describe, expect, it, vi } from "vitest";
import { AccessTokenError } from "../src/auth/token-provider.js";
import { TikTokBusinessSender } from "../src/channels/tiktok-send.js";

function bodyAsJson(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("expected JSON body");
  return JSON.parse(body) as Record<string, unknown>;
}

function requestUrl(value: string | URL | Request): string {
  if (typeof value === "string") return value;
  return value instanceof URL ? value.toString() : value.url;
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

  it("downloads, uploads, and sends a JPG image to a conversation", async () => {
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(imageBytes, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(imageBytes.byteLength)
        }
      }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: { media_id: "media-upload-1" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: { message: { message_id: "tt-image-msg-1" } }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ));
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });

    await expect(sender.send("conv-1", {
      kind: "image",
      source: { kind: "url", value: "https://cdn.example.test/nails.jpg" },
      mimeType: "image/jpeg",
      filename: "nails.jpg",
      sizeBytes: imageBytes.byteLength
    })).resolves.toEqual({ providerMessageId: "tt-image-msg-1" });

    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const [downloadUrl, downloadInit] = fetchImpl.mock.calls[0]!;
    expect(requestUrl(downloadUrl)).toBe("https://cdn.example.test/nails.jpg");
    expect(downloadInit?.method).toBe("GET");
    expect(downloadInit?.redirect).toBe("manual");

    const [uploadUrl, uploadInit] = fetchImpl.mock.calls[1]!;
    expect(uploadUrl).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/message/media/upload/"
    );
    expect(uploadInit?.method).toBe("POST");
    expect(new Headers(uploadInit?.headers).get("Access-Token"))
      .toBe("access-token-123456789");
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    const form = uploadInit?.body as FormData;
    expect(form.get("business_id")).toBe("business-1");
    expect(form.get("media_type")).toBe("IMAGE");
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("image/jpeg");
    expect((file as Blob).size).toBe(imageBytes.byteLength);

    const [sendUrl, sendInit] = fetchImpl.mock.calls[2]!;
    expect(sendUrl).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/message/send/"
    );
    expect(bodyAsJson(sendInit?.body)).toEqual({
      business_id: "business-1",
      recipient_type: "CONVERSATION",
      recipient: "conv-1",
      message_type: "IMAGE",
      image: { media_id: "media-upload-1" }
    });
  });

  it("rejects unsupported image sources, captions, and replies before provider I/O", async () => {
    for (const part of [
      {
        kind: "image" as const,
        source: { kind: "provider", value: "provider-media" }
      },
      {
        kind: "image" as const,
        source: { kind: "url", value: "https://cdn.example.test/image.jpg" },
        caption: "TikTok image captions are not supported"
      }
    ]) {
      const fetchImpl = vi.fn<typeof fetch>();
      const sender = new TikTokBusinessSender({
        businessId: "business-1",
        accessToken: "access-token-123456789",
        fetchImpl
      });
      await expect(sender.send("conv-1", part))
        .rejects.toMatchObject({ retryable: false, ambiguous: false });
      expect(fetchImpl).not.toHaveBeenCalled();
    }

    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });
    await expect(sender.send("conv-1", {
      kind: "image",
      source: { kind: "url", value: "https://cdn.example.test/image.jpg" }
    }, "msg-1")).rejects.toMatchObject({
      retryable: false,
      ambiguous: false
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unsafe or oversized image URLs before TikTok upload", async () => {
    for (const part of [
      {
        kind: "image" as const,
        source: { kind: "url", value: "http://cdn.example.test/image.jpg" }
      },
      {
        kind: "image" as const,
        source: { kind: "url", value: "https://127.0.0.1/image.jpg" }
      },
      {
        kind: "image" as const,
        source: { kind: "url", value: "https://cdn.example.test/image.jpg" },
        sizeBytes: 3 * 1024 * 1024 + 1
      },
      {
        kind: "image" as const,
        source: { kind: "url", value: "https://cdn.example.test/image.webp" },
        mimeType: "image/webp"
      }
    ]) {
      const fetchImpl = vi.fn<typeof fetch>();
      const sender = new TikTokBusinessSender({
        businessId: "business-1",
        accessToken: "access-token-123456789",
        fetchImpl
      });
      await expect(sender.send("conv-1", part))
        .rejects.toMatchObject({ retryable: false, ambiguous: false });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("enforces TikTok image MIME and byte limits after download", async () => {
    for (const response of [
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/webp" }
      }),
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(3 * 1024 * 1024 + 1)
        }
      }),
      new Response(new Uint8Array(3 * 1024 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "image/png" }
      })
    ]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
      const sender = new TikTokBusinessSender({
        businessId: "business-1",
        accessToken: "access-token-123456789",
        fetchImpl
      });

      await expect(sender.send("conv-1", {
        kind: "image",
        source: { kind: "url", value: "https://cdn.example.test/image.jpg" }
      })).rejects.toMatchObject({
        retryable: false,
        ambiguous: false
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("classifies image upload transport failure as retryable but not delivery-ambiguous", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" }
      }))
      .mockRejectedValueOnce(new Error("upload socket reset"));
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });

    await expect(sender.send("conv-1", {
      kind: "image",
      source: { kind: "url", value: "https://cdn.example.test/image.png" }
    })).rejects.toMatchObject({
      retryable: true,
      ambiguous: false
    });
  });

  it("continues rejecting unsupported non-image media before provider I/O", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });
    await expect(sender.send("conv-1", {
      kind: "video",
      source: { kind: "url", value: "https://example.test/video.mp4" }
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
