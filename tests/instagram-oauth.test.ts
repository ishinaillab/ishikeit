import { describe, expect, it, vi } from "vitest";
import {
  INSTAGRAM_REVIEW_SCOPES,
  INSTAGRAM_WEBHOOK_FIELDS,
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
  it("emits bounded machine diagnostics without leaking arbitrary provider values", () => {
    const diagnostic = instagramOAuthFailureDiagnostic(new InstagramOAuthFlowError(
      "credential_lookup",
      new InstagramOAuthRequestError("provider response", {
        retryable: false,
        status: 401,
        providerCode: "unexpected code with spaces",
        reason: "scope_or_permission_rejected"
      })
    ));
    expect(diagnostic).toContain("stage=credential_lookup");
    expect(diagnostic).toContain("status=401");
    expect(diagnostic).not.toContain("unexpected code with spaces");
    expect(diagnostic).not.toContain("provider_code=");
  });

  it("never embeds untrusted Graph error descriptions in exception messages", async () => {
    const secret = "sensitive-token-in-provider-error";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        error: { code: 190, message: "Invalid OAuth access token " + secret }
      }), { status: 400 })
    );
    const client = new InstagramOAuthClient({
      appId: "123456789012345",
      appSecret: "instagram-secret-123456",
      fetchImpl
    });

    const error = await client.resolveProfessionalAccountId("test-token")
      .then(() => undefined, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(InstagramOAuthRequestError);
    expect((error as InstagramOAuthRequestError).status).toBe(400);
    expect((error as InstagramOAuthRequestError).providerCode).toBe("190");
    expect((error as Error).message).not.toContain(secret);
    expect(instagramOAuthFailureDiagnostic(error)).not.toContain(secret);
  });

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
    expect(exchangeInit?.redirect).toBe("error");
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

  it("enables the authorized account for the active Instagram webhook fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const client = new InstagramOAuthClient({
      appId: "123456789012345",
      appSecret: "instagram-secret-123456",
      graphApiVersion: "v26.0",
      fetchImpl
    });

    await expect(client.ensureWebhookSubscription("long-access"))
      .resolves.toBeUndefined();

    const [request, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(requestUrl(request));
    expect(url.origin + url.pathname)
      .toBe("https://graph.instagram.com/v26.0/me/subscribed_apps");
    expect(INSTAGRAM_WEBHOOK_FIELDS).toEqual([
      "messages", "standby", "messaging_handover",
      "messaging_seen", "messaging_postbacks"
    ]);
    expect(url.searchParams.get("subscribed_fields"))
      .toBe("messages,standby,messaging_handover,messaging_seen,messaging_postbacks");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization"))
      .toBe("Bearer long-access");
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

  it("classifies OAuth code 190 using numeric subcode without exposing token or provider message", async () => {
    for (const providerSubcode of [460, 463]) {
      const token = "synthetic-private-ig-access-token";
      const client = new InstagramOAuthClient({
        appId: "123456789012345",
        appSecret: "instagram-secret-123456",
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify({
            error: {
              message: "Error validating access token: sensitive session details",
              type: "OAuthException", code: 190, error_subcode: providerSubcode
            }
          }), { status: 400 })
        )
      });
      let failure: unknown;
      try {
        await client.resolveProfessionalAccountId(token);
      } catch (error) { failure = error; }
      expect(failure).toMatchObject({
        status: 400, providerCode: "190", providerSubcode,
        reason: "reauthorization_required", retryable: false
      });
      const diagnostic = instagramOAuthFailureDiagnostic(
        new InstagramOAuthFlowError("account_resolution", failure)
      );
      expect(diagnostic).toContain("provider_code=190");
      expect(diagnostic).toContain(`provider_subcode=${providerSubcode}`);
      expect(diagnostic).toContain("reason=reauthorization_required");
      expect(diagnostic).not.toContain(token);
      expect(diagnostic).not.toContain("sensitive session details");
      expect(diagnostic).not.toContain("instagram-secret-123456");
    }
  });

  it("ignores nonnumeric error subcodes instead of echoing untrusted provider content", async () => {
    const client = new InstagramOAuthClient({
      appId: "123456789012345",
      appSecret: "instagram-secret-123456",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({
          error: {message: "session invalid", code: 190, error_subcode: "secret-bearing-text"}
        }), { status: 400 })
      )
    });
    let failure: unknown;
    try { await client.resolveProfessionalAccountId("test-token"); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ providerCode: "190", reason: "reauthorization_required" });
    const diagnostic = instagramOAuthFailureDiagnostic(new InstagramOAuthFlowError("account_resolution", failure));
    expect(diagnostic).not.toContain("secret-bearing-text");
    expect(diagnostic).not.toContain("provider_subcode=");
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
    const ensureWebhookSubscription = vi.fn().mockResolvedValue(undefined);
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
      resolveProfessionalAccountId: vi.fn().mockResolvedValue("17841499999999999"),
      ensureWebhookSubscription
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
    expect(ensureWebhookSubscription).toHaveBeenCalledWith(
      "long-secret",
      INSTAGRAM_WEBHOOK_FIELDS
    );

    await expect(service.completeAuthorization(state!, "authorization-code"))
      .rejects.toThrow(/already consumed|invalid|expired/i);
  });

  it("promotes only the exact Graph-verified managed studio account", async () => {
    const store = new MemoryOAuthStore();
    const expectedManagedAccountId = vi.fn().mockResolvedValue("17841438662359631");
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "short-new", userId: "app-subject-new",
        scopes: ["instagram_business_basic", "instagram_business_manage_messages"]
      }),
      exchangeLongLived: vi.fn().mockResolvedValue({
        accessToken: "long-new", accessExpiresInSeconds: 5_184_000
      }),
      refresh: vi.fn(),
      resolveProfessionalAccountId: vi.fn().mockResolvedValue("17841438662359631"),
      ensureWebhookSubscription: vi.fn().mockResolvedValue(undefined)
    };
    const service = new InstagramOAuthService({
      appId: "123456789012345",
      redirectUri: "https://apps.example.test/instagram/callback/",
      store, client, expectedManagedAccountId
    });
    const started = await service.beginAuthorization();
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    await expect(service.completeAuthorization(state, "authorization-code"))
      .resolves.toMatchObject({ accountId: "17841438662359631" });
    expect(expectedManagedAccountId).toHaveBeenCalledOnce();
    await expect(store.resolveCredentialAccountId("instagram", "17841438662359631"))
      .resolves.toBe("app-subject-new");
    expect((await store.get("instagram", "app-subject-new"))?.accessToken).toBe("long-new");
  });

  it("refuses a different Instagram login without persisting or subscribing it", async () => {
    const store = new MemoryOAuthStore();
    const ensureWebhookSubscription = vi.fn();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "short-wrong", userId: "different-app-subject",
        scopes: [...INSTAGRAM_REVIEW_SCOPES]
      }),
      exchangeLongLived: vi.fn().mockResolvedValue({
        accessToken: "long-wrong", accessExpiresInSeconds: 5_184_000
      }),
      refresh: vi.fn(),
      resolveProfessionalAccountId: vi.fn().mockResolvedValue("17841437646366614"),
      ensureWebhookSubscription
    };
    const service = new InstagramOAuthService({
      appId: "123456789012345",
      redirectUri: "https://apps.example.test/instagram/callback/",
      store, client,
      expectedManagedAccountId: vi.fn().mockResolvedValue("17841438662359631")
    });
    const state = new URL((await service.beginAuthorization()).authorizationUrl)
      .searchParams.get("state")!;
    await expect(service.completeAuthorization(state, "authorization-code"))
      .rejects.toMatchObject({ stage: "account_resolution" });
    expect(await store.get("instagram", "different-app-subject")).toBeUndefined();
    expect(await store.resolveCredentialAccountId("instagram", "17841437646366614"))
      .toBeUndefined();
    expect(ensureWebhookSubscription).not.toHaveBeenCalled();
    await expect(service.completeAuthorization(state, "authorization-code"))
      .rejects.toThrow(/consumed|expired|invalid/i);
  });

  it("rejects an unavailable managed account before storing a new OAuth grant", async () => {
    const store = new MemoryOAuthStore();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "short-new", userId: "new-subject", scopes: [...INSTAGRAM_REVIEW_SCOPES]
      }),
      exchangeLongLived: vi.fn().mockResolvedValue({
        accessToken: "long-new", accessExpiresInSeconds: 5_184_000
      }),
      refresh: vi.fn(), resolveProfessionalAccountId: vi.fn().mockResolvedValue("17841438662359631"),
      ensureWebhookSubscription: vi.fn()
    };
    const service = new InstagramOAuthService({
      appId: "123456789012345",
      redirectUri: "https://apps.example.test/instagram/callback/",
      store, client,
      expectedManagedAccountId: vi.fn().mockRejectedValue(new Error("managed token unavailable"))
    });
    const state = new URL((await service.beginAuthorization()).authorizationUrl)
      .searchParams.get("state")!;
    await expect(service.completeAuthorization(state, "authorization-code"))
      .rejects.toMatchObject({ stage: "account_resolution" });
    expect(await store.get("instagram", "new-subject")).toBeUndefined();
  });

  it("rejects a consent flow without all basic and messaging scopes", async () => {
    const store = new MemoryOAuthStore();
    const exchangeLongLived = vi.fn();
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "short-limited", userId: "limited-subject",
        scopes: ["instagram_business_basic"]
      }),
      exchangeLongLived, refresh: vi.fn(),
      resolveProfessionalAccountId: vi.fn(), ensureWebhookSubscription: vi.fn()
    };
    const service = new InstagramOAuthService({
      appId: "123456789012345",
      redirectUri: "https://apps.example.test/instagram/callback/",
      store, client
    });
    const state = new URL((await service.beginAuthorization()).authorizationUrl)
      .searchParams.get("state")!;
    const failure = await service.completeAuthorization(state, "authorization-code")
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toMatchObject({ stage: "short_token_exchange" });
    expect(instagramOAuthFailureDiagnostic(failure))
      .toContain("reason=required_scopes_missing");
    expect(exchangeLongLived).not.toHaveBeenCalled();
    expect(await store.get("instagram", "limited-subject")).toBeUndefined();
  });

  it("reports durable status safely when an access expiry is absent", async () => {
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "instagram",
      accountId: "oauth-subject",
      accessToken: "long-secret",
      scopes: [...INSTAGRAM_REVIEW_SCOPES]
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
    const service = new InstagramOAuthService({
      appId: "123456789012345",
      redirectUri: "https://apps.example.test/ishikeit/oauth/instagram/callback/",
      store,
      client
    });

    await expect(service.status("professional-account")).resolves.toEqual({
      authorized: true,
      accountId: "professional-account",
      scopes: [...INSTAGRAM_REVIEW_SCOPES]
    });
  });

  it("distinguishes stored Instagram OAuth token from current provider validity", async () => {
    const now = new Date("2026-10-28T14:00:00.000Z");
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "instagram",
      accountId: "oauth-tester",
      accessToken: "private-tester-token",
      scopes: [...INSTAGRAM_REVIEW_SCOPES],
      accessExpiresAt: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000)
    });
    await store.putAccountAlias(
      "instagram", "professional-tester", "oauth-tester", "instagram_professional_account"
    );
    const resolveProfessionalAccountId = vi.fn().mockResolvedValue("professional-tester");
    const client: InstagramOAuthClientLike = {
      exchangeAuthorizationCode: vi.fn(), exchangeLongLived: vi.fn(),
      refresh: vi.fn(), resolveProfessionalAccountId, ensureWebhookSubscription: vi.fn()
    };
    const service = new InstagramOAuthService({
      appId: "123456789012345",
      redirectUri: "https://apps.example.test/ishikeit/oauth/instagram/callback/",
      store, client, now: () => now
    });

    expect((await service.status("professional-tester")).providerValidation).toBeUndefined();
    expect(resolveProfessionalAccountId).not.toHaveBeenCalled();
    expect((await service.status("professional-tester", true)).providerValidation).toBe("valid");
    expect(resolveProfessionalAccountId).toHaveBeenCalledWith("private-tester-token");

    resolveProfessionalAccountId.mockResolvedValueOnce("other-owner");
    expect((await service.status("professional-tester", true)).providerValidation)
      .toBe("identity_mismatch");

    resolveProfessionalAccountId.mockRejectedValueOnce(
      new InstagramOAuthRequestError("private provider response", {
        retryable: false, status: 400, providerCode: "190"
      })
    );
    const invalid = await service.status("professional-tester", true);
    expect(invalid).toMatchObject({
      authorized: true,
      accountId: "professional-tester",
      providerValidation: "reauthorization_required"
    });
    expect(JSON.stringify(invalid)).not.toContain("private-tester-token");
    expect(JSON.stringify(invalid)).not.toContain("private provider response");
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
      resolveProfessionalAccountId: vi.fn(),
      ensureWebhookSubscription: vi.fn()
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
