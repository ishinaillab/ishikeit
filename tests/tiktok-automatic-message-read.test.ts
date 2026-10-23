import { describe, expect, it, vi } from "vitest";
import {
  TikTokAutoMessageReader,
  TikTokAutoMessageReadError
} from "../src/messaging/tiktok-automatic-message-read.js";

const base = {
  businessId: "business-1",
  accessToken: "test-token"
};

function ok(data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ code: 0, message: "OK", data }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("TikTokAutoMessageReader (dormant, read-only)", () => {
  it("reads a welcome message using account-level Business Messaging API, never Ads creative API", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok({
      business_id: "business-1",
      operation_status: "ENABLE",
      auto_messages: [{
        auto_message_id: "welcome-1",
        auto_message_type: "WELCOME_MESSAGE",
        audit_status: "APPROVED",
        welcome_message: { content: "Private configured message text" }
      }]
    }));
    const client = new TikTokAutoMessageReader({ ...base, fetchImpl });
    await expect(client.get("WELCOME_MESSAGE")).resolves.toEqual({
      businessId: "business-1",
      type: "WELCOME_MESSAGE",
      enabled: true,
      messages: [{ id: "welcome-1", type: "WELCOME_MESSAGE", auditStatus: "APPROVED" }]
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.origin).toBe("https://business-api.tiktok.com");
    expect(url.pathname).toBe("/open_api/v1.3/business/message/auto_message/get/");
    expect(url.searchParams.get("business_id")).toBe("business-1");
    expect(url.searchParams.get("auto_message_type")).toBe("WELCOME_MESSAGE");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toMatchObject({ "Access-Token": "test-token" });
    expect(init?.body).toBeUndefined();
  });

  it("handles the disabled suggested-question list without mutating it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok({
      operation_status: "DISABLE",
      auto_messages: []
    }));
    const client = new TikTokAutoMessageReader({ ...base, fetchImpl });
    await expect(client.get("SUGGESTED_QUESTION")).resolves.toEqual({
      businessId: "business-1",
      type: "SUGGESTED_QUESTION",
      enabled: false,
      messages: []
    });
  });

  it("refuses provider responses for a different account", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok({
      business_id: "another-account",
      operation_status: "ENABLE",
      auto_messages: []
    }));
    const client = new TikTokAutoMessageReader({ ...base, fetchImpl });
    await expect(client.get("CHAT_PROMPT")).rejects.toMatchObject({
      retryable: false,
      stage: "get"
    });
  });

  it("fails closed rather than inventing an empty list when provider data is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok({
      operation_status: "ENABLE"
    }));
    const client = new TikTokAutoMessageReader({ ...base, fetchImpl });
    await expect(client.get("FOLLOW_WELCOME")).rejects.toMatchObject({
      retryable: true,
      stage: "get"
    });
  });

  it("classifies rate limits without leaking the provider's body text", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        code: 51065,
        message: "Don't copy this potentially sensitive vendor message"
      }), { status: 429, headers: { "content-type": "application/json" } })
    );
    const client = new TikTokAutoMessageReader({ ...base, fetchImpl });
    await expect(client.get("WELCOME_MESSAGE")).rejects.toMatchObject({
      name: "TikTokAutoMessageReadError",
      retryable: true,
      providerCode: "51065",
      status: 429
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not call the provider when account credentials are absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new TikTokAutoMessageReader({
      businessId: "business-1",
      accessTokenProvider: {
        getAccessToken: async () => {
          throw new Error("no authorization yet");
        }
      },
      fetchImpl
    });
    await expect(client.get("WELCOME_MESSAGE")).rejects.toBeInstanceOf(
      TikTokAutoMessageReadError
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unsupported types before any external request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new TikTokAutoMessageReader({ ...base, fetchImpl });
    await expect(client.get("CREATIVE_WELCOME" as never)).rejects.toThrow(
      "Unsupported TikTok automatic-message type"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
