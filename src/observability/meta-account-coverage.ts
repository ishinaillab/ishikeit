import type pg from "pg";
import type { PostgresDatabase } from "../persistence/postgres.js";

/**
 * Read-only check whether the independently validated managed Instagram
 * Professional account corresponds to the account that receives signed
 * customer DMs. Never logs or returns Meta account IDs.
 */
export async function instagramManagedAccountMatchesInbound(
  db: PostgresDatabase,
  professionalAccountId: string
): Promise<boolean> {
  if (professionalAccountId.length < 1) return false;
  const result = await db.query<{ matches: boolean } & pg.QueryResultRow>(
    `SELECT EXISTS (
       SELECT 1 FROM public.inbound_events
       WHERE provider='meta'
         AND channel='instagram'
         AND event_type='message.received'
         AND account_id=$1
       LIMIT 1
     ) AS matches`,
    [professionalAccountId]
  );
  return result.rows[0]?.matches === true;
}


/**
 * Guard Page-subscription updates: the configured Messenger token must
 * independently resolve to a Page already seen in authenticated webhook
 * ingress. Do not expose raw Page IDs in logs.
 */
export async function messengerManagedPageMatchesInbound(
  db: PostgresDatabase,
  pageId: string
): Promise<boolean> {
  if (!/^\d{5,32}$/u.test(pageId)) return false;
  const result = await db.query<{ matches: boolean } & pg.QueryResultRow>(
    `SELECT EXISTS (
       SELECT 1 FROM public.inbound_events
       WHERE provider='meta'
         AND channel='messenger'
         AND event_type='message.received'
         AND account_id=$1
       LIMIT 1
     ) AS matches`,
    [pageId]
  );
  return result.rows[0]?.matches === true;
}


/**
 * Select a Page only when exactly one recent numeric Page ID exists in
 * signed Messenger inbound events. Historical test aliases and older
 * migrated Pages must not drive a live Page subscription write.
 */
export async function messengerRecentSignedPageId(
  db: PostgresDatabase
): Promise<string | undefined> {
  const result = await db.query<{ account_id: string } & pg.QueryResultRow>(
    `SELECT account_id FROM public.inbound_events
     WHERE provider='meta'
       AND channel='messenger'
       AND event_type='message.received'
       AND received_at >= now() - interval '30 days'
       AND account_id ~ '^[0-9]{5,32}$'
     GROUP BY account_id
     ORDER BY max(received_at) DESC
     LIMIT 2`
  );
  return result.rows.length === 1 ? result.rows[0]?.account_id : undefined;
}
