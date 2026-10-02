import { describe, expect, it, vi } from "vitest";
import { InstagramAccessTokenManager } from "../src/auth/instagram-token-manager.js";
import type { InstagramOAuthClientLike } from "../src/auth/instagram-oauth.js";
import { MemoryOAuthStore } from "./support/memory-oauth-store.js";

describe("InstagramAccessTokenManager", () => {
  it("returns undefined for accounts that have not authorized the app", async () => {
    const store = new MemoryOAuthStore();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      exchangeLongLived: vi.fn(),
      refresh: vi.fn()
    };
    const manager = new InstagramAccessTokenManager({ store, client });
    await expect(manager.getAccessToken("missing")).resolves.toBeUndefined();
  });

  it("returns a healthy durable token without refreshing", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T05:00:00.000Z");
    await store.put({
      provider: "instagram",
      accountId: "ig-1",
      accessToken: "healthy-token",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    });
    const refresh = vi.fn();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      exchangeLongLived: vi.fn(),
      refresh
    };
    const manager = new InstagramAccessTokenManager({
      store,
      client,
      now: () => now
    });

    await expect(manager.getAccessToken("ig-1")).resolves.toBe("healthy-token");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes a valid long-lived token near expiry and persists the replacement", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T05:00:00.000Z");
    await store.put({
      provider: "instagram",
      accountId: "ig-1",
      accessToken: "old-token",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    });
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "refreshed-token",
      accessExpiresInSeconds: 5_184_000
    });
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      exchangeLongLived: vi.fn(),
      refresh
    };
    const manager = new InstagramAccessTokenManager({
      store,
      client,
      refreshSkewSeconds: 7 * 24 * 60 * 60,
      now: () => now
    });

    await expect(manager.getAccessToken("ig-1")).resolves.toBe("refreshed-token");
    expect(refresh).toHaveBeenCalledWith("old-token");
    await expect(store.get("instagram", "ig-1")).resolves.toMatchObject({
      accessToken: "refreshed-token",
      tokenVersion: 2
    });
  });

  it("requires reauthorization after token expiry instead of attempting refresh", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T05:00:00.000Z");
    await store.put({
      provider: "instagram",
      accountId: "ig-1",
      accessToken: "expired-token",
      scopes: ["instagram_business_basic"],
      accessExpiresAt: new Date(now.getTime() - 1)
    });
    const refresh = vi.fn();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      exchangeLongLived: vi.fn(),
      refresh
    };
    const manager = new InstagramAccessTokenManager({
      store,
      client,
      now: () => now
    });

    await expect(manager.getAccessToken("ig-1")).rejects.toMatchObject({
      retryable: false
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not fall back after an account has been revoked", async () => {
    const store = new MemoryOAuthStore();
    await store.revoke("instagram", "ig-revoked", "deauthorized");
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      exchangeLongLived: vi.fn(),
      refresh: vi.fn()
    };
    const manager = new InstagramAccessTokenManager({ store, client });

    await expect(manager.getAccessToken("ig-revoked")).rejects.toMatchObject({
      retryable: false
    });
  });
});
