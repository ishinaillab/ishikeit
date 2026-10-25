import {
  AccessTokenError,
  StaticAccessTokenProvider,
  type AccessTokenProvider
} from "../auth/token-provider.js";

/**
 * An unregistered, read-only TikTok account-tier preflight.
 * Business Messaging access, scopes, account-holder age, and approval must
 * be independently verified; has_advanced_access proves none of those.
 */
export type TikTokBusinessProfileTransport = "GET_QUERY" | "POST_JSON";

export interface TikTokBusinessEligibilitySnapshot {
  businessId: string;
  hasAdvancedAccess: boolean;
}

export type TikTokBusinessEligibilityStage = "access_token" | "profile";

export class TikTokBusinessEligibilityError extends Error {
  readonly stage: TikTokBusinessEligibilityStage;
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: string;

  constructor(
    message: string,
    options: {
      stage: TikTokBusinessEligibilityStage;
      retryable: boolean;
      status?: number;
      providerCode?: string;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TikTokBusinessEligibilityError";
    this.stage = options.stage;
    this.retryable = options.retryable;
    if (options.status !== undefined) this.status = options.status;
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
  }
}

export interface TikTokBusinessEligibilityReaderOptions {
  businessId: string;
  /** Select the provider-verified request method; no guessed default. */
  transport: TikTokBusinessProfileTransport;
  accessToken?: string;
  accessTokenProvider?: AccessTokenProvider;
  timeoutMs?: number;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function providerCode(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const code = String(value);
  // Provider codes are numeric; never promote arbitrary response text or
  // long untrusted strings into error metadata.
  return /^\d{1,8}$/.test(code) ? code : undefined;
}

export class TikTokBusinessEligibilityReader {
  readonly #businessId: string;
  readonly #transport: TikTokBusinessProfileTransport;
  readonly #accessTokenProvider: AccessTokenProvider;
  readonly #timeoutMs: number;
  readonly #apiVersion: string;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokBusinessEligibilityReaderOptions) {
    if (
      options.businessId.trim() !== options.businessId
      || options.businessId.length < 1 || options.businessId.length > 256
    ) {
      throw new Error("TikTok eligibility requires a valid business ID");
    }
    if ((options.accessToken === undefined) === (options.accessTokenProvider === undefined)) {
      throw new Error("TikTok eligibility requires exactly one token source");
    }
    if (options.transport !== "GET_QUERY" && options.transport !== "POST_JSON") {
      throw new Error("TikTok profile retrieval transport must be explicitly verified");
    }
    if (options.apiVersion !== undefined && !/^v\d+\.\d+$/.test(options.apiVersion)) {
      throw new Error("TikTok eligibility API version is invalid");
    }
    this.#businessId = options.businessId;
    this.#transport = options.transport;
    this.#accessTokenProvider = options.accessTokenProvider
      ?? new StaticAccessTokenProvider(options.accessToken!);
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async get(): Promise<TikTokBusinessEligibilitySnapshot> {
    let token: string;
    try {
      token = await this.#accessTokenProvider.getAccessToken();
      if (token.trim() === "") throw new Error("empty access token");
    } catch (error) {
      throw new TikTokBusinessEligibilityError(
        "TikTok account authorization unavailable",
        {
          stage: "access_token",
          retryable: error instanceof AccessTokenError ? error.retryable : false
        }
      );
    }

    // Official Business API guidance names business/get and has_advanced_access,
    // but access approval and request transport still need real-account readback.
    const url = new URL(
      `https://business-api.tiktok.com/open_api/${this.#apiVersion}/business/get/`
    );
    if (this.#transport === "GET_QUERY") {
      url.searchParams.set("business_id", this.#businessId);
    }
    const init: RequestInit = this.#transport === "GET_QUERY"
      ? {
          method: "GET",
          headers: { "Access-Token": token, accept: "application/json" }
        }
      : {
          method: "POST",
          headers: {
            "Access-Token": token,
            accept: "application/json",
            "content-type": "application/json"
          },
          body: JSON.stringify({ business_id: this.#businessId })
        };

    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch {
      throw new TikTokBusinessEligibilityError(
        "TikTok eligibility profile read did not complete",
        { stage: "profile", retryable: true }
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TikTokBusinessEligibilityError(
        "TikTok eligibility profile returned an invalid response",
        { stage: "profile", retryable: true, status: response.status }
      );
    }
    const envelope = record(payload);
    const code = providerCode(envelope?.code);
    if (!response.ok || code !== "0") {
      throw new TikTokBusinessEligibilityError(
        "TikTok eligibility profile read was rejected",
        {
          stage: "profile",
          retryable: response.status === 429 || response.status >= 500,
          status: response.status,
          ...(code === undefined ? {} : { providerCode: code })
        }
      );
    }

    const data = record(envelope?.data);
    if (data === undefined || (data.business_id !== undefined
      && data.business_id !== this.#businessId)) {
      throw new TikTokBusinessEligibilityError(
        "TikTok eligibility profile account does not match",
        { stage: "profile", retryable: false }
      );
    }
    if (typeof data.has_advanced_access !== "boolean") {
      throw new TikTokBusinessEligibilityError(
        "TikTok eligibility profile lacks a verified account-tier flag",
        { stage: "profile", retryable: false }
      );
    }

    return {
      businessId: this.#businessId,
      hasAdvancedAccess: data.has_advanced_access
    };
  }
}
