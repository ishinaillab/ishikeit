import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { MetaOutboundPayload } from "../domain/outbound.js";
import { outboundPartitionKey } from "../domain/outbound.js";
import type { PostgresDatabase } from "./postgres.js";

export const META_SEND_TOPIC = "meta.message.send";

export interface OutboxJob {
  id: string;
  topic: string;
  partitionKey: string;
  payload: unknown;
  attemptCount: number;
  leaseToken: string;
}

export interface OutboxDeliveryStore {
  claimNext(leaseDurationMs: number): Promise<OutboxJob | undefined>;
  complete(job: OutboxJob, providerMessageId?: string): Promise<boolean>;
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

export class PostgresOutboxStore implements OutboxDeliveryStore {
  constructor(private readonly db: PostgresDatabase) {}

  async enqueueMetaMessage(payload: MetaOutboundPayload): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      "INSERT INTO outbox (id,topic,partition_key,payload) VALUES ($1,$2,$3,$4::jsonb)",
      [id, META_SEND_TOPIC, outboundPartitionKey(payload), JSON.stringify(payload)]
    );
    return id;
  }

  async claimNext(leaseDurationMs: number): Promise<OutboxJob | undefined> {
    const leaseToken = randomUUID();
    const result = await this.db.query<OutboxRow>(
      `WITH candidate AS (
         SELECT id
         FROM outbox
         WHERE topic = $1
           AND published_at IS NULL
           AND dead_lettered_at IS NULL
           AND COALESCE(next_attempt_at, created_at) <= now()
           AND (lease_expires_at IS NULL OR lease_expires_at <= now())
         ORDER BY COALESCE(next_attempt_at, created_at), created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE outbox AS o
       SET lease_token = $2::uuid,
           lease_expires_at = now() + make_interval(secs => $3::double precision)
       FROM candidate
       WHERE o.id = candidate.id
       RETURNING o.id,o.topic,o.partition_key,o.payload,o.attempt_count,o.lease_token`,
      [META_SEND_TOPIC, leaseToken, leaseDurationMs / 1000]
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

  async complete(job: OutboxJob, providerMessageId?: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE outbox
       SET published_at = now(),
           lease_expires_at = NULL,
           lease_token = NULL,
           payload = CASE
             WHEN $3::text IS NULL THEN payload
             ELSE payload || jsonb_build_object(
               'delivery',
               jsonb_build_object('providerMessageId',$3::text,'sentAt',now())
             )
           END
       WHERE id = $1::uuid AND lease_token = $2::uuid`,
      [job.id, job.leaseToken, providerMessageId ?? null]
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

export function outboundPayloadFingerprint(payload: MetaOutboundPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
