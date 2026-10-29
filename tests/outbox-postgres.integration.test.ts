import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { ACTION_DISPATCH_TOPIC, PostgresOutboxStore } from "../src/persistence/outbox.js";
import { PostgresMetaUnknownReconciler } from "../src/persistence/meta-unknown-reconciliation.js";
import type { ActionEnvelope } from "../src/domain/actions.js";

/**
 * Never run these DDL-backed integration tests against production.
 * Only the isolated CI PostgreSQL service with this exact local database
 * name is permitted. Ordinary npm test skips the suite entirely.
 */
const connectionString = process.env.PG_OUTBOX_TEST_DATABASE_URL;
if (connectionString !== undefined) {
  const target = new URL(connectionString);
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") {
    throw new Error("Outbox integration tests require a local PostgreSQL URI");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname)
    || target.pathname !== "/ishikeit_outbox_test") {
    throw new Error("Refusing outbox integration tests outside the isolated local CI database");
  }
}

const database = connectionString === undefined ? undefined : new PostgresDatabase(connectionString);
const store = database === undefined ? undefined : new PostgresOutboxStore(database);

function action(key: string, partition = "synthetic-partition"): ActionEnvelope {
  return {
    schemaVersion: 1,
    idempotencyKey: key,
    provider: "meta",
    capability: "messaging",
    operation: "message.send",
    orderingKey: partition,
    target: { channel: "messenger", accountId: "synthetic-page", recipientId: "synthetic-recipient" },
    body: { part: { kind: "text", text: "synthetic test only" } }
  };
}

describe.skipIf(database === undefined)("Meta durable outbox fence on isolated PostgreSQL", () => {
  beforeAll(async () => {
    await database!.query(`
      CREATE TABLE public.outbox (
        id uuid PRIMARY KEY,
        topic text NOT NULL,
        partition_key text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz,
        attempt_count integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        lease_expires_at timestamptz,
        lease_token uuid,
        meta_send_started_at timestamptz,
        dead_lettered_at timestamptz,
        dead_letter_reason text,
        CHECK ((lease_expires_at IS NULL) = (lease_token IS NULL))
      );
      CREATE TABLE public.outbox_attempts (
        outbox_id uuid NOT NULL,
        topic text,
        partition_key text,
        attempt_number integer NOT NULL,
        outcome text,
        provider text,
        capability text,
        operation text,
        duration_ms integer,
        retryable boolean,
        ambiguous boolean,
        http_status integer,
        provider_code text,
        error_class text
      );
      CREATE TABLE public.meta_outbound_reconciliations (
        outbox_id uuid PRIMARY KEY REFERENCES public.outbox(id),
        disposition text NOT NULL,
        evidence text NOT NULL,
        reviewer_hash text NOT NULL,
        reviewed_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  });

  beforeEach(async () => {
    await database!.query("DELETE FROM public.meta_outbound_reconciliations");
    await database!.query("DELETE FROM public.outbox_attempts");
    await database!.query("DELETE FROM public.outbox");
  });

  afterAll(async () => {
    try {
      await database!.query("DROP TABLE IF EXISTS public.meta_outbound_reconciliations, public.outbox_attempts, public.outbox");
    } finally {
      await database!.close();
    }
  });

  it("allows only one concurrent worker to claim and send a single Meta action", async () => {
    const inserted = await store!.enqueueAction(action("race-single"));
    const workerA = new PostgresOutboxStore(database!);
    const workerB = new PostgresOutboxStore(database!);
    const claims = await Promise.all([
      workerA.claimNext(ACTION_DISPATCH_TOPIC, 30000),
      workerB.claimNext(ACTION_DISPATCH_TOPIC, 30000)
    ]);
    const claimed = claims.filter((job) => job !== undefined);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(inserted.id);
    expect(await store!.prepareMetaSend(claimed[0]!)).toBe(true);
    expect(await store!.prepareMetaSend(claimed[0]!)).toBe(false);
    expect(await workerB.claimNext(ACTION_DISPATCH_TOPIC, 30000)).toBeUndefined();

    expect(await workerA.complete(claimed[0]!, "synthetic-provider-ack")).toBe(true);
    expect(await workerB.claimNext(ACTION_DISPATCH_TOPIC, 30000)).toBeUndefined();
    const rows = await database!.query<{attempt_count: number}>(
      "SELECT count(*)::integer AS attempt_count FROM public.outbox_attempts WHERE outcome = 'published'"
    );
    expect(rows.rows[0]?.attempt_count).toBe(1);
  });

  it("quarantines an armed send after lease expiry and never retries an unknown provider outcome", async () => {
    const inserted = await store!.enqueueAction(action("crash-after-arm"));
    const claimed = await store!.claimNext(ACTION_DISPATCH_TOPIC, 80);
    expect(claimed?.id).toBe(inserted.id);
    expect(await store!.prepareMetaSend(claimed!)).toBe(true);

    // Simulate a worker dying after the durable fence but before any reply.
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    const again = await new PostgresOutboxStore(database!).claimNext(ACTION_DISPATCH_TOPIC, 30000);
    expect(again).toBeUndefined();
    const fenced = await database!.query<{
      dead_lettered_at: Date | null;
      published_at: Date | null;
      attempt_count: number;
      dead_letter_reason: string | null;
    }>("SELECT dead_lettered_at,published_at,attempt_count,dead_letter_reason FROM public.outbox WHERE id=$1", [inserted.id]);
    expect(fenced.rows[0]?.dead_lettered_at).toBeInstanceOf(Date);
    expect(fenced.rows[0]?.published_at).toBeNull();
    expect(fenced.rows[0]?.attempt_count).toBe(1);
    expect(fenced.rows[0]?.dead_letter_reason).toContain("provider_outcome_unknown");
    expect(await store!.complete(claimed!, "too-late-ack")).toBe(false);

    const attempts = await database!.query<{ outcome: string; ambiguous: boolean; error_class: string }>(
      "SELECT outcome,ambiguous,error_class FROM public.outbox_attempts WHERE outbox_id=$1",
      [inserted.id]
    );
    expect(attempts.rows).toEqual([{
      outcome: "dead_letter", ambiguous: true, error_class: "provider_outcome_unknown"
    }]);
  });

  it("releases the conversation partition after quarantining its expired armed predecessor", async () => {
    const first = await store!.enqueueAction(action("ordered-first", "same-conversation"));
    const second = await store!.enqueueAction(action("ordered-second", "same-conversation"));
    const claimed = await store!.claimNext(ACTION_DISPATCH_TOPIC, 80);
    expect(claimed?.id).toBe(first.id);
    expect(await store!.prepareMetaSend(claimed!)).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    const next = await new PostgresOutboxStore(database!).claimNext(ACTION_DISPATCH_TOPIC, 30000);
    expect(next?.id).toBe(second.id);
    expect(await store!.prepareMetaSend(next!)).toBe(true);
    expect(await store!.complete(next!, "synthetic-success")).toBe(true);
    const firstRow = await database!.query<{dead_lettered_at: Date|null}>(
      "SELECT dead_lettered_at FROM public.outbox WHERE id=$1", [first.id]
    );
    expect(firstRow.rows[0]?.dead_lettered_at).toBeInstanceOf(Date);
  });

  it("permits a subsequent attempt only after a definite nonambiguous HTTP 429", async () => {
    const inserted = await store!.enqueueAction(action("definite-throttle"));
    const first = await store!.claimNext(ACTION_DISPATCH_TOPIC, 30000);
    expect(first?.id).toBe(inserted.id);
    expect(await store!.prepareMetaSend(first!)).toBe(true);
    expect(await store!.retry(first!, new Date(Date.now() - 1000), {
      provider: "meta", capability: "messaging", operation: "message.send",
      retryable: true, ambiguous: false, httpStatus: 429, errorClass: "throttled"
    })).toBe(true);
    const second = await store!.claimNext(ACTION_DISPATCH_TOPIC, 30000);
    expect(second?.id).toBe(inserted.id);
    expect(second?.attemptCount).toBe(1);
    expect(await store!.prepareMetaSend(second!)).toBe(true);
    expect(await store!.complete(second!, "synthetic-success")).toBe(true);
    const attempts = await database!.query<{outcome:string}>(
      "SELECT outcome FROM public.outbox_attempts WHERE outbox_id=$1 ORDER BY attempt_number",
      [inserted.id]
    );
    expect(attempts.rows.map((row)=>row.outcome)).toEqual(["retry","published"]);
  });
  it("keeps a quarantined provider-unknown send terminal during operator review", async () => {
    const inserted = await store!.enqueueAction(action("manual-unknown-case"));
    const job = await store!.claimNext(ACTION_DISPATCH_TOPIC, 80);
    expect(job?.id).toBe(inserted.id);
    expect(await store!.prepareMetaSend(job!)).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    expect(await store!.claimNext(ACTION_DISPATCH_TOPIC, 30000)).toBeUndefined();

    const ledger = new PostgresMetaUnknownReconciler(database!);
    const initial = await ledger.list(25);
    expect(initial.total).toBe(1);
    expect(initial.unreviewed).toBe(1);
    expect(initial.cases[0]).toMatchObject({
      outboxId: inserted.id, channel: "messenger", operation: "message.send",
      disposition: null
    });
    expect(JSON.stringify(initial)).not.toContain("synthetic-recipient");
    expect(JSON.stringify(initial)).not.toContain("synthetic test only");

    const input = {
      outboxId: inserted.id,
      disposition: "reviewed_do_not_resend" as const,
      evidence: "manual_thread_review" as const,
      operatorTag: "ci-reviewer"
    };
    expect(await ledger.review(input)).toBe("recorded");
    expect(await ledger.review(input)).toBe("already_recorded");
    expect(await ledger.review({...input, disposition: "followup_required"})).toBe("conflict");
    const reviewed = await ledger.list(25);
    expect(reviewed.total).toBe(1);
    expect(reviewed.reviewed).toBe(1);
    expect(reviewed.unreviewed).toBe(0);
    expect(reviewed.cases[0]?.disposition).toBe("reviewed_do_not_resend");

    const state = await database!.query<{
      published_at: Date|null; dead_lettered_at:Date|null; meta_send_started_at:Date|null
    }>("SELECT published_at,dead_lettered_at,meta_send_started_at FROM public.outbox WHERE id=$1", [inserted.id]);
    expect(state.rows[0]?.published_at).toBeNull();
    expect(state.rows[0]?.dead_lettered_at).toBeInstanceOf(Date);
    expect(state.rows[0]?.meta_send_started_at).toBeInstanceOf(Date);
    expect(await store!.claimNext(ACTION_DISPATCH_TOPIC, 30000)).toBeUndefined();
  });

});
