import { AccessTokenError } from "./token-provider.js";
import type { OAuthCredential, OAuthCredentialStore } from "./oauth-store.js";
import {
  InstagramOAuthRequestError,
  type InstagramOAuthClientLike
} from "./instagram-oauth.js";

export interface AccountAccessTokenProvider {
  getAccessToken(accountId: string): Promise<string | undefined>;
}

export interface InstagramAccessTokenManagerOptions {
  store: OAuthCredentialStore;
  client: InstagramOAuthClientLike;
  refreshSkewSeconds?: number;
  now?: () => Date;
}

export interface InstagramAccessTokenRouterOptions {
  oauthProvider?: AccountAccessTokenProvider | undefined;
  managedAccessToken?: string | undefined;
  client: Pick<InstagramOAuthClientLike, "resolveProfessionalAccountId">;
}

export class InstagramAccessTokenRouter implements AccountAccessTokenProvider {
  readonly #oauthProvider: AccountAccessTokenProvider | undefined;
  readonly #managedAccessToken: string | undefined;
  readonly #client: Pick<InstagramOAuthClientLike, "resolveProfessionalAccountId">;
  #managedAccountIdPromise: Promise<string> | undefined;

  constructor(options: InstagramAccessTokenRouterOptions) {
    this.#oauthProvider = options.oauthProvider;
    this.#managedAccessToken = options.managedAccessToken;
    this.#client = options.client;
  }

  async getAccessToken(accountId: string): Promise<string | undefined> {
    if (this.#oauthProvider !== undefined) {
      const oauthToken = await this.#oauthProvider.getAccessToken(accountId);
      if (oauthToken !== undefined) return oauthToken;
    }

    if (this.#managedAccessToken === undefined) return undefined;

    const managedAccountId = await this.managedAccountId();
    return managedAccountId === accountId ? this.#managedAccessToken : undefined;
  }

  async managedAccountId(): Promise<string | undefined> {
    if (this.#managedAccessToken === undefined) return undefined;
    this.#managedAccountIdPromise ??= this.#client
      .resolveProfessionalAccountId(this.#managedAccessToken)
      .catch((error) => {
        this.#managedAccountIdPromise = undefined;
        throw new AccessTokenError(
          "Configured Instagram managed-account token could not be validated",
          {
            retryable: error instanceof InstagramOAuthRequestError
              ? error.retryable
              : true,
            cause: error
          }
        );
      });
    return this.#managedAccountIdPromise;
  }
}

export class InstagramAccessTokenManager implements AccountAccessTokenProvider {
  readonly #store: OAuthCredentialStore;
  readonly #client: InstagramOAuthClientLike;
  readonly #refreshSkewMs: number;
  readonly #now: () => Date;
  readonly #refreshPromises = new Map<string, Promise<OAuthCredential>>();

  constructor(options: InstagramAccessTokenManagerOptions) {
    this.#store = options.store;
    this.#client = options.client;
    this.#refreshSkewMs = (options.refreshSkewSeconds ?? 7 * 24 * 60 * 60) * 1000;
    this.#now = options.now ?? (() => new Date());
  }

  async getAccessToken(accountId: string): Promise<string | undefined> {
    const credentialAccountId = await this.#store.resolveCredentialAccountId(
      "instagram",
      accountId
    ) ?? accountId;
    const credential = await this.#store.get("instagram", credentialAccountId);
    if (credential === undefined) {
      if (await this.#store.isRevoked("instagram", credentialAccountId)) {
        throw new AccessTokenError(
          "Instagram account authorization has been revoked; reauthorization is required",
          { retryable: false }
        );
      }
      return undefined;
    }

    const now = this.#now();
    if (credential.accessExpiresAt.getTime() <= now.getTime()) {
      throw new AccessTokenError(
        "Instagram OAuth access token has expired; reauthorization is required",
        { retryable: false }
      );
    }

    if (credential.accessExpiresAt.getTime() > now.getTime() + this.#refreshSkewMs) {
      return credential.accessToken;
    }

    return (await this.#refresh(credentialAccountId)).accessToken;
  }

  async #refresh(accountId: string): Promise<OAuthCredential> {
    const existing = this.#refreshPromises.get(accountId);
    if (existing !== undefined) return existing;

    const promise = this.#store.withRefreshLock(
      "instagram",
      accountId,
      () => this.#refreshUnderLock(accountId)
    ).finally(() => {
      this.#refreshPromises.delete(accountId);
    });

    this.#refreshPromises.set(accountId, promise);
    return promise;
  }

  async #refreshUnderLock(accountId: string): Promise<OAuthCredential> {
    const current = await this.#store.get("instagram", accountId);
    if (current === undefined) {
      throw new AccessTokenError("Instagram account is not authorized", {
        retryable: false
      });
    }

    const now = this.#now();
    if (current.accessExpiresAt.getTime() <= now.getTime()) {
      throw new AccessTokenError(
        "Instagram OAuth access token has expired; reauthorization is required",
        { retryable: false }
      );
    }
    if (current.accessExpiresAt.getTime() > now.getTime() + this.#refreshSkewMs) {
      return current;
    }

    let result;
    try {
      result = await this.#client.refresh(current.accessToken);
    } catch (error) {
      throw new AccessTokenError("Instagram OAuth token refresh failed", {
        retryable: error instanceof InstagramOAuthRequestError
          ? error.retryable
          : true,
        cause: error
      });
    }

    const updated = {
      provider: "instagram",
      accountId,
      accessToken: result.accessToken,
      scopes: current.scopes,
      accessExpiresAt: new Date(now.getTime() + result.accessExpiresInSeconds * 1000)
    } as const;

    await this.#store.put(updated);
    const persisted = await this.#store.get("instagram", accountId);
    if (persisted === undefined) {
      throw new AccessTokenError(
        "Instagram OAuth credential disappeared after refresh",
        { retryable: true }
      );
    }
    return persisted;
  }
}
