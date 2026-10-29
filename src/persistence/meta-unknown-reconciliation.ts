import { createHash } from "node:crypto";
import type pg from "pg";
import type { PostgresDatabase } from "./postgres.js";

/**
 * Operator attestation only. This ledger has no method that resets an outbox
 * dead letter, creates an action, or invokes a provider.
 */
export type MetaUnknownDisposition = "followup_required" | "reviewed_do_not_resend";
export type MetaUnknownEvidence = "provider_record" | "manual_thread_review" | "customer_confirmation";

export interface MetaUnknownCase {
  outboxId: string;
  channel: "messenger" | "instagram" | "whatsapp" | "unknown";
  operation: "message.send" | "message.template.send";
  armedAt: string | null;
  deadLetteredAt: string;
  disposition: MetaUnknownDisposition | null;
  reviewedAt: string | null;
}

export interface MetaUnknownCaseSummary {
  total: number;
  unreviewed: number;
  reviewed: number;
  cases: MetaUnknownCase[];
}

export interface MetaUnknownReview {
  outboxId: string;
  disposition: MetaUnknownDisposition;
  evidence: MetaUnknownEvidence;
  /** Pseudonymous operator label. Its hash, not the label, is stored. */
  operatorTag: string;
}

export type MetaReviewResult = "recorded" | "already_recorded" | "conflict" | "not_found";

export interface MetaUnknownReconciler {
  list(limit: number): Promise<MetaUnknownCaseSummary>;
  review(input: MetaUnknownReview): Promise<MetaReviewResult>;
}

interface CountRow extends pg.QueryResultRow {
  total: string;
  reviewed: string;
}
interface CaseRow extends pg.QueryResultRow {
  outbox_id: string;
  channel: string | null;
  operation: "message.send" | "message.template.send";
  armed_at: Date | string | null;
  dead_lettered_at: Date | string;
  disposition: MetaUnknownDisposition | null;
  reviewed_at: Date | string | null;
}
interface ExistingRow extends pg.QueryResultRow {
  exists: boolean;
  disposition: MetaUnknownDisposition | null;
  evidence: MetaUnknownEvidence | null;
  reviewer_hash: string | null;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export class PostgresMetaUnknownReconciler implements MetaUnknownReconciler {
  constructor(private readonly db: PostgresDatabase) {}

  async list(limit: number): Promise<MetaUnknownCaseSummary> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Unknown-outcome list limit must be 1 to 50");
    }
    const filter = `o.topic='action.dispatch'
      AND o.dead_lettered_at IS NOT NULL
      AND o.dead_letter_reason LIKE 'provider_outcome_unknown;%'
      AND o.payload->>'provider'='meta'
      AND o.payload->>'capability'='messaging'
      AND o.payload->>'operation' IN ('message.send','message.template.send')`;
    const [counts, cases] = await Promise.all([
      this.db.query<CountRow>(
        `SELECT count(*)::bigint AS total,
                count(r.outbox_id)::bigint AS reviewed
         FROM public.outbox AS o
         LEFT JOIN public.meta_outbound_reconciliations AS r ON r.outbox_id=o.id
         WHERE ${filter}`
      ),
      this.db.query<CaseRow>(
        `SELECT o.id AS outbox_id,
                o.payload->'target'->>'channel' AS channel,
                o.payload->>'operation' AS operation,
                o.meta_send_started_at AS armed_at,
                o.dead_lettered_at,
                r.disposition, r.reviewed_at
         FROM public.outbox AS o
         LEFT JOIN public.meta_outbound_reconciliations AS r ON r.outbox_id=o.id
         WHERE ${filter}
         ORDER BY r.reviewed_at NULLS FIRST, o.dead_lettered_at DESC, o.id
         LIMIT $1`, [limit]
      )
    ]);
    const total = Number(counts.rows[0]?.total ?? 0);
    const reviewed = Number(counts.rows[0]?.reviewed ?? 0);
    return {
      total,
      unreviewed: total - reviewed,
      reviewed,
      cases: cases.rows.map((r) => ({
        outboxId: r.outbox_id,
        channel: r.channel === "messenger" || r.channel === "instagram" || r.channel === "whatsapp"
          ? r.channel : "unknown",
        operation: r.operation,
        armedAt: r.armed_at === null ? null : iso(r.armed_at),
        deadLetteredAt: iso(r.dead_lettered_at),
        disposition: r.disposition,
        reviewedAt: r.reviewed_at === null ? null : iso(r.reviewed_at)
      }))
    };
  }

  async review(input: MetaUnknownReview): Promise<MetaReviewResult> {
    const reviewerHash = createHash("sha256").update(input.operatorTag, "utf8").digest("hex");
    const result = await this.db.query<{ outbox_id: string } & pg.QueryResultRow>(
      `INSERT INTO public.meta_outbound_reconciliations
           (outbox_id, disposition, evidence, reviewer_hash)
       SELECT o.id,$2,$3,$4
       FROM public.outbox AS o
       WHERE o.id=$1::uuid
         AND o.topic='action.dispatch'
         AND o.dead_lettered_at IS NOT NULL
         AND o.dead_letter_reason LIKE 'provider_outcome_unknown;%'
         AND o.payload->>'provider'='meta'
         AND o.payload->>'capability'='messaging'
         AND o.payload->>'operation' IN ('message.send','message.template.send')
       ON CONFLICT (outbox_id) DO NOTHING RETURNING outbox_id`,
      [input.outboxId, input.disposition, input.evidence, reviewerHash]
    );
    if (result.rowCount === 1) return "recorded";
    const existing = await this.db.query<ExistingRow>(
      `SELECT (o.id IS NOT NULL) AS exists,
              r.disposition, r.evidence, r.reviewer_hash
       FROM public.outbox AS o
       LEFT JOIN public.meta_outbound_reconciliations AS r ON r.outbox_id=o.id
       WHERE o.id=$1::uuid
         AND o.topic='action.dispatch'
         AND o.dead_lettered_at IS NOT NULL
         AND o.dead_letter_reason LIKE 'provider_outcome_unknown;%'
         AND o.payload->>'provider'='meta'
         AND o.payload->>'capability'='messaging'
         AND o.payload->>'operation' IN ('message.send','message.template.send')`,
      [input.outboxId]
    );
    const row = existing.rows[0];
    if (row?.exists !== true) return "not_found";
    return row.disposition === input.disposition && row.evidence === input.evidence
      && row.reviewer_hash === reviewerHash
      ? "already_recorded" : "conflict";
  }
}
