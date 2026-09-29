import { createHash, randomUUID } from "node:crypto";
import type { CanonicalEvent, IngressIdentity } from "../domain/events.js";
import type { PostgresDatabase } from "./postgres.js";

export interface InboundStore {
  ingest(event: CanonicalEvent, identity: IngressIdentity, rawBodyHash: string): Promise<"created"|"duplicate">;
}

export class PostgresInboundStore implements InboundStore {
  constructor(private readonly db: PostgresDatabase) {}

  async ingest(event: CanonicalEvent, identity: IngressIdentity, rawBodyHash: string): Promise<"created"|"duplicate"> {
    return this.db.transaction(async (tx) => {
      const id = randomUUID();
      const inserted = await tx.query(
        "INSERT INTO inbound_events (id,channel,account_id,event_type,provider_event_id,provider_message_id,deduplication_key,payload_hash,normalized_payload,schema_version,status,occurred_at,received_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'persisted',$11,$12) ON CONFLICT (deduplication_key) DO NOTHING RETURNING id",
        [id,event.channel,event.accountId,event.eventType,event.providerEventId ?? null,event.providerMessageId ?? null,identity.deduplicationKey,rawBodyHash,JSON.stringify(event),event.schemaVersion,event.occurredAt ? new Date(event.occurredAt) : null,new Date(event.receivedAt)]
      );
      if (inserted.rowCount !== 1) return "duplicate";
      await tx.query(
        "INSERT INTO outbox (id,topic,partition_key,payload) VALUES ($1,'inbound.event.accepted',$2,$3::jsonb)",
        [randomUUID(),identity.partitionKey,JSON.stringify({eventId:id})]
      );
      return "created";
    });
  }
}

export function sha256Hex(raw: Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}
