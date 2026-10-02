import { createHash, randomBytes } from "node:crypto";
import type { OAuthCredentialStore } from "./oauth-store.js";

const DEFAULT_AUTHORIZATION_URL = "https://www.instagram.com/oauth/authorize";
const TOKEN_EXCHANGE_URL = "https://api.instagram.com/oauth/access_token";
const LONG_LIVED_TOKEN_URL = "https://graph.instagram.com/access_token";
const REFRESH_TOKEN_URL = "https://graph.instagram.com/refresh_access_token";

export const INSTAGRAM_REVIEW_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages"
] as const;

interface InstagramOAuthClientOptions {
  appId: string;
  appSecret: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface InstagramShortLivedTokenResult {
  accessToken: string;
  userId: string;
  scopes: readonly string[];
}

export interface InstagramLongLivedTokenResult {
  accessToken: string;
  accessExpiresInSeconds: number;
}

export interface InstagramOAuthClientLike {
  exchangeAuthorizationCode(
    code: string,
    redirectUri: string
  ): Promise<InstagramShortLivedTokenResult>;
  exchangeLongLived(accessToken: string): Promise<InstagramLongLivedTokenResult>;
  refresh(accessToken: string): Promise<InstagramLongLivedTokenResult>;
}

export interface InstagramOAuthStatus {
  authorized: boolean;
  accountId?: string;
  scopes?: readonly string[];
  accessExpiresAt?: string;
}

export interface InstagramOAuthController {
  beginAuthorization(): Promise<{ authorizationUrl: string; expiresAt: string }>;
  completeAuthorization(
    state: string,
    code: string
  ): Promise<{
    accountId: string;
    scopes: readonly string[];
    accessExpiresAt: string;
  }>;
  status(accountId?: string): Promise<InstagramOAuthStatus>;
}

export class InstagramOAuthRequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: string;
  readonly reason?: string;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      status?: number;
      providerCode?: string;
      reason?: string;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "InstagramOAuthRequestError";
    this.retryable = options.retryable;
    if (options.status !== undefined) this.status = options.status;
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
    if (options.reason !== undefined) this.reason = options.reason;
  }
}

export type InstagramOAuthFlowStage =
  | "short_token_exchange"
  | "long_token_exchange"
  | "credential_persistence";

export class InstagramOAuthFlowError extends Error {
  readonly stage: InstagramOAuthFlowStage;

  constructor(stage: InstagramOAuthFlowStage, cause: unknown) {
    super(`Instagram OAuth flow failed at ${stage}`, { cause });
    this.name = "InstagramOAuthFlowError";
    this.stage = stage;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

function positiveSeconds(value: unknown): number | undefined {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value)
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

function parseInstagramJson(rawText: string): Record<string, unknown> {
  if (rawText.length === 0) return {};
  const normalized = rawText.replace(
    /("user_id"\s*:\s*)(\d+)(?=\s*[,}])/gu,
    '$1"$2"'
  );
  try {
    const parsed: unknown = JSON.parse(normalized);
    return record(parsed) ?? {};
  } catch {
    return {};
  }
}

function providerError(body: Record<string, unknown> | undefined): {
  message: string;
  code?: string;
} {
  const graph = record(body?.error);
  const message = stringValue(graph?.message)
    ?? stringValue(body?.error_message)
    ?? stringValue(body?.message)
    ?? "unknown provider error";
  const code = stringValue(graph?.code)
    ?? stringValue(body?.code)
    ?? stringValue(body?.error_type);
  return {
    message,
    ...(code === undefined ? {} : { code })
  };
}

function classifyProviderReason(message: string): string {
  if (/matching code was not found|already used|authorization code/i.test(message)) {
    return "authorization_code_invalid_or_used";
  }
  if (/client secret|app secret/i.test(message)) {
    return "client_secret_invalid";
  }
  if (/redirect[_ ]?uri|redirect uri/i.test(message)) {
    return "redirect_uri_mismatch";
  }
  if (/client[_ ]?id|app id/i.test(message)) {
    return "client_id_invalid";
  }
  if (/permission|scope/i.test(message)) {
    return "scope_or_permission_rejected";
  }
  return "provider_rejected";
}

export function instagramOAuthFailureDiagnostic(error: unknown): string {
  const flow = error instanceof InstagramOAuthFlowError ? error : undefined;
  const cause = flow?.cause ?? error;
  const request = cause instanceof InstagramOAuthRequestError ? cause : undefined;
  const parts = [
    `stage=${flow?.stage ?? "unknown"}`,
    `class=${cause instanceof Error ? cause.name : typeof cause}`
  ];
  if (request?.status !== undefined) parts.push(`status=${request.status}`);
  if (request?.providerCode !== undefined) parts.push(`provider_code=${request.providerCode}`);
  if (request?.reason !== undefined) parts.push(`reason=${request.reason}`);
  if (request !== undefined) parts.push(`retryable=${request.retryable}`);
  return parts.join(" ");
}

export class InstagramOAuthClient implements InstagramOAuthClientLike {
  readonly #appId: string;
  readonly #appSecret: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: InstagramOAuthClientOptions) {
    this.#appId = options.appId;
    this.#appSecret = options.appSecret;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string
  ): Promise<InstagramShortLivedTokenResult> {
    const form = new FormData();
    form.set("client_id", this.#appId);
    form.set("client_secret", this.#appSecret);
    form.set("grant_type", "authorization_code");
    form.set("redirect_uri", redirectUri);
    form.set("code", code);

    const body = await this.#request(TOKEN_EXCHANGE_URL, {
      method: "POST",
      body: form
    });

    const first = Array.isArray(body.data) ? record(body.data[0]) : undefined;
    const source = first ?? body;
    const accessToken = stringValue(source.access_token);
    const userId = stringValue(source.user_id);
    if (accessToken === undefined || userId === undefined) {
      const reason = accessToken === undefined
        ? "success_payload_missing_access_token"
        : "success_payload_missing_user_id";
      throw new InstagramOAuthRequestError(
        "Instagram OAuth response did not contain the required short-lived token fields",
        { retryable: false, reason }
      );
    }

    return {
      accessToken,
      userId,
      scopes: scopesValue(source.permissions ?? source.scope)
    };
  }

  async exchangeLongLived(accessToken: string): Promise<InstagramLongLivedTokenResult> {
    const url = new URL(LONG_LIVED_TOKEN_URL);
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", this.#appSecret);
    url.searchParams.set("access_token", accessToken);
    return this.#longLivedRequest(url);
  }

  async refresh(accessToken: string): Promise<InstagramLongLivedTokenResult> {
    const url = new URL(REFRESH_TOKEN_URL);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", accessToken);
    return this.#longLivedRequest(url);
  }

  async #longLivedRequest(url: URL): Promise<InstagramLongLivedTokenResult> {
    const body = await this.#request(url.toString(), { method: "GET" });
    const accessToken = stringValue(body.access_token);
    const accessExpiresInSeconds = positiveSeconds(body.expires_in);
    if (accessToken === undefined || accessExpiresInSeconds === undefined) {
      throw new InstagramOAuthRequestError(
        "Instagram OAuth response did not contain a valid long-lived token lifetime",
        { retryable: false }
      );
    }
    return { accessToken, accessExpiresInSeconds };
  }

  async #request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.headers ?? {})
        },
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      });
    } catch (error) {
      throw new InstagramOAuthRequestError(
        "Instagram OAuth request failed before a response was received",
        { retryable: true, cause: error }
      );
    }

    const rawText = await response.text().catch(() => "");
    const body = parseInstagramJson(rawText);
    if (!response.ok) {
      const error = providerError(body);
      throw new InstagramOAuthRequestError(
        `Instagram OAuth request was rejected: ${error.message.slice(0, 300)}`,
        {
          retryable: response.status === 429 || response.status >= 500,
          status: response.status,
          ...(error.code === undefined ? {} : { providerCode: error.code }),
          reason: classifyProviderReason(error.message)
        }
      );
    }
    return body;
  }
}

export interface InstagramOAuthServiceOptions {
  appId: string;
  redirectUri: string;
  store: OAuthCredentialStore;
  client: InstagramOAuthClientLike;
  authorizationUrl?: string;
  scopes?: readonly string[];
  stateTtlSeconds?: number;
  now?: () => Date;
}

export class InstagramOAuthService implements InstagramOAuthController {
  readonly #appId: string;
  readonly #redirectUri: string;
  readonly #store: OAuthCredentialStore;
  readonly #client: InstagramOAuthClientLike;
  readonly #authorizationUrl: string;
  readonly #scopes: readonly string[];
  readonly #stateTtlSeconds: number;
  readonly #now: () => Date;

  constructor(options: InstagramOAuthServiceOptions) {
    this.#appId = options.appId;
    this.#redirectUri = options.redirectUri;
    this.#store = options.store;
    this.#client = options.client;
    this.#authorizationUrl = options.authorizationUrl ?? DEFAULT_AUTHORIZATION_URL;
    this.#scopes = options.scopes ?? INSTAGRAM_REVIEW_SCOPES;
    this.#stateTtlSeconds = options.stateTtlSeconds ?? 600;
    this.#now = options.now ?? (() => new Date());
  }

  async beginAuthorization(): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const state = randomBytes(32).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const expiresAt = new Date(this.#now().getTime() + this.#stateTtlSeconds * 1000);
    await this.#store.createAuthorizationState(
      "instagram",
      stateHash,
      this.#redirectUri,
      expiresAt
    );

    const url = new URL(this.#authorizationUrl);
    url.searchParams.set("client_id", this.#appId);
    url.searchParams.set("redirect_uri", this.#redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.#scopes.join(","));
    url.searchParams.set("state", state);
    url.searchParams.set("force_reauth", "true");
    return {
      authorizationUrl: url.toString(),
      expiresAt: expiresAt.toISOString()
    };
  }

  async completeAuthorization(
    state: string,
    code: string
  ): Promise<{
    accountId: string;
    scopes: readonly string[];
    accessExpiresAt: string;
  }> {
    if (!/^[A-Za-z0-9_-]{20,256}$/u.test(state)) {
      throw new Error("Instagram OAuth state is invalid");
    }
    if (code.length < 8 || code.length > 4096) {
      throw new Error("Instagram authorization code is invalid");
    }

    const stateHash = createHash("sha256").update(state).digest("hex");
    const storedState = await this.#store.consumeAuthorizationState("instagram", stateHash);
    if (storedState === undefined || storedState.redirectUri !== this.#redirectUri) {
      throw new Error("Instagram OAuth state is expired, invalid, or already consumed");
    }

    let short: InstagramShortLivedTokenResult;
    try {
      short = await this.#client.exchangeAuthorizationCode(
        code.replace(/#_$/u, ""),
        this.#redirectUri
      );
    } catch (error) {
      throw new InstagramOAuthFlowError("short_token_exchange", error);
    }

    let long: InstagramLongLivedTokenResult;
    try {
      long = await this.#client.exchangeLongLived(short.accessToken);
    } catch (error) {
      throw new InstagramOAuthFlowError("long_token_exchange", error);
    }

    const accessExpiresAt = new Date(
      this.#now().getTime() + long.accessExpiresInSeconds * 1000
    );

    try {
      await this.#store.put({
        provider: "instagram",
        accountId: short.userId,
        accessToken: long.accessToken,
        scopes: short.scopes,
        accessExpiresAt
      });
    } catch (error) {
      throw new InstagramOAuthFlowError("credential_persistence", error);
    }

    return {
      accountId: short.userId,
      scopes: short.scopes,
      accessExpiresAt: accessExpiresAt.toISOString()
    };
  }

  async status(accountId?: string): Promise<InstagramOAuthStatus> {
    const credential = accountId === undefined
      ? await this.#store.latest("instagram")
      : await this.#store.get("instagram", accountId);
    if (credential === undefined) return { authorized: false };
    return {
      authorized: true,
      accountId: credential.accountId,
      scopes: credential.scopes,
      accessExpiresAt: credential.accessExpiresAt.toISOString()
    };
  }
}
