import pino from "pino";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import { TikTokMarketingOAuthNotAuthorizedError } from "../src/auth/tiktok-marketing-oauth.js";
import {
  TikTokBusinessMessagingNotAuthorizedError,
  TikTokBusinessMessagingReadError,
  TikTokBusinessMessagingValidationError
} from "../src/messaging/tiktok-business-read.js";
import { TikTokBusinessWebhookRequestError } from "../src/messaging/tiktok-webhook-config.js";
import type { InboundStore } from "../src/persistence/inbound.js";

function makeServer(store: InboundStore, webhookBodyLimit?: number) {
  return buildServer({
    logger: pino({ level: "silent" }),
    ready: () => Promise.resolve(true),
    inbound: store,
    appSecret: "secret",
    verifyToken: "verify-token-1234",
    ...(webhookBodyLimit === undefined ? {} : { webhookBodyLimit })
  });
}

function signedHeaders(raw: string) {
  return {
    "content-type": "application/json",
    "x-hub-signature-256": "sha256=" + createHmac("sha256", "secret").update(raw).digest("hex")
  };
}

function metaSignedRequest(userId: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({
    algorithm: "HMAC-SHA256",
    issued_at: 1790928000,
    user_id: userId
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return signature + "." + payload;
}

function tiktokSignedHeaders(raw: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret)
    .update(String(timestamp) + "." + raw)
    .digest("hex");
  return {
    "content-type": "application/json",
    "tiktok-signature": `t=${timestamp},s=${signature}`
  };
}

describe("webhook routes", () => {
  it("exposes runtime contract metadata without secrets", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const server = makeServer({ ingest });

    const res = await server.inject({
      method: "GET",
      url: "/health/capabilities"
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      service: "ishikeit",
      architecture: "event-action-v1",
      canonicalEventSchema: 2,
      actionSchema: 1,
      operationalMetricsSchema: 2,
      wordpressBridgeApiSchema: 3,
      wordpressBridgeStorageSchema: "1.1.1",
      tiktokMarketingOAuthSchema: 2,
      tiktokMarketingAdvertiserSchema: 2,
      tiktokBusinessMessagingReadSchema: 1,
      tiktokBusinessMessagingWebhookSchema: 1,
      tiktokBusinessMessagingImageSendSchema: 2,
      runtime: {
        processorEnabled: false,
        actionDispatchEnabled: false,
        processorCutoverAt: null,
        processorCanaryPartitionCount: 0,
        videoInterpreterProvider: "none"
      }
    });
    await server.close();
  });


  it("exposes configured runtime gates without secrets", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      runtimeState: {
        processorEnabled: true,
        actionDispatchEnabled: true,
        processorCutoverAt: "2026-09-30T09:30:00.000Z",
        processorCanaryPartitionCount: 1,
        videoInterpreterProvider: "gemini"
      }
    });

    const res = await server.inject({
      method: "GET",
      url: "/health/capabilities"
    });

    const body = res.json<{
      runtime: {
        processorEnabled: boolean;
        actionDispatchEnabled: boolean;
        processorCutoverAt: string | null;
        processorCanaryPartitionCount: number;
        videoInterpreterProvider: "none" | "gemini";
      };
    }>();
    expect(body.runtime).toEqual({
      processorEnabled: true,
      actionDispatchEnabled: true,
      processorCutoverAt: "2026-09-30T09:30:00.000Z",
      processorCanaryPartitionCount: 1,
      videoInterpreterProvider: "gemini"
    });
    expect(res.body).not.toContain("secret");
    await server.close();
  });

  it("protects operational metrics and bounds the requested window", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const snapshot = vi.fn().mockResolvedValue({
      generatedAt: "2026-09-30T00:00:00.000Z",
      windowMinutes: 15,
      inbound: {
        received: 1,
        processed: 1,
        failedCurrent: 0,
        outcomes: {
          handled: 1,
          handoff: 0,
          ignored: 0,
          rolloutSkipped: 0,
          unknown: 0
        },
        processingLatencyMs: { p50: 100, p95: 100, max: 100 }
      },
      handoffs: { total: 0, byReason: [] },
      queue: [],
      attempts: { published: 1, retries: 0, deadLetters: 0, byRoute: [] }
    });
    const token = "o".repeat(32);
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      metrics: { snapshot },
      opsMetricsToken: token
    });

    const unauthorized = await server.inject({ method: "GET", url: "/ops/metrics" });
    expect(unauthorized.statusCode).toBe(401);
    expect(snapshot).not.toHaveBeenCalled();

    const invalid = await server.inject({
      method: "GET",
      url: "/ops/metrics?window=2",
      headers: { authorization: "Bearer " + token }
    });
    expect(invalid.statusCode).toBe(400);

    const ok = await server.inject({
      method: "GET",
      url: "/ops/metrics?window=15",
      headers: { authorization: "Bearer " + token }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("private, no-store");
    expect(snapshot).toHaveBeenCalledWith(15);
    expect(ok.json()).toMatchObject({ windowMinutes: 15 });

    await server.close();
  });

  it("protects TikTok OAuth operations and accepts a state-validated callback", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const beginAuthorization = vi.fn().mockResolvedValue({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?state=opaque",
      expiresAt: "2026-10-02T02:10:00.000Z"
    });
    const status = vi.fn().mockResolvedValue({
      authorized: true,
      businessId: "business-1",
      accessExpiresAt: "2026-10-03T00:00:00.000Z",
      refreshAvailable: true
    });
    const completeAuthorization = vi.fn().mockResolvedValue({
      businessId: "business-1",
      scopes: ["business.messaging"],
      accessExpiresAt: "2026-10-03T00:00:00.000Z",
      refreshExpiresAt: "2027-10-02T00:00:00.000Z"
    });
    const token = "o".repeat(32);
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokOAuth: {
        service: { beginAuthorization, status, completeAuthorization },
        configuredBusinessId: "business-1"
      }
    });

    const unauthorized = await server.inject({
      method: "POST",
      url: "/ops/tiktok/oauth/start"
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(beginAuthorization).not.toHaveBeenCalled();

    const started = await server.inject({
      method: "POST",
      url: "/ops/tiktok/oauth/start",
      headers: { authorization: "Bearer " + token }
    });
    expect(started.statusCode).toBe(200);
    expect(started.headers["cache-control"]).toBe("private, no-store");
    const startedBody = started.json<{
      status: string;
      authorizationUrl: string;
    }>();
    expect(startedBody.status).toBe("authorization_required");
    expect(startedBody.authorizationUrl).toContain("tiktok.com");

    const statusResult = await server.inject({
      method: "GET",
      url: "/ops/tiktok/oauth/status",
      headers: { authorization: "Bearer " + token }
    });
    expect(statusResult.statusCode).toBe(200);
    expect(status).toHaveBeenCalledWith("business-1");
    expect(statusResult.body).not.toContain("token");

    const callback = await server.inject({
      method: "GET",
      url: "/ishikeit/oauth/tiktok/callback/?state=opaque_state_1234567890&auth_code=auth-code-123"
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.body).toContain("business-1");
    expect(callback.body).not.toContain("access");
    expect(completeAuthorization).toHaveBeenCalledWith(
      "opaque_state_1234567890",
      "auth-code-123"
    );

    await server.close();
  });




  it("gates TikTok Business Messaging webhook operations and requires operational bearer auth", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const absent = makeServer({ ingest });
    const absentStatus = await absent.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/webhook/status"
    });
    const absentReconcile = await absent.inject({
      method: "POST",
      url: "/ops/tiktok/messaging/webhook/reconcile"
    });
    expect(absentStatus.statusCode).toBe(404);
    expect(absentReconcile.statusCode).toBe(404);
    await absent.close();

    expect(() => buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      tiktokBusinessMessagingWebhook: {
        service: {
          status: vi.fn(),
          reconcile: vi.fn()
        }
      }
    })).toThrow(/TikTok Business Messaging webhook operations require an operational bearer token/i);
  });

  it("serves protected TikTok Business Messaging webhook status and reconcile", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);
    const callbackUrl =
      "https://apps.ishinaillab.com/ishikeit/webhooks/tiktok";
    const status = vi.fn().mockResolvedValue({
      configured: true,
      matchesExpected: false,
      expectedCallbackUrl: callbackUrl,
      callbackUrl: "https://old.example/webhook"
    });
    const reconcile = vi.fn().mockResolvedValue({
      changed: true,
      configured: true,
      matchesExpected: true,
      expectedCallbackUrl: callbackUrl,
      callbackUrl
    });
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokBusinessMessagingWebhook: {
        service: { status, reconcile }
      }
    });

    const unauthorized = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/webhook/status"
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toContain("Bearer");
    expect(status).not.toHaveBeenCalled();

    const current = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/webhook/status",
      headers: { authorization: "Bearer " + token }
    });
    expect(current.statusCode).toBe(200);
    expect(current.headers["cache-control"]).toBe("private, no-store");
    expect(current.json()).toEqual({
      configured: true,
      matchesExpected: false,
      expectedCallbackUrl: callbackUrl,
      callbackUrl: "https://old.example/webhook"
    });
    expect(current.body).not.toContain("secret");

    const reconciled = await server.inject({
      method: "POST",
      url: "/ops/tiktok/messaging/webhook/reconcile",
      headers: { authorization: "Bearer " + token }
    });
    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.headers["cache-control"]).toBe("private, no-store");
    expect(reconciled.json()).toEqual({
      changed: true,
      configured: true,
      matchesExpected: true,
      expectedCallbackUrl: callbackUrl,
      callbackUrl
    });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconciled.body).not.toContain("secret");

    await server.close();
  });

  it("maps TikTok Business Messaging webhook provider failures without exposing provider data", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);
    const providerError = new TikTokBusinessWebhookRequestError(
      "provider echoed super-secret-value",
      {
        retryable: true,
        stage: "webhook_get",
        status: 503,
        providerCode: "51065"
      }
    );
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokBusinessMessagingWebhook: {
        service: {
          status: vi.fn().mockRejectedValue(providerError),
          reconcile: vi.fn().mockRejectedValue(providerError)
        }
      }
    });
    const headers = { authorization: "Bearer " + token };

    const statusResult = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/webhook/status",
      headers
    });
    expect(statusResult.statusCode).toBe(503);
    expect(statusResult.json()).toEqual({
      status: "webhook_configuration_unavailable"
    });
    expect(statusResult.body).not.toContain("super-secret-value");

    const reconcileResult = await server.inject({
      method: "POST",
      url: "/ops/tiktok/messaging/webhook/reconcile",
      headers
    });
    expect(reconcileResult.statusCode).toBe(503);
    expect(reconcileResult.json()).toEqual({
      status: "webhook_reconcile_unavailable"
    });
    expect(reconcileResult.body).not.toContain("super-secret-value");

    await server.close();
  });

  it("gates TikTok Business Messaging read routes and requires operational bearer auth", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const absent = makeServer({ ingest });
    const absentCapability = await absent.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/capabilities?conversation_id=conv-1&conversation_type=SINGLE"
    });
    const absentConversations = await absent.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/conversations?conversation_type=SINGLE"
    });
    const absentMessages = await absent.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/conversations/conv-1/messages"
    });
    expect(absentCapability.statusCode).toBe(404);
    expect(absentConversations.statusCode).toBe(404);
    expect(absentMessages.statusCode).toBe(404);
    await absent.close();

    expect(() => buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      tiktokBusinessMessagingRead: {
        service: {
          resolveConversationType: vi.fn(),
          checkImageSendCapability: vi.fn(),
          listConversations: vi.fn(),
          listMessages: vi.fn()
        }
      }
    })).toThrow(/TikTok Business Messaging read operations require an operational bearer token/i);
  });

  it("protects and serves TikTok Business Messaging capability, conversation, and message reads", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);
    const checkImageSendCapability = vi.fn().mockResolvedValue({
      conversationId: "conv+1",
      conversationType: "SINGLE",
      imageSend: true
    });
    const listConversations = vi.fn().mockResolvedValue({
      conversations: [
        { conversationId: "conv+1", updatedAtMs: 1791061200123 }
      ],
      hasMore: true,
      cursor: 1791060000000
    });
    const listMessages = vi.fn().mockResolvedValue({
      conversationId: "conv+1",
      messages: [
        {
          messageId: "msg-1",
          conversationId: "conv+1",
          timestampMs: 1791061200123,
          messageType: "TEXT",
          source: "APP",
          fromRole: "PERSONAL_ACCOUNT",
          toRole: "BUSINESS_ACCOUNT",
          text: "Hello"
        }
      ]
    });
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokBusinessMessagingRead: {
        service: {
          checkImageSendCapability,
          listConversations,
          listMessages
        }
      }
    });

    const unauthorized = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/conversations?conversation_type=SINGLE"
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toContain("Bearer");
    expect(listConversations).not.toHaveBeenCalled();

    const capability = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/capabilities?conversation_id=conv%2B1&conversation_type=SINGLE",
      headers: { authorization: "Bearer " + token }
    });
    expect(capability.statusCode).toBe(200);
    expect(capability.headers["cache-control"]).toBe("private, no-store");
    expect(capability.json()).toEqual({
      conversationId: "conv+1",
      conversationType: "SINGLE",
      imageSend: true
    });
    expect(checkImageSendCapability).toHaveBeenCalledWith({
      conversationId: "conv+1",
      conversationType: "SINGLE"
    });

    const conversations = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/conversations?conversation_type=STRANGER&limit=25&cursor=1791050000000",
      headers: { authorization: "Bearer " + token }
    });
    expect(conversations.statusCode).toBe(200);
    expect(conversations.headers["cache-control"]).toBe("private, no-store");
    expect(listConversations).toHaveBeenCalledWith({
      conversationType: "STRANGER",
      limit: 25,
      cursor: 1791050000000
    });

    const messages = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/conversations/conv%2B1/messages",
      headers: { authorization: "Bearer " + token }
    });
    expect(messages.statusCode).toBe(200);
    expect(messages.headers["cache-control"]).toBe("private, no-store");
    expect(listMessages).toHaveBeenCalledWith("conv+1");
    expect(messages.body).not.toContain("profile_image");
    expect(messages.body).not.toContain("access-token");

    await server.close();
  });

  it("validates TikTok Business Messaging read query parameters before provider calls", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);
    const checkImageSendCapability = vi.fn();
    const listConversations = vi.fn();
    const listMessages = vi.fn();
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokBusinessMessagingRead: {
        service: {
          checkImageSendCapability,
          listConversations,
          listMessages
        }
      }
    });
    const headers = { authorization: "Bearer " + token };

    for (const url of [
      "/ops/tiktok/messaging/capabilities?conversation_id=conv-1&conversation_type=GROUP",
      "/ops/tiktok/messaging/capabilities?conversation_type=SINGLE",
      "/ops/tiktok/messaging/conversations",
      "/ops/tiktok/messaging/conversations?conversation_type=SINGLE&limit=0",
      "/ops/tiktok/messaging/conversations?conversation_type=SINGLE&limit=101",
      "/ops/tiktok/messaging/conversations?conversation_type=SINGLE&cursor=-1",
      "/ops/tiktok/messaging/conversations?conversation_type=SINGLE&cursor=1.5"
    ]) {
      const result = await server.inject({ method: "GET", url, headers });
      expect(result.statusCode, url).toBe(400);
      expect(result.json()).toEqual({ status: "invalid_request" });
    }

    expect(checkImageSendCapability).not.toHaveBeenCalled();
    expect(listConversations).not.toHaveBeenCalled();
    expect(listMessages).not.toHaveBeenCalled();
    await server.close();
  });

  it("maps TikTok Business Messaging read authorization, validation, and provider errors safely", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);
    const headers = { authorization: "Bearer " + token };

    for (const [error, expectedStatus, expectedBody] of [
      [
        new TikTokBusinessMessagingNotAuthorizedError(),
        409,
        { status: "not_authorized" }
      ],
      [
        new TikTokBusinessMessagingValidationError("invalid"),
        400,
        { status: "invalid_request" }
      ],
      [
        new TikTokBusinessMessagingReadError(
          "provider echoed private-message-content",
          { retryable: true, stage: "message_list", status: 503 }
        ),
        503,
        { status: "messaging_read_unavailable" }
      ]
    ] as const) {
      const server = buildServer({
        logger: pino({ level: "silent" }),
        ready: () => Promise.resolve(true),
        inbound: { ingest },
        appSecret: "secret",
        verifyToken: "verify-token-1234",
        opsMetricsToken: token,
        tiktokBusinessMessagingRead: {
          service: {
            checkImageSendCapability: vi.fn(),
            listConversations: vi.fn(),
            listMessages: vi.fn().mockRejectedValue(error)
          }
        }
      });

      const result = await server.inject({
        method: "GET",
        url: "/ops/tiktok/messaging/conversations/conv-1/messages",
        headers
      });
      expect(result.statusCode).toBe(expectedStatus);
      expect(result.json()).toEqual(expectedBody);
      expect(result.body).not.toContain("private-message-content");
      await server.close();
    }
  });

  it("gates TikTok Marketing OAuth routes and requires operational bearer auth", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const absent = makeServer({ ingest });
    const absentStart = await absent.inject({
      method: "POST",
      url: "/ops/tiktok/marketing/oauth/start"
    });
    const absentVerify = await absent.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/oauth/verify"
    });
    const absentCallback = await absent.inject({
      method: "GET",
      url: "/ishikeit/oauth/tiktok/advertiser/callback/?state=opaque_state_1234567890&auth_code=auth-code-123"
    });
    expect(absentStart.statusCode).toBe(404);
    expect(absentVerify.statusCode).toBe(404);
    expect(absentCallback.statusCode).toBe(404);
    await absent.close();

    expect(() => buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      tiktokMarketingOAuth: {
        service: {
          beginAuthorization: vi.fn(),
          status: vi.fn(),
          verifyAccess: vi.fn(),
          completeAuthorization: vi.fn()
        }
      }
    })).toThrow(/operational bearer token/i);
  });

  it("protects TikTok Marketing OAuth operations and completes advertiser auth with auth_code", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const beginAuthorization = vi.fn().mockResolvedValue({
      authorizationUrl:
        "https://business-api.tiktok.com/portal/marketing-auth?state=opaque",
      expiresAt: "2026-10-04T02:20:00.000Z"
    });
    const status = vi.fn().mockResolvedValue({
      authorized: true,
      advertiserIds: ["100", "200"]
    });
    const completeAuthorization = vi.fn().mockResolvedValue({
      advertiserIds: ["100", "200"]
    });
    const verifyAccess = vi.fn().mockResolvedValue({
      verified: true,
      inSync: true,
      authorizedAdvertiserIds: ["100", "200"],
      storedAdvertiserIds: ["100", "200"],
      staleStoredAdvertiserIds: [],
      untrackedAuthorizedAdvertiserIds: []
    });
    const token = "o".repeat(32);
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingOAuth: {
        service: { beginAuthorization, status, verifyAccess, completeAuthorization }
      }
    });

    const unauthorized = await server.inject({
      method: "POST",
      url: "/ops/tiktok/marketing/oauth/start"
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toContain("Bearer");
    expect(beginAuthorization).not.toHaveBeenCalled();

    const started = await server.inject({
      method: "POST",
      url: "/ops/tiktok/marketing/oauth/start",
      headers: { authorization: "Bearer " + token }
    });
    expect(started.statusCode).toBe(200);
    expect(started.headers["cache-control"]).toBe("private, no-store");
    expect(started.json()).toMatchObject({
      status: "authorization_required",
      expiresAt: "2026-10-04T02:20:00.000Z"
    });

    const statusResult = await server.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/oauth/status",
      headers: { authorization: "Bearer " + token }
    });
    expect(statusResult.statusCode).toBe(200);
    expect(statusResult.headers["cache-control"]).toBe("private, no-store");
    expect(statusResult.json()).toEqual({
      authorized: true,
      advertiserIds: ["100", "200"]
    });
    expect(statusResult.body).not.toContain("token");
    expect(statusResult.body).not.toContain("secret");

    const verifyUnauthorized = await server.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/oauth/verify"
    });
    expect(verifyUnauthorized.statusCode).toBe(401);
    expect(verifyAccess).not.toHaveBeenCalled();

    const verified = await server.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/oauth/verify",
      headers: { authorization: "Bearer " + token }
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.headers["cache-control"]).toBe("private, no-store");
    expect(verified.json()).toEqual({
      verified: true,
      inSync: true,
      authorizedAdvertiserIds: ["100", "200"],
      storedAdvertiserIds: ["100", "200"],
      staleStoredAdvertiserIds: [],
      untrackedAuthorizedAdvertiserIds: []
    });
    expect(verified.body).not.toContain("token");
    expect(verified.body).not.toContain("secret");
    expect(verified.body).not.toContain("advertiserName");

    const callback = await server.inject({
      method: "GET",
      url: "/ishikeit/oauth/tiktok/advertiser/callback/?state=opaque_state_1234567890&auth_code=authoritative-auth-code&code=wrong-code"
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.headers["cache-control"]).toBe("no-store");
    expect(callback.body).toContain("2 advertiser");
    expect(callback.body).not.toContain("access");
    expect(callback.body).not.toContain("secret");
    expect(completeAuthorization).toHaveBeenCalledWith(
      "opaque_state_1234567890",
      "authoritative-auth-code"
    );

    await server.close();
  });



  it("protects the TikTok Marketing Ad Account Management proof", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const absent = makeServer({ ingest });
    const absentResult = await absent.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/advertisers/verify"
    });
    expect(absentResult.statusCode).toBe(404);
    await absent.close();

    expect(() => buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      tiktokMarketingAdvertisers: {
        service: { verifyAccountManagement: vi.fn(), listAccounts: vi.fn() }
      }
    })).toThrow(/TikTok Marketing advertiser operations require an operational bearer token/i);

    const verifyAccountManagement = vi.fn().mockResolvedValue({
      verified: true,
      storedAdvertiserIds: ["100", "200"],
      verifiedAdvertiserIds: ["100", "200"],
      missingAdvertiserIds: []
    });
    const token = "o".repeat(32);
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingAdvertisers: {
        service: { verifyAccountManagement, listAccounts: vi.fn() }
      }
    });

    const unauthorized = await server.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/advertisers/verify"
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toContain("Bearer");
    expect(verifyAccountManagement).not.toHaveBeenCalled();

    const verified = await server.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/advertisers/verify",
      headers: { authorization: "Bearer " + token }
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.headers["cache-control"]).toBe("private, no-store");
    expect(verified.json()).toEqual({
      verified: true,
      storedAdvertiserIds: ["100", "200"],
      verifiedAdvertiserIds: ["100", "200"],
      missingAdvertiserIds: []
    });
    expect(verified.body).not.toContain("token");
    expect(verified.body).not.toContain("secret");

    await server.close();
  });



  it("lists safe TikTok Marketing advertiser summaries behind operational bearer auth", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);
    const listAccounts = vi.fn().mockResolvedValue({
      accounts: [
        {
          advertiserId: "100",
          name: "Ishi Ads",
          status: "STATUS_ENABLE",
          currency: "PHP",
          timezone: "Asia/Manila",
          country: "PH"
        }
      ]
    });
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingAdvertisers: {
        service: {
          verifyAccountManagement: vi.fn(),
          listAccounts
        }
      }
    });

    const unauthorized = await server.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/advertisers"
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toContain("Bearer");
    expect(listAccounts).not.toHaveBeenCalled();

    const result = await server.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/advertisers",
      headers: { authorization: "Bearer " + token }
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.json()).toEqual({
      accounts: [
        {
          advertiserId: "100",
          name: "Ishi Ads",
          status: "STATUS_ENABLE",
          currency: "PHP",
          timezone: "Asia/Manila",
          country: "PH"
        }
      ]
    });
    expect(result.body).not.toContain("token");
    expect(result.body).not.toContain("secret");
    expect(result.body).not.toContain("email");
    expect(result.body).not.toContain("balance");

    await server.close();
  });

  it("maps advertiser-summary authorization and provider failures safely", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);

    const notAuthorized = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingAdvertisers: {
        service: {
          verifyAccountManagement: vi.fn(),
          listAccounts: vi.fn().mockRejectedValue(
            new TikTokMarketingOAuthNotAuthorizedError()
          )
        }
      }
    });
    const missing = await notAuthorized.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/advertisers",
      headers: { authorization: "Bearer " + token }
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual({ status: "not_authorized" });
    await notAuthorized.close();

    const unavailable = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingAdvertisers: {
        service: {
          verifyAccountManagement: vi.fn(),
          listAccounts: vi.fn().mockRejectedValue(
            new Error("provider echoed private-ad-account-data")
          )
        }
      }
    });
    const failed = await unavailable.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/advertisers",
      headers: { authorization: "Bearer " + token }
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ status: "advertiser_list_unavailable" });
    expect(failed.body).not.toContain("private-ad-account-data");
    await unavailable.close();
  });

  it("distinguishes missing TikTok Marketing authorization from advertiser-provider failure", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);

    const notAuthorized = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingAdvertisers: {
        service: {
          verifyAccountManagement: vi.fn().mockRejectedValue(
            new TikTokMarketingOAuthNotAuthorizedError()
          ),
          listAccounts: vi.fn()
        }
      }
    });
    const missing = await notAuthorized.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/advertisers/verify",
      headers: { authorization: "Bearer " + token }
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual({ status: "not_authorized" });
    await notAuthorized.close();

    const unavailable = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingAdvertisers: {
        service: {
          verifyAccountManagement: vi.fn().mockRejectedValue(
            new Error("provider echoed marketing-access-secret")
          ),
          listAccounts: vi.fn()
        }
      }
    });
    const failed = await unavailable.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/advertisers/verify",
      headers: { authorization: "Bearer " + token }
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({
      status: "advertiser_verification_unavailable"
    });
    expect(failed.body).not.toContain("marketing-access-secret");
    await unavailable.close();
  });

  it("maps TikTok Marketing verification state safely without exposing provider errors", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const token = "o".repeat(32);
    const baseService = {
      beginAuthorization: vi.fn(),
      status: vi.fn(),
      completeAuthorization: vi.fn()
    };

    const notAuthorized = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingOAuth: {
        service: {
          ...baseService,
          verifyAccess: vi.fn().mockRejectedValue(
            new TikTokMarketingOAuthNotAuthorizedError()
          )
        }
      }
    });
    const missing = await notAuthorized.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/oauth/verify",
      headers: { authorization: "Bearer " + token }
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual({ status: "not_authorized" });
    await notAuthorized.close();

    const unavailable = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingOAuth: {
        service: {
          ...baseService,
          verifyAccess: vi.fn().mockRejectedValue(
            new Error("provider echoed marketing-access-secret")
          )
        }
      }
    });
    const failed = await unavailable.inject({
      method: "GET",
      url: "/ops/tiktok/marketing/oauth/verify",
      headers: { authorization: "Bearer " + token }
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ status: "verification_unavailable" });
    expect(failed.body).not.toContain("marketing-access-secret");
    await unavailable.close();
  });

  it("rejects incomplete or failed TikTok Marketing callbacks without exposing provider data", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const completeAuthorization = vi.fn().mockRejectedValue(
      new Error("provider failure access-token-secret auth-code-secret")
    );
    const token = "o".repeat(32);
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: token,
      tiktokMarketingOAuth: {
        service: {
          beginAuthorization: vi.fn(),
          status: vi.fn(),
          verifyAccess: vi.fn(),
          completeAuthorization
        }
      }
    });

    const codeOnly = await server.inject({
      method: "GET",
      url: "/ishikeit/oauth/tiktok/advertiser/callback/?state=opaque_state_1234567890&code=legacy-code"
    });
    expect(codeOnly.statusCode).toBe(400);
    expect(completeAuthorization).not.toHaveBeenCalled();

    const failed = await server.inject({
      method: "GET",
      url: "/ishikeit/oauth/tiktok/advertiser/callback/?state=opaque_state_1234567890&auth_code=auth-code-123"
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.headers["cache-control"]).toBe("no-store");
    expect(failed.body).toBe(
      "TikTok advertiser authorization could not be completed. Start a new authorization request."
    );
    expect(failed.body).not.toContain("access-token-secret");
    expect(failed.body).not.toContain("auth-code-secret");

    await server.close();
  });

  it("exposes the Instagram review login, callback, and protected status without tokens", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const beginAuthorization = vi.fn().mockResolvedValue({
      authorizationUrl:
        "https://www.instagram.com/oauth/authorize?client_id=123&state=opaque",
      expiresAt: "2026-10-02T06:10:00.000Z"
    });
    const completeAuthorization = vi.fn().mockResolvedValue({
      accountId: "17841430000000000",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: "2026-12-01T06:00:00.000Z"
    });
    const status = vi.fn().mockResolvedValue({
      authorized: true,
      accountId: "17841430000000000",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: "2026-12-01T06:00:00.000Z"
    });
    const deauthorize = vi.fn().mockResolvedValue(undefined);
    const requestDeletion = vi.fn().mockResolvedValue({
      confirmationCode: "abcdef0123456789abcdef0123456789",
      statusUrl: "https://apps.example.test/ishikeit/privacy/data-deletion/status/abcdef0123456789abcdef0123456789"
    });
    const deletionStatus = vi.fn().mockResolvedValue({
      status: "completed",
      requestedAt: "2026-10-02T08:00:00.000Z",
      completedAt: "2026-10-02T08:00:01.000Z"
    });
    const opsToken = "o".repeat(32);
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      opsMetricsToken: opsToken,
      instagramOAuth: {
        service: { beginAuthorization, completeAuthorization, status },
        compliance: {
          appSecret: "instagram-secret",
          dataLifecycle: {
            ready: vi.fn().mockResolvedValue(true),
            deauthorize,
            requestDeletion,
            deletionStatus
          },
          statusBaseUrl: "https://apps.example.test"
        }
      }
    });

    const login = await server.inject({
      method: "GET",
      url: "/ishikeit/oauth/instagram/login/"
    });
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toContain("instagram.com/oauth/authorize");
    expect(login.headers["cache-control"]).toBe("no-store");

    const callback = await server.inject({
      method: "GET",
      url: "/ishikeit/oauth/instagram/callback/?state=opaque_state_1234567890&code=auth-code-123"
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.body).toContain("17841430000000000");
    expect(callback.body).not.toContain("token");
    expect(completeAuthorization).toHaveBeenCalledWith(
      "opaque_state_1234567890",
      "auth-code-123"
    );

    const denied = await server.inject({
      method: "GET",
      url: "/ishikeit/oauth/instagram/callback/?state=opaque_state_1234567890&error=access_denied"
    });
    expect(denied.statusCode).toBe(400);

    const unauthorized = await server.inject({
      method: "GET",
      url: "/ops/instagram/oauth/status?account_id=17841430000000000"
    });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await server.inject({
      method: "GET",
      url: "/ops/instagram/oauth/status?account_id=17841430000000000",
      headers: { authorization: "Bearer " + opsToken }
    });
    expect(authorized.statusCode).toBe(200);
    expect(status).toHaveBeenCalledWith("17841430000000000");
    expect(authorized.body).not.toContain("accessToken");

    const signed = metaSignedRequest("17841430000000000", "instagram-secret");
    const form = "signed_request=" + encodeURIComponent(signed);

    const deauthorized = await server.inject({
      method: "POST",
      url: "/ishikeit/oauth/instagram/deauthorize/",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: form
    });
    expect(deauthorized.statusCode).toBe(200);
    expect(deauthorize).toHaveBeenCalledWith("17841430000000000");

    const deletion = await server.inject({
      method: "POST",
      url: "/ishikeit/oauth/instagram/data-deletion/",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: form
    });
    expect(deletion.statusCode).toBe(200);
    expect(deletion.json()).toEqual({
      url: "https://apps.example.test/ishikeit/privacy/data-deletion/status/abcdef0123456789abcdef0123456789",
      confirmation_code: "abcdef0123456789abcdef0123456789"
    });
    expect(requestDeletion).toHaveBeenCalledWith(
      "17841430000000000",
      "https://apps.example.test"
    );

    const deletionPage = await server.inject({
      method: "GET",
      url: "/ishikeit/privacy/data-deletion/status/abcdef0123456789abcdef0123456789"
    });
    expect(deletionPage.statusCode).toBe(200);
    expect(deletionPage.body).toContain("completed");
    expect(deletionPage.headers["cache-control"]).toBe("no-store");

    await server.close();
  });

  it("answers the GET challenge", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);

    const res = await server.inject({
      method: "GET",
      url: "/ishikeit/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token-1234&hub.challenge=abc"
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("abc");
    await server.close();
  });

  it("rejects bad signatures before persistence", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=" + "0".repeat(64)
      },
      payload: '{"object":"page","entry":[]}'
    });

    expect(res.statusCode).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
    await server.close();
  });

  it("rejects signed invalid JSON before persistence", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);
    const raw = '{"object":';

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: signedHeaders(raw),
      payload: raw
    });

    expect(res.statusCode).toBe(422);
    expect(ingest).not.toHaveBeenCalled();
    await server.close();
  });

  it("durably accepts a signed event", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>().mockResolvedValue("created");
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);
    const raw = JSON.stringify({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "user-1" },
          timestamp: 1790000000000,
          message: { mid: "m-1", text: "hello" }
        }]
      }]
    });

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: {
        ...signedHeaders(raw),
        "content-type": "application/json; charset=utf-8"
      },
      payload: raw
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "accepted" });
    expect(ingest).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it("authenticates and durably accepts a Telegram update", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>().mockResolvedValue("created");
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      telegram: {
        botId: "123456789",
        webhookSecret: "t".repeat(32)
      }
    });
    const raw = JSON.stringify({
      update_id: 7001,
      message: {
        message_id: 91,
        date: 1790000000,
        chat: { id: 639123456789, type: "private" },
        from: { id: 639123456789, is_bot: false, first_name: "Test" },
        text: "hello telegram"
      }
    });

    const rejected = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/telegram",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong"
      },
      payload: raw
    });
    expect(rejected.statusCode).toBe(401);
    expect(ingest).not.toHaveBeenCalled();

    const accepted = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/telegram",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "t".repeat(32)
      },
      payload: raw
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ status: "accepted" });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({
      provider: "telegram",
      channel: "bot",
      accountId: "123456789",
      eventType: "message.received",
      identityId: "639123456789"
    });
    await server.close();
  });

  it("authenticates and durably accepts a TikTok Business Messaging webhook", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>().mockResolvedValue("created");
    const clientSecret = "tiktok-client-secret-123456789";
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      tiktok: {
        appId: "app-123",
        clientSecret,
        businessId: "business-1",
        maxSignatureAgeSeconds: 300
      }
    });
    const raw = JSON.stringify({
      event: "im_receive_msg",
      client_key: "app-123",
      user_openid: "business-1",
      create_time: 1790000000,
      content: JSON.stringify({
        conversation_id: "conv-1",
        message_id: "msg-1",
        timestamp: 1790000000123,
        type: "text",
        text: { body: "hello TikTok" }
      })
    });

    const rejected = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/tiktok",
      headers: {
        "content-type": "application/json",
        "tiktok-signature": "t=1,s=" + "0".repeat(64)
      },
      payload: raw
    });
    expect(rejected.statusCode).toBe(401);
    expect(ingest).not.toHaveBeenCalled();

    const otherBusinessRaw = raw.replace(
      '"user_openid":"business-1"',
      '"user_openid":"business-other"'
    );
    const ignored = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/tiktok",
      headers: tiktokSignedHeaders(otherBusinessRaw, clientSecret),
      payload: otherBusinessRaw
    });
    expect(ignored.statusCode).toBe(200);
    expect(ignored.json()).toEqual({ status: "ignored" });
    expect(ingest).not.toHaveBeenCalled();

    const accepted = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/tiktok",
      headers: tiktokSignedHeaders(raw, clientSecret),
      payload: raw
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ status: "accepted" });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({
      provider: "tiktok",
      channel: "business",
      accountId: "business-1",
      eventType: "message.received",
      identityId: "conv-1",
      content: [{ kind: "text", text: "hello TikTok" }]
    });
    await server.close();
  });

  it("does not acknowledge a database failure", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>().mockRejectedValue(new Error("database unavailable"));
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);
    const raw = JSON.stringify({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "user-1" },
          timestamp: 1790000000000,
          message: { mid: "m-2", text: "retry me" }
        }]
      }]
    });

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: signedHeaders(raw),
      payload: raw
    });

    expect(res.statusCode).toBe(500);
    await server.close();
  });

  it("enforces the webhook body limit before processing", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store, 32);
    const raw = JSON.stringify({
      object: "page",
      entry: [{ id: "page-1", messaging: [] }],
      padding: "x".repeat(100)
    });

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: signedHeaders(raw),
      payload: raw
    });

    expect(res.statusCode).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
    await server.close();
  });
});
