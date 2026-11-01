import type pg from "pg";
import { actionJobId } from "../domain/actions.js";
import type { PostgresDatabase } from "./postgres.js";

/** Read-only, partition-scoped history for truthful Meta AI disclosure.
 * A handled inbound event is NOT evidence its reply reached the provider.
 * Indexed inbound partition history + outbox primary key avoid a migration.
 */
export interface MetaDisclosureReader {
  hasRecentAutomatedReply(partitionKey: string, before: Date, eventId: string): Promise<boolean>;
}

interface PriorInboundRow extends pg.QueryResultRow { id: string; }
interface DeliveryRow extends pg.QueryResultRow { delivered: boolean; }

export class PostgresMetaDisclosureReader implements MetaDisclosureReader {
  constructor(private readonly db: Pick<PostgresDatabase, "query">) {}

  async hasRecentAutomatedReply(partitionKey: string, before: Date, eventId: string): Promise<boolean> {
    // Busy conversations may exceed this bound: redisclose rather than
    // suppress a required disclosure on an unproven earlier delivery.
    const inbound = await this.db.query<PriorInboundRow>(
      `SELECT id FROM inbound_events
       WHERE partition_key = $1
         AND id <> $3::uuid
         AND event_type IN ('message.received', 'message.postback')
         AND processing_outcome = 'handled'
         AND processed_at IS NOT NULL
         AND received_at >= $2::timestamptz - interval '24 hours'
         AND received_at < $2::timestamptz
       ORDER BY received_at DESC LIMIT 256`,
      [partitionKey, before, eventId]
    );
    if (inbound.rows.length === 0) return false;

    // Partition-ordered replies publish part 0 before subsequent parts.
    // Derive durable job IDs and use outbox(id) PK, never an unindexed
    // scan of customer message payloads.
    const replyIds = inbound.rows.map((row) => actionJobId({
      schemaVersion: 1,
      idempotencyKey: `${row.id}:reply:0`,
      provider: "meta",
      capability: "messaging",
      operation: "message.send",
      orderingKey: partitionKey,
      target: {},
      body: {}
    }));
    const published = await this.db.query<DeliveryRow>(
      `SELECT EXISTS (
         SELECT 1 FROM outbox
         WHERE id = ANY($1::uuid[])
           AND topic = 'action.dispatch'
           AND partition_key = $2
           AND published_at IS NOT NULL
           AND published_at >= $3::timestamptz - interval '24 hours'
           AND published_at < $3::timestamptz
       ) AS delivered`,
      [replyIds, partitionKey, before]
    );
    return published.rows[0]?.delivered === true;
  }
}
