import { createHash, randomBytes } from "node:crypto";
import type { OAuthCredentialStore } from "./oauth-store.js";

interface TikTokOAuthClientOptions {
  appId: string;
  appSecret: string;
  apiVersion?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface TikTokOAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  accessExpiresInSeconds: number;
  refreshExpiresInSeconds?: number;
  openId?: string;
  scopes: readonly string[];
}

export interface TikTokOAuthClientLike {
  exchangeAuthorizationCode(
    authCode: string,
    redirectUri: string
  ): Promise<TikTokOAuthTokenResult>;
  refresh(refreshToken: string): Promise<TikTokOAuthTokenResult>;
}

export interface TikTokOAuthController {
  beginAuthorization(): Promise<{ authorizationUrl: string; expiresAt: string }>;
  completeAuthorization(
    state: string,
    authCode: string
  ): Promise<{
    businessId: string;
    scopes: readonly string[];
    accessExpiresAt: string;
    refreshExpiresAt?: string;
  }>;
  status(accountId?: string): Promise<TikTokOAuthStatus>;
}

export class TikTokOAuthRequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: string;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      status?: number;
      providerCode?: string;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TikTokOAuthRequestError";
    this.retryable = options.retryable;
    if (options.status !== undefined) this.status = options.status;
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
  }
}

export interface TikTokOAuthStatus {
  authorized: boolean;
  businessId?: string;
  scopes?: readonly string[];
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
  refreshAvailable?: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function providerCode(value: unknown): string | undefined {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : undefined;
}

function secondsValue(value: unknown): number | undefined {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : undefined;
  return number !== undefined && Number.isSafeInteger(number) && number > 0
    ? number
    : undefined;
}

function scopesValue(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string") {
    return value.split(/[ ,]+/u).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export class TikTokOAuthClient implements TikTokOAuthClientLike {
  readonly #appId: string;
  readonly #appSecret: string;
  readonly #apiVersion: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TikTokOAuthClientOptions) {
    this.#appId = options.appId;
    this.#appSecret = options.appSecret;
    this.#apiVersion = options.apiVersion ?? "v1.3";
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  exchangeAuthorizationCode(
    authCode: string,
    redirectUri: string
  ): Promise<TikTokOAuthTokenResult> {
    return this.#request("tt_user/oauth2/token/", {
      grant_type: "authorization_code",
      auth_code: authCode,
      client_secret: this.#appSecret,
      client_id: this.#appId,
      redirect_uri: redirectUri
    });
  }

  refresh(refreshToken: string): Promise<TikTokOAuthTokenResult> {
    return this.#request("tt_user/oauth2/refresh_token/", {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_secret: this.#appSecret,
      client_id: this.#appId
    });
  }

  async #request(path: string, payload: Record<string, unknown>): Promise<TikTokOAuthTokenResult> {
    let response: Response;
    try {
      response = await this.#fetch(
        `https://business-api.tiktok.com/open_api/${this.#apiVersion}/${path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.#requestTimeoutMs)
        }
      );
    } catch (error) {
      throw new TikTokOAuthRequestError(
        "TikTok OAuth request failed before a response was received",
        { retryable: true, cause: error }
      );
    }

    const raw: unknown = await response.json().catch(() => ({}));
    const body = record(raw);
    const code = body?.code;
    if (!response.ok || (code !== 0 && code !== "0")) {
      const message = stringValue(body?.message) ?? "unknown provider error";
      const codeString = providerCode(code);
      const retryable = response.status === 429
        || response.status >= 500
        || codeString === "40100"
        || codeString === "51065";
      throw new TikTokOAuthRequestError(
        `TikTok OAuth request was rejected: ${message.slice(0, 300)}`,
        {
          retryable,
          ...(response.status >= 400 ? { status: response.status } : {}),
          ...(codeString === undefined ? {} : { providerCode: codeString })
        }
      );
    }

    const data = record(body?.data);
    const accessToken = stringValue(data?.access_token);
    const accessExpiresInSeconds = secondsValue(data?.expires_in);
    if (accessToken === undefined || accessExpiresInSeconds === undefined) {
      throw new TikTokOAuthRequestError(
        "TikTok OAuth response did not contain a valid access token lifetime",
        { retryable: false }
      );
    }

    const refreshToken = stringValue(data?.refresh_token);
    const refreshExpiresInSeconds = secondsValue(data?.refresh_token_expires_in);
    const openId = stringValue(data?.open_id);
    return {
      accessToken,
      ...(refreshToken === undefined ? {} : { refreshToken }),
      accessExpiresInSeconds,
      ...(refreshExpiresInSeconds === undefined ? {} : { refreshExpiresInSeconds }),
      ...(openId === undefined ? {} : { openId }),
      scopes: scopesValue(data?.scope)
    };
  }
}

export interface TikTokOAuthServiceOptions {
  authorizationUrl: string;
  redirectUri: string;
  store: OAuthCredentialStore;
  client: TikTokOAuthClientLike;
  stateTtlSeconds?: number;
  now?: () => Date;
}

export class TikTokOAuthService implements TikTokOAuthController {
  readonly #authorizationUrl: URL;
  readonly #redirectUri: string;
  readonly #store: OAuthCredentialStore;
  readonly #client: TikTokOAuthClientLike;
  readonly #stateTtlSeconds: number;
  readonly #now: () => Date;

  constructor(options: TikTokOAuthServiceOptions) {
    this.#authorizationUrl = new URL(options.authorizationUrl);
    this.#redirectUri = options.redirectUri;
    this.#store = options.store;
    this.#client = options.client;
    this.#stateTtlSeconds = options.stateTtlSeconds ?? 600;
    this.#now = options.now ?? (() => new Date());
  }

  async beginAuthorization(): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const state = randomBytes(32).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const expiresAt = new Date(this.#now().getTime() + this.#stateTtlSeconds * 1000);
    await this.#store.createAuthorizationState(
      "tiktok",
      stateHash,
      this.#redirectUri,
      expiresAt
    );

    const url = new URL(this.#authorizationUrl);
    url.searchParams.set("state", state);
    return {
      authorizationUrl: url.toString(),
      expiresAt: expiresAt.toISOString()
    };
  }

  async completeAuthorization(
    state: string,
    authCode: string
  ): Promise<{
    businessId: string;
    scopes: readonly string[];
    accessExpiresAt: string;
    refreshExpiresAt?: string;
  }> {
    if (!/^[A-Za-z0-9_-]{20,256}$/u.test(state)) {
      throw new Error("TikTok OAuth state is invalid");
    }
    if (authCode.length < 8 || authCode.length > 2048) {
      throw new Error("TikTok authorization code is invalid");
    }

    const stateHash = createHash("sha256").update(state).digest("hex");
    const storedState = await this.#store.consumeAuthorizationState("tiktok", stateHash);
    if (storedState === undefined || storedState.redirectUri !== this.#redirectUri) {
      throw new Error("TikTok OAuth state is expired, invalid, or already consumed");
    }

    const result = await this.#client.exchangeAuthorizationCode(authCode, this.#redirectUri);
    if (result.openId === undefined) {
      throw new Error("TikTok OAuth response did not contain the Business Account open_id");
    }
    if (result.refreshToken === undefined) {
      throw new Error("TikTok OAuth response did not contain a refresh token");
    }

    const now = this.#now();
    const accessExpiresAt = new Date(now.getTime() + result.accessExpiresInSeconds * 1000);
    const refreshExpiresAt = result.refreshExpiresInSeconds === undefined
      ? undefined
      : new Date(now.getTime() + result.refreshExpiresInSeconds * 1000);

    await this.#store.put({
      provider: "tiktok",
      accountId: result.openId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      scopes: result.scopes,
      accessExpiresAt,
      ...(refreshExpiresAt === undefined ? {} : { refreshExpiresAt })
    });

    return {
      businessId: result.openId,
      scopes: result.scopes,
      accessExpiresAt: accessExpiresAt.toISOString(),
      ...(refreshExpiresAt === undefined
        ? {}
        : { refreshExpiresAt: refreshExpiresAt.toISOString() })
    };
  }

  async status(accountId?: string): Promise<TikTokOAuthStatus> {
    const credential = accountId === undefined
      ? await this.#store.latest("tiktok")
      : await this.#store.get("tiktok", accountId);
    if (credential === undefined) return { authorized: false };

    return {
      authorized: true,
      businessId: credential.accountId,
      scopes: credential.scopes,
      ...(credential.accessExpiresAt === undefined
        ? {}
        : { accessExpiresAt: credential.accessExpiresAt.toISOString() }),
      ...(credential.refreshExpiresAt === undefined
        ? {}
        : { refreshExpiresAt: credential.refreshExpiresAt.toISOString() }),
      refreshAvailable: credential.refreshToken !== undefined
    };
  }
}
