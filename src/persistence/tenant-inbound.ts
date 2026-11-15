import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { canonicalEventSchema, type CanonicalEvent, type IngressIdentity } from "../domain/events.js";
import type { PostgresDatabase } from "./postgres.js";
import { INBOUND_ACCEPTED_TOPIC } from "./outbox.js";

/**
 * Dormant, SERVER-ONLY tenant ingress staging. There are intentionally NO
 * production callers. A future webhook adapter must first verify the actual
 * provider signature, configured application and immutable account/connection
 * identity independently of customer-controlled webhook fields. This method
 * checks that proof against the active registry under PostgreSQL row locks;
 * it does not itself authenticate a webhook or grant messaging rights.
 *
 * The current legacy queue claimant intentionally PARKS all tenant-stamped
 * jobs. Never enable tenant processing before all downstream (including
 * consent, handoff, provider grants and per-send generation) gates are tested.
 */
const id = z.string().uuid();
const name = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const bindingSchema = z.object({
  workspaceId: id,
  connectionId: id,
  connectionGeneration: z.number().int().positive().safe(),
  provider: name,
  providerAccountId: z.string().min(1).max(256),
  providerApplicationKey: name,
  providerConnectionId: z.string().min(1).max(256).optional()
}).strict();
const ingressSchema = z.object({
  deduplicationKey: z.string().min(1).max(2048),
  partitionKey: z.string().min(1).max(2048)
}).strict();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export type TenantIngressBinding = z.infer<typeof bindingSchema>;

function object(value:unknown):Record<string,unknown>|undefined{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)
    ?value as Record<string,unknown>:undefined;
}
function telegramUserId(value:unknown):string|undefined{
  return typeof value==="number"&&Number.isSafeInteger(value)&&value>0
    ?String(value):undefined;
}
/** Normalized Bot API events name the BOT, while native ownership is the
 * VERIFIED Business user's numeric Telegram ID. Only a correctly bound
 * inbound Business message may cross that representation boundary. A future
 * production caller MUST separately verify the webhook secret and a current
 * getBusinessConnection result for this exact bot, owner and connection. */
function boundEvent(raw:CanonicalEvent,b:TenantIngressBinding):CanonicalEvent{
  if(raw.provider==="meta"&&["instagram","messenger","whatsapp"].includes(b.provider)
     &&raw.channel===b.provider &&raw.accountId===b.providerAccountId)return raw;
  if(raw.provider==="tiktok"&&b.provider==="tiktok"&&
     raw.channel==="business"&&raw.accountId===b.providerAccountId)return raw;
  // Legacy synthetic/meta and future unrelated adapters still require
  // provider equality. Native products above have stricter channel mapping.
  if(raw.provider===b.provider&&
     !["telegram","instagram","messenger","whatsapp","tiktok"].includes(b.provider)&&
     (b.provider!=="meta"||["instagram","messenger","whatsapp"].includes(raw.channel))&&
     raw.accountId===b.providerAccountId)return raw;
  if(raw.provider!=="telegram"||b.provider!=="telegram"||
     raw.channel!=="bot"||raw.eventType!=="message.received"||
     !/^telegram-oidc-[1-9][0-9]{4,15}$/u.test(b.providerApplicationKey)||
     !/^[1-9][0-9]{0,15}$/u.test(b.providerAccountId)||
     typeof b.providerConnectionId!=="string"||
     b.providerConnectionId.length<5||b.providerConnectionId.length>256||
     !/^[1-9][0-9]{0,15}$/u.test(raw.identityId??"")||
     !raw.occurredAt)
    throw Error("Tenant ingress provider identity mismatch");
  const bot=b.providerApplicationKey.slice("telegram-oidc-".length);
  const body=object(object(object(raw.data)?.update)?.business_message);
  const chat=object(body?.chat),sender=object(body?.from);
  if(raw.accountId!==bot ||
     raw.source!=="urn:ishikeit:source:telegram:bot:"+bot ||
     object(raw.data)?.businessConnectionId!==b.providerConnectionId ||
     body?.business_connection_id!==b.providerConnectionId ||
     chat?.type!=="private" ||
     telegramUserId(chat.id)!==raw.identityId ||
     telegramUserId(sender?.id)!==raw.identityId ||
     sender?.is_bot!==false ||
     body?.sender_business_bot!==undefined ||
     raw.identityId===b.providerAccountId)
    throw Error("Tenant Telegram Business message identity mismatch");
  return {...raw,accountId:b.providerAccountId};
}


interface DuplicateRow extends pg.QueryResultRow {
  workspace_id: string | null;
  connection_id: string | null;
  connection_generation: number | string | null;
  provider: string;
  account_id: string;
  channel: string;
  capability: string;
  event_type: string;
  provider_event_id: string | null;
  provider_message_id: string | null;
  partition_key: string;
  payload_hash: string;
}

export class PostgresTenantInboundStaging {
  constructor(private readonly db: Pick<PostgresDatabase, "transaction">) {}

  async ingestVerified(
    eventInput: CanonicalEvent,
    identityInput: IngressIdentity,
    rawBodyHash: string,
    bindingInput: TenantIngressBinding
  ): Promise<"created" | "duplicate"> {
    const original=canonicalEventSchema.parse(eventInput);
    const identity=ingressSchema.parse(identityInput);
    const binding=bindingSchema.parse(bindingInput);
    hashSchema.parse(rawBodyHash);
    const event=boundEvent(original,binding);
    // Legacy WhatsApp opt-out/opt-in and LatePoint projection require
    // immediate transaction-side effects currently implemented only in the
    // legacy inbound store. Do not silently omit those safety side effects.
    if (event.provider === "latepoint" || event.channel === "whatsapp" ||
        event.capability !== "messaging") {
      throw new Error("Tenant ingress side effects are not yet supported");
    }

    return this.db.transaction(async tx => {
      // Hold FOR SHARE until BOTH inbound record and parked outbox event
      // commit. A pause/disconnect or rebind updating this registry row
      // cannot race ahead of the allocation and supply a stale generation.
      const authorized = await tx.query(
        `SELECT c.connection_id
           FROM public.ishikeit_account_connections c
           JOIN public.ishikeit_workspaces w ON w.workspace_id=c.workspace_id
          WHERE c.connection_id=$1::uuid AND c.workspace_id=$2::uuid
            AND c.provider=$3 AND c.provider_account_id=$4
            AND c.provider_application_key=$5
            AND c.provider_connection_id IS NOT DISTINCT FROM $6::text
            AND c.generation=$7::bigint AND c.status='connected'
            AND w.state='active'
          FOR SHARE OF c,w`,
        [binding.connectionId, binding.workspaceId, binding.provider,
          binding.providerAccountId, binding.providerApplicationKey,
          binding.providerConnectionId ?? null, binding.connectionGeneration]
      );
      if (authorized.rowCount !== 1) {
        throw new Error("Tenant ingress connection unavailable or stale");
      }

      const eventId = randomUUID();
      const inserted = await tx.query(
        `INSERT INTO public.inbound_events
          (id,provider,channel,capability,account_id,event_type,provider_event_id,
           provider_message_id,deduplication_key,partition_key,payload_hash,
           normalized_payload,schema_version,status,occurred_at,received_at,
           workspace_id,connection_id,connection_generation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,
                 'persisted',$14,$15,$16::uuid,$17::uuid,$18::bigint)
         ON CONFLICT (deduplication_key) DO NOTHING
         RETURNING id`,
        [eventId,event.provider,event.channel,event.capability,event.accountId,
         event.eventType,event.providerEventId ?? null,event.providerMessageId ?? null,
         identity.deduplicationKey,identity.partitionKey,rawBodyHash,
         JSON.stringify(event),event.schemaVersion,
         event.occurredAt ? new Date(event.occurredAt) : null,
         new Date(event.receivedAt),
         binding.workspaceId,binding.connectionId,binding.connectionGeneration]
      );
      if (inserted.rowCount !== 1) {
        // Existing global dedup cannot silently mean success for a DIFFERENT
        // tenant, generation, body or account. Same signed payload may have
        // a different local receivedAt on retry; compare raw-body digest,
        // immutable provider account and connection provenance instead.
        const existing = await tx.query<DuplicateRow>(
          `SELECT workspace_id,connection_id,connection_generation,
                  provider,account_id,channel,capability,event_type,
                  provider_event_id,provider_message_id,partition_key,payload_hash
             FROM public.inbound_events
            WHERE deduplication_key=$1 FOR SHARE`,
          [identity.deduplicationKey]
        );
        const row = existing.rows[0];
        if (row === undefined ||
            row.workspace_id !== binding.workspaceId ||
            row.connection_id !== binding.connectionId ||
            Number(row.connection_generation) !== binding.connectionGeneration ||
            row.provider !== event.provider ||
            row.account_id !== event.accountId ||
            row.channel !== event.channel ||
            row.capability !== event.capability ||
            row.event_type !== event.eventType ||
            row.provider_event_id !== (event.providerEventId ?? null) ||
            row.provider_message_id !== (event.providerMessageId ?? null) ||
            row.partition_key !== identity.partitionKey ||
            row.payload_hash !== rawBodyHash) {
          throw new Error("Tenant ingress deduplication ownership collision");
        }
        return "duplicate";
      }

      // The tenant event deliberately remains parked in the outbox. The
      // existing legacy claimant categorically excludes non-null provenance.
      await tx.query(
        `INSERT INTO public.outbox
          (id,topic,partition_key,payload,workspace_id,connection_id,connection_generation)
         VALUES($1,$2,$3,$4::jsonb,$5::uuid,$6::uuid,$7::bigint)`,
        [randomUUID(),INBOUND_ACCEPTED_TOPIC,identity.partitionKey,
          JSON.stringify({schemaVersion:1,eventId}),
          binding.workspaceId,binding.connectionId,binding.connectionGeneration]
      );
      return "created";
    });
  }
}
