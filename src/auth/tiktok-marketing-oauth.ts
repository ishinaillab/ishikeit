export type TikTokMarketingOAuthStage =
  | "token_exchange"
  | "advertiser_discovery";

export interface TikTokMarketingTokenResult {
  accessToken: string;
  scopes?: readonly string[];
}

export interface TikTokMarketingAdvertiser {
  advertiserId: string;
  advertiserName?: string;
}

export interface TikTokMarketingOAuthClientLike {
  exchangeAuthorizationCode(authCode: string): Promise<TikTokMarketingTokenResult>;
  listAuthorizedAdvertisers(
    accessToken: string
  ): Promise<readonly TikTokMarketingAdvertiser[]>;
}

interface TikTokMarketingOAuthClientOptions {
  appId: string;
  appSecret: string;
  apiVersion?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class TikTokMarketingOAuthRequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: string;
  readonly stage: TikTokMarketingOAuthStage;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      stage: TikTokMarketingOAuthStage;
      status?: number;
      providerCode?: string;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TikTokMarketingOAuthRequestError";
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

function scopesValue(value: unknown): readonly string[] | undefined {
  const scopes = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : typeof value === "string"
      ? value.split(/[ ,]+/u).map((item) => item.trim()).filter(Boolean)
      : [];
  return scopes.length === 0 ? undefined : scopes;
}

function retryable(status: number, code: string | undefined): boolean {
  return status === 429
    || status >= 500
    || code === "40100"
    || code === "51065";
}

export class TikTokMarketingOAuthClient implements TikTokMarketingOAuthClientLike {
  readonly #appId: string;
  readonly #appSecret: string;
  readonly #apiVersion: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokMarketingOAuthClientOptions) {
    this.#appId = options.appId;
    this.#appSecret = options.appSecret;
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async exchangeAuthorizationCode(
    authCode: string
  ): Promise<TikTokMarketingTokenResult> {
    const body = await this.#request(
      "token_exchange",
      `https://business-api.tiktok.com/open_api/${this.#apiVersion}/oauth2/access_token/`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          app_id: this.#appId,
          auth_code: authCode,
          secret: this.#appSecret
        })
      }
    );

    const data = record(body.data);
    const accessToken = nonEmptyString(data?.access_token);
    if (accessToken === undefined) {
      throw new TikTokMarketingOAuthRequestError(
        "TikTok Marketing OAuth response did not contain a valid access token",
        { retryable: false, stage: "token_exchange" }
      );
    }

    const scopes = scopesValue(data?.scope);
    return {
      accessToken,
      ...(scopes === undefined ? {} : { scopes })
    };
  }

  async listAuthorizedAdvertisers(
    accessToken: string
  ): Promise<readonly TikTokMarketingAdvertiser[]> {
    const url = new URL(
      `https://business-api.tiktok.com/open_api/${this.#apiVersion}/oauth2/advertiser/get/`
    );
    url.searchParams.set("app_id", this.#appId);
    url.searchParams.set("secret", this.#appSecret);

    const body = await this.#request(
      "advertiser_discovery",
      url,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "Access-Token": accessToken
        }
      }
    );

    const data = record(body.data);
    const list = Array.isArray(data?.list) ? data.list : [];
    const advertisers = new Map<string, TikTokMarketingAdvertiser>();
    for (const raw of list) {
      const item = record(raw);
      const advertiserId = nonEmptyString(item?.advertiser_id);
      if (advertiserId === undefined || advertisers.has(advertiserId)) continue;
      const advertiserName = nonEmptyString(item?.advertiser_name);
      advertisers.set(advertiserId, {
        advertiserId,
        ...(advertiserName === undefined ? {} : { advertiserName })
      });
    }
    return [...advertisers.values()].sort((a, b) =>
      a.advertiserId.localeCompare(b.advertiserId)
    );
  }

  async #request(
    stage: TikTokMarketingOAuthStage,
    url: string | URL,
    init: RequestInit
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new TikTokMarketingOAuthRequestError(
        "TikTok Marketing OAuth request failed before a response was received",
        { retryable: true, stage, cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => ({}));
    const body = record(raw) ?? {};
    const code = providerCode(body.code);
    if (!response.ok || (code !== undefined && code !== "0")) {
      throw new TikTokMarketingOAuthRequestError(
        "TikTok Marketing OAuth request was rejected",
        {
          retryable: retryable(response.status, code),
          stage,
          ...(response.status >= 400 ? { status: response.status } : {}),
          ...(code === undefined ? {} : { providerCode: code })
        }
      );
    }

    return body;
  }
}
