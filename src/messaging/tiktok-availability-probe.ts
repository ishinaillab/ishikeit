import type { OAuthCredentialStore } from "../auth/oauth-store.js";
import type { TikTokOAuthClientLike } from "../auth/tiktok-oauth.js";
import { TikTokAccessTokenManager } from "../auth/tiktok-token-manager.js";

export type TikTokMessagingProbeState =
  | "accepted"
  | "provider_rejected"
  | "provider_unavailable"
  | "invalid_provider_response"
  | "no_stored_authorization"
  | "ambiguous_authorization"
  | "access_token_expired"
  | "credential_store_unavailable";

export interface TikTokMessagingProbeResult {
  status: TikTokMessagingProbeState;
  /** HTTP status and TikTok numeric code only; no conversation data or identifiers. */
  httpStatus?: number;
  providerCode?: string;
  providerErrorCategory?: "permission" | "scope" | "account" | "parameter" | "authentication" | "other";
}

export interface TikTokMessagingProbeController {
  probe(): Promise<TikTokMessagingProbeResult>;
}

export interface TikTokMessagingProbeOptions {
  store: Pick<OAuthCredentialStore, "list">;
  refreshStore?: OAuthCredentialStore;
  oauthClient?: TikTokOAuthClientLike;
  apiVersion?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

async function responseDetails(response: Response): Promise<{ code?: string; category?: TikTokMessagingProbeResult["providerErrorCategory"] }> {
  const reader = response.body?.getReader();
  if (reader === undefined) return {};
  const bytes: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > 48_000) {
        await reader.cancel().catch(() => undefined);
        return {};
      }
      bytes.push(next.value);
    }
    const buffer = Buffer.concat(bytes);
    const parsed: unknown = JSON.parse(buffer.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const message = (parsed as Record<string, unknown>).message;
    const normalized = typeof message === "string" ? message.toLowerCase().slice(0, 500) : "";
    const category = /permission|not authorized|not allowed|access denied|no access/u.test(normalized) ? "permission"
      : /scope/u.test(normalized) ? "scope"
      : /business.account|business_id|account/u.test(normalized) ? "account"
      : /parameter|param|invalid request/u.test(normalized) ? "parameter"
      : /token|authentication|oauth/u.test(normalized) ? "authentication" : "other";
    const raw = (parsed as Record<string, unknown>).code;
    const candidate = typeof raw === "number" && Number.isSafeInteger(raw)
      ? String(raw)
      : typeof raw === "string" ? raw : undefined;
    return { ...(candidate !== undefined && /^-?\d{1,8}$/u.test(candidate) ? { code: candidate } : {}), category };
  } catch {
    return {};
  } finally {
    reader.releaseLock();
  }
}

/**
 * Read-only, opt-in TikTok Business Messaging entitlement smoke probe.
 * Does not enable a TikTok account, subscribe webhooks, inspect message
 * content, or send a message. May refresh and persist the existing OAuth
 * credential when an explicitly configured refresh client is provided.
 */
export class TikTokMessagingAvailabilityProbe implements TikTokMessagingProbeController {
  readonly #store: Pick<OAuthCredentialStore, "list">;
  readonly #refreshStore: OAuthCredentialStore | undefined;
  readonly #oauthClient: TikTokOAuthClientLike | undefined;
  readonly #version: string;
  readonly #timeout: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(options: TikTokMessagingProbeOptions) {
    this.#store = options.store;
    this.#refreshStore = options.refreshStore;
    this.#oauthClient = options.oauthClient;
    this.#version = options.apiVersion ?? "v1.3";
    this.#timeout = options.requestTimeoutMs ?? 8000;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    if (!/^v1\.3$/u.test(this.#version) || !Number.isInteger(this.#timeout)
      || this.#timeout < 500 || this.#timeout > 30_000) {
      throw new Error("Invalid TikTok Messaging probe configuration");
    }
  }

  async probe(): Promise<TikTokMessagingProbeResult> {
    let credentials;
    try {
      credentials = await this.#store.list("tiktok");
    } catch {
      return { status: "credential_store_unavailable" };
    }

    if (credentials.length === 0) return { status: "no_stored_authorization" };
    if (credentials.length !== 1) return { status: "ambiguous_authorization" };
    let credential = credentials[0]!;
    if (credential.provider !== "tiktok"
      || credential.accountId.length < 1
      || credential.accessToken.length < 8) {
      return { status: "no_stored_authorization" };
    }
    if (credential.accessExpiresAt === undefined
      || credential.accessExpiresAt.getTime() <= this.#now().getTime() + 60_000) {
      if (this.#refreshStore === undefined || this.#oauthClient === undefined) {
        return { status: "access_token_expired" };
      }
      try {
        const manager = new TikTokAccessTokenManager({
          businessId: credential.accountId,
          store: this.#refreshStore,
          client: this.#oauthClient
        });
        await manager.getAccessToken();
        const refreshed = await this.#refreshStore.get("tiktok", credential.accountId);
        if (refreshed === undefined || refreshed.accessExpiresAt === undefined
          || refreshed.accessExpiresAt.getTime() <= this.#now().getTime() + 60_000) {
          return { status: "access_token_expired" };
        }
        credential = refreshed;
      } catch {
        return { status: "access_token_expired" };
      }
    }

    const url = new URL(
      `https://business-api.tiktok.com/open_api/${this.#version}/business/message/conversation/list/`
    );
    url.searchParams.set("business_id", credential.accountId);
    url.searchParams.set("conversation_type", "SINGLE");
    url.searchParams.set("limit", "1");

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "Access-Token": credential.accessToken
        },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(this.#timeout)
      });
    } catch {
      return { status: "provider_unavailable" };
    }

    const { code, category } = await responseDetails(response);
    const details = {
      httpStatus: response.status,
      ...(code === undefined ? {} : { providerCode: code }),
      ...(category === undefined ? {} : { providerErrorCategory: category })
    };

    if (response.ok && code === "0") {
      return { status: "accepted", ...details };
    }
    if (response.status === 429 || response.status >= 500) {
      return { status: "provider_unavailable", ...details };
    }
    if (response.status >= 400 && response.status < 500
      || code !== undefined && code !== "0") {
      return { status: "provider_rejected", ...details };
    }
    return { status: "invalid_provider_response", ...details };
  }
}
