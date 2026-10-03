import { describe, expect, it, vi } from "vitest";
import {
  TikTokMarketingAdvertiserClient,
  TikTokMarketingAdvertiserRequestError,
  TikTokMarketingAdvertiserService
} from "../src/marketing/tiktok-advertiser.js";
import { TikTokMarketingOAuthNotAuthorizedError } from "../src/auth/tiktok-marketing-oauth.js";
import { MemoryOAuthStore } from "./support/memory-oauth-store.js";

function requestUrl(value: string | URL | Request): URL {
  if (typeof value === "string") return new URL(value);
  return value instanceof URL ? value : new URL(value.url);
}

describe("TikTokMarketingAdvertiserClient", () => {
  it("reads ad-account details through the official v1.3 Account Management endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        list: [
          { advertiser_id: "200", name: "Second" },
          { advertiser_id: "100", name: "First" },
          { advertiser_id: "200", name: "Duplicate" }
        ]
      }
    }), { status: 200 }));
    const client = new TikTokMarketingAdvertiserClient({ fetchImpl });

    await expect(client.getAdvertiserIds(
      "marketing-access",
      ["200", "100"]
    )).resolves.toEqual(["100", "200"]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [urlValue, init] = fetchImpl.mock.calls[0]!;
    const url = requestUrl(urlValue);
    expect(url.origin + url.pathname)
      .toBe("https://business-api.tiktok.com/open_api/v1.3/advertiser/info/");
    expect(url.searchParams.getAll("advertiser_ids")).toEqual(["100", "200"]);
    expect(url.searchParams.has("fields")).toBe(false);
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Access-Token")).toBe("marketing-access");
  });


  it("requests only safe account-summary fields and drops sensitive provider fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        list: [
          {
            advertiser_id: "200",
            name: "Second account",
            status: "STATUS_ENABLE",
            currency: "PHP",
            timezone: "Asia/Manila",
            country: "PH",
            email: "secret@example.com",
            telephone_number: "+639171234567",
            address: "Private address",
            balance: 12345.67
          },
          {
            advertiser_id: "100",
            name: "First account",
            status: "STATUS_ENABLE",
            currency: "USD",
            timezone: "America/Los_Angeles",
            country: "US"
          }
        ]
      }
    }), { status: 200 }));
    const client = new TikTokMarketingAdvertiserClient({ fetchImpl });

    const result = await client.getAdvertiserAccounts(
      "marketing-access",
      ["200", "100"]
    );

    expect(result).toEqual([
      {
        advertiserId: "100",
        name: "First account",
        status: "STATUS_ENABLE",
        currency: "USD",
        timezone: "America/Los_Angeles",
        country: "US"
      },
      {
        advertiserId: "200",
        name: "Second account",
        status: "STATUS_ENABLE",
        currency: "PHP",
        timezone: "Asia/Manila",
        country: "PH"
      }
    ]);

    const [urlValue] = fetchImpl.mock.calls[0]!;
    const url = requestUrl(urlValue);
    expect(url.searchParams.getAll("advertiser_ids")).toEqual(["100", "200"]);
    expect(url.searchParams.getAll("fields")).toEqual([
      "advertiser_id",
      "country",
      "currency",
      "name",
      "status",
      "timezone"
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret@example.com");
    expect(serialized).not.toContain("+639171234567");
    expect(serialized).not.toContain("Private address");
    expect(serialized).not.toContain("12345.67");
  });

  it("rejects an empty advertiser request before network I/O", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new TikTokMarketingAdvertiserClient({ fetchImpl });

    await expect(client.getAdvertiserIds("marketing-access", []))
      .rejects.toMatchObject({
        retryable: false,
        stage: "advertiser_info"
      });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes only valid advertiser IDs and does not expose account fields", async () => {
    const client = new TikTokMarketingAdvertiserClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 0,
        data: {
          list: [
            { advertiser_id: "100", name: "First", currency: "PHP" },
            { advertiser_id: "" },
            { name: "No id" }
          ]
        }
      }), { status: 200 }))
    });

    const result = await client.getAdvertiserIds("marketing-access", ["100"]);
    expect(result).toEqual(["100"]);
    expect(JSON.stringify(result)).not.toContain("First");
    expect(JSON.stringify(result)).not.toContain("PHP");
  });


  it("treats TikTok provider throttling codes as retryable even on HTTP 200", async () => {
    const client = new TikTokMarketingAdvertiserClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 40100,
        message: "rate limited"
      }), { status: 200 }))
    });

    await expect(client.getAdvertiserIds("marketing-access", ["100"]))
      .rejects.toMatchObject({
        retryable: true,
        status: 200,
        providerCode: "40100",
        stage: "advertiser_info"
      });
  });

  it("classifies advertiser-info provider failures without leaking the access token", async () => {
    const token = "marketing-access-secret";
    const client = new TikTokMarketingAdvertiserClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        code: 40001,
        message: "no permission"
      }), { status: 200 }))
    });

    const result = client.getAdvertiserIds(token, ["100"]);
    await expect(result).rejects.toBeInstanceOf(TikTokMarketingAdvertiserRequestError);
    await expect(result).rejects.toMatchObject({
      retryable: false,
      status: 200,
      providerCode: "40001",
      stage: "advertiser_info"
    });
    let error: unknown;
    try {
      await result;
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).not.toContain(token);
  });
});

describe("TikTokMarketingAdvertiserService", () => {
  it("requires a durable Marketing authorization before account proof", async () => {
    const store = new MemoryOAuthStore();
    const getAdvertiserIds = vi.fn();
    const service = new TikTokMarketingAdvertiserService({
      store,
      client: { getAdvertiserIds, getAdvertiserAccounts: vi.fn() }
    });

    await expect(service.verifyAccountManagement())
      .rejects.toBeInstanceOf(TikTokMarketingOAuthNotAuthorizedError);
    expect(getAdvertiserIds).not.toHaveBeenCalled();
  });


  it("lists safe advertiser summaries across independent OAuth grants", async () => {
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "tiktok-marketing",
      accountId: "100",
      accessToken: "grant-a",
      scopes: []
    });
    await store.put({
      provider: "tiktok-marketing",
      accountId: "200",
      accessToken: "grant-a",
      scopes: []
    });
    await store.put({
      provider: "tiktok-marketing",
      accountId: "300",
      accessToken: "grant-b",
      scopes: []
    });
    const getAdvertiserAccounts = vi.fn()
      .mockImplementation((accessToken: string) => {
        if (accessToken === "grant-a") {
          return Promise.resolve([
            {
              advertiserId: "200",
              name: "Second",
              status: "STATUS_ENABLE",
              currency: "PHP",
              timezone: "Asia/Manila",
              country: "PH"
            },
            {
              advertiserId: "100",
              name: "First",
              status: "STATUS_ENABLE",
              currency: "PHP",
              timezone: "Asia/Manila",
              country: "PH"
            },
            { advertiserId: "999", name: "Not requested" }
          ]);
        }
        if (accessToken === "grant-b") {
          return Promise.resolve([
            { advertiserId: "300", name: "Third", status: "STATUS_ENABLE" }
          ]);
        }
        return Promise.resolve([]);
      });
    const service = new TikTokMarketingAdvertiserService({
      store,
      client: {
        getAdvertiserIds: vi.fn(),
        getAdvertiserAccounts
      }
    });

    const result = await service.listAccounts();
    expect(result).toEqual({
      accounts: [
        {
          advertiserId: "100",
          name: "First",
          status: "STATUS_ENABLE",
          currency: "PHP",
          timezone: "Asia/Manila",
          country: "PH"
        },
        {
          advertiserId: "200",
          name: "Second",
          status: "STATUS_ENABLE",
          currency: "PHP",
          timezone: "Asia/Manila",
          country: "PH"
        },
        { advertiserId: "300", name: "Third", status: "STATUS_ENABLE" }
      ]
    });
    expect(getAdvertiserAccounts).toHaveBeenCalledTimes(2);
    expect(getAdvertiserAccounts).toHaveBeenCalledWith("grant-a", ["100", "200"]);
    expect(getAdvertiserAccounts).toHaveBeenCalledWith("grant-b", ["300"]);
    expect(JSON.stringify(result)).not.toContain("grant-a");
    expect(JSON.stringify(result)).not.toContain("grant-b");
  });

  it("requires durable Marketing authorization before listing advertiser summaries", async () => {
    const store = new MemoryOAuthStore();
    const getAdvertiserAccounts = vi.fn();
    const service = new TikTokMarketingAdvertiserService({
      store,
      client: {
        getAdvertiserIds: vi.fn(),
        getAdvertiserAccounts
      }
    });

    await expect(service.listAccounts())
      .rejects.toBeInstanceOf(TikTokMarketingOAuthNotAuthorizedError);
    expect(getAdvertiserAccounts).not.toHaveBeenCalled();
  });

  it("proves every stored advertiser against the token grant that created it", async () => {
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "tiktok-marketing",
      accountId: "100",
      accessToken: "grant-a",
      scopes: []
    });
    await store.put({
      provider: "tiktok-marketing",
      accountId: "200",
      accessToken: "grant-a",
      scopes: []
    });
    await store.put({
      provider: "tiktok-marketing",
      accountId: "300",
      accessToken: "grant-b",
      scopes: []
    });
    const getAdvertiserIds = vi.fn()
      .mockImplementation((accessToken: string) => {
        if (accessToken === "grant-a") return Promise.resolve(["100", "200"]);
        if (accessToken === "grant-b") return Promise.resolve(["300"]);
        return Promise.resolve([]);
      });
    const service = new TikTokMarketingAdvertiserService({
      store,
      client: { getAdvertiserIds, getAdvertiserAccounts: vi.fn() }
    });

    await expect(service.verifyAccountManagement()).resolves.toEqual({
      verified: true,
      storedAdvertiserIds: ["100", "200", "300"],
      verifiedAdvertiserIds: ["100", "200", "300"],
      missingAdvertiserIds: []
    });
    expect(getAdvertiserIds).toHaveBeenCalledTimes(2);
    expect(getAdvertiserIds).toHaveBeenCalledWith("grant-a", ["100", "200"]);
    expect(getAdvertiserIds).toHaveBeenCalledWith("grant-b", ["300"]);
  });

  it("reports missing advertiser access without mutating durable credentials or leaking grants", async () => {
    const store = new MemoryOAuthStore();
    await store.put({
      provider: "tiktok-marketing",
      accountId: "100",
      accessToken: "marketing-access-secret",
      scopes: ["advertiser.info"]
    });
    await store.put({
      provider: "tiktok-marketing",
      accountId: "200",
      accessToken: "marketing-access-secret",
      scopes: ["advertiser.info"]
    });
    const service = new TikTokMarketingAdvertiserService({
      store,
      client: {
        getAdvertiserIds: vi.fn().mockResolvedValue(["100"]),
        getAdvertiserAccounts: vi.fn()
      }
    });

    const result = await service.verifyAccountManagement();
    expect(result).toEqual({
      verified: false,
      storedAdvertiserIds: ["100", "200"],
      verifiedAdvertiserIds: ["100"],
      missingAdvertiserIds: ["200"]
    });
    expect(JSON.stringify(result)).not.toContain("marketing-access-secret");
    expect(JSON.stringify(result)).not.toContain("advertiser.info");
    await expect(store.list("tiktok-marketing")).resolves.toEqual([
      expect.objectContaining({ accountId: "100", tokenVersion: 1 }),
      expect.objectContaining({ accountId: "200", tokenVersion: 1 })
    ]);
  });
});
