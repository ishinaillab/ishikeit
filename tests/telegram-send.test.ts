import { describe, expect, it, vi } from "vitest";
import { TelegramSender } from "../src/channels/telegram-send.js";

const token = "123456789:abcdefghijklmnopqrstuvwxyzABCDE";

function bodyAsJson(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("expected JSON request body");
  return JSON.parse(body) as Record<string, unknown>;
}

describe("TelegramSender", () => {
  it("sends text through sendMessage and returns the provider message ID", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, result: { message_id: 42 } }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const sender = new TelegramSender({ botToken: token, fetchImpl });

    await expect(sender.send("7001", { kind: "text", text: "hello" }))
      .resolves.toEqual({ providerMessageId: "42" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot" + token + "/sendMessage");
    expect(bodyAsJson(init?.body)).toEqual({ chat_id: "7001", text: "hello" });
  });

  it("maps portable image media to sendPhoto by HTTPS URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, result: { message_id: 43 } }),
      { status: 200 }
    ));
    const sender = new TelegramSender({ botToken: token, fetchImpl });
    await sender.send("7001", {
      kind: "image",
      source: { kind: "url", value: "https://example.test/photo.jpg" },
      caption: "reference"
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot" + token + "/sendPhoto");
    expect(bodyAsJson(init?.body)).toEqual({
      chat_id: "7001",
      photo: "https://example.test/photo.jpg",
      caption: "reference"
    });
  });

  it("honors Telegram retry_after for throttling", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        ok: false,
        error_code: 429,
        description: "Too Many Requests",
        parameters: { retry_after: 3 }
      }),
      { status: 429, headers: { "content-type": "application/json" } }
    ));
    const sender = new TelegramSender({ botToken: token, fetchImpl });

    await expect(sender.send("7001", { kind: "text", text: "hello" }))
      .rejects.toMatchObject({
        retryable: true,
        ambiguous: false,
        status: 429,
        providerCode: "429",
        retryAfterMs: 3000
      });
  });

  it("marks transport failures as retryable and delivery-ambiguous", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket reset"));
    const sender = new TelegramSender({ botToken: token, fetchImpl });
    await expect(sender.send("7001", { kind: "text", text: "hello" }))
      .rejects.toMatchObject({ retryable: true, ambiguous: true });
  });

  it("rejects non-URL outbound media before network I/O", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new TelegramSender({ botToken: token, fetchImpl });
    await expect(sender.send("7001", {
      kind: "document",
      source: { kind: "provider", value: "file-id" }
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
