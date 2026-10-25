import { describe, expect, it, vi } from "vitest";
import {
  TikTokBusinessEligibilityError,
  TikTokBusinessEligibilityReader
} from "../src/messaging/tiktok-business-eligibility.js";

const base = {
  businessId: "owned-business-id",
  accessToken: "test-token",
  transport: "GET_QUERY" as const
};

function ok(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ code: 0, message: "OK", data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("TikTokBusinessEligibilityReader (dormant, read-only)", () => {
  it("reads only the account-tier flag at the documented business profile path", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok({
      business_id: "owned-business-id",
      has_advanced_access: true,
      display_name: "Private profile detail",
      username: "Private user name",
      profile_image: "https://private.example/photo"
    }));
    const result = await new TikTokBusinessEligibilityReader({
      ...base, fetchImpl
    }).get();
    expect(result).toEqual({
      businessId: "owned-business-id", hasAdvancedAccess: true
    });
    expect(JSON.stringify(result)).not.toContain("Private");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [rawUrl, options] = fetchImpl.mock.calls[0]!;
    const url = new URL(rawUrl instanceof URL
      ? rawUrl.href
      : typeof rawUrl === "string" ? rawUrl : rawUrl.url
    );
    expect(url.origin).toBe("https://business-api.tiktok.com");
    expect(url.pathname).toBe("/open_api/v1.3/business/get/");
    expect(url.searchParams.get("business_id")).toBe("owned-business-id");
    expect(options?.method).toBe("GET");
    expect(options?.headers).toMatchObject({ "Access-Token": "test-token" });
    expect(options?.body).toBeUndefined();
    expect(options?.redirect).toBe("error");
  });

  it("returns a false tier flag rather than guessing that app approval grants access", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok({
      has_advanced_access: false
    }));
    await expect(new TikTokBusinessEligibilityReader({
      ...base, fetchImpl
    }).get()).resolves.toEqual({
      businessId: "owned-business-id",
      hasAdvancedAccess: false
    });
  });

  it("fails closed if the account profile does not include a boolean entitlement", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok({
      has_advanced_access: "true"
    }));
    await expect(new TikTokBusinessEligibilityReader({
      ...base, fetchImpl
    }).get()).rejects.toBeInstanceOf(TikTokBusinessEligibilityError);
  });

  it("rejects a mismatched business ID even when entitlement is true", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok({
      business_id: "someone-else", has_advanced_access: true
    }));
    await expect(new TikTokBusinessEligibilityReader({
      ...base, fetchImpl
    }).get()).rejects.toMatchObject({ stage: "profile", retryable: false });
  });

  it("does not fetch until authorized token source is available", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const reader = new TikTokBusinessEligibilityReader({
      businessId: base.businessId,
      transport: "GET_QUERY",
      accessTokenProvider: {
        getAccessToken: () => Promise.reject(new Error("secret missing"))
      },
      fetchImpl
    });
    await expect(reader.get()).rejects.toMatchObject({
      stage: "access_token", retryable: false
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not leak provider failure bodies, even if they contain tokens", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        code: 40100,
        message: "secret-token private-message",
        data: { access_token: "secret-token" }
      }),
      { status: 403 }
    ));
    const reader = new TikTokBusinessEligibilityReader({ ...base, fetchImpl });
    let message = "";
    try {
      await reader.get();
    } catch (error) {
      expect(error).toBeInstanceOf(TikTokBusinessEligibilityError);
      expect(error).toMatchObject({
        retryable: false, providerCode: "40100", stage: "profile"
      });
      message = JSON.stringify(error);
    }
    expect(message).not.toContain("secret-token");
    expect(message).not.toContain("private-message");
  });

  it("never includes arbitrary provider error-code text in diagnostic metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        code: "secret-token-private-message",
        message: "private body"
      }), { status: 403 })
    );
    let errorCode: string | undefined;
    try {
      await new TikTokBusinessEligibilityReader({ ...base, fetchImpl }).get();
    } catch (error) {
      expect(error).toBeInstanceOf(TikTokBusinessEligibilityError);
      errorCode = (error as TikTokBusinessEligibilityError).providerCode;
      expect(JSON.stringify(error)).not.toContain("secret-token");
      expect(JSON.stringify(error)).not.toContain("private body");
    }
    expect(errorCode).toBeUndefined();
  });

  it("supports an explicitly verified JSON retrieval transport without URL identifiers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok({
      business_id: "owned-business-id", has_advanced_access: true
    }));
    await new TikTokBusinessEligibilityReader({
      ...base, transport: "POST_JSON", fetchImpl
    }).get();
    const [rawUrl, options] = fetchImpl.mock.calls[0]!;
    const url = new URL(rawUrl instanceof URL
      ? rawUrl.href
      : typeof rawUrl === "string" ? rawUrl : rawUrl.url
    );
    expect(url.search).toBe("");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(options?.body as string)).toEqual({
      business_id: "owned-business-id"
    });
  });

  it("requires a verified transport method and one token source", () => {
    expect(() => new TikTokBusinessEligibilityReader({
      ...base, transport: undefined as never
    })).toThrow("transport must be explicitly verified");
    expect(() => new TikTokBusinessEligibilityReader({
      ...base, accessTokenProvider: {
        getAccessToken: () => Promise.resolve("other")
      }
    })).toThrow("exactly one token source");
    expect(() => new TikTokBusinessEligibilityReader({
      ...base, apiVersion: "../v1.3"
    })).toThrow("API version is invalid");
  });

  it("safely classifies provider retryable errors without exposing messages", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 51065, message: "private" }), {
        status: 429
      })
    );
    await expect(new TikTokBusinessEligibilityReader({
      ...base, fetchImpl
    }).get()).rejects.toMatchObject({
      stage: "profile", retryable: true, status: 429, providerCode: "51065"
    });
  });

  it("treats a malformed provider response as a failure, not successful eligibility", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html>not json</html>", { status: 200 })
    );
    await expect(new TikTokBusinessEligibilityReader({
      ...base, fetchImpl
    }).get()).rejects.toMatchObject({
      stage: "profile", retryable: true
    });
  });
});
