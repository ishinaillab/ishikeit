import { describe, expect, it, vi } from "vitest";
import {
  INSTAGRAM_REVIEW_SCOPES,
  InstagramOAuthClient,
  InstagramOAuthRequestError,
  InstagramOAuthService,
  type InstagramOAuthClientLike
} from "../src/auth/instagram-oauth.js";
import { MemoryOAuthStore } from "./support/memory-oauth-store.js";

function requestUrl(value: string | URL | Request): string {
  if (typeof value === "string") return value;
  return value instanceof URL ? value.toString() : value.url;
}

describe("InstagramOAuthClient", () => {
  it("exchanges a code and then obtains a long-lived token using current Instagram endpoints", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          access_token: "short-access",
          user_id: "17841430000000000",
          permissions: "instagram_business_basic,instagram_business_manage_messages"
        }]
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "long-access",
        token_type: "bearer",
        expires_in: 5_183_944
      }), { status: 200 }));

    const client = new InstagramOAuthClient({
      appId: "123456789012345",
      appSecret: "instagram-secret-123456",
      fetchImpl
    });

    const short = await client.exchangeAuthorizationCode(
      "authorization-code",
      "https://apps.example.test/ishikeit/oauth/instagram/callback/"
    );
    expect(short).toEqual({
      accessToken: "short-access",
      userId: "17841430000000000",
      scopes: [...INSTAGRAM_REVIEW_SCOPES]
    });

    const [exchangeUrl, exchangeInit] = fetchImpl.mock.calls[0]!;
    expect(exchangeUrl).toBe("https://api.instagram.com/oauth/access_token");
    expect(exchangeInit?.method).toBe("POST");
    expect(exchangeInit?.body).toBeInstanceOf(FormData);
    const form = exchangeInit?.body as FormData;
    expect(form.get("client_id")).toBe("123456789012345");
    expect(form.get("client_secret")).toBe("instagram-secret-123456");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("redirect_uri")).toBe(
      "https://apps.example.test/ishikeit/oauth/instagram/callback/"
    );
    expect(form.get("code")).toBe("authorization-code");

    await expect(client.exchangeLongLived(short.accessToken)).resolves.toEqual({
      accessToken: "long-access",
      accessExpiresInSeconds: 5_183_944
    });
    const longUrl = new URL(requestUrl(fetchImpl.mock.calls[1]![0]));
    expect(longUrl.origin + longUrl.pathname).toBe("https://graph.instagram.com/access_token");
    expect(longUrl.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(longUrl.searchParams.get("client_secret")).toBe("instagram-secret-123456");
    expect(longUrl.searchParams.get("access_token")).toBe("short-access");
  });

  it("uses the current refresh endpoint and classifies provider failures", async () => {
    const refreshFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: "refreshed-access",
      token_type: "bearer",
      expires_in: 5_183_944
    }), { status: 200 }));
    const client = new InstagramOAuthClient({
      appId: "123456789012345",
      appSecret: "instagram-secret-123456",
      fetchImpl: refreshFetch
    });

    await expect(client.refresh("long-access")).resolves.toEqual({
      accessToken: "refreshed-access",
      accessExpiresInSeconds: 5_183_944
    });
    const refreshUrl = new URL(requestUrl(refreshFetch.mock.calls[0]![0]));
    expect(refreshUrl.origin + refreshUrl.pathname)
      .toBe("https://graph.instagram.com/refresh_access_token");
    expect(refreshUrl.searchParams.get("grant_type")).toBe("ig_refresh_token");

    const failureClient = new InstagramOAuthClient({
      appId: "123456789012345",
      appSecret: "instagram-secret-123456",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        error: { message: "temporarily unavailable", code: 2 }
      }), { status: 503 }))
    });
    const result = failureClient.refresh("long-access");
    await expect(result).rejects.toBeInstanceOf(InstagramOAuthRequestError);
    await expect(result).rejects.toMatchObject({
      retryable: true,
      status: 503,
      providerCode: "2"
    });
  });
});

describe("InstagramOAuthService", () => {
  it("uses one-time CSRF state and persists only the long-lived token", async () => {
    const store = new MemoryOAuthStore();
    const now = new Date();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "short-secret",
        userId: "17841430000000000",
        scopes: [...INSTAGRAM_REVIEW_SCOPES]
      }),
      exchangeLongLived: vi.fn().mockResolvedValue({
        accessToken: "long-secret",
        accessExpiresInSeconds: 5_184_000
      }),
      refresh: vi.fn()
    };
    const service = new InstagramOAuthService({
      appId: "123456789012345",
      redirectUri: "https://apps.example.test/ishikeit/oauth/instagram/callback/",
      store,
      client,
      now: () => now
    });

    const start = await service.beginAuthorization();
    const url = new URL(start.authorizationUrl);
    const state = url.searchParams.get("state");
    expect(url.origin + url.pathname).toBe("https://api.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("123456789012345");
    expect(url.searchParams.get("redirect_uri"))
      .toBe("https://apps.example.test/ishikeit/oauth/instagram/callback/");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(INSTAGRAM_REVIEW_SCOPES.join(","));
    expect(url.searchParams.get("force_reauth")).toBe("true");
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);

    const result = await service.completeAuthorization(state!, "authorization-code");
    expect(result).toEqual({
      accountId: "17841430000000000",
      scopes: [...INSTAGRAM_REVIEW_SCOPES],
      accessExpiresAt: new Date(now.getTime() + 5_184_000_000).toISOString()
    });
    expect(JSON.stringify(result)).not.toContain("secret");

    const stored = await store.get("instagram", "17841430000000000");
    expect(stored).toMatchObject({
      accessToken: "long-secret",
      accountId: "17841430000000000",
      tokenVersion: 1
    });

    await expect(service.completeAuthorization(state!, "authorization-code"))
      .rejects.toThrow(/already consumed|invalid|expired/i);
  });
});
