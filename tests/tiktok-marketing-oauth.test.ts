import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  TikTokMarketingOAuthClient,
  TikTokMarketingOAuthNotAuthorizedError,
  TikTokMarketingOAuthRequestError,
  TikTokMarketingOAuthService,
  type TikTokMarketingOAuthClientLike
} from "../src/auth/tiktok-marketing-oauth.js";

function requestUrl(value: string | URL | Request): string {
  if (typeof value === "string") return value;
  return value instanceof URL ? value.toString() : value.url;
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("expected JSON body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("TikTokMarketingOAuthClient", () => {
  it("exchanges auth_code through the Marketing OAuth endpoint with only documented app fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        access_token: "marketing-access",
        scope: ["advertiser.info"]
      }
    }), { status: 200 }));
    const client = new TikTokMarketingOAuthClient({
      appId: "app-123",
      appSecret: "secret-secret-secret",
      fetchImpl
    });

    await expect(client.exchangeAuthorizationCode("auth-code-123")).resolves.toEqual({
      accessToken: "marketing-access",
      scopes: ["advertiser.info"]
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(requestBody(init)).toEqual({
      app_id: "app-123",
      auth_code: "auth-code-123",
      secret: "secret-secret-secret"
    });
    expect(JSON.stringify(requestBody(init))).not.toContain("redirect_uri");
    expect(JSON.stringify(requestBody(init))).not.toContain("tt_user");
  });

  it("does not invent scopes when the token response omits them", async () => {
    const client = new TikTokMarketingOAuthClient({
      appId: "app-123",
      appSecret: "secret-secret-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        data: { access_token: "marketing-access" }
      }), { status: 200 }))
    });

    await expect(client.exchangeAuthorizationCode("auth-code-123")).resolves.toEqual({
      accessToken: "marketing-access"
    });
  });

  it("rejects a successful response without a usable access token", async () => {
    const client = new TikTokMarketingOAuthClient({
      appId: "app-123",
      appSecret: "secret-secret-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        data: {}
      }), { status: 200 }))
    });

    await expect(client.exchangeAuthorizationCode("auth-code-123"))
      .rejects.toMatchObject({
        retryable: false,
        stage: "token_exchange"
      });
  });

  it("discovers and normalizes authorized advertisers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        list: [
          { advertiser_id: "200", advertiser_name: "Second" },
          { advertiser_id: "100", advertiser_name: "First" },
          { advertiser_id: "200", advertiser_name: "Second duplicate" },
          { advertiser_id: "" },
          {}
        ]
      }
    }), { status: 200 }));
    const client = new TikTokMarketingOAuthClient({
      appId: "app-123",
      appSecret: "secret-secret-secret",
      fetchImpl
    });

    await expect(client.listAuthorizedAdvertisers("marketing-access")).resolves.toEqual([
      { advertiserId: "100", advertiserName: "First" },
      { advertiserId: "200", advertiserName: "Second" }
    ]);

    const [urlValue, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(requestUrl(urlValue));
    expect(url.origin + url.pathname)
      .toBe("https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/");
    expect(url.searchParams.get("app_id")).toBe("app-123");
    expect(url.searchParams.get("secret")).toBe("secret-secret-secret");
    expect(new Headers(init?.headers).get("Access-Token")).toBe("marketing-access");
    expect(init?.method).toBe("GET");
  });

  it("returns an empty advertiser list instead of inventing an account", async () => {
    const client = new TikTokMarketingOAuthClient({
      appId: "app-123",
      appSecret: "secret-secret-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        data: { list: [] }
      }), { status: 200 }))
    });

    await expect(client.listAuthorizedAdvertisers("marketing-access")).resolves.toEqual([]);
  });

  it("classifies retryable transport and provider failures without leaking credentials", async () => {
    const secret = "secret-secret-secret";
    const token = "marketing-access";

    const transport = new TikTokMarketingOAuthClient({
      appId: "app-123",
      appSecret: secret,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("socket closed"))
    });
    const transportResult = transport.exchangeAuthorizationCode("auth-code-123");
    await expect(transportResult).rejects.toBeInstanceOf(TikTokMarketingOAuthRequestError);
    await expect(transportResult).rejects.toMatchObject({
      retryable: true,
      stage: "token_exchange"
    });

    const rateLimited = new TikTokMarketingOAuthClient({
      appId: "app-123",
      appSecret: secret,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 40100,
        message: "rate limited"
      }), { status: 429 }))
    });
    const providerResult = rateLimited.listAuthorizedAdvertisers(token);
    await expect(providerResult).rejects.toMatchObject({
      retryable: true,
      status: 429,
      providerCode: "40100",
      stage: "advertiser_discovery"
    });

    let error: unknown;
    try {
      await providerResult;
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain(token);
  });

  it("classifies permanent provider rejection as non-retryable", async () => {
    const client = new TikTokMarketingOAuthClient({
      appId: "app-123",
      appSecret: "secret-secret-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 40001,
        message: "no permission"
      }), { status: 200 }))
    });

    await expect(client.exchangeAuthorizationCode("auth-code-123"))
      .rejects.toMatchObject({
        retryable: false,
        status: 200,
        providerCode: "40001",
        stage: "token_exchange"
      });
  });
});


describe("TikTokMarketingOAuthService", () => {
  it("creates one-time state under the tiktok-marketing namespace and preserves only its hash", async () => {
    const { MemoryOAuthStore } = await import("./support/memory-oauth-store.js");
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-04T00:00:00.000Z");
    const listAuthorizedAdvertisers = vi.fn();
    const client: TikTokMarketingOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      listAuthorizedAdvertisers
    };
    const service = new TikTokMarketingOAuthService({
      authorizationUrl:
        "https://business-api.tiktok.com/portal/auth?app_id=app-123&state=replace-me",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      store,
      client,
      stateTtlSeconds: 600,
      now: () => now
    });

    const started = await service.beginAuthorization();
    const url = new URL(started.authorizationUrl);
    const state = url.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(state).not.toBe("replace-me");
    expect(started.expiresAt).toBe("2026-10-04T00:10:00.000Z");

    const stateHash = createHash("sha256").update(state!).digest("hex");
    expect([...store.states.keys()]).toEqual([stateHash]);
    expect(store.states.get(stateHash)).toMatchObject({
      provider: "tiktok-marketing",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      expiresAt: new Date("2026-10-04T00:10:00.000Z"),
      consumed: false
    });
    expect([...store.states.keys()]).not.toContain(state);
  });

  it("rejects invalid or replayed state before another provider exchange", async () => {
    const { MemoryOAuthStore } = await import("./support/memory-oauth-store.js");
    const store = new MemoryOAuthStore();
    const exchangeAuthorizationCode = vi.fn().mockResolvedValue({
      accessToken: "marketing-access"
    });
    const listAuthorizedAdvertisers = vi.fn().mockResolvedValue([
      { advertiserId: "100" }
    ]);
    const service = new TikTokMarketingOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app_id=app-123",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      store,
      client: { exchangeAuthorizationCode, listAuthorizedAdvertisers }
    });

    await expect(service.completeAuthorization("invalid", "auth-code-123"))
      .rejects.toThrow(/state/i);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();

    const started = await service.beginAuthorization();
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    await expect(service.completeAuthorization(state, "auth-code-123"))
      .resolves.toEqual({ advertiserIds: ["100"] });
    await expect(service.completeAuthorization(state, "auth-code-123"))
      .rejects.toThrow(/consumed|expired|invalid/i);
    expect(exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it("rejects a token that authorizes no advertisers and persists nothing", async () => {
    const { MemoryOAuthStore } = await import("./support/memory-oauth-store.js");
    const store = new MemoryOAuthStore();
    const client: TikTokMarketingOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "marketing-access"
      }),
      listAuthorizedAdvertisers: vi.fn().mockResolvedValue([])
    };
    const service = new TikTokMarketingOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app_id=app-123",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      store,
      client
    });

    const started = await service.beginAuthorization();
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    await expect(service.completeAuthorization(state, "auth-code-123"))
      .rejects.toThrow(/advertiser/i);
    await expect(store.list("tiktok-marketing")).resolves.toEqual([]);
  });

  it("persists one non-expiring Marketing credential per verified advertiser", async () => {
    const { MemoryOAuthStore } = await import("./support/memory-oauth-store.js");
    const store = new MemoryOAuthStore();
    const client: TikTokMarketingOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "marketing-access"
      }),
      listAuthorizedAdvertisers: vi.fn().mockResolvedValue([
        { advertiserId: "200", advertiserName: "Second" },
        { advertiserId: "100", advertiserName: "First" }
      ])
    };
    const service = new TikTokMarketingOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app_id=app-123",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      store,
      client
    });

    const started = await service.beginAuthorization();
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    await expect(service.completeAuthorization(state, "auth-code-123"))
      .resolves.toEqual({ advertiserIds: ["100", "200"] });

    await expect(store.list("tiktok-marketing")).resolves.toEqual([
      {
        provider: "tiktok-marketing",
        accountId: "100",
        accessToken: "marketing-access",
        scopes: [],
        tokenVersion: 1
      },
      {
        provider: "tiktok-marketing",
        accountId: "200",
        accessToken: "marketing-access",
        scopes: [],
        tokenVersion: 1
      }
    ]);
    await expect(store.list("tiktok")).resolves.toEqual([]);
  });

  it("persists verified scopes and exposes only advertiser IDs in status", async () => {
    const { MemoryOAuthStore } = await import("./support/memory-oauth-store.js");
    const store = new MemoryOAuthStore();
    const client: TikTokMarketingOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "marketing-access-secret",
        scopes: ["advertiser.info"]
      }),
      listAuthorizedAdvertisers: vi.fn().mockResolvedValue([
        { advertiserId: "200" },
        { advertiserId: "100" }
      ])
    };
    const service = new TikTokMarketingOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app_id=app-123",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      store,
      client
    });

    const started = await service.beginAuthorization();
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    await service.completeAuthorization(state, "auth-code-123");

    const status = await service.status();
    expect(status).toEqual({
      authorized: true,
      advertiserIds: ["100", "200"]
    });
    expect(JSON.stringify(status)).not.toContain("marketing-access-secret");
    expect(JSON.stringify(status)).not.toContain("advertiser.info");

    await expect(store.get("tiktok-marketing", "100")).resolves.toMatchObject({
      scopes: ["advertiser.info"]
    });
  });


  it("rejects live verification when no Marketing credential is stored", async () => {
    const { MemoryOAuthStore } = await import("./support/memory-oauth-store.js");
    const store = new MemoryOAuthStore();
    const listAuthorizedAdvertisers = vi.fn();
    const client: TikTokMarketingOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      listAuthorizedAdvertisers
    };
    const service = new TikTokMarketingOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app_id=app-123",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      store,
      client
    });

    await expect(service.verifyAccess())
      .rejects.toBeInstanceOf(TikTokMarketingOAuthNotAuthorizedError);
    expect(listAuthorizedAdvertisers).not.toHaveBeenCalled();
  });

  it("verifies live advertiser access and reports store drift without mutating credentials", async () => {
    const { MemoryOAuthStore } = await import("./support/memory-oauth-store.js");
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "tiktok-marketing",
      accountId: "100",
      accessToken: "marketing-access-secret",
      scopes: []
    });
    await store.put({
      provider: "tiktok-marketing",
      accountId: "200",
      accessToken: "marketing-access-secret",
      scopes: []
    });
    const listAuthorizedAdvertisers = vi.fn().mockResolvedValue([
      { advertiserId: "100", advertiserName: "First" },
      { advertiserId: "300", advertiserName: "Newly authorized" }
    ]);
    const client: TikTokMarketingOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      listAuthorizedAdvertisers
    };
    const service = new TikTokMarketingOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app_id=app-123",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      store,
      client
    });

    await expect(service.verifyAccess()).resolves.toEqual({
      verified: true,
      inSync: false,
      authorizedAdvertiserIds: ["100", "300"],
      storedAdvertiserIds: ["100", "200"],
      staleStoredAdvertiserIds: ["200"],
      untrackedAuthorizedAdvertiserIds: ["300"]
    });
    expect(listAuthorizedAdvertisers).toHaveBeenCalledWith("marketing-access-secret");
    await expect(store.list("tiktok-marketing")).resolves.toEqual([
      expect.objectContaining({ accountId: "100", tokenVersion: 1 }),
      expect.objectContaining({ accountId: "200", tokenVersion: 1 })
    ]);
  });

  it("reports an in-sync read-only verification without leaking token or scopes", async () => {
    const { MemoryOAuthStore } = await import("./support/memory-oauth-store.js");
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "tiktok-marketing",
      accountId: "100",
      accessToken: "marketing-access-secret",
      scopes: ["advertiser.info"]
    });
    const client: TikTokMarketingOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      listAuthorizedAdvertisers: vi.fn().mockResolvedValue([
        { advertiserId: "100", advertiserName: "First" }
      ])
    };
    const service = new TikTokMarketingOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app_id=app-123",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      store,
      client
    });

    const result = await service.verifyAccess();
    expect(result).toEqual({
      verified: true,
      inSync: true,
      authorizedAdvertiserIds: ["100"],
      storedAdvertiserIds: ["100"],
      staleStoredAdvertiserIds: [],
      untrackedAuthorizedAdvertiserIds: []
    });
    expect(JSON.stringify(result)).not.toContain("marketing-access-secret");
    expect(JSON.stringify(result)).not.toContain("advertiser.info");
    expect(JSON.stringify(result)).not.toContain("First");
  });

  it("reports unauthorized status when no Marketing credentials exist", async () => {
    const { MemoryOAuthStore } = await import("./support/memory-oauth-store.js");
    const store = new MemoryOAuthStore();
    const client: TikTokMarketingOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      listAuthorizedAdvertisers: vi.fn()
    };
    const service = new TikTokMarketingOAuthService({
      authorizationUrl: "https://business-api.tiktok.com/portal/auth?app_id=app-123",
      redirectUri:
        "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/",
      store,
      client
    });

    await expect(service.status()).resolves.toEqual({
      authorized: false,
      advertiserIds: []
    });
  });
});
