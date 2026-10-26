import { describe, expect, it, vi } from "vitest";
import type { OAuthCredential } from "../src/auth/oauth-store.js";
import {
  TikTokMessagingAvailabilityProbe
} from "../src/messaging/tiktok-availability-probe.js";

const NOW = new Date("2026-10-27T00:00:00Z");
const token = "sensitive-access-token-for-tests";
const accountId = "sensitive-owner-open-id";
const credential: OAuthCredential = {
  provider: "tiktok",
  accountId,
  accessToken: token,
  refreshToken: "sensitive-refresh-token",
  scopes: ["user.info.basic", "video.list"],
  accessExpiresAt: new Date("2026-10-28T00:00:00Z"),
  tokenVersion: 1
};

function makeProbe(credentials: OAuthCredential[], fetchImpl = vi.fn<typeof fetch>()) {
  const list = vi.fn().mockResolvedValue(credentials);
  return {
    list,
    fetchImpl,
    service: new TikTokMessagingAvailabilityProbe({
      store: { list },
      now: () => NOW,
      fetchImpl
    })
  };
}

describe("TikTok Messaging API availability probe", () => {
  it("makes exactly one smallest read with stored owner OAuth, redacting all conversation data", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          conversations: [
            { conversation_id: "personal-private-conversation-id", username: "private-person" }
          ]
        }
      }), { status: 200 }
    ));
    const { service, list } = makeProbe([credential], fetchImpl);
    const result = await service.probe();
    expect(result).toEqual({ status: "accepted", httpStatus: 200, providerCode: "0" });
    expect(list).toHaveBeenCalledWith("tiktok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    const url = typeof rawUrl === "string"
      ? new URL(rawUrl)
      : rawUrl instanceof URL ? rawUrl : new URL(rawUrl.url);
    expect(url.origin + url.pathname).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/message/conversation/list/"
    );
    expect(url.searchParams.get("business_id")).toBe(accountId);
    expect(url.searchParams.get("conversation_type")).toBe("SINGLE");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Access-Token")).toBe(token);
    const returned = JSON.stringify(result);
    for (const secret of [token, accountId, "personal-private-conversation-id", "private-person"]) {
      expect(returned).not.toContain(secret);
    }
  });

  it("classifies a denied Messaging API permission with no token or provider message returned", async () => {
    const providerMessage = "Provider error contains personal data and secret";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ code: 40003, message: providerMessage }),
      { status: 403 }
    ));
    const result = await makeProbe([credential], fetchImpl).service.probe();
    expect(result).toEqual({
      status: "provider_rejected", httpStatus: 403, providerCode: "40003"
    });
    expect(JSON.stringify(result)).not.toContain(providerMessage);
  });

  it("rejects an unsuccessful TikTok business-code response even with HTTP 200", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ code: 40100, message: "not authorized" }),
      { status: 200 }
    ));
    await expect(makeProbe([credential], fetchImpl).service.probe()).resolves.toEqual({
      status: "provider_rejected", httpStatus: 200, providerCode: "40100"
    });
  });

  it("fails closed with no provider calls when authorization is absent, ambiguous or expired", async () => {
    const missing = makeProbe([]);
    expect(await missing.service.probe()).toEqual({ status: "no_stored_authorization" });
    const ambiguous = makeProbe([credential, { ...credential, accountId: "second" }]);
    expect(await ambiguous.service.probe()).toEqual({ status: "ambiguous_authorization" });
    const expired = makeProbe([{ ...credential, accessExpiresAt: NOW }]);
    expect(await expired.service.probe()).toEqual({ status: "access_token_expired" });
    for (const result of [missing, ambiguous, expired]) {
      expect(result.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("maps transport errors to sanitized unavailability", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret in network error"));
    const result = await makeProbe([credential], fetchImpl).service.probe();
    expect(result).toEqual({ status: "provider_unavailable" });
  });

  it("treats bad, missing or oversized provider payloads as inconclusive, not accepted", async () => {
    for (const body of ["not json", "{}", JSON.stringify({ code: 0, data: "x".repeat(50000) })]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
        body,
        { status: 200 }
      ));
      expect(await makeProbe([credential], fetchImpl).service.probe()).toEqual({
        status: "invalid_provider_response",
        httpStatus: 200
      });
    }
  });

  it("never refreshes OAuth or performs a provider write", async () => {
    const refresh = vi.fn();
    const list = vi.fn().mockResolvedValue([credential]);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ code: 0, data: { conversations: [] } }), { status: 200 }
    ));
    const service = new TikTokMessagingAvailabilityProbe({
      store: { list },
      fetchImpl,
      now: () => NOW
    });
    await service.probe();
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe("GET");
  });
});
