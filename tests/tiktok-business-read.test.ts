import { describe, expect, it, vi } from "vitest";
import { AccessTokenError } from "../src/auth/token-provider.js";
import {
  TikTokBusinessMessagingNotAuthorizedError,
  TikTokBusinessMessagingReadClient,
  TikTokBusinessMessagingReadError,
  TikTokBusinessMessagingValidationError
} from "../src/messaging/tiktok-business-read.js";

function requestUrl(value: string | URL | Request): URL {
  if (typeof value === "string") return new URL(value);
  return value instanceof URL ? value : new URL(value.url);
}

describe("TikTokBusinessMessagingReadClient", () => {
  it("checks IMAGE_SEND capability for an exact conversation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          capability_infos: [
            { capability_type: "IMAGE_SEND", capability_result: true }
          ]
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const client = new TikTokBusinessMessagingReadClient({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });

    await expect(client.checkImageSendCapability({
      conversationId: "conv+1",
      conversationType: "SINGLE"
    })).resolves.toEqual({
      conversationId: "conv+1",
      conversationType: "SINGLE",
      imageSend: true
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    const url = requestUrl(rawUrl);
    expect(url.origin + url.pathname).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/message/capabilities/get/"
    );
    expect(url.searchParams.get("business_id")).toBe("business-1");
    expect(url.searchParams.get("capability_types")).toBe('["IMAGE_SEND"]');
    expect(url.searchParams.get("conversation_id")).toBe("conv+1");
    expect(url.searchParams.get("conversation_type")).toBe("SINGLE");
    expect(url.toString()).toContain("conversation_id=conv%2B1");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Access-Token"))
      .toBe("access-token-123456789");
  });

  it("lists conversation summaries without referral or participant metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          conversations: [
            {
              conversation_id: "conv-2",
              up_time: 1791061200123,
              referral: {
                ad: [{ advertiser_id: "adv-secret", ad_name: "Private Campaign" }]
              }
            },
            {
              conversation_id: "conv-1",
              up_time: 1791061100000
            }
          ],
          has_more: true,
          cursor: 1791060000000
        }
      }),
      { status: 200 }
    ));
    const client = new TikTokBusinessMessagingReadClient({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });

    const result = await client.listConversations({
      conversationType: "SINGLE",
      limit: 25,
      cursor: 1791050000000
    });

    expect(result).toEqual({
      conversations: [
        { conversationId: "conv-2", updatedAtMs: 1791061200123 },
        { conversationId: "conv-1", updatedAtMs: 1791061100000 }
      ],
      hasMore: true,
      cursor: 1791060000000
    });
    expect(JSON.stringify(result)).not.toContain("adv-secret");
    expect(JSON.stringify(result)).not.toContain("Private Campaign");

    const [rawUrl] = fetchImpl.mock.calls[0]!;
    const url = requestUrl(rawUrl);
    expect(url.origin + url.pathname).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/message/conversation/list/"
    );
    expect(url.searchParams.get("business_id")).toBe("business-1");
    expect(url.searchParams.get("conversation_type")).toBe("SINGLE");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("cursor")).toBe("1791050000000");
  });

  it("lists safe message history while dropping usernames, participant IDs, and profile images", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          messages: [
            {
              sender: "private_username",
              recipient: "ishi_business",
              conversation_id: "conv+1",
              message_id: "msg-1",
              timestamp: 1791061200123,
              message_type: "TEXT",
              auto_message_type: "WELCOME_MESSAGE",
              message_tag: { source: "APP" },
              text: { body: "Hello from TikTok" },
              from_user: {
                role: "PERSONAL_ACCOUNT",
                id: "personal-private-id",
                display_name: "Private Name",
                profile_image: "https://private.example/avatar.jpg"
              },
              to_user: {
                role: "BUSINESS_ACCOUNT",
                id: "business-1",
                display_name: "Ishi"
              },
              referenced_message_info: {
                referenced_message_id: "msg-0"
              }
            },
            {
              conversation_id: "conv+1",
              message_id: "msg-2",
              timestamp: 1791061300000,
              message_type: "IMAGE",
              image: { media_id: "provider-media-secret" },
              from_user: { role: "BUSINESS_ACCOUNT", id: "business-1" },
              to_user: { role: "PERSONAL_ACCOUNT", id: "personal-private-id" }
            }
          ],
          participants: [
            {
              role: "PERSONAL_ACCOUNT",
              id: "personal-private-id",
              display_name: "Private Name",
              profile_image: "https://private.example/avatar.jpg"
            }
          ]
        }
      }),
      { status: 200 }
    ));
    const client = new TikTokBusinessMessagingReadClient({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl
    });

    const result = await client.listMessages("conv+1");

    expect(result).toEqual({
      conversationId: "conv+1",
      messages: [
        {
          messageId: "msg-1",
          conversationId: "conv+1",
          timestampMs: 1791061200123,
          messageType: "TEXT",
          source: "APP",
          fromRole: "PERSONAL_ACCOUNT",
          toRole: "BUSINESS_ACCOUNT",
          autoMessageType: "WELCOME_MESSAGE",
          text: "Hello from TikTok",
          referencedMessageId: "msg-0"
        },
        {
          messageId: "msg-2",
          conversationId: "conv+1",
          timestampMs: 1791061300000,
          messageType: "IMAGE",
          fromRole: "BUSINESS_ACCOUNT",
          toRole: "PERSONAL_ACCOUNT"
        }
      ]
    });

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "private_username",
      "personal-private-id",
      "Private Name",
      "private.example",
      "provider-media-secret"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const [rawUrl] = fetchImpl.mock.calls[0]!;
    const url = requestUrl(rawUrl);
    expect(url.origin + url.pathname).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/message/content/list/"
    );
    expect(url.searchParams.get("business_id")).toBe("business-1");
    expect(url.searchParams.get("conversation_id")).toBe("conv+1");
    expect(url.toString()).toContain("conversation_id=conv%2B1");
  });

  it("rejects invalid read inputs before token or network access", async () => {
    const getAccessToken = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new TikTokBusinessMessagingReadClient({
      businessId: "business-1",
      accessTokenProvider: { getAccessToken },
      fetchImpl
    });

    await expect(client.listConversations({
      conversationType: "GROUP" as "SINGLE",
      limit: 25
    })).rejects.toBeInstanceOf(TikTokBusinessMessagingValidationError);
    await expect(client.listConversations({
      conversationType: "SINGLE",
      limit: 101
    })).rejects.toBeInstanceOf(TikTokBusinessMessagingValidationError);
    await expect(client.listMessages(""))
      .rejects.toBeInstanceOf(TikTokBusinessMessagingValidationError);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a reauthorization-required token failure separately from provider failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new TikTokBusinessMessagingReadClient({
      businessId: "business-1",
      accessTokenProvider: {
        getAccessToken: () => Promise.reject(new AccessTokenError(
          "reauthorization required",
          { retryable: false }
        ))
      },
      fetchImpl
    });

    await expect(client.listConversations({
      conversationType: "SINGLE",
      limit: 10
    })).rejects.toBeInstanceOf(TikTokBusinessMessagingNotAuthorizedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies TikTok throttling as retryable even when returned with HTTP 200", async () => {
    const client = new TikTokBusinessMessagingReadClient({
      businessId: "business-1",
      accessToken: "access-token-123456789",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({ code: 40100, message: "rate limited" }),
        { status: 200 }
      ))
    });

    await expect(client.listConversations({
      conversationType: "STRANGER",
      limit: 10
    })).rejects.toMatchObject({
      retryable: true,
      status: 200,
      providerCode: "40100",
      stage: "conversation_list"
    });
  });

  it("uses a generic read error that never includes the access token", async () => {
    const token = "access-token-secret-value";
    const result = new TikTokBusinessMessagingReadClient({
      businessId: "business-1",
      accessToken: token,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({ code: 40001, message: "provider rejected request" }),
        { status: 200 }
      ))
    }).checkImageSendCapability({
      conversationId: "conv-1",
      conversationType: "SINGLE"
    });

    await expect(result).rejects.toBeInstanceOf(TikTokBusinessMessagingReadError);
    let error: unknown;
    try {
      await result;
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).not.toContain(token);
  });
});
