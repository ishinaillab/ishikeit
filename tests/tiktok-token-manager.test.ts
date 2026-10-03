import { describe, expect, it, vi } from "vitest";
import { AccessTokenError } from "../src/auth/token-provider.js";
import { TikTokAccessTokenManager, tiktokCredentialCanRefresh } from "../src/auth/tiktok-token-manager.js";
import { TikTokOAuthRequestError, type TikTokOAuthClientLike } from "../src/auth/tiktok-oauth.js";
import { MemoryOAuthStore } from "./support/memory-oauth-store.js";

describe("TikTokAccessTokenManager", () => {
  it("identifies whether a durable credential can still refresh", () => {
    const now = new Date("2026-10-02T00:00:00.000Z");
    expect(tiktokCredentialCanRefresh(undefined, now)).toBe(false);
    expect(tiktokCredentialCanRefresh({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "access",
      scopes: [],
      accessExpiresAt: now,
      tokenVersion: 1
    }, now)).toBe(false);
    expect(tiktokCredentialCanRefresh({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "access",
      refreshToken: "refresh",
      scopes: [],
      accessExpiresAt: now,
      refreshExpiresAt: new Date(now.getTime() + 1000),
      tokenVersion: 1
    }, now)).toBe(true);
    expect(tiktokCredentialCanRefresh({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "access",
      refreshToken: "refresh",
      scopes: [],
      refreshExpiresAt: new Date(now.getTime() + 1000),
      tokenVersion: 1
    } as never, now)).toBe(false);
    expect(tiktokCredentialCanRefresh({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "access",
      refreshToken: "refresh",
      scopes: [],
      accessExpiresAt: now,
      refreshExpiresAt: now,
      tokenVersion: 1
    }, now)).toBe(false);
  });
  it("rejects a Business Messaging credential without an access expiry", async () => {
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "access-without-expiry",
      refreshToken: "refresh-current",
      scopes: ["business.messaging"]
    } as never);
    const refresh = vi.fn();
    const client: TikTokOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      refresh
    };
    const manager = new TikTokAccessTokenManager({
      businessId: "business-1",
      store,
      client
    });

    const result = manager.getAccessToken();
    await expect(result).rejects.toBeInstanceOf(AccessTokenError);
    await expect(result).rejects.toMatchObject({ retryable: false });
    await expect(result).rejects.toThrow(/expiry/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns an unexpired access token without refreshing", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T00:00:00.000Z");
    await store.put({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "access-current",
      refreshToken: "refresh-current",
      scopes: ["business.messaging"],
      accessExpiresAt: new Date(now.getTime() + 3600_000),
      refreshExpiresAt: new Date(now.getTime() + 30 * 86400_000)
    });
    const refresh = vi.fn();
    const client: TikTokOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      refresh
    };
    const manager = new TikTokAccessTokenManager({
      businessId: "business-1",
      store,
      client,
      now: () => now
    });

    await expect(manager.getAccessToken()).resolves.toBe("access-current");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes before expiry and persists the replacement token pair", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T00:00:00.000Z");
    await store.put({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "access-old",
      refreshToken: "refresh-old",
      scopes: ["business.messaging"],
      accessExpiresAt: new Date(now.getTime() + 120_000),
      refreshExpiresAt: new Date(now.getTime() + 30 * 86400_000)
    });
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      accessExpiresInSeconds: 86400,
      refreshExpiresInSeconds: 31536000,
      openId: "business-1",
      scopes: ["business.messaging"]
    });
    const client: TikTokOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      refresh
    };
    const manager = new TikTokAccessTokenManager({
      businessId: "business-1",
      store,
      client,
      refreshSkewSeconds: 300,
      now: () => now
    });

    await expect(manager.getAccessToken()).resolves.toBe("access-new");
    expect(refresh).toHaveBeenCalledWith("refresh-old");
    await expect(store.get("tiktok", "business-1")).resolves.toMatchObject({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      tokenVersion: 2
    });
  });

  it("collapses concurrent refreshes into one provider call", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T00:00:00.000Z");
    await store.put({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "expired",
      refreshToken: "refresh-old",
      scopes: [],
      accessExpiresAt: new Date(now.getTime() - 1000),
      refreshExpiresAt: new Date(now.getTime() + 86400_000)
    });

    let resolveRefresh!: (value: {
      accessToken: string;
      accessExpiresInSeconds: number;
      scopes: string[];
    }) => void;
    const pending = new Promise<{
      accessToken: string;
      accessExpiresInSeconds: number;
      scopes: string[];
    }>((resolve) => { resolveRefresh = resolve; });
    const refresh = vi.fn().mockReturnValue(pending);
    const client: TikTokOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      refresh
    };
    const manager = new TikTokAccessTokenManager({
      businessId: "business-1",
      store,
      client,
      now: () => now
    });

    const first = manager.getAccessToken();
    const second = manager.getAccessToken();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    resolveRefresh({
      accessToken: "access-new",
      accessExpiresInSeconds: 86400,
      scopes: []
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      "access-new",
      "access-new"
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("serializes refreshes across independent manager instances", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T00:00:00.000Z");
    await store.put({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "access-old",
      refreshToken: "refresh-old",
      scopes: [],
      accessExpiresAt: new Date(now.getTime() + 1000),
      refreshExpiresAt: new Date(now.getTime() + 86400_000)
    });

    let resolveRefresh!: (value: {
      accessToken: string;
      accessExpiresInSeconds: number;
      scopes: string[];
    }) => void;
    const pending = new Promise<{
      accessToken: string;
      accessExpiresInSeconds: number;
      scopes: string[];
    }>((resolve) => { resolveRefresh = resolve; });
    const refresh = vi.fn().mockReturnValue(pending);
    const client: TikTokOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      refresh
    };
    const firstManager = new TikTokAccessTokenManager({
      businessId: "business-1",
      store,
      client,
      now: () => now
    });
    const secondManager = new TikTokAccessTokenManager({
      businessId: "business-1",
      store,
      client,
      now: () => now
    });

    const first = firstManager.getAccessToken();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const second = secondManager.getAccessToken();

    resolveRefresh({
      accessToken: "access-new",
      accessExpiresInSeconds: 86400,
      scopes: []
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      "access-new",
      "access-new"
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps transient TikTok OAuth refresh failures retryable", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T00:00:00.000Z");
    await store.put({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "access-old",
      refreshToken: "refresh-old",
      scopes: [],
      accessExpiresAt: new Date(now.getTime() + 1000),
      refreshExpiresAt: new Date(now.getTime() + 86400_000)
    });
    const refresh = vi.fn().mockRejectedValue(new TikTokOAuthRequestError(
      "temporary provider failure",
      { retryable: true, status: 503 }
    ));
    const client: TikTokOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      refresh
    };
    const manager = new TikTokAccessTokenManager({
      businessId: "business-1",
      store,
      client,
      now: () => now
    });

    const result = manager.getAccessToken();
    await expect(result).rejects.toBeInstanceOf(AccessTokenError);
    await expect(result).rejects.toMatchObject({ retryable: true });
  });

  it("requires reauthorization after refresh-token expiry", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T00:00:00.000Z");
    await store.put({
      provider: "tiktok",
      accountId: "business-1",
      accessToken: "expired",
      refreshToken: "refresh-expired",
      scopes: [],
      accessExpiresAt: new Date(now.getTime() - 1000),
      refreshExpiresAt: new Date(now.getTime() - 1)
    });
    const refresh = vi.fn();
    const client: TikTokOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      refresh
    };
    const manager = new TikTokAccessTokenManager({
      businessId: "business-1",
      store,
      client,
      now: () => now
    });

    const result = manager.getAccessToken();
    await expect(result).rejects.toBeInstanceOf(AccessTokenError);
    await expect(result).rejects.toMatchObject({ retryable: false });
    await expect(result).rejects.toThrow(/reauthorization/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
