import { createHmac } from "node:crypto";
import type pg from "pg";
import type { PostgresDatabase, SqlExecutor } from "./postgres.js";

export type WhatsAppConsentPurpose = "appointment_updates";

export interface WhatsAppConsentReader {
  hasActiveConsent(accountId: string, recipientId: string, purpose: WhatsAppConsentPurpose): Promise<boolean>;
}

interface ConsentRow extends pg.QueryResultRow {
  active: boolean;
}

/**
 * No implicit consent from receiving ordinary messages. An explicit,
 * independently verified consent event must be recorded in the private ledger.
 * The identity key is an HMAC, not an enumerable plain hash of a phone number.
 */
export class PostgresWhatsAppConsentStore implements WhatsAppConsentReader {
  readonly #hashKey: Buffer;
  constructor(
    private readonly db: PostgresDatabase,
    hashKeyBase64: string
  ) {
    const key = Buffer.from(hashKeyBase64, "base64");
    if (key.length !== 32 || key.toString("base64").replace(/=+$/u, "")
      !== hashKeyBase64.replace(/=+$/u, "")) {
      throw new Error("WhatsApp consent identity key must encode exactly 32 bytes");
    }
    this.#hashKey = key;
  }

  private recipientKey(accountId: string, recipientId: string): string {
    if (!/^\d{5,32}$/u.test(accountId) || !/^\d{7,15}$/u.test(recipientId)) {
      throw new Error("Invalid WhatsApp consent account or recipient");
    }
    return createHmac("sha256", this.#hashKey)
      .update("meta-whatsapp-consent-v1\0" + accountId + "\0" + recipientId, "utf8")
      .digest("hex");
  }

  async hasActiveConsent(
    accountId: string,
    recipientId: string,
    purpose: WhatsAppConsentPurpose
  ): Promise<boolean> {
    const key = this.recipientKey(accountId, recipientId);
    const result = await this.db.query<ConsentRow>(
      `SELECT EXISTS (
         SELECT 1 FROM public.meta_whatsapp_template_opt_ins
         WHERE recipient_key=$1 AND purpose=$2
           AND consented_at<=now() AND revoked_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.meta_whatsapp_template_opt_outs AS stopped
             WHERE stopped.recipient_key=meta_whatsapp_template_opt_ins.recipient_key
               AND stopped.purpose=meta_whatsapp_template_opt_ins.purpose
               AND stopped.opted_out_at >= meta_whatsapp_template_opt_ins.consented_at
           )
       ) AS active`,
      [key, purpose]
    );
    return result.rows[0]?.active === true;
  }

  /**
   * Record the explicit signed opt-in atomically with inbound ingestion.
   * Out-of-order/old messages cannot override a later STOP or a newer opt-in.
   */
  async grantInTransaction(
    tx: SqlExecutor,
    accountId: string,
    recipientId: string,
    sourceEventId: string,
    occurredAt: Date
  ): Promise<void> {
    if (!Number.isFinite(occurredAt.getTime())) throw new Error("Invalid consent timestamp");
    const key = this.recipientKey(accountId, recipientId);
    await tx.query(
      `INSERT INTO public.meta_whatsapp_template_opt_ins
       (recipient_key,purpose,source_event_id,consented_at,revoked_at)
       SELECT $1,'appointment_updates',$2::uuid,LEAST($3::timestamptz,now()),NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM public.meta_whatsapp_template_opt_outs
         WHERE recipient_key=$1 AND purpose='appointment_updates'
           AND opted_out_at >= LEAST($3::timestamptz,now())
       )
       ON CONFLICT(recipient_key,purpose) DO UPDATE SET
         source_event_id=EXCLUDED.source_event_id,
         consented_at=EXCLUDED.consented_at,
         revoked_at=NULL
       WHERE EXCLUDED.consented_at >
         GREATEST(meta_whatsapp_template_opt_ins.consented_at,
           COALESCE(meta_whatsapp_template_opt_ins.revoked_at, meta_whatsapp_template_opt_ins.consented_at))
         AND NOT EXISTS (
           SELECT 1 FROM public.meta_whatsapp_template_opt_outs
           WHERE recipient_key=EXCLUDED.recipient_key
             AND purpose=EXCLUDED.purpose
             AND opted_out_at >= EXCLUDED.consented_at
         )`,
      [key, sourceEventId, occurredAt]
    );
  }

  /**
   * Persist a STOP tombstone even when the customer has never opted in.
   * This blocks a delayed old opt-in webhook from creating new consent.
   * The source event is the exact signed customer STOP, not inferred intent.
   */
  async revokeInTransaction(
    tx: SqlExecutor,
    accountId: string,
    recipientId: string,
    sourceEventId: string,
    occurredAt: Date
  ): Promise<void> {
    if (!Number.isFinite(occurredAt.getTime())) throw new Error("Invalid STOP timestamp");
    const key = this.recipientKey(accountId, recipientId);
    await tx.query(
      `INSERT INTO public.meta_whatsapp_template_opt_outs
         (recipient_key,purpose,source_event_id,opted_out_at)
       VALUES ($1,'appointment_updates',$2::uuid,GREATEST($3::timestamptz,now()))
       ON CONFLICT(recipient_key,purpose) DO UPDATE SET
         opted_out_at=GREATEST(
           meta_whatsapp_template_opt_outs.opted_out_at,EXCLUDED.opted_out_at),
         source_event_id=CASE
           WHEN EXCLUDED.opted_out_at >= meta_whatsapp_template_opt_outs.opted_out_at
             THEN EXCLUDED.source_event_id
           ELSE meta_whatsapp_template_opt_outs.source_event_id END`,
      [key, sourceEventId, occurredAt]
    );
    await tx.query(
      `UPDATE public.meta_whatsapp_template_opt_ins
       SET revoked_at=GREATEST(now(),consented_at,$3::timestamptz)
       WHERE recipient_key=$1 AND purpose='appointment_updates' AND revoked_at IS NULL`,
      [key, "appointment_updates", occurredAt]
    );
  }
}
