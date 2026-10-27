import { describe, expect, it, vi } from "vitest";
import { MetaMessagingAdapter } from "../src/adapters/meta/messaging.js";
import { MetaSender } from "../src/channels/meta-send.js";
import type { ActionEnvelope } from "../src/domain/actions.js";

const action: ActionEnvelope = {
  schemaVersion: 1,
  idempotencyKey: "reply-1",
  provider: "meta",
  capability: "messaging",
  operation: "message.send",
  orderingKey: "conversation-1",
  target: { channel: "whatsapp", accountId: "phone-1", recipientId: "customer-1" },
  body: { part: { kind: "text", text: "Hello" } }
};

describe("MetaMessagingAdapter standard reply policy", () => {
  it("rejects legacy queued actions without a provider timestamp before send", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new MetaSender({ graphApiVersion: "v26.0", whatsappAccessToken: "test-token", instagramGraphHost: "graph.instagram.com", fetchImpl });
    const adapter = new MetaMessagingAdapter(sender);
    await expect(adapter.execute(action)).rejects.toMatchObject({
      retryable: false,
      message: "Meta standard reply is not eligible: missing_timestamp"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects stale customer replies before send", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new MetaSender({ graphApiVersion: "v26.0", whatsappAccessToken: "test-token", instagramGraphHost: "graph.instagram.com", fetchImpl });
    const adapter = new MetaMessagingAdapter(sender);
    await expect(adapter.execute({
      ...action,
      body: { part: { kind: "text", text: "Hello" }, customerMessageAt: "2020-01-01T00:00:00.000Z" }
    })).rejects.toMatchObject({ retryable: false, message: "Meta standard reply is not eligible: outside_window" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
