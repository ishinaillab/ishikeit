import pino from "pino";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
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

  it("exposes the Instagram review login, callback, and protected status without tokens", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const beginAuthorization = vi.fn().mockResolvedValue({
      authorizationUrl:
        "https://api.instagram.com/oauth/authorize?client_id=123&state=opaque",
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
