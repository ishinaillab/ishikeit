import { describe, expect, it, vi } from "vitest";
import {
  TikTokOAuthClient,
  TikTokOAuthRequestError,
  TikTokOAuthService,
  type TikTokOAuthClientLike
} from "../src/auth/tiktok-oauth.js";
import { MemoryOAuthStore } from "./support/memory-oauth-store.js";

function bodyAsJson(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("expected JSON request body");
  return JSON.parse(body) as Record<string, unknown>;
}

describe("TikTokOAuthClient", () => {
  it("exchanges an authorization code using the documented tt_user endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 86400,
        refresh_token_expires_in: 31536000,
        open_id: "business-1",
        scope: ["business.messaging"]
      }
    }), { status: 200 }));

    const client = new TikTokOAuthClient({
      appId: "app-1",
      appSecret: "secret-secret-secret",
      fetchImpl
    });
    const result = await client.exchangeAuthorizationCode(
      "auth-code-123",
      "https://apps.example.test/callback/"
    );

    expect(result).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      accessExpiresInSeconds: 86400,
      refreshExpiresInSeconds: 31536000,
      openId: "business-1",
      scopes: ["business.messaging"]
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/"
    );
    expect(bodyAsJson(init?.body)).toEqual({
      grant_type: "authorization_code",
      auth_code: "auth-code-123",
      client_secret: "secret-secret-secret",
      client_id: "app-1",
      redirect_uri: "https://apps.example.test/callback/"
    });
  });

  it("classifies transient and permanent provider OAuth failures", async () => {
    const transient = new TikTokOAuthClient({
      appId: "app-1",
      appSecret: "secret-secret-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 51065,
        message: "system error"
      }), { status: 503 }))
    });
    const transientResult = transient.refresh("refresh-1");
    await expect(transientResult).rejects.toBeInstanceOf(TikTokOAuthRequestError);
    await expect(transientResult).rejects.toMatchObject({
      retryable: true,
      status: 503,
      providerCode: "51065"
    });

    const permanent = new TikTokOAuthClient({
      appId: "app-1",
      appSecret: "secret-secret-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 40001,
        message: "no permission"
      }), { status: 200 }))
    });
    const permanentResult = permanent.refresh("refresh-1");
    await expect(permanentResult).rejects.toBeInstanceOf(TikTokOAuthRequestError);
    await expect(permanentResult).rejects.toMatchObject({
      retryable: false,
      providerCode: "40001"
    });
  });

  it("refreshes through the documented refresh endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        access_token: "access-2",
        refresh_token: "refresh-2",
        expires_in: 86400,
        refresh_token_expires_in: 31536000
      }
    }), { status: 200 }));
    const client = new TikTokOAuthClient({
      appId: "app-1",
      appSecret: "secret-secret-secret",
      fetchImpl
    });

    await client.refresh("refresh-1");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/refresh_token/"
    );
    expect(bodyAsJson(fetchImpl.mock.calls[0]?.[1]?.body)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-1"
    });
  });
});

describe("TikTokOAuthService", () => {
  it("creates one-time state and stores tokens without exposing them in the result", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date();
    const client: TikTokOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        accessExpiresInSeconds: 86400,
        refreshExpiresInSeconds: 31536000,
        openId: "business-1",
        scopes: ["business.messaging"]
      }),
      refresh: vi.fn()
    };
    const service = new TikTokOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app=1",
      redirectUri: "https://apps.example.test/ishikeit/oauth/tiktok/callback/",
      store,
      client,
      stateTtlSeconds: 600,
      now: () => now
    });

    const start = await service.beginAuthorization();
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(start.authorizationUrl).not.toContain("access-secret");

    const result = await service.completeAuthorization(state!, "auth-code-123");
    expect(result).toMatchObject({
      businessId: "business-1",
      scopes: ["business.messaging"]
    });
    expect(JSON.stringify(result)).not.toContain("access-secret");
    expect(JSON.stringify(result)).not.toContain("refresh-secret");

    const stored = await store.get("tiktok", "business-1");
    expect(stored).toMatchObject({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      tokenVersion: 1
    });

    await expect(service.completeAuthorization(state!, "auth-code-123"))
      .rejects.toThrow(/already consumed|invalid|expired/i);
  });

  it("rejects an initial authorization response without a refresh token", async () => {
    const store = new MemoryOAuthStore();
    const client: TikTokOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "access-only",
        accessExpiresInSeconds: 86400,
        openId: "business-1",
        scopes: ["business.messaging"]
      }),
      refresh: vi.fn()
    };
    const service = new TikTokOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app=1",
      redirectUri: "https://apps.example.test/ishikeit/oauth/tiktok/callback/",
      store,
      client
    });

    const start = await service.beginAuthorization();
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    await expect(service.completeAuthorization(state!, "auth-code-123"))
      .rejects.toThrow(/refresh token/i);
    await expect(store.get("tiktok", "business-1")).resolves.toBeUndefined();
  });
});
