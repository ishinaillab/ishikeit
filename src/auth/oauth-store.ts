import type pg from "pg";
import type { CredentialCipher, EncryptedCredentialValue } from "./credential-cipher.js";
import type { PostgresDatabase } from "../persistence/postgres.js";

export interface OAuthCredential {
  provider: string;
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  scopes: readonly string[];
  accessExpiresAt: Date;
  refreshExpiresAt?: Date;
  tokenVersion: number;
}

export interface OAuthAuthorizationState {
  provider: string;
  redirectUri: string;
}

export interface OAuthCredentialStore {
  ready(): Promise<boolean>;
  get(provider: string, accountId: string): Promise<OAuthCredential | undefined>;
  latest(provider: string): Promise<OAuthCredential | undefined>;
  put(credential: Omit<OAuthCredential, "tokenVersion">): Promise<void>;
  revoke(provider: string, accountId: string, reason: string): Promise<void>;
  isRevoked(provider: string, accountId: string): Promise<boolean>;
  withRefreshLock<T>(
    provider: string,
    accountId: string,
    work: () => Promise<T>
  ): Promise<T>;
  createAuthorizationState(
    provider: string,
    stateHash: string,
    redirectUri: string,
    expiresAt: Date
  ): Promise<void>;
  consumeAuthorizationState(
    provider: string,
    stateHash: string
  ): Promise<OAuthAuthorizationState | undefined>;
}

interface CredentialRow extends pg.QueryResultRow {
  provider: string;
  account_id: string;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_tag: Buffer;
  refresh_token_ciphertext: Buffer | null;
  refresh_token_iv: Buffer | null;
  refresh_token_tag: Buffer | null;
  scopes: string[];
  access_expires_at: Date;
  refresh_expires_at: Date | null;
  token_version: number;
}

interface StateRow extends pg.QueryResultRow {
  provider: string;
  redirect_uri: string;
}

function aad(provider: string, accountId: string, kind: "access" | "refresh"): string {
  return ["ishikeit-oauth-v1", provider, accountId, kind].join("\0");
}

function encrypted(
  ciphertext: Buffer,
  iv: Buffer,
  tag: Buffer
): EncryptedCredentialValue {
  return { ciphertext, iv, tag };
}

export class PostgresOAuthCredentialStore implements OAuthCredentialStore {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly cipher: CredentialCipher
  ) {}

  async ready(): Promise<boolean> {
    try {
      const result = await this.db.query<{
        credentials: boolean;
        states: boolean;
        revocations: boolean;
      } & pg.QueryResultRow>(
        `SELECT
           to_regclass('public.oauth_credentials') IS NOT NULL AS credentials,
           to_regclass('public.oauth_authorization_states') IS NOT NULL AS states,
           to_regclass('public.oauth_revocations') IS NOT NULL AS revocations`
      );
      return result.rows[0]?.credentials === true
        && result.rows[0]?.states === true
        && result.rows[0]?.revocations === true;
    } catch {
      return false;
    }
  }

  async get(provider: string, accountId: string): Promise<OAuthCredential | undefined> {
    const result = await this.db.query<CredentialRow>(
      `SELECT provider,account_id,
              access_token_ciphertext,access_token_iv,access_token_tag,
              refresh_token_ciphertext,refresh_token_iv,refresh_token_tag,
              scopes,access_expires_at,refresh_expires_at,token_version
       FROM oauth_credentials
       WHERE provider=$1 AND account_id=$2`,
      [provider, accountId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : this.#decode(row);
  }

  async latest(provider: string): Promise<OAuthCredential | undefined> {
    const result = await this.db.query<CredentialRow>(
      `SELECT provider,account_id,
              access_token_ciphertext,access_token_iv,access_token_tag,
              refresh_token_ciphertext,refresh_token_iv,refresh_token_tag,
              scopes,access_expires_at,refresh_expires_at,token_version
       FROM oauth_credentials
       WHERE provider=$1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [provider]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : this.#decode(row);
  }

  async put(credential: Omit<OAuthCredential, "tokenVersion">): Promise<void> {
    const access = this.cipher.encrypt(
      credential.accessToken,
      aad(credential.provider, credential.accountId, "access")
    );
    const refresh = credential.refreshToken === undefined
      ? undefined
      : this.cipher.encrypt(
          credential.refreshToken,
          aad(credential.provider, credential.accountId, "refresh")
        );

    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO oauth_credentials
         (provider,account_id,
          access_token_ciphertext,access_token_iv,access_token_tag,
          refresh_token_ciphertext,refresh_token_iv,refresh_token_tag,
          scopes,access_expires_at,refresh_expires_at,token_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)
         ON CONFLICT (provider,account_id) DO UPDATE SET
           access_token_ciphertext=EXCLUDED.access_token_ciphertext,
           access_token_iv=EXCLUDED.access_token_iv,
           access_token_tag=EXCLUDED.access_token_tag,
           refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
           refresh_token_iv=EXCLUDED.refresh_token_iv,
           refresh_token_tag=EXCLUDED.refresh_token_tag,
           scopes=EXCLUDED.scopes,
           access_expires_at=EXCLUDED.access_expires_at,
           refresh_expires_at=EXCLUDED.refresh_expires_at,
           token_version=oauth_credentials.token_version + 1,
           updated_at=now()`,
        [
          credential.provider,
          credential.accountId,
          access.ciphertext,
          access.iv,
          access.tag,
          refresh?.ciphertext ?? null,
          refresh?.iv ?? null,
          refresh?.tag ?? null,
          [...credential.scopes],
          credential.accessExpiresAt,
          credential.refreshExpiresAt ?? null
        ]
      );
      await tx.query(
        `DELETE FROM oauth_revocations WHERE provider=$1 AND account_id=$2`,
        [credential.provider, credential.accountId]
      );
    });
  }

  async revoke(provider: string, accountId: string, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO oauth_revocations (provider,account_id,reason)
         VALUES ($1,$2,$3)
         ON CONFLICT (provider,account_id) DO UPDATE SET
           reason=EXCLUDED.reason, revoked_at=now()`,
        [provider, accountId, reason]
      );
      await tx.query(
        `DELETE FROM oauth_credentials WHERE provider=$1 AND account_id=$2`,
        [provider, accountId]
      );
    });
  }

  async isRevoked(provider: string, accountId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM oauth_revocations WHERE provider=$1 AND account_id=$2 LIMIT 1`,
      [provider, accountId]
    );
    return result.rowCount === 1;
  }

  withRefreshLock<T>(
    provider: string,
    accountId: string,
    work: () => Promise<T>
  ): Promise<T> {
    return this.db.withAdvisoryLock(
      `ishikeit:oauth-refresh:${provider}:${accountId}`,
      work
    );
  }

  async createAuthorizationState(
    provider: string,
    stateHash: string,
    redirectUri: string,
    expiresAt: Date
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM oauth_authorization_states
         WHERE expires_at <= now() OR consumed_at IS NOT NULL`
      );
      await tx.query(
        `INSERT INTO oauth_authorization_states
         (state_hash,provider,redirect_uri,expires_at)
         VALUES ($1,$2,$3,$4)`,
        [stateHash, provider, redirectUri, expiresAt]
      );
    });
  }

  async consumeAuthorizationState(
    provider: string,
    stateHash: string
  ): Promise<OAuthAuthorizationState | undefined> {
    const result = await this.db.query<StateRow>(
      `UPDATE oauth_authorization_states
       SET consumed_at=now()
       WHERE state_hash=$1
         AND provider=$2
         AND consumed_at IS NULL
         AND expires_at > now()
       RETURNING provider,redirect_uri`,
      [stateHash, provider]
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : { provider: row.provider, redirectUri: row.redirect_uri };
  }

  #decode(row: CredentialRow): OAuthCredential {
    const accessToken = this.cipher.decrypt(
      encrypted(row.access_token_ciphertext, row.access_token_iv, row.access_token_tag),
      aad(row.provider, row.account_id, "access")
    );

    let refreshToken: string | undefined;
    if (
      row.refresh_token_ciphertext !== null
      && row.refresh_token_iv !== null
      && row.refresh_token_tag !== null
    ) {
      refreshToken = this.cipher.decrypt(
        encrypted(row.refresh_token_ciphertext, row.refresh_token_iv, row.refresh_token_tag),
        aad(row.provider, row.account_id, "refresh")
      );
    }

    return {
      provider: row.provider,
      accountId: row.account_id,
      accessToken,
      ...(refreshToken === undefined ? {} : { refreshToken }),
      scopes: row.scopes,
      accessExpiresAt: row.access_expires_at,
      ...(row.refresh_expires_at === null ? {} : { refreshExpiresAt: row.refresh_expires_at }),
      tokenVersion: row.token_version
    };
  }
}
