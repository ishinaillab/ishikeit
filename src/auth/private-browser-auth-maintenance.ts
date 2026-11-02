import type pg from "pg";
import type { PostgresDatabase } from "../persistence/postgres.js";

interface DeletedRow extends pg.QueryResultRow { count: number }
export interface BrowserAuthCleanupResult {
  expiredAttempts: number;
  expiredSessions: number;
  oldRateBuckets: number;
}

/**
 * Bounded privacy maintenance for server-private BFF auth.
 *
 * Only expired/revoked records are eligible. Every statement deletes at most
 * 250 rows and SKIP LOCKED avoids blocking a concurrent OTP verification,
 * refresh, or logout. Repeated passes eventually drain large backlogs.
 *
 * Per-provider OAuth credentials, auth.users, workspace membership and
 * existing messaging queues are never touched.
 */
export class PostgresBrowserAuthMaintenance {
  constructor(private readonly db: Pick<PostgresDatabase,"query">) {}

  async runOnce(): Promise<BrowserAuthCleanupResult> {
    const attempts=await this.db.query<DeletedRow>(
      `WITH expired AS (
        SELECT ctid FROM public.ishikeit_browser_login_attempts
        WHERE expires_at < now()
        ORDER BY expires_at ASC
        LIMIT 250 FOR UPDATE SKIP LOCKED
       ), erased AS (
        DELETE FROM public.ishikeit_browser_login_attempts
        WHERE ctid IN (SELECT ctid FROM expired)
        RETURNING 1
       ) SELECT count(*)::int AS count FROM erased`
    );
    const sessions=await this.db.query<DeletedRow>(
      `WITH expired AS (
        SELECT ctid FROM public.ishikeit_browser_sessions
        WHERE session_expires_at < now() OR revoked_at IS NOT NULL
        ORDER BY session_expires_at ASC
        LIMIT 250 FOR UPDATE SKIP LOCKED
       ), erased AS (
        DELETE FROM public.ishikeit_browser_sessions
        WHERE ctid IN (SELECT ctid FROM expired)
        RETURNING 1
       ) SELECT count(*)::int AS count FROM erased`
    );
    // Keep reset windows for 24h to support limited abuse triage without
    // retaining indefinite pseudonymous network/email rate hashes.
    const rates=await this.db.query<DeletedRow>(
      `WITH expired AS (
        SELECT ctid FROM public.ishikeit_browser_auth_limits
        WHERE reset_at < now() - interval '24 hours'
        ORDER BY reset_at ASC
        LIMIT 250 FOR UPDATE SKIP LOCKED
       ), erased AS (
        DELETE FROM public.ishikeit_browser_auth_limits
        WHERE ctid IN (SELECT ctid FROM expired)
        RETURNING 1
       ) SELECT count(*)::int AS count FROM erased`
    );
    return {
      expiredAttempts:attempts.rows[0]?.count??0,
      expiredSessions:sessions.rows[0]?.count??0,
      oldRateBuckets:rates.rows[0]?.count??0
    };
  }
}
