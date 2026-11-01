import type pg from "pg";
import { z } from "zod";
import type { PostgresDatabase } from "./postgres.js";
import type { ObservedAccountFact } from "../policy/provider-contract.js";

const id = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const evidenceKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const reference = z.string().min(1).max(256)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const factSchema = z.object({
  provider: id.max(128),
  accountId: id,
  key: evidenceKey,
  state: z.enum(["granted", "denied"]),
  source: z.enum(["provider_api", "oauth_grant", "signed_webhook", "provider_connection_readback"]),
  sourceReference: reference,
  observedAt: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true })
}).strict().refine((fact) =>
  Date.parse(fact.validUntil) > Date.parse(fact.observedAt), "Evidence expiry must follow observation"
);

type FactRow = pg.QueryResultRow & {
  provider: string;
  account_id: string;
  evidence_key: string;
  state: "granted" | "denied";
  evidence_source: ObservedAccountFact["source"];
  source_reference: string;
  observed_at: Date;
  valid_until: Date;
};

/** Persistent latest-per-key snapshots; a missing/expired observation never
 * resurrects an older grant. Data writes come from server-verified readers
 * only. The store is NOT an externally callable permission-management API.
 */
export class PostgresAccountCapabilityFacts {
  constructor(private readonly db: Pick<PostgresDatabase, "query" | "transaction">) {}

  async record(facts: readonly ObservedAccountFact[]): Promise<number> {
    if (facts.length === 0) return 0;
    if (facts.length > 32) throw new Error("Provider proof batch exceeds bound");
    const parsed = facts.map((fact) => factSchema.parse(fact));
    const first = parsed[0]!;
    if (parsed.some((fact) =>
      fact.provider !== first.provider || fact.accountId !== first.accountId
    )) throw new Error("Mixed account/provider proof batch rejected");
    // Validate entire batch before any writes. A denials tied to a grant
    // must win even when the observations arrive in reverse order.
    return this.db.transaction(async (tx) => {
      let applied = 0;
      for (const fact of parsed) {
      const result = await tx.query(
        `INSERT INTO public.provider_account_capability_facts
           (provider,account_id,evidence_key,state,evidence_source,
            source_reference,observed_at,valid_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (provider,account_id,evidence_key) DO UPDATE SET
           state=EXCLUDED.state,
           evidence_source=EXCLUDED.evidence_source,
           source_reference=EXCLUDED.source_reference,
           observed_at=EXCLUDED.observed_at,
           valid_until=EXCLUDED.valid_until,
           recorded_at=now()
         WHERE EXCLUDED.observed_at > provider_account_capability_facts.observed_at
            OR (EXCLUDED.observed_at = provider_account_capability_facts.observed_at
              AND EXCLUDED.state = 'denied'
              AND provider_account_capability_facts.state <> 'denied')`,
        [fact.provider, fact.accountId, fact.key, fact.state, fact.source,
          fact.sourceReference, new Date(fact.observedAt), new Date(fact.validUntil)]
      );
      if (result.rowCount === 1) applied++;
    }
      return applied;
    });
  }

  async read(provider: string, accountId: string): Promise<readonly ObservedAccountFact[]> {
    id.max(128).parse(provider);
    id.parse(accountId);
    const result = await this.db.query<FactRow>(
      `SELECT provider,account_id,evidence_key,state,evidence_source,
              source_reference,observed_at,valid_until
       FROM public.provider_account_capability_facts
       WHERE provider=$1 AND account_id=$2
       ORDER BY evidence_key ASC`,
      [provider, accountId]
    );
    // Include expired latest facts: the evaluator must treat them as unknown,
    // not query for previous grants or assume expired means revoked forever.
    return result.rows.map((row) => ({
      provider: row.provider,
      accountId: row.account_id,
      key: row.evidence_key,
      state: row.state,
      source: row.evidence_source,
      sourceReference: row.source_reference,
      observedAt: row.observed_at.toISOString(),
      validUntil: row.valid_until.toISOString()
    }));
  }

  /** Restrict deletion to verified account lifecycle processing, never public. */
  async deleteAccount(provider: string, accountId: string): Promise<void> {
    id.max(128).parse(provider);
    id.parse(accountId);
    await this.db.query(
      "DELETE FROM public.provider_account_capability_facts WHERE provider=$1 AND account_id=$2",
      [provider, accountId]
    );
  }
}
