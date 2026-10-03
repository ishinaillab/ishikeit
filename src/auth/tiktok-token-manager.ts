import { AccessTokenError, type AccessTokenProvider } from "./token-provider.js";
import type { OAuthCredential, OAuthCredentialStore } from "./oauth-store.js";
import { TikTokOAuthRequestError, type TikTokOAuthClientLike } from "./tiktok-oauth.js";

export function tiktokCredentialCanRefresh(
  credential: OAuthCredential | undefined,
  now: Date = new Date()
): boolean {
  return credential?.accessExpiresAt !== undefined
    && credential.refreshToken !== undefined
    && (
      credential.refreshExpiresAt === undefined
      || credential.refreshExpiresAt.getTime() > now.getTime()
    );
}

export interface TikTokAccessTokenManagerOptions {
  businessId: string;
  store: OAuthCredentialStore;
  client: TikTokOAuthClientLike;
  refreshSkewSeconds?: number;
  now?: () => Date;
}

export class TikTokAccessTokenManager implements AccessTokenProvider {
  readonly #businessId: string;
  readonly #store: OAuthCredentialStore;
  readonly #client: TikTokOAuthClientLike;
  readonly #refreshSkewMs: number;
  readonly #now: () => Date;
  #refreshPromise: Promise<OAuthCredential> | undefined;

  constructor(options: TikTokAccessTokenManagerOptions) {
    this.#businessId = options.businessId;
    this.#store = options.store;
    this.#client = options.client;
    this.#refreshSkewMs = (options.refreshSkewSeconds ?? 300) * 1000;
    this.#now = options.now ?? (() => new Date());
  }

  async getAccessToken(): Promise<string> {
    const credential = await this.#store.get("tiktok", this.#businessId);
    if (credential === undefined) {
      throw new AccessTokenError("TikTok Business Account is not authorized", {
        retryable: false
      });
    }
    if (credential.accessExpiresAt === undefined) {
      throw new AccessTokenError(
        "TikTok OAuth credential does not contain an access expiry; reauthorization is required",
        { retryable: false }
      );
    }

    if (credential.accessExpiresAt.getTime() > this.#now().getTime() + this.#refreshSkewMs) {
      return credential.accessToken;
    }

    const refreshed = await this.#refresh();
    return refreshed.accessToken;
  }

  async #refresh(): Promise<OAuthCredential> {
    if (this.#refreshPromise !== undefined) return this.#refreshPromise;

    this.#refreshPromise = this.#store.withRefreshLock(
      "tiktok",
      this.#businessId,
      () => this.#refreshUnderLock()
    ).finally(() => {
      this.#refreshPromise = undefined;
    });
    return this.#refreshPromise;
  }

  async #refreshUnderLock(): Promise<OAuthCredential> {
    const current = await this.#store.get("tiktok", this.#businessId);
    if (current === undefined) {
      throw new AccessTokenError("TikTok Business Account is not authorized", {
        retryable: false
      });
    }
    if (current.accessExpiresAt === undefined) {
      throw new AccessTokenError(
        "TikTok OAuth credential does not contain an access expiry; reauthorization is required",
        { retryable: false }
      );
    }

    const now = this.#now();
    if (current.accessExpiresAt.getTime() > now.getTime() + this.#refreshSkewMs) {
      return current;
    }

    const refreshToken = current.refreshToken;
    if (refreshToken === undefined) {
      throw new AccessTokenError(
        "TikTok OAuth credential does not contain a refresh token",
        { retryable: false }
      );
    }
    if (
      current.refreshExpiresAt !== undefined
      && current.refreshExpiresAt.getTime() <= now.getTime()
    ) {
      throw new AccessTokenError(
        "TikTok OAuth refresh token has expired; reauthorization is required",
        { retryable: false }
      );
    }

    let result;
    try {
      result = await this.#client.refresh(refreshToken);
    } catch (error) {
      throw new AccessTokenError("TikTok OAuth refresh failed", {
        retryable: error instanceof TikTokOAuthRequestError
          ? error.retryable
          : true,
        cause: error
      });
    }

    if (result.openId !== undefined && result.openId !== this.#businessId) {
      throw new AccessTokenError(
        "TikTok refresh response returned a different Business Account",
        { retryable: false }
      );
    }

    const accessExpiresAt = new Date(now.getTime() + result.accessExpiresInSeconds * 1000);
    const refreshExpiresAt = result.refreshExpiresInSeconds === undefined
      ? current.refreshExpiresAt
      : new Date(now.getTime() + result.refreshExpiresInSeconds * 1000);

    const updated = {
      provider: "tiktok",
      accountId: this.#businessId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken ?? refreshToken,
      scopes: result.scopes.length > 0 ? result.scopes : current.scopes,
      accessExpiresAt,
      ...(refreshExpiresAt === undefined ? {} : { refreshExpiresAt })
    } as const;

    await this.#store.put(updated);
    const persisted = await this.#store.get("tiktok", this.#businessId);
    if (persisted === undefined) {
      throw new AccessTokenError(
        "TikTok OAuth credential disappeared after refresh",
        { retryable: true }
      );
    }
    return persisted;
  }
}
