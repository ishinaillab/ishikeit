import { describe, expect, it, vi } from "vitest";
import { TelegramMessagingAdapter } from "../src/adapters/telegram/messaging.js";
import { TelegramSender } from "../src/channels/telegram-send.js";

const token = "123456789:abcdefghijklmnopqrstuvwxyzABCDE";

describe("TelegramMessagingAdapter", () => {
  it("dispatches the generic message.send action through the configured bot", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, result: { message_id: 77 } }),
      { status: 200 }
    ));
    const adapter = new TelegramMessagingAdapter(new TelegramSender({ botToken: token, fetchImpl }));

    await expect(adapter.execute({
      schemaVersion: 1,
      idempotencyKey: "event-1:reply:0",
      provider: "telegram",
      capability: "messaging",
      operation: "message.send",
      orderingKey: "partition-1",
      target: { channel: "bot", accountId: "123456789", recipientId: "7001" },
      body: { part: { kind: "text", text: "hello" } }
    })).resolves.toEqual({ providerResourceId: "77" });
  });

  it("rejects actions targeting a different Telegram bot account", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new TelegramMessagingAdapter(new TelegramSender({ botToken: token, fetchImpl }));

    await expect(adapter.execute({
      schemaVersion: 1,
      idempotencyKey: "event-2:reply:0",
      provider: "telegram",
      capability: "messaging",
      operation: "message.send",
      orderingKey: "partition-1",
      target: { channel: "bot", accountId: "999", recipientId: "7001" },
      body: { part: { kind: "text", text: "hello" } }
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
