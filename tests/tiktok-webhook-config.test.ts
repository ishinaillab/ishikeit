import { describe, expect, it, vi } from "vitest";
import {
  TikTokBusinessWebhookClient,
  TikTokBusinessWebhookRequestError,
  TikTokBusinessWebhookService
} from "../src/messaging/tiktok-webhook-config.js";

function requestUrl(value: string | URL | Request): URL {
  if (typeof value === "string") return new URL(value);
  return value instanceof URL ? value : new URL(value.url);
}

describe("TikTokBusinessWebhookClient", () => {
  it("reads the current DIRECT_MESSAGE webhook configuration", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          app_id: "app-123",
          event_type: "DIRECT_MESSAGE",
          callback_url: "https://apps.ishinaillab.com/ishikeit/webhooks/tiktok"
        }
      }),
      { status: 200 }
    ));
    const client = new TikTokBusinessWebhookClient({
      appId: "app-123",
      appSecret: "super-secret-value",
      fetchImpl
    });

    await expect(client.getDirectMessageWebhook()).resolves.toEqual({
      configured: true,
      callbackUrl: "https://apps.ishinaillab.com/ishikeit/webhooks/tiktok"
    });

    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    const url = requestUrl(rawUrl);
    expect(url.origin + url.pathname).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/webhook/list/"
    );
    expect(url.searchParams.get("app_id")).toBe("app-123");
    expect(url.searchParams.get("secret")).toBe("super-secret-value");
    expect(url.searchParams.get("event_type")).toBe("DIRECT_MESSAGE");
    expect(init?.method).toBe("GET");
  });

  it("treats an absent callback_url as an unconfigured DIRECT_MESSAGE webhook", async () => {
    const client = new TikTokBusinessWebhookClient({
      appId: "app-123",
      appSecret: "super-secret-value",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: { app_id: "app-123", event_type: "DIRECT_MESSAGE" }
        }),
        { status: 200 }
      ))
    });

    await expect(client.getDirectMessageWebhook()).resolves.toEqual({
      configured: false
    });
  });

  it("creates or updates only the DIRECT_MESSAGE webhook callback", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          app_id: "app-123",
          event_type: "DIRECT_MESSAGE",
          callback_url: "https://apps.ishinaillab.com/ishikeit/webhooks/tiktok"
        }
      }),
      { status: 200 }
    ));
    const client = new TikTokBusinessWebhookClient({
      appId: "app-123",
      appSecret: "super-secret-value",
      fetchImpl
    });

    await expect(client.setDirectMessageWebhook(
      "https://apps.ishinaillab.com/ishikeit/webhooks/tiktok"
    )).resolves.toEqual({
      configured: true,
      callbackUrl: "https://apps.ishinaillab.com/ishikeit/webhooks/tiktok"
    });

    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    const url = requestUrl(rawUrl);
    expect(url.origin + url.pathname).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/webhook/update/"
    );
    expect(url.search).toBe("");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type"))
      .toContain("application/json");
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(init?.body as string)).toEqual({
      app_id: "app-123",
      secret: "super-secret-value",
      event_type: "DIRECT_MESSAGE",
      callback_url: "https://apps.ishinaillab.com/ishikeit/webhooks/tiktok"
    });
  });

  it("classifies provider throttling without leaking app secret", async () => {
    const secret = "super-secret-value";
    const result = new TikTokBusinessWebhookClient({
      appId: "app-123",
      appSecret: secret,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({ code: 40100, message: "rate limited" }),
        { status: 200 }
      ))
    }).getDirectMessageWebhook();

    await expect(result).rejects.toBeInstanceOf(TikTokBusinessWebhookRequestError);
    await expect(result).rejects.toMatchObject({
      retryable: true,
      status: 200,
      providerCode: "40100",
      stage: "webhook_get"
    });
    let error: unknown;
    try {
      await result;
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).not.toContain(secret);
  });
});

describe("TikTokBusinessWebhookService", () => {
  const expectedCallback =
    "https://apps.ishinaillab.com/ishikeit/webhooks/tiktok";

  it("reports webhook status without writing", async () => {
    const getDirectMessageWebhook = vi.fn().mockResolvedValue({
      configured: true,
      callbackUrl: expectedCallback
    });
    const setDirectMessageWebhook = vi.fn();
    const service = new TikTokBusinessWebhookService({
      expectedCallbackUrl: expectedCallback,
      client: { getDirectMessageWebhook, setDirectMessageWebhook }
    });

    await expect(service.status()).resolves.toEqual({
      configured: true,
      matchesExpected: true,
      expectedCallbackUrl: expectedCallback,
      callbackUrl: expectedCallback
    });
    expect(setDirectMessageWebhook).not.toHaveBeenCalled();
  });

  it("reconcile is a no-op when TikTok already matches Ishikeit", async () => {
    const getDirectMessageWebhook = vi.fn().mockResolvedValue({
      configured: true,
      callbackUrl: expectedCallback
    });
    const setDirectMessageWebhook = vi.fn();
    const service = new TikTokBusinessWebhookService({
      expectedCallbackUrl: expectedCallback,
      client: { getDirectMessageWebhook, setDirectMessageWebhook }
    });

    await expect(service.reconcile()).resolves.toEqual({
      changed: false,
      configured: true,
      matchesExpected: true,
      expectedCallbackUrl: expectedCallback,
      callbackUrl: expectedCallback
    });
    expect(setDirectMessageWebhook).not.toHaveBeenCalled();
  });

  it("reconcile creates or updates drifted webhook state and reads back the result", async () => {
    const getDirectMessageWebhook = vi.fn()
      .mockResolvedValueOnce({
        configured: true,
        callbackUrl: "https://old.example/webhook"
      })
      .mockResolvedValueOnce({
        configured: true,
        callbackUrl: expectedCallback
      });
    const setDirectMessageWebhook = vi.fn().mockResolvedValue({
      configured: true,
      callbackUrl: expectedCallback
    });
    const service = new TikTokBusinessWebhookService({
      expectedCallbackUrl: expectedCallback,
      client: { getDirectMessageWebhook, setDirectMessageWebhook }
    });

    await expect(service.reconcile()).resolves.toEqual({
      changed: true,
      configured: true,
      matchesExpected: true,
      expectedCallbackUrl: expectedCallback,
      callbackUrl: expectedCallback
    });
    expect(setDirectMessageWebhook).toHaveBeenCalledWith(expectedCallback);
    expect(getDirectMessageWebhook).toHaveBeenCalledTimes(2);
  });

  it("reports unsuccessful readback instead of claiming convergence", async () => {
    const getDirectMessageWebhook = vi.fn()
      .mockResolvedValueOnce({ configured: false })
      .mockResolvedValueOnce({
        configured: true,
        callbackUrl: "https://unexpected.example/webhook"
      });
    const setDirectMessageWebhook = vi.fn().mockResolvedValue({
      configured: true,
      callbackUrl: expectedCallback
    });
    const service = new TikTokBusinessWebhookService({
      expectedCallbackUrl: expectedCallback,
      client: { getDirectMessageWebhook, setDirectMessageWebhook }
    });

    await expect(service.reconcile()).resolves.toEqual({
      changed: true,
      configured: true,
      matchesExpected: false,
      expectedCallbackUrl: expectedCallback,
      callbackUrl: "https://unexpected.example/webhook"
    });
  });
});
