import { describe, expect, it } from "vitest";
import {
  normalizeTikTokBusinessWebhook,
  tiktokBusinessIngressIdentity
} from "../src/channels/tiktok-normalizer.js";

function envelope(message: Record<string, unknown>, event = "im_receive_msg") {
  return {
    event,
    client_key: "app-123",
    user_openid: "business-1",
    create_time: 1790000000,
    content: JSON.stringify(message)
  };
}

describe("TikTok Business Messaging normalizer", () => {
  it("normalizes inbound text into a canonical conversation event", () => {
    const [event] = normalizeTikTokBusinessWebhook(envelope({
      conversation_id: "conv-1",
      message_id: "msg-1",
      timestamp: 1790000000123,
      type: "text",
      text: { body: "hello TikTok" }
    }), "app-123", "business-1", "2026-10-02T00:00:00.000Z");

    expect(event).toMatchObject({
      provider: "tiktok",
      channel: "business",
      capability: "messaging",
      accountId: "business-1",
      eventType: "message.received",
      providerMessageId: "msg-1",
      identityId: "conv-1",
      content: [{ kind: "text", text: "hello TikTok" }]
    });
  });

  it("maps inbound image and video media IDs to portable provider media", () => {
    const [image] = normalizeTikTokBusinessWebhook(envelope({
      conversation_id: "conv-1",
      message_id: "msg-image",
      type: "image",
      image: { media_id: "media-image" }
    }), "app-123", "business-1");
    const [video] = normalizeTikTokBusinessWebhook(envelope({
      conversation_id: "conv-1",
      message_id: "msg-video",
      type: "video",
      video: { media_id: "media-video" }
    }), "app-123", "business-1");

    expect(image?.content).toEqual([{
      kind: "image",
      source: { kind: "provider", value: "media-image" }
    }]);
    expect(video?.content).toEqual([{
      kind: "video",
      source: { kind: "provider", value: "media-video" }
    }]);
  });

  it("keeps send echoes out of the customer-message handler route", () => {
    const [event] = normalizeTikTokBusinessWebhook(envelope({
      conversation_id: "conv-1",
      message_id: "msg-2",
      type: "text",
      text: { body: "outbound echo" }
    }, "im_send_msg"), "app-123", "business-1");

    expect(event).toMatchObject({
      eventType: "message.sent",
      identityId: "conv-1",
      content: []
    });
  });

  it("keeps privacy-reduced EU receive events out of the conversational route", () => {
    const [event] = normalizeTikTokBusinessWebhook({
      event: "im_receive_msg_eu",
      client_key: "app-123",
      user_openid: "business-1",
      create_time: 1790000000,
      content: JSON.stringify({
        to_user: { role: "business_account", id: "business-1" },
        timestamp: 1790000000123
      })
    }, "app-123", "business-1");

    expect(event).toMatchObject({
      provider: "tiktok",
      eventType: "event.im.receive.msg.eu",
      content: []
    });
    expect(event?.identityId).toBeUndefined();
  });

  it("uses stable message deduplication and per-conversation partitioning", () => {
    const [first] = normalizeTikTokBusinessWebhook(envelope({
      conversation_id: "conv-1",
      message_id: "msg-3",
      type: "text",
      text: { body: "a" }
    }), "app-123", "business-1");
    const [second] = normalizeTikTokBusinessWebhook(envelope({
      conversation_id: "conv-1",
      message_id: "msg-4",
      type: "text",
      text: { body: "b" }
    }), "app-123", "business-1");

    const firstIdentity = tiktokBusinessIngressIdentity(first!);
    const secondIdentity = tiktokBusinessIngressIdentity(second!);
    expect(firstIdentity.deduplicationKey).not.toBe(secondIdentity.deduplicationKey);
    expect(firstIdentity.partitionKey).toBe(secondIdentity.partitionKey);
    expect(firstIdentity.partitionKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a webhook for a different configured Business Account", () => {
    expect(() => normalizeTikTokBusinessWebhook({
      event: "im_receive_msg",
      client_key: "app-123",
      user_openid: "business-other",
      create_time: 1790000000,
      content: JSON.stringify({
        conversation_id: "conv-1",
        message_id: "msg-business",
        type: "text",
        text: { body: "hello" }
      })
    }, "app-123", "business-1")).toThrow(/Business Account/i);
  });

  it("rejects a webhook for a different configured app", () => {
    expect(() => normalizeTikTokBusinessWebhook(
      envelope({
        conversation_id: "conv-1",
        message_id: "msg-5",
        type: "text",
        text: { body: "hello" }
      }),
      "different-app",
      "business-1"
    )).toThrow(/app identity/i);
  });
});
