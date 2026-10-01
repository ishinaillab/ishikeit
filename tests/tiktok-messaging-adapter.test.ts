import { describe, expect, it, vi } from "vitest";
import { TikTokBusinessMessagingAdapter } from "../src/adapters/tiktok/messaging.js";
import { TikTokBusinessSender } from "../src/channels/tiktok-send.js";

describe("TikTokBusinessMessagingAdapter", () => {
  it("dispatches a generic text message through the configured Business Account", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ code: 0, data: { message: { message_id: "tt-77" } } }),
      { status: 200 }
    ));
    const adapter = new TikTokBusinessMessagingAdapter(new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    }));

    await expect(adapter.execute({
      schemaVersion: 1,
      idempotencyKey: "event-1:reply:0",
      provider: "tiktok",
      capability: "messaging",
      operation: "message.send",
      orderingKey: "partition-1",
      target: { channel: "business", accountId: "business-1", recipientId: "conv-1" },
      body: { part: { kind: "text", text: "hello" } }
    })).resolves.toEqual({ providerResourceId: "tt-77" });
  });

  it("rejects actions targeting a different Business Account", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new TikTokBusinessMessagingAdapter(new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    }));

    await expect(adapter.execute({
      schemaVersion: 1,
      idempotencyKey: "event-2:reply:0",
      provider: "tiktok",
      capability: "messaging",
      operation: "message.send",
      orderingKey: "partition-1",
      target: { channel: "business", accountId: "business-2", recipientId: "conv-1" },
      body: { part: { kind: "text", text: "hello" } }
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
