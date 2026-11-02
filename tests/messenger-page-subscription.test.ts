import { describe, expect, it, vi } from "vitest";
import {
  MESSENGER_PAGE_WEBHOOK_FIELDS,
  MessengerPageSubscriptionClient
} from "../src/auth/messenger-page-subscription.js";

const pageId = "123456789012";
const appId = "1042452472116584";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

function client(fetchImpl: typeof fetch, graphProofAppSecret?: string): MessengerPageSubscriptionClient {
  return new MessengerPageSubscriptionClient({
    appId, graphApiVersion: "v26.0", graphProofAppSecret, fetchImpl
  });
}

const knownPage = () => Promise.resolve(true);

describe("Messenger verified Page webhook subscriptions", () => {
  it("does not write when all approved Page fields are already subscribed", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: [...MESSENGER_PAGE_WEBHOOK_FIELDS]
      }] }));
    const verify = vi.fn().mockResolvedValue(true);
    await expect(client(fetchImpl).reconcile("page-access", pageId, verify))
      .resolves.toEqual({ changed: false });
    expect(verify).toHaveBeenCalledWith(pageId);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    if (typeof url !== "string") throw new Error("Expected string Graph URL");
    expect(url).toContain(`/v26.0/${pageId}/subscribed_apps`);
    expect(url).not.toContain("/me?");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer page-access");
    expect(init?.method).not.toBe("POST");
  });

  it("preserves installed Page fields and verifies a confirmed subscription upgrade", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: ["messages", "message_echoes"]
      }] }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: ["messages", "message_echoes", ...MESSENGER_PAGE_WEBHOOK_FIELDS]
      }] }));
    await expect(client(fetchImpl).reconcile("page-access", pageId, knownPage))
      .resolves.toEqual({ changed: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [postUrl, postInit] = fetchImpl.mock.calls[1]!;
    if (typeof postUrl !== "string") throw new Error("Expected string Graph URL");
    expect(postUrl).toContain(`/v26.0/${pageId}/subscribed_apps`);
    expect(new URL(postUrl).searchParams.toString()).toBe("");
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

  it("signs verified Page subscription GET and POST requests when enabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: ["messages"]
      }] }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: [...MESSENGER_PAGE_WEBHOOK_FIELDS]
      }] }));
    await expect(client(fetchImpl, "matching-app-secret")
      .reconcile("page-access", pageId, knownPage)).resolves.toEqual({ changed: true });

    for (const [url, init] of fetchImpl.mock.calls) {
      const graphUrl = new URL(url as string);
      expect(graphUrl.origin).toBe("https://graph.facebook.com");
      expect(graphUrl.searchParams.get("appsecret_proof")).toMatch(/^[a-f0-9]{64}$/);
      expect(graphUrl.toString()).not.toContain("page-access");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer page-access");
      expect(init?.redirect).toBe("error");
    }
  });

  it("refuses Page access if its ID is not previously associated with signed inbound events", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(client(fetchImpl).reconcile("page-access", pageId, () => Promise.resolve(false)))
      .rejects.toMatchObject({ stage: "page_identity_mismatch" });
    await expect(client(fetchImpl).reconcile("page-access", "untrusted-alias", knownPage))
      .rejects.toMatchObject({ stage: "invalid_page_identity" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never installs this app on an unknown Page", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{
        id: "999999999999", subscribed_fields: ["messages"]
      }] }));
    await expect(client(fetchImpl).reconcile("page-access", pageId, knownPage))
      .rejects.toMatchObject({ stage: "app_not_subscribed_to_page" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports only provider numeric codes, not credential, Page identity or Graph response text", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      error: { message: "SECRET_FROM_PROVIDER", code: 100, error_subcode: 33 }
    }, 400));
    const err = await client(fetchImpl).reconcile("private-page-access", pageId, knownPage)
      .catch((error: unknown) => error);
    expect(err).toMatchObject({
      stage: "subscription_read", status: 400,
      graphCode: 100, graphSubcode: 33
    });
    const message = String(err);
    expect(message).not.toContain("SECRET_FROM_PROVIDER");
    expect(message).not.toContain("private-page-access");
    expect(message).not.toContain(pageId);
  });

  it("emits only the exact verified Page after successful subscribed-app readback", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ data: [{
      id: appId, subscribed_fields: [...MESSENGER_PAGE_WEBHOOK_FIELDS]
    }] }));
    const onVerifiedPage = vi.fn(async (_verifiedPageId: string) => undefined);
    await expect(client(fetchImpl).reconcile(
      "page-access", pageId, knownPage, onVerifiedPage
    )).resolves.toEqual({ changed: false });
    expect(onVerifiedPage).toHaveBeenCalledTimes(1);
    expect(onVerifiedPage).toHaveBeenCalledWith(pageId);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never emits an account grant from foreign app subscriptions or unverified Pages", async () => {
    const onVerifiedPage = vi.fn(async (_verifiedPageId: string) => undefined);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ data: [{
      id: "999999999999", subscribed_fields: [...MESSENGER_PAGE_WEBHOOK_FIELDS]
    }] }));
    await expect(client(fetchImpl).reconcile(
      "page-access", pageId, knownPage, onVerifiedPage
    )).rejects.toMatchObject({ stage: "app_not_subscribed_to_page" });
    await expect(client(fetchImpl).reconcile(
      "page-access", pageId, () => Promise.resolve(false), onVerifiedPage
    )).rejects.toMatchObject({ stage: "page_identity_mismatch" });
    expect(onVerifiedPage).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never emits a verified Page when a provider write lacks confirmed readback", async () => {
    const onVerifiedPage = vi.fn(async (_verifiedPageId: string) => undefined);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: ["messages"]
      }] }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: ["messages"]
      }] }));
    await expect(client(fetchImpl).reconcile(
      "page-access", pageId, knownPage, onVerifiedPage
    )).rejects.toMatchObject({ stage: "readback_mismatch" });
    expect(onVerifiedPage).not.toHaveBeenCalled();
  });

  it("emits Page evidence only after confirmed subscription upgrade", async () => {
    const onVerifiedPage = vi.fn(async (_verifiedPageId: string) => undefined);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: ["messages"]
      }] }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ data: [{
        id: appId, subscribed_fields: [...MESSENGER_PAGE_WEBHOOK_FIELDS]
      }] }));
    await expect(client(fetchImpl).reconcile(
      "page-access", pageId, knownPage, onVerifiedPage
    )).resolves.toEqual({ changed: true });
    expect(onVerifiedPage).toHaveBeenCalledTimes(1);
    expect(onVerifiedPage).toHaveBeenCalledWith(pageId);
  });
});
