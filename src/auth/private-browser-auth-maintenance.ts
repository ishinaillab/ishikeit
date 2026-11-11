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
 * Only expired, revoked, or provider-orphaned BFF sessions are eligible.
 * Every statement deletes at most 250 rows. SKIP LOCKED avoids blocking a
 * concurrent OTP verification, refresh, or logout. A missing exact GoTrue
 * auth.sessions row means the BFF row cannot authorize any account access.
 * Repeated passes drain the backlog without touching the live provider user.
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
        SELECT b.ctid FROM public.ishikeit_browser_sessions AS b
        WHERE b.session_expires_at < now() OR b.revoked_at IS NOT NULL
          OR NOT EXISTS (
            SELECT 1 FROM auth.sessions AS s
            WHERE s.id=b.auth_session_id AND s.user_id=b.user_id
          )
        ORDER BY b.session_expires_at ASC
        LIMIT 250 FOR UPDATE OF b SKIP LOCKED
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
