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
       ) AS active`,
      [key, purpose]
    );
    return result.rows[0]?.active === true;
  }

  /** Idempotent opt-out; only operate on a verified, signed customer message. */
  async revokeInTransaction(
    tx: SqlExecutor,
    accountId: string,
    recipientId: string
  ): Promise<void> {
    const key = this.recipientKey(accountId, recipientId);
    await tx.query(
      `UPDATE public.meta_whatsapp_template_opt_ins
       SET revoked_at=now()
       WHERE recipient_key=$1 AND revoked_at IS NULL`,
      [key]
    );
  }
}
