import type { OAuthCredentialStore } from "../auth/oauth-store.js";
import { TikTokMarketingOAuthNotAuthorizedError } from "../auth/tiktok-marketing-oauth.js";

export type TikTokMarketingAdvertiserStage = "advertiser_info";

export interface TikTokMarketingAdvertiserClientLike {
  getAdvertiserIds(
    accessToken: string,
    advertiserIds: readonly string[]
  ): Promise<readonly string[]>;
}

interface TikTokMarketingAdvertiserClientOptions {
  apiVersion?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class TikTokMarketingAdvertiserRequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: string;
  readonly stage: TikTokMarketingAdvertiserStage;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      stage: TikTokMarketingAdvertiserStage;
      status?: number;
      providerCode?: string;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TikTokMarketingAdvertiserRequestError";
    this.retryable = options.retryable;
    this.stage = options.stage;
    if (options.status !== undefined) this.status = options.status;
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function providerCode(value: unknown): string | undefined {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : undefined;
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function normalizeAdvertiserIds(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
    .sort((a, b) => a.localeCompare(b));
}

export class TikTokMarketingAdvertiserClient
implements TikTokMarketingAdvertiserClientLike {
  readonly #apiVersion: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokMarketingAdvertiserClientOptions = {}) {
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async getAdvertiserIds(
    accessToken: string,
    advertiserIds: readonly string[]
  ): Promise<readonly string[]> {
    const requestedIds = normalizeAdvertiserIds(advertiserIds);
    if (requestedIds.length === 0) {
      throw new TikTokMarketingAdvertiserRequestError(
        "TikTok Marketing advertiser info requires at least one advertiser ID",
        { retryable: false, stage: "advertiser_info" }
      );
    }

    const url = new URL(
      `https://business-api.tiktok.com/open_api/${this.#apiVersion}/advertiser/info/`
    );
    for (const advertiserId of requestedIds) {
      url.searchParams.append("advertiser_ids", advertiserId);
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "Access-Token": accessToken
        },
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new TikTokMarketingAdvertiserRequestError(
        "TikTok Marketing advertiser info request failed before a response was received",
        { retryable: true, stage: "advertiser_info", cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => ({}));
    const body = record(raw) ?? {};
    const code = providerCode(body.code);
    if (!response.ok || (code !== undefined && code !== "0")) {
      throw new TikTokMarketingAdvertiserRequestError(
        "TikTok Marketing advertiser info request was rejected",
        {
          retryable: isRetryable(response.status),
          stage: "advertiser_info",
          status: response.status,
          ...(code === undefined ? {} : { providerCode: code })
        }
      );
    }

    const data = record(body.data);
    const list = Array.isArray(data?.list) ? data.list : [];
    const returnedIds = new Set<string>();
    for (const rawAdvertiser of list) {
      const advertiser = record(rawAdvertiser);
      const advertiserId = nonEmptyString(advertiser?.advertiser_id);
      if (advertiserId !== undefined) returnedIds.add(advertiserId);
    }
    return [...returnedIds].sort((a, b) => a.localeCompare(b));
  }
}

export interface TikTokMarketingAccountVerification {
  verified: boolean;
  storedAdvertiserIds: readonly string[];
  verifiedAdvertiserIds: readonly string[];
  missingAdvertiserIds: readonly string[];
}

export interface TikTokMarketingAdvertiserController {
  verifyAccountManagement(): Promise<TikTokMarketingAccountVerification>;
}

export class TikTokMarketingAdvertiserService
implements TikTokMarketingAdvertiserController {
  readonly #store: OAuthCredentialStore;
  readonly #client: TikTokMarketingAdvertiserClientLike;

  constructor(options: {
    store: OAuthCredentialStore;
    client: TikTokMarketingAdvertiserClientLike;
  }) {
    this.#store = options.store;
    this.#client = options.client;
  }

  async verifyAccountManagement(): Promise<TikTokMarketingAccountVerification> {
    const credentials = await this.#store.list("tiktok-marketing");
    if (credentials.length === 0) {
      throw new TikTokMarketingOAuthNotAuthorizedError();
    }

    const idsByToken = new Map<string, string[]>();
    for (const credential of credentials) {
      const advertiserIds = idsByToken.get(credential.accessToken) ?? [];
      advertiserIds.push(credential.accountId);
      idsByToken.set(credential.accessToken, advertiserIds);
    }

    const verified = new Set<string>();
    for (const [accessToken, advertiserIds] of idsByToken) {
      const requestedIds = normalizeAdvertiserIds(advertiserIds);
      const returnedIds = await this.#client.getAdvertiserIds(
        accessToken,
        requestedIds
      );
      const requestedSet = new Set(requestedIds);
      for (const advertiserId of returnedIds) {
        if (requestedSet.has(advertiserId)) verified.add(advertiserId);
      }
    }

    const storedAdvertiserIds = normalizeAdvertiserIds(
      credentials.map((credential) => credential.accountId)
    );
    const verifiedAdvertiserIds = storedAdvertiserIds.filter(
      (advertiserId) => verified.has(advertiserId)
    );
    const missingAdvertiserIds = storedAdvertiserIds.filter(
      (advertiserId) => !verified.has(advertiserId)
    );

    return {
      verified: missingAdvertiserIds.length === 0,
      storedAdvertiserIds,
      verifiedAdvertiserIds,
      missingAdvertiserIds
    };
  }
}
