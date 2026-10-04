import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { BrainClient } from "../src/brain/types.js";
import { normalizeTikTokBusinessWebhook, tiktokBusinessIngressIdentity } from "../src/channels/tiktok-normalizer.js";
import { TikTokBusinessSender } from "../src/channels/tiktok-send.js";
import { buildServer } from "../src/http/server.js";
import {
  TikTokBusinessCommentToMessageClient,
  TikTokBusinessCommentToMessageService
} from "../src/messaging/tiktok-comment-to-message.js";
import type { InboundStore, StoredInboundEvent } from "../src/persistence/inbound.js";
import { TikTokHighIntentCommentHandler } from "../src/processing/tiktok-comment-to-message-handler.js";

function highIntentEnvelope(commentId = "comment-1", uniqueIdentifier = "user-stable-1") {
  return {
    event: "im_receive_high_intent_comment",
    client_key: "app-123",
    user_openid: "business-1",
    create_time: 1791075600,
    content: JSON.stringify({
      from: "personal-1",
      to: "business-1",
      timestamp: 1791075600123,
      unique_identifier: uniqueIdentifier,
      from_user: { role: "personal_account", id: "personal-1" },
      to_user: { role: "business_account", id: "business-1" },
      comment_id: commentId,
      comment_text: "How much is this?",
      is_follower: true
    })
  };
}

describe("TikTok Comment-to-Message", () => {
  it("normalizes a high-intent comment as an actionable messaging event", () => {
    const [event] = normalizeTikTokBusinessWebhook(
      highIntentEnvelope(),
      "app-123",
      "business-1",
      "2026-10-04T01:00:00.000Z"
    );

    expect(event).toMatchObject({
      provider: "tiktok",
      channel: "business",
      capability: "messaging",
      accountId: "business-1",
      eventType: "comment.high_intent.received",
      providerEventId: "comment:comment-1",
      identityId: "user-stable-1",
      content: [{ kind: "text", text: "How much is this?" }],
      data: {
        commentId: "comment-1",
        isFollower: true
      }
    });
  });

  it("partitions multiple high-intent comments from the same user together", () => {
    const [first] = normalizeTikTokBusinessWebhook(
      highIntentEnvelope("comment-1", "user-stable-1"),
      "app-123",
      "business-1"
    );
    const [second] = normalizeTikTokBusinessWebhook(
      highIntentEnvelope("comment-2", "user-stable-1"),
      "app-123",
      "business-1"
    );

    const firstIdentity = tiktokBusinessIngressIdentity(first!);
    const secondIdentity = tiktokBusinessIngressIdentity(second!);
    expect(firstIdentity.deduplicationKey).not.toBe(secondIdentity.deduplicationKey);
    expect(firstIdentity.partitionKey).toBe(secondIdentity.partitionKey);
  });

  it("reads and updates the provider Comment-to-Message setting", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          business_id: "business-1",
          direct_reply_type: "COMMENT_TO_MESSAGE",
          operation_status: "DISABLE"
        }
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        message: "OK",
        data: {}
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          business_id: "business-1",
          direct_reply_type: "COMMENT_TO_MESSAGE",
          operation_status: "ENABLE"
        }
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const client = new TikTokBusinessCommentToMessageClient({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });

    await expect(client.getStatus()).resolves.toEqual({
      businessId: "business-1",
      enabled: false
    });
    await expect(client.setEnabled(true)).resolves.toEqual({
      businessId: "business-1",
      enabled: true
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const getUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(getUrl.pathname).toBe("/open_api/v1.3/business/message/direct_reply/get/");
    expect(getUrl.searchParams.get("business_id")).toBe("business-1");
    expect(getUrl.searchParams.get("direct_reply_type")).toBe("COMMENT_TO_MESSAGE");

    const updateInit = fetchImpl.mock.calls[1]?.[1];
    expect(updateInit?.method).toBe("POST");
    expect(JSON.parse(String(updateInit?.body))).toEqual({
      business_id: "business-1",
      direct_reply_type: "COMMENT_TO_MESSAGE",
      operation_status: "ENABLE"
    });
  });

  it("reconciles Comment-to-Message desired state and verifies provider read-back", async () => {
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ businessId: "business-1", enabled: false })
      .mockResolvedValueOnce({ businessId: "business-1", enabled: true });
    const setEnabled = vi.fn().mockResolvedValue({ businessId: "business-1", enabled: true });
    const service = new TikTokBusinessCommentToMessageService({
      expectedEnabled: true,
      client: { getStatus, setEnabled }
    });

    await expect(service.reconcile()).resolves.toEqual({
      businessId: "business-1",
      enabled: true,
      expectedEnabled: true,
      matchesExpected: true,
      changed: true
    });
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it("sends a high-intent comment reply through TikTok direct_reply without a conversation recipient", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        code: 0,
        message: "OK",
        data: { message: { message_id: "reply-message-1" } }
      }), { status: 200, headers: { "content-type": "application/json" } })
    );
    const sender = new TikTokBusinessSender({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });

    await expect(sender.sendCommentReply(
      "comment-1",
      { kind: "text", text: "Our structured manicure starts at ₱899." }
    )).resolves.toEqual({ providerMessageId: "reply-message-1" });

    const init = fetchImpl.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body));
    expect(payload).toEqual({
      business_id: "business-1",
      message_type: "TEXT",
      text: { body: "Our structured manicure starts at ₱899." },
      direct_reply: {
        reply_type: "COMMENT_REPLY",
        comment_reply: { comment_id: "comment-1" }
      }
    });
    expect(payload).not.toHaveProperty("recipient");
    expect(payload).not.toHaveProperty("recipient_type");
  });

  it("turns a high-intent comment into a distinct ordered direct-reply action", async () => {
    const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
      handoff: false,
      parts: [{ kind: "text", text: "Yes — we can help with that." }]
    });
    const handler = new TikTokHighIntentCommentHandler({ respond });
    const [event] = normalizeTikTokBusinessWebhook(
      highIntentEnvelope(),
      "app-123",
      "business-1",
      "2026-10-04T01:00:00.000Z"
    );
    const stored: StoredInboundEvent = {
      id: "11111111-1111-4111-8111-111111111111",
      partitionKey: "partition-1",
      status: "persisted",
      event: event!
    };

    const result = await handler.handle(stored);
    expect(result.outcome).toBe("handled");
    expect(result.actions).toEqual([expect.objectContaining({
      provider: "tiktok",
      capability: "messaging",
      operation: "comment_to_message.reply",
      orderingKey: "partition-1",
      target: {
        channel: "business",
        accountId: "business-1",
        commentId: "comment-1"
      },
      body: { part: { kind: "text", text: "Yes — we can help with that." } }
    })]);
  });

  it("exposes protected Comment-to-Message status and reconcile routes", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);
    const status = vi.fn().mockResolvedValue({
      businessId: "business-1",
      enabled: false,
      expectedEnabled: true,
      matchesExpected: false
    });
    const reconcile = vi.fn().mockResolvedValue({
      businessId: "business-1",
      enabled: true,
      expectedEnabled: true,
      matchesExpected: true,
      changed: true
    });

    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokCommentToMessage: {
        service: { status, reconcile }
      }
    });

    const unauthorized = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/comment-to-message/status"
    });
    expect(unauthorized.statusCode).toBe(401);

    const read = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/comment-to-message/status",
      headers: { authorization: "Bearer " + token }
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({
      businessId: "business-1",
      enabled: false,
      expectedEnabled: true,
      matchesExpected: false
    });

    const changed = await server.inject({
      method: "POST",
      url: "/ops/tiktok/messaging/comment-to-message/reconcile",
      headers: { authorization: "Bearer " + token }
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ changed: true, matchesExpected: true });

    await server.close();
  });
});
