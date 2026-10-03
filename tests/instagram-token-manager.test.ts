import { describe, expect, it, vi } from "vitest";
import { InstagramAccessTokenManager, InstagramAccessTokenRouter } from "../src/auth/instagram-token-manager.js";
import type { InstagramOAuthClientLike } from "../src/auth/instagram-oauth.js";
import { MemoryOAuthStore } from "./support/memory-oauth-store.js";

describe("InstagramAccessTokenManager", () => {
  it("returns undefined for accounts that have not authorized the app", async () => {
    const store = new MemoryOAuthStore();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      exchangeLongLived: vi.fn(),
      refresh: vi.fn(),
      resolveProfessionalAccountId: vi.fn(),
      ensureWebhookSubscription: vi.fn()
    };
    const manager = new InstagramAccessTokenManager({ store, client });
    await expect(manager.getAccessToken("missing")).resolves.toBeUndefined();
  });

  it("rejects an Instagram OAuth credential without an access expiry", async () => {
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "instagram",
      accountId: "ig-1",
      accessToken: "token-without-expiry",
      scopes: ["instagram_business_basic"]
    });
    const refresh = vi.fn();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      exchangeLongLived: vi.fn(),
      refresh,
      resolveProfessionalAccountId: vi.fn(),
      ensureWebhookSubscription: vi.fn()
    };
    const manager = new InstagramAccessTokenManager({ store, client });

    const result = manager.getAccessToken("ig-1");
    await expect(result).rejects.toMatchObject({ retryable: false });
    await expect(result).rejects.toThrow(/expiry/i);
    expect(refresh).not.toHaveBeenCalled();
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
      refresh,
      resolveProfessionalAccountId: vi.fn(),
      ensureWebhookSubscription: vi.fn()
    };
    const manager = new InstagramAccessTokenManager({
      store,
      client,
      now: () => now
    });

    await expect(manager.getAccessToken("ig-1")).resolves.toBe("healthy-token");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("resolves a professional-account webhook ID to its OAuth credential", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date("2026-10-02T05:00:00.000Z");
    await store.put({
      provider: "instagram",
      accountId: "oauth-subject",
      accessToken: "mapped-token",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    });
    await store.putAccountAlias(
      "instagram",
      "professional-account",
      "oauth-subject",
      "instagram_professional_account"
    );
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(),
      exchangeLongLived: vi.fn(),
      refresh: vi.fn(),
      resolveProfessionalAccountId: vi.fn(),
      ensureWebhookSubscription: vi.fn()
    };
    const manager = new InstagramAccessTokenManager({
      store,
      client,
      now: () => now
    });

    await expect(manager.getAccessToken("professional-account"))
      .resolves.toBe("mapped-token");

    await store.revoke("instagram", "professional-account", "deauthorized");
    await expect(manager.getAccessToken("professional-account"))
      .rejects.toMatchObject({ retryable: false });
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
      refresh,
      resolveProfessionalAccountId: vi.fn(),
      ensureWebhookSubscription: vi.fn()
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
      refresh,
      resolveProfessionalAccountId: vi.fn(),
      ensureWebhookSubscription: vi.fn()
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
      refresh: vi.fn(),
      resolveProfessionalAccountId: vi.fn(),
      ensureWebhookSubscription: vi.fn()
    };
    const manager = new InstagramAccessTokenManager({ store, client });

    await expect(manager.getAccessToken("ig-revoked")).rejects.toMatchObject({
      retryable: false
    });
  });
});


describe("InstagramAccessTokenRouter", () => {
  it("prefers a durable OAuth credential without inspecting the managed token", async () => {
    const oauthProvider = { getAccessToken: vi.fn().mockResolvedValue("oauth-token") };
    const resolveProfessionalAccountId = vi.fn();
    const router = new InstagramAccessTokenRouter({
      oauthProvider,
      managedAccessToken: "managed-token",
      client: { resolveProfessionalAccountId }
    });

    await expect(router.getAccessToken("business-account")).resolves.toBe("oauth-token");
    expect(oauthProvider.getAccessToken).toHaveBeenCalledWith("business-account");
    expect(resolveProfessionalAccountId).not.toHaveBeenCalled();
  });

  it("uses a managed App Dashboard token only for the professional account it represents", async () => {
    const oauthProvider = { getAccessToken: vi.fn().mockResolvedValue(undefined) };
    const resolveProfessionalAccountId = vi.fn().mockResolvedValue("business-account");
    const router = new InstagramAccessTokenRouter({
      oauthProvider,
      managedAccessToken: "managed-token",
      client: { resolveProfessionalAccountId }
    });

    await expect(router.getAccessToken("business-account")).resolves.toBe("managed-token");
    await expect(router.getAccessToken("other-account")).resolves.toBeUndefined();
    expect(resolveProfessionalAccountId).toHaveBeenCalledTimes(1);
    expect(resolveProfessionalAccountId).toHaveBeenCalledWith("managed-token");
  });



  it("reports no managed account when no App Dashboard token is configured", async () => {
    const resolveProfessionalAccountId = vi.fn();
    const router = new InstagramAccessTokenRouter({
      client: { resolveProfessionalAccountId }
    });

    await expect(router.managedAccountId()).resolves.toBeUndefined();
    await expect(router.getAccessToken("business-account")).resolves.toBeUndefined();
    expect(resolveProfessionalAccountId).not.toHaveBeenCalled();
  });

  it("does not fall through to a managed token when OAuth routing rejects a revoked account", async () => {
    const oauthProvider = {
      getAccessToken: vi.fn().mockRejectedValue(
        new (await import("../src/auth/token-provider.js")).AccessTokenError(
          "revoked",
          { retryable: false }
        )
      )
    };
    const resolveProfessionalAccountId = vi.fn().mockResolvedValue("business-account");
    const router = new InstagramAccessTokenRouter({
      oauthProvider,
      managedAccessToken: "managed-token",
      client: { resolveProfessionalAccountId }
    });

    await expect(router.getAccessToken("business-account")).rejects.toMatchObject({
      retryable: false
    });
    expect(resolveProfessionalAccountId).not.toHaveBeenCalled();
  });
});
