import { describe, expect, it, vi } from "vitest";
import { TelegramMediaResolver } from "../src/media/telegram.js";
import type { CanonicalEvent } from "../src/domain/events.js";

const token = "123456789:abcdefghijklmnopqrstuvwxyzABCDE";
const event: CanonicalEvent = {
  schemaVersion: 2,
  specversion: "1.0",
  id: "update:1",
  source: "urn:ishikeit:source:telegram:bot:123456789",
  type: "com.ishikeit.messaging.message.received",
  provider: "telegram",
  channel: "bot",
  capability: "messaging",
  accountId: "123456789",
  eventType: "message.received",
  providerEventId: "update:1",
  providerMessageId: "10",
  identityId: "7001",
  receivedAt: "2026-10-01T00:00:00.000Z",
  content: [],
  data: {}
};

describe("TelegramMediaResolver", () => {
  it("resolves file_id through getFile and downloads bounded bytes", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: { file_id: "f1", file_path: "documents/reference.pdf", file_size: 4 }
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": "4" }
      }));

    const resolver = new TelegramMediaResolver({
      botToken: token,
      maxBytes: 1024,
      fetchImpl
    });

    const resolved = await resolver.resolve(event, {
      kind: "document",
      source: { kind: "provider", value: "f1" },
      filename: "reference.pdf",
      mimeType: "application/pdf"
    });

    expect(resolved.filename).toBe("reference.pdf");
    expect(resolved.mimeType).toBe("application/pdf");
    expect([...resolved.bytes]).toEqual([1, 2, 3, 4]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/getFile");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("/file/bot");
  });

  it("rejects media above the configured ceiling before provider I/O", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const resolver = new TelegramMediaResolver({
      botToken: token,
      maxBytes: 100,
      fetchImpl
    });

    await expect(resolver.resolve(event, {
      kind: "video",
      source: { kind: "provider", value: "f2" },
      sizeBytes: 101
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies getFile server errors as retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ ok: false, error_code: 500, description: "server error" }),
      { status: 500, headers: { "content-type": "application/json" } }
    ));
    const resolver = new TelegramMediaResolver({
      botToken: token,
      maxBytes: 1024,
      fetchImpl
    });

    await expect(resolver.resolve(event, {
      kind: "audio",
      source: { kind: "provider", value: "f3" }
    })).rejects.toMatchObject({ retryable: true });
  });
});
