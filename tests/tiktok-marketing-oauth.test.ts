import { describe, expect, it, vi } from "vitest";
import {
  TikTokMarketingOAuthClient,
  TikTokMarketingOAuthRequestError
} from "../src/auth/tiktok-marketing-oauth.js";

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
    const url = new URL(String(urlValue));
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
        providerCode: "40001",
        stage: "token_exchange"
      });
  });
});
