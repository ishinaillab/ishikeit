import type pg from "pg";
import type { PostgresDatabase } from "./postgres.js";

/** Read-only, partition-scoped history used for truthful Meta AI disclosure.
 * Existing inbound_events_partition_idx supports the 24-hour time window.
 */
export interface MetaDisclosureReader {
  hasRecentAutomatedReply(partitionKey: string, before: Date, eventId: string): Promise<boolean>;
}

export class PostgresMetaDisclosureReader implements MetaDisclosureReader {
  constructor(private readonly db: Pick<PostgresDatabase, "query">) {}

  async hasRecentAutomatedReply(partitionKey: string, before: Date, eventId: string): Promise<boolean> {
    const row = await this.db.query<{ already_disclosed: boolean } & pg.QueryResultRow>(
      `SELECT EXISTS (
         SELECT 1 FROM inbound_events
         WHERE partition_key = $1
           AND id <> $3::uuid
           AND event_type IN ('message.received', 'message.postback')
           AND processing_outcome = 'handled'
           AND processed_at IS NOT NULL
           AND received_at >= $2::timestamptz - interval '24 hours'
           AND received_at < $2::timestamptz
       ) AS already_disclosed`,
      [partitionKey, before, eventId]
    );
    return row.rows[0]?.already_disclosed === true;
  }
}
