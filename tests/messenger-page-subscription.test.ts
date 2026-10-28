import { describe, expect, it, vi } from "vitest";
import {
  MESSENGER_PAGE_WEBHOOK_FIELDS,
  MessengerPageSubscriptionClient
} from "../src/auth/messenger-page-subscription.js";

const accountId = "123456789012";
const appId = "1042452472116584";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

function client(fetchImpl: typeof fetch): MessengerPageSubscriptionClient {
  return new MessengerPageSubscriptionClient({
    appId, graphApiVersion: "v26.0", fetchImpl
  });
}

describe("Messenger verified Page webhook subscriptions", () => {
  it("does not write when all approved Page fields are already subscribed", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: accountId }))
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: [...MESSENGER_PAGE_WEBHOOK_FIELDS]
      }] }));
    const knownPage = vi.fn().mockResolvedValue(true);
    await expect(client(fetchImpl).reconcile("page-access", knownPage))
      .resolves.toEqual({ changed: false });
    expect(knownPage).toHaveBeenCalledWith(accountId);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every((call) => call[1]?.method !== "POST")).toBe(true);
  });

  it("preserves existing Page fields and verifies a confirmed subscription upgrade", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: accountId }))
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: ["messages", "message_echoes"]
      }] }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: ["messages", "message_echoes", ...MESSENGER_PAGE_WEBHOOK_FIELDS]
      }] }));
    await expect(client(fetchImpl).reconcile("page-access", () => Promise.resolve(true)))
      .resolves.toEqual({ changed: true });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const [postUrl, postInit] = fetchImpl.mock.calls[2]!;
    if (typeof postUrl !== "string") throw new Error("Expected string Graph URL");
    expect(postUrl).toContain(`/v26.0/${accountId}/subscribed_apps`);
    expect(new URL(postUrl).searchParams.has("access_token")).toBe(false);
    expect(postInit?.method).toBe("POST");
    expect(postInit?.redirect).toBe("error");
    expect(new Headers(postInit?.headers).get("authorization")).toBe("Bearer page-access");
    expect(new Headers(postInit?.headers).get("content-type"))
      .toBe("application/x-www-form-urlencoded");
    if (typeof postInit?.body !== "string") throw new Error("Expected form-encoded body");
    const params = new URLSearchParams(postInit.body);
    expect(params.get("subscribed_fields")?.split(",")).toEqual(
      ["messages", "message_echoes", ...MESSENGER_PAGE_WEBHOOK_FIELDS.filter((f) => f !== "messages")]
    );
  });

  it("refuses to change any Page without proof it is the signed inbound account", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: accountId }));
    await expect(client(fetchImpl).reconcile("page-access", () => Promise.resolve(false)))
      .rejects.toMatchObject({ stage: "page_identity_mismatch" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never installs on a Page where this exact app is not already subscribed", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: accountId }))
      .mockResolvedValueOnce(json({ data: [{
        id: "999999999999", subscribed_fields: ["messages"]
      }] }));
    await expect(client(fetchImpl).reconcile("page-access", () => Promise.resolve(true)))
      .rejects.toMatchObject({ stage: "app_not_subscribed_to_page" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("redacts provider error details instead of exposing account, token or Graph error bodies", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: accountId }))
      .mockResolvedValueOnce(json({
        error: { message: "SECRET_FROM_PROVIDER" }
      }, 403));
    const err = await client(fetchImpl).reconcile("private-page-access", () => Promise.resolve(true))
      .catch((error: unknown) => error);
    expect(err).toMatchObject({ stage: "subscription_read", status: 403 });
    const message = String(err);
    expect(message).not.toContain("SECRET_FROM_PROVIDER");
    expect(message).not.toContain("private-page-access");
    expect(message).not.toContain(accountId);
  });
});
