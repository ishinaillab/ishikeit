import { describe, expect, it } from "vitest";
import { normalizeTelegramUpdate, telegramIngressIdentity } from "../src/channels/telegram-normalizer.js";

describe("Telegram normalizer", () => {
  it("normalizes private text messages into canonical messaging events", () => {
    const [event] = normalizeTelegramUpdate({
      update_id: 1001,
      message: {
        message_id: 12,
        date: 1790000000,
        chat: { id: 639123456789, type: "private" },
        from: { id: 639123456789, is_bot: false, first_name: "Test" },
        text: "hello"
      }
    }, "123456789", "2026-10-01T00:00:00.000Z");

    expect(event).toMatchObject({
      provider: "telegram",
      channel: "bot",
      capability: "messaging",
      accountId: "123456789",
      eventType: "message.received",
      providerEventId: "update:1001",
      providerMessageId: "12",
      identityId: "639123456789",
      content: [{ kind: "text", text: "hello" }]
    });
  });

  it("selects the largest Telegram photo and preserves its caption", () => {
    const [event] = normalizeTelegramUpdate({
      update_id: 1002,
      message: {
        message_id: 13,
        date: 1790000000,
        chat: { id: -1001234567890, type: "supergroup" },
        caption: "reference",
        photo: [
          { file_id: "small", width: 90, height: 90, file_size: 1000 },
          { file_id: "large", width: 1280, height: 1280, file_size: 50000 }
        ]
      }
    }, "123456789");

    expect(event?.content).toEqual([{
      kind: "image",
      source: { kind: "provider", value: "large" },
      mimeType: "image/jpeg",
      caption: "reference",
      sizeBytes: 50000
    }]);
  });

  it("keeps edited messages out of the conversational handler route", () => {
    const [event] = normalizeTelegramUpdate({
      update_id: 1003,
      edited_message: {
        message_id: 14,
        date: 1790000000,
        edit_date: 1790000010,
        chat: { id: 5001, type: "private" },
        text: "edited"
      }
    }, "123456789");

    expect(event).toMatchObject({
      eventType: "message.edited",
      identityId: "5001",
      content: []
    });
  });

  it("derives deterministic update deduplication and per-chat partitioning", () => {
    const [first] = normalizeTelegramUpdate({
      update_id: 1004,
      message: { message_id: 15, date: 1790000000, chat: { id: 7001 }, text: "a" }
    }, "123456789");
    const [second] = normalizeTelegramUpdate({
      update_id: 1005,
      message: { message_id: 16, date: 1790000001, chat: { id: 7001 }, text: "b" }
    }, "123456789");

    const firstIdentity = telegramIngressIdentity(first!);
    const secondIdentity = telegramIngressIdentity(second!);
    expect(firstIdentity.deduplicationKey).not.toBe(secondIdentity.deduplicationKey);
    expect(firstIdentity.partitionKey).toBe(secondIdentity.partitionKey);
    expect(firstIdentity.partitionKey).toMatch(/^[0-9a-f]{64}$/);
  });
});
