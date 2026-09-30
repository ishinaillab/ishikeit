import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { ActionEnvelope } from "../domain/actions.js";
import { normalizeHandoffReason, type ProcessingDisposition } from "../domain/processing.js";
import { canonicalEventSchema, type CanonicalEvent, type IngressIdentity } from "../domain/events.js";
import { enqueueAction, INBOUND_ACCEPTED_TOPIC } from "./outbox.js";
import type { PostgresDatabase } from "./postgres.js";

export interface InboundStore {
  ingest(event: CanonicalEvent, identity: IngressIdentity, rawBodyHash: string): Promise<"created"|"duplicate">;
}

export interface StoredInboundEvent {
  id: string;
  event: CanonicalEvent;
  partitionKey: string;
  status: string;
  processedAt?: Date;
}

export interface InboundEventProcessingStore {
  get(id: string): Promise<StoredInboundEvent | undefined>;
  markProcessing(id: string): Promise<void>;
  complete(id: string, actions: readonly ActionEnvelope[], disposition: ProcessingDisposition): Promise<void>;
  recordFailure(id: string, reason: string): Promise<void>;
}

interface EventRow extends pg.QueryResultRow {
  id: string;
  normalized_payload: unknown;
  partition_key: string;
  status: string;
  processed_at: Date | null;
}

export class PostgresInboundStore implements InboundStore {
  constructor(private readonly db: PostgresDatabase) {}

  async ingest(event: CanonicalEvent, identity: IngressIdentity, rawBodyHash: string): Promise<"created"|"duplicate"> {
    return this.db.transaction(async (tx) => {
      const id = randomUUID();
      const inserted = await tx.query(
        `INSERT INTO inbound_events
         (id,provider,channel,capability,account_id,event_type,provider_event_id,provider_message_id,
          deduplication_key,partition_key,payload_hash,normalized_payload,schema_version,status,occurred_at,received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,'persisted',$14,$15)
         ON CONFLICT (deduplication_key) DO NOTHING
         RETURNING id`,
        [
          id,
          event.provider,
          event.channel,
          event.capability,
          event.accountId,
          event.eventType,
          event.providerEventId ?? null,
          event.providerMessageId ?? null,
          identity.deduplicationKey,
          identity.partitionKey,
          rawBodyHash,
          JSON.stringify(event),
          event.schemaVersion,
          event.occurredAt ? new Date(event.occurredAt) : null,
          new Date(event.receivedAt)
        ]
      );
      if (inserted.rowCount !== 1) return "duplicate";
      await tx.query(
        "INSERT INTO outbox (id,topic,partition_key,payload) VALUES ($1,$2,$3,$4::jsonb)",
        [randomUUID(), INBOUND_ACCEPTED_TOPIC, identity.partitionKey, JSON.stringify({ schemaVersion: 1, eventId: id })]
      );
      return "created";
    });
  }
}

export class PostgresInboundEventRepository implements InboundEventProcessingStore {
  constructor(private readonly db: PostgresDatabase) {}

  async get(id: string): Promise<StoredInboundEvent | undefined> {
    const result = await this.db.query<EventRow>(
      "SELECT id,normalized_payload,partition_key,status,processed_at FROM inbound_events WHERE id = $1::uuid",
      [id]
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;

    const parsed = canonicalEventSchema.safeParse(row.normalized_payload);
    if (!parsed.success) throw new Error("stored inbound event has an unsupported schema");

    return {
      id: row.id,
      event: parsed.data,
      partitionKey: row.partition_key,
      status: row.status,
      ...(row.processed_at === null ? {} : { processedAt: row.processed_at })
    };
  }

  async markProcessing(id: string): Promise<void> {
    await this.db.query(
      `UPDATE inbound_events
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           last_error = NULL
       WHERE id = $1::uuid AND processed_at IS NULL`,
      [id]
    );
  }

  async complete(
    id: string,
    actions: readonly ActionEnvelope[],
    disposition: ProcessingDisposition
  ): Promise<void> {
    const handoffReason = disposition.outcome === "handoff"
      ? normalizeHandoffReason(disposition.handoffReason)
      : null;

    await this.db.transaction(async (tx) => {
      for (const action of actions) await enqueueAction(tx, action);
      const result = await tx.query(
        `UPDATE inbound_events
         SET status = 'processed',
             processed_at = now(),
             last_error = NULL,
             processing_outcome = $2,
             handoff_reason = $3
         WHERE id = $1::uuid AND processed_at IS NULL`,
        [id, disposition.outcome, handoffReason]
      );
      if (result.rowCount !== 1) {
        const existing = await tx.query<{ processed_at: Date | null } & pg.QueryResultRow>(
          "SELECT processed_at FROM inbound_events WHERE id = $1::uuid",
          [id]
        );
        if (existing.rows[0]?.processed_at === null || existing.rows[0] === undefined) {
          throw new Error("failed to mark inbound event processed");
        }
      }
    });
  }

  async recordFailure(id: string, reason: string): Promise<void> {
    await this.db.query(
      `UPDATE inbound_events
       SET status = 'failed',
           last_error = $2
       WHERE id = $1::uuid AND processed_at IS NULL`,
      [id, reason.slice(0, 2000)]
    );
  }
}

export function sha256Hex(raw: Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}
