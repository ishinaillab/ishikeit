import { describe, expect, it, vi } from "vitest";
import { InstagramOAuthMaintenance } from "../src/workers/instagram-oauth-maintenance.js";
import { MemoryOAuthStore } from "./support/memory-oauth-store.js";

const now = new Date("2026-11-01T00:00:00.000Z");
const refreshSkewSeconds = 7 * 24 * 60 * 60;

describe("InstagramOAuthMaintenance", () => {
  it("skips healthy far-from-expiry studio grants and invalid legacy tester accounts", async () => {
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "instagram", accountId: "studio-subject", accessToken: "healthy-studio-token",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    });
    await store.putAccountAlias("instagram", "17841438662359631", "studio-subject",
      "instagram_professional_account");
    await store.put({
      provider: "instagram", accountId: "former-tester-subject", accessToken: "old-token",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    });
    await store.putAccountAlias("instagram", "17841437646366614", "former-tester-subject",
      "instagram_professional_account");
    const getAccessToken = vi.fn();
    const hasHistoricalSignedInbound = vi.fn(async (id: string) => id === "17841438662359631");
    const runner = new InstagramOAuthMaintenance({
      store, accessTokens: { getAccessToken },
      hasHistoricalSignedInbound, refreshSkewSeconds, now: () => now
    });
    await expect(runner.runOnce()).resolves.toEqual({
      checked: 2, due: 0, succeeded: 0, failed: 0
    });
    expect(hasHistoricalSignedInbound).toHaveBeenCalledWith("17841437646366614");
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("renews a due studio grant through the existing account-bound refresh manager", async () => {
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "instagram", accountId: "studio-subject", accessToken: "soon-expiring",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    });
    await store.putAccountAlias("instagram", "17841438662359631", "studio-subject",
      "instagram_professional_account");
    const getAccessToken = vi.fn().mockResolvedValue("valid-refreshed-token");
    const runner = new InstagramOAuthMaintenance({
      store,
      accessTokens: { getAccessToken },
      hasHistoricalSignedInbound: async (id) => id === "17841438662359631",
      refreshSkewSeconds, now: () => now
    });
    await expect(runner.runOnce()).resolves.toEqual({
      checked: 1, due: 1, succeeded: 1, failed: 0
    });
    expect(getAccessToken).toHaveBeenCalledExactlyOnceWith("17841438662359631");
  });

  it("fails closed for ambiguous mappings and does not retry unavailable Graph in a loop", async () => {
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "instagram", accountId: "studio-subject", accessToken: "soon-expiring",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    });
    await store.putAccountAlias("instagram", "17841438662359631", "studio-subject",
      "instagram_professional_account");
    await store.putAccountAlias("instagram", "17841437646366614", "studio-subject",
      "instagram_professional_account");
    const getAccessToken = vi.fn().mockRejectedValue(new Error("provider failed"));
    const runner = new InstagramOAuthMaintenance({
      store, accessTokens: { getAccessToken },
      hasHistoricalSignedInbound: async () => true,
      refreshSkewSeconds, now: () => now
    });
    await expect(runner.runOnce()).resolves.toMatchObject({
      checked: 1, due: 0, succeeded: 0, failed: 0
    });
    expect(getAccessToken).not.toHaveBeenCalled();

    store.aliases.delete("instagram:17841437646366614");
    await expect(runner.runOnce()).resolves.toEqual({
      checked: 1, due: 1, succeeded: 0, failed: 1
    });
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });
});
