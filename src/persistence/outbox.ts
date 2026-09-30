import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ActionEnvelope } from "../domain/actions.js";
import { actionJobId } from "../domain/actions.js";
import type { PostgresDatabase, SqlExecutor } from "./postgres.js";

export const ACTION_DISPATCH_TOPIC = "action.dispatch";
export const INBOUND_ACCEPTED_TOPIC = "inbound.event.accepted";

export interface OutboxJob {
  id: string;
  topic: string;
  partitionKey: string;
  payload: unknown;
  attemptCount: number;
  leaseToken: string;
}

export interface EnqueueResult {
  id: string;
  created: boolean;
}

export interface OutboxDeliveryStore {
  claimNext(topic: string, leaseDurationMs: number): Promise<OutboxJob | undefined>;
  complete(job: OutboxJob, providerResourceId?: string): Promise<boolean>;
  retry(job: OutboxJob, nextAttemptAt: Date): Promise<boolean>;
  deadLetter(job: OutboxJob, reason: string): Promise<boolean>;
}

interface OutboxRow extends pg.QueryResultRow {
  id: string;
  topic: string;
  partition_key: string;
  payload: unknown;
  attempt_count: number;
  lease_token: string;
}

interface PayloadMatchRow extends pg.QueryResultRow {
  same_payload: boolean;
}

export async function enqueueAction(
  executor: SqlExecutor,
  action: ActionEnvelope
): Promise<EnqueueResult> {
  const id = actionJobId(action);
  const inserted = await executor.query<{ id: string } & pg.QueryResultRow>(
    "INSERT INTO outbox (id,topic,partition_key,payload) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id",
    [id, ACTION_DISPATCH_TOPIC, action.orderingKey, JSON.stringify(action)]
  );

  if (inserted.rowCount === 1) return { id, created: true };

  const existing = await executor.query<PayloadMatchRow>(
    "SELECT payload = $2::jsonb AS same_payload FROM outbox WHERE id = $1::uuid",
    [id, JSON.stringify(action)]
  );
  if (existing.rows[0]?.same_payload !== true) {
    throw new Error("action idempotency key was reused with a different payload");
  }
  return { id, created: false };
}

export class PostgresOutboxStore implements OutboxDeliveryStore {
  constructor(private readonly db: PostgresDatabase) {}

  enqueueAction(action: ActionEnvelope): Promise<EnqueueResult> {
    return enqueueAction(this.db, action);
  }

  async claimNext(topic: string, leaseDurationMs: number): Promise<OutboxJob | undefined> {
    const leaseToken = randomUUID();
    const result = await this.db.query<OutboxRow>(
      `WITH candidate AS (
         SELECT o.id
         FROM outbox AS o
         WHERE o.topic = $1
           AND o.published_at IS NULL
           AND o.dead_lettered_at IS NULL
           AND COALESCE(o.next_attempt_at, o.created_at) <= now()
           AND (o.lease_expires_at IS NULL OR o.lease_expires_at <= now())
           AND NOT EXISTS (
             SELECT 1
             FROM outbox AS earlier
             WHERE earlier.topic = o.topic
               AND earlier.partition_key = o.partition_key
               AND earlier.published_at IS NULL
               AND earlier.dead_lettered_at IS NULL
               AND (earlier.created_at, earlier.id) < (o.created_at, o.id)
           )
           AND NOT EXISTS (
             SELECT 1
             FROM outbox AS leased
             WHERE leased.topic = o.topic
               AND leased.partition_key = o.partition_key
               AND leased.id <> o.id
               AND leased.published_at IS NULL
               AND leased.dead_lettered_at IS NULL
               AND leased.lease_expires_at > now()
           )
         ORDER BY COALESCE(o.next_attempt_at, o.created_at), o.created_at, o.id
         FOR UPDATE OF o SKIP LOCKED
         LIMIT 1
       )
       UPDATE outbox AS o
       SET lease_token = $2::uuid,
           lease_expires_at = now() + make_interval(secs => $3::double precision)
       FROM candidate
       WHERE o.id = candidate.id
       RETURNING o.id,o.topic,o.partition_key,o.payload,o.attempt_count,o.lease_token`,
      [topic, leaseToken, leaseDurationMs / 1000]
    );

    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      topic: row.topic,
      partitionKey: row.partition_key,
      payload: row.payload,
      attemptCount: row.attempt_count,
      leaseToken: row.lease_token
    };
  }

  async complete(job: OutboxJob, providerResourceId?: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE outbox
       SET published_at = now(),
           lease_expires_at = NULL,
           lease_token = NULL,
           payload = CASE
             WHEN $3::text IS NULL THEN payload
             ELSE payload || jsonb_build_object(
               'delivery',
               jsonb_build_object('providerResourceId',$3::text,'sentAt',now())
             )
           END
       WHERE id = $1::uuid AND lease_token = $2::uuid`,
      [job.id, job.leaseToken, providerResourceId ?? null]
    );
    return result.rowCount === 1;
  }

  async retry(job: OutboxJob, nextAttemptAt: Date): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE outbox
       SET attempt_count = attempt_count + 1,
           next_attempt_at = $3,
           lease_expires_at = NULL,
           lease_token = NULL
       WHERE id = $1::uuid AND lease_token = $2::uuid`,
      [job.id, job.leaseToken, nextAttemptAt]
    );
    return result.rowCount === 1;
  }

  async deadLetter(job: OutboxJob, reason: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE outbox
       SET attempt_count = attempt_count + 1,
           dead_lettered_at = now(),
           dead_letter_reason = $3,
           lease_expires_at = NULL,
           lease_token = NULL
       WHERE id = $1::uuid AND lease_token = $2::uuid`,
      [job.id, job.leaseToken, reason.slice(0, 2000)]
    );
    return result.rowCount === 1;
  }
}
