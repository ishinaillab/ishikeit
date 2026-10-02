import { describe, expect, it, vi } from "vitest";
import {
  INSTAGRAM_REVIEW_SCOPES,
  InstagramOAuthClient,
  InstagramOAuthFlowError,
  InstagramOAuthRequestError,
  InstagramOAuthService,
  instagramOAuthFailureDiagnostic,
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

  it("preserves a bare numeric Instagram user_id without JavaScript precision loss", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      '{"data":[{"access_token":"short-access","user_id":17841430000000001,"permissions":"instagram_business_basic,instagram_business_manage_messages"}]}',
      { status: 200 }
    ));
    const client = new InstagramOAuthClient({
      appId: "123456789012345",
      appSecret: "instagram-secret-123456",
      fetchImpl
    });

    await expect(client.exchangeAuthorizationCode(
      "authorization-code",
      "https://apps.example.test/ishikeit/oauth/instagram/callback/"
    )).resolves.toEqual({
      accessToken: "short-access",
      userId: "17841430000000001",
      scopes: [...INSTAGRAM_REVIEW_SCOPES]
    });
  });

  it("resolves the Instagram Professional account ID from /me", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: [{ user_id: "17841438662359631" }]
    }), { status: 200 }));
    const client = new InstagramOAuthClient({
      appId: "123456789012345",
      appSecret: "instagram-secret-123456",
      graphApiVersion: "v25.0",
      fetchImpl
    });

    await expect(client.resolveProfessionalAccountId("long-access"))
      .resolves.toBe("17841438662359631");
    const profileUrl = new URL(requestUrl(fetchImpl.mock.calls[0]![0]));
    expect(profileUrl.origin + profileUrl.pathname)
      .toBe("https://graph.instagram.com/v25.0/me");
    expect(profileUrl.searchParams.get("fields")).toBe("user_id");
    expect(profileUrl.searchParams.get("access_token")).toBe("long-access");
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
      providerCode: "2",
      reason: "provider_rejected"
    });
  });

  it("classifies provider rejection reasons without exposing credentials", async () => {
    const client = new InstagramOAuthClient({
      appId: "123456789012345",
      appSecret: "instagram-secret-123456",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        error_type: "OAuthException",
        code: 400,
        error_message: "Invalid client secret"
      }), { status: 400 }))
    });

    let failure: unknown;
    try {
      await client.exchangeAuthorizationCode(
        "authorization-code",
        "https://apps.example.test/ishikeit/oauth/instagram/callback/"
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      status: 400,
      providerCode: "400",
      reason: "client_secret_invalid",
      retryable: false
    });
    const diagnostic = instagramOAuthFailureDiagnostic(
      new InstagramOAuthFlowError("short_token_exchange", failure)
    );
    expect(diagnostic).toBe(
      "stage=short_token_exchange class=InstagramOAuthRequestError status=400 provider_code=400 reason=client_secret_invalid retryable=false"
    );
    expect(diagnostic).not.toContain("instagram-secret-123456");
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
      refresh: vi.fn(),
      resolveProfessionalAccountId: vi.fn().mockResolvedValue("17841499999999999")
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
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("123456789012345");
    expect(url.searchParams.get("redirect_uri"))
      .toBe("https://apps.example.test/ishikeit/oauth/instagram/callback/");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(INSTAGRAM_REVIEW_SCOPES.join(","));
    expect(url.searchParams.get("force_reauth")).toBe("true");
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);

    const result = await service.completeAuthorization(state!, "authorization-code");
    expect(result).toEqual({
      accountId: "17841499999999999",
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
    await expect(
      store.resolveCredentialAccountId("instagram", "17841499999999999")
    ).resolves.toBe("17841430000000000");

    await expect(service.completeAuthorization(state!, "authorization-code"))
      .rejects.toThrow(/already consumed|invalid|expired/i);
  });

  it("identifies the exact failing OAuth stage after state validation", async () => {
    const store = new MemoryOAuthStore();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockRejectedValue(
        new InstagramOAuthRequestError("provider rejected request", {
          retryable: false,
          status: 400,
          providerCode: "OAuthException",
          reason: "redirect_uri_mismatch"
        })
      ),
      exchangeLongLived: vi.fn(),
      refresh: vi.fn(),
      resolveProfessionalAccountId: vi.fn()
    };
    const service = new InstagramOAuthService({
      appId: "123456789012345",
      redirectUri: "https://apps.example.test/ishikeit/oauth/instagram/callback/",
      store,
      client
    });

    const started = await service.beginAuthorization();
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;

    let failure: unknown;
    try {
      await service.completeAuthorization(state, "authorization-code");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InstagramOAuthFlowError);
    expect(failure).toMatchObject({ stage: "short_token_exchange" });
    expect(instagramOAuthFailureDiagnostic(failure)).toBe(
      "stage=short_token_exchange class=InstagramOAuthRequestError status=400 provider_code=OAuthException reason=redirect_uri_mismatch retryable=false"
    );
  });
});
