import type pg from "pg";
import type { PostgresDatabase } from "../persistence/postgres.js";
import type { OAuthCredentialStore } from "../auth/oauth-store.js";
import type { InstagramOAuthClientLike } from "../auth/instagram-oauth.js";

/** EPHEMERAL verification module. Remove immediately after read-back of the one-time live test. */
const RUN_ID = "ishikeit-2026-11-01-owner-approved-instagram-once";
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
interface ClaimRow extends pg.QueryResultRow { run_id: string }
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
}

/**
 * Hard-coded, owner-approved, one-grant-only live proof. Never log or return
 * plaintext, aliases, provider errors, or the actual token. No public route.
 *
 * An INSERT-before-request durable claim ensures that even on a provider error
 * or rolling deployment restart Meta receives at most one refresh attempt.
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
    // Unique durable marker is inserted BEFORE the network request and stays
    // claimed even on failure. It is in a dedicated RLS-protected temporary table.
    const claim = await db.query<ClaimRow>(
      `INSERT INTO public.ishikeit_instagram_renewal_once
          (run_id,outcome) VALUES ($1,'claimed')
       ON CONFLICT (run_id) DO NOTHING RETURNING run_id`,
      [RUN_ID]
    );
    if (claim.rowCount !== 1) return "already_attempted";

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
      try {
        await db.query(
          "UPDATE public.ishikeit_instagram_renewal_once SET outcome=$2,finished_at=now() WHERE run_id=$1",
          [RUN_ID, outcome]
        );
      } catch {
        // Durable claim still prevents a second refresh even if result write failed.
      }
    }
  });
}
