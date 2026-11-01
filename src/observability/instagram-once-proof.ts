import type pg from "pg";
import { open, writeFile } from "node:fs/promises";
import type { PostgresDatabase } from "../persistence/postgres.js";
import type { OAuthCredentialStore } from "../auth/oauth-store.js";
import type { InstagramOAuthClientLike } from "../auth/instagram-oauth.js";

/** EPHEMERAL verification module. Remove immediately after read-back of the one-time live test. */
const PRIVATE_CLAIM_PATH = "/home/u328762438/domains/apps.ishinaillab.com/hbuilds/config/instagram-renewal-once-20261101.claim";
const SUBJECT = "28436714725987041";
const PROFESSIONAL_ID = "17841438662359631";
const EXPECTED_VERSION = 1;
const EXPECTED_EXPIRES = Date.parse("2026-12-28T23:52:32.169Z");
const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const MIN_VALIDITY_MS = 55 * 24 * 60 * 60 * 1000;
const MAX_VALIDITY_MS = 61 * 24 * 60 * 60 * 1000;

interface Metadata extends pg.QueryResultRow {
  token_version: number;
  access_expires_at: Date | null;
  updated_at: Date;
}
export type OneTimeProofResult =
  | "skipped"
  | "already_attempted"
  | "succeeded"
  | "failed";

export interface OneTimeProofDependencies {
  db: Pick<PostgresDatabase, "query" | "withAdvisoryLock">;
  store: Pick<OAuthCredentialStore, "get" | "aliasesForCredential" | "isRevoked" | "put">;
  client: Pick<InstagramOAuthClientLike, "refresh" | "resolveProfessionalAccountId">;
  now?: () => Date;
  claimFilePath?: string;
}

/**
 * Hard-coded, owner-approved, one-grant-only live proof. Never log or return
 * plaintext, aliases, provider errors, or the actual token. No public route.
 *
 * An O_EXCL private filesystem claim made before the Meta request ensures
 * provider failures and rolling deployments cannot cause repeat attempts.
 * The same advisory lock name as normal maintenance serializes grant writes.
 */
export async function proveOneTimeInstagramRefresh(
  options: OneTimeProofDependencies
): Promise<OneTimeProofResult> {
  const { db, store, client } = options;
  const now = options.now ?? (() => new Date());
  return db.withAdvisoryLock("ishikeit:oauth-refresh:instagram:" + SUBJECT, async () => {
    const [credential, aliases, revoked, metadata] = await Promise.all([
      store.get("instagram", SUBJECT),
      store.aliasesForCredential("instagram", SUBJECT),
      store.isRevoked("instagram", SUBJECT),
      db.query<Metadata>(
        `SELECT token_version,access_expires_at,updated_at
           FROM public.oauth_credentials
          WHERE provider=$1 AND account_id=$2 LIMIT 1`,
        ["instagram", SUBJECT]
      )
    ]);
    const row = metadata.rows[0];
    const currentTime = now();
    if (credential === undefined || row === undefined || revoked
      || credential.tokenVersion !== EXPECTED_VERSION
      || row.token_version !== EXPECTED_VERSION
      || aliases.length !== 1 || aliases[0] !== PROFESSIONAL_ID
      || credential.accountId !== SUBJECT
      || credential.accessExpiresAt?.getTime() !== EXPECTED_EXPIRES
      || row.access_expires_at?.getTime() !== EXPECTED_EXPIRES
      || currentTime.getTime() - row.updated_at.getTime() < MIN_AGE_MS
      || currentTime.getTime() >= EXPECTED_EXPIRES
      || currentTime.getTime() <= row.updated_at.getTime()) {
      return "skipped";
    }
    // Private atomic O_EXCL creation is durable across separate server processes.
    const claimPath = options.claimFilePath ?? PRIVATE_CLAIM_PATH;
    let claim;
    try { claim = await open(claimPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return "already_attempted";
      throw error;
    }
    try { await claim.writeFile("claimed\n"); }
    finally { await claim.close(); }

    let outcome: "failed" | "succeeded" = "failed";
    try {
      const renewed = await client.refresh(credential.accessToken);
      if (!Number.isSafeInteger(renewed.accessExpiresInSeconds)
        || renewed.accessExpiresInSeconds * 1000 < MIN_VALIDITY_MS
        || renewed.accessExpiresInSeconds * 1000 > MAX_VALIDITY_MS
        || renewed.accessToken.length < 20) {
        return "failed";
      }
      if (await client.resolveProfessionalAccountId(renewed.accessToken) !== PROFESSIONAL_ID) {
        return "failed";
      }
      const freshExpiry = new Date(now().getTime() + renewed.accessExpiresInSeconds * 1000);
      if (freshExpiry.getTime() <= EXPECTED_EXPIRES + 12 * 60 * 60 * 1000) {
        return "failed";
      }
      await store.put({
        provider: "instagram",
        accountId: SUBJECT,
        accessToken: renewed.accessToken,
        scopes: credential.scopes,
        accessExpiresAt: freshExpiry
      });
      const updated = await store.get("instagram", SUBJECT);
      if (updated?.tokenVersion !== EXPECTED_VERSION + 1
        || updated.accessExpiresAt?.getTime() !== freshExpiry.getTime()) {
        return "failed";
      }
      outcome = "succeeded";
      return "succeeded";
    } catch {
      // Never include provider exception text or access tokens in logs.
      return "failed";
    } finally {
      try { await writeFile(claimPath, outcome + "\n", { mode: 0o600 }); }
      catch { /* private atomic claim remains even if status write fails */ }
    }
  });
}
