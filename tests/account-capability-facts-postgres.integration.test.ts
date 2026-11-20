import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { PostgresAccountCapabilityFacts } from "../src/persistence/account-capability-facts.js";
import { accountCapabilities } from "../src/channels/account-capabilities.js";
import type { ObservedAccountFact } from "../src/policy/provider-contract.js";

const connectionString = process.env.PG_OUTBOX_TEST_DATABASE_URL;
if (connectionString !== undefined) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || url.pathname !== "/ishikeit_outbox_test") {
    throw new Error("Refusing provider-proof tests outside disposable local Postgres");
  }
}
const db = connectionString === undefined ? undefined : new PostgresDatabase(connectionString);
const facts = db === undefined ? undefined : new PostgresAccountCapabilityFacts(db);
const seen = new Date("2026-11-02T00:00:00Z");
let migratedLegacyKey:string|undefined;
const grant = (key: string, options: Partial<ObservedAccountFact & {
  providerApplicationKey:string;sourceConnectionId:string
}> = {}): ObservedAccountFact & {
  providerApplicationKey:string;sourceConnectionId?:string
} => ({
  provider: "telegram", accountId: "9001", providerApplicationKey:"test-bot-app",
  key, state: "granted",
  source: "provider_connection_readback", sourceReference: "getBusinessConnection",
  observedAt: seen.toISOString(), validUntil: new Date(seen.getTime() + 300000).toISOString(),
  ...options
});

describe.skipIf(db === undefined)("durable provider account capability provenance on disposable PG17", () => {
  beforeAll(async () => {
    // Real Supabase client roles are absent from the disposable PG17 image.
    // Create exact NOLOGIN roles BEFORE migration to validate actual REVOKE
    // and RLS behavior, not a fallback constant when roles are missing.
    await db!.query("CREATE ROLE anon NOLOGIN");
    await db!.query("CREATE ROLE authenticated NOLOGIN");
    const migration = await readFile("migrations/0009_provider_account_capability_facts.sql", "utf8");
    await db!.query(migration);
    await db!.query(`INSERT INTO public.provider_account_capability_facts
      (provider,account_id,evidence_key,state,evidence_source,source_reference,
       observed_at,valid_until)
      VALUES ('telegram','legacy-owner','telegram.rights.can_reply',
      'granted','provider_api','old-unknown-app',$1,$2)`,
      [seen,new Date(seen.getTime()+300000)]);
    await db!.query(await readFile("migrations/0024_provider_capability_application_scope.sql","utf8"));
    const legacy=await db!.query<{provider_application_key:string}>(
      "SELECT provider_application_key FROM public.provider_account_capability_facts_v2 WHERE account_id='legacy-owner'");
    migratedLegacyKey=legacy.rows[0]?.provider_application_key;
  });
  beforeEach(async () => { await db!.query("DELETE FROM public.provider_account_capability_facts_v2"); await db!.query("DELETE FROM public.provider_account_capability_facts"); });
  afterAll(async () => {
    try {
      await db!.query("DROP TABLE IF EXISTS public.provider_account_capability_facts_v2");
      await db!.query("DROP TABLE IF EXISTS public.provider_account_capability_facts");
      await db!.query("DROP ROLE anon");
      await db!.query("DROP ROLE authenticated");
    } finally { await db!.close(); }
  });

  it("persists verified rights and projects them to only the exact provider account", async () => {
    expect(await facts!.record([grant("telegram.business_connection"), grant("telegram.rights.can_reply")]))
      .toBe(2);
    expect(accountCapabilities({
      provider: "telegram", accountId: "9001",
      facts: await facts!.read("telegram", "9001","test-bot-app"),
      installedFeatures: ["official_account_replies"]
    }, new Date(seen.getTime() + 60_000)).official_account_replies?.status).toBe("available");
    expect(accountCapabilities({
      provider: "telegram", accountId: "9002",
      facts: await facts!.read("telegram", "9002","test-bot-app"),
      installedFeatures: ["official_account_replies"]
    }, new Date(seen.getTime() + 60_000)).official_account_replies?.status).toBe("unverified");
  });
  it("keeps more recent denied rights even after they expire; no old grant resurrects", async () => {
    await facts!.record([grant("telegram.business_connection"), grant("telegram.rights.can_reply")]);
    const newer = new Date(seen.getTime() + 15_000);
    await facts!.record([grant("telegram.rights.can_reply", {
      state: "denied", observedAt: newer.toISOString(),
      validUntil: new Date(newer.getTime() + 60_000).toISOString()
    })]);
    // Out-of-order observations cannot overwrite a newer denial.
    expect(await facts!.record([grant("telegram.rights.can_reply")])).toBe(0);
    expect((await facts!.read("telegram", "9001","test-bot-app")).find((f) => f.key === "telegram.rights.can_reply")?.state)
      .toBe("denied");
    expect(accountCapabilities({
      provider: "telegram", accountId: "9001",
      facts: await facts!.read("telegram", "9001","test-bot-app"),
      installedFeatures: ["official_account_replies"]
    }, new Date(newer.getTime() + 90_000)).official_account_replies?.status).toBe("unverified");
  });
  it("resolves conflicting equal-time writes to denial, not a grant", async () => {
    await facts!.record([grant("telegram.rights.can_reply", { state: "denied" })]);
    expect(await facts!.record([grant("telegram.rights.can_reply")])).toBe(0);
    expect((await facts!.read("telegram", "9001","test-bot-app"))[0]?.state).toBe("denied");
  });
  it("refuses mixed accounts, invalid sources, and token-like references before writes", async () => {
    await expect(facts!.record([
      grant("telegram.rights.can_reply"),
      grant("telegram.business_connection", { accountId: "9999" })
    ])).rejects.toThrow(/Mixed account/i);
    await expect(facts!.record([
      grant("telegram.rights.can_reply", { sourceReference: "Bearer secret value" })
    ])).rejects.toThrow();
    // A mixed owner-generation batch may not persist even one row.
    await expect(facts!.record([
      grant("telegram.rights.can_reply", {
        sourceConnectionId:"00000000-0000-4000-8000-000000000001"
      }),
      grant("telegram.business_connection", {
        sourceConnectionId:"00000000-0000-4000-8000-000000000002"
      })
    ])).rejects.toThrow(/Mixed account/i);
    expect(await facts!.read("telegram", "9001","test-bot-app")).toEqual([]);
  });
  it("retains only account-scoped facts and permits account deletion", async () => {
    await facts!.record([grant("telegram.rights.can_reply")]);
    await facts!.record([grant("telegram.rights.can_reply", { accountId: "9002" })]);
    await facts!.deleteAccount("telegram", "9001","test-bot-app");
    expect(await facts!.read("telegram", "9001","test-bot-app")).toEqual([]);
    expect(await facts!.read("telegram", "9002","test-bot-app")).toHaveLength(1);
  });
  it("preserves pre-migration records without attributing any OAuth application",()=>{
    expect(migratedLegacyKey).toBe("legacy-unbound");
  });

  it("quarantines legacy unscoped provider evidence after database migration",async()=>{
    const legacy=grant("telegram.rights.can_reply");
    await db!.query(
      `INSERT INTO public.provider_account_capability_facts_v2
         (provider,account_id,provider_application_key,evidence_key,state,
          evidence_source,source_reference,observed_at,valid_until)
       VALUES ($1,$2,'legacy-unbound',$3,$4,$5,$6,$7,$8)`,
      [legacy.provider,legacy.accountId,legacy.key,legacy.state,
       legacy.source,legacy.sourceReference,new Date(legacy.observedAt),
       new Date(legacy.validUntil)]
    );
    const existing=await db!.query<{provider_application_key:string}>(
      `SELECT provider_application_key FROM public.provider_account_capability_facts_v2
       WHERE provider=$1 AND account_id=$2`,
      ["telegram","9001"]
    );
    expect(existing.rows[0]?.provider_application_key).toBe("legacy-unbound");
    expect(await facts!.read("telegram","9001","test-bot-app")).toEqual([]);
    await expect(facts!.record([
      {...legacy,providerApplicationKey:"legacy-unbound"}
    ])).rejects.toThrow(/Unattributed historical evidence/i);
    expect(await facts!.read("telegram","9001","test-bot-app")).toEqual([]);
  });

  it("keeps old three-column evidence inserts operational in the expanded schema",async()=>{
    const legacy=grant("telegram.business_connection");
    await db!.query(
      `INSERT INTO public.provider_account_capability_facts
       (provider,account_id,evidence_key,state,evidence_source,
        source_reference,observed_at,valid_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [legacy.provider,legacy.accountId,legacy.key,legacy.state,
       legacy.source,legacy.sourceReference,new Date(legacy.observedAt),
       new Date(legacy.validUntil)]
    );
    const old=await db!.query<{evidence_key:string}>(
      "SELECT evidence_key FROM public.provider_account_capability_facts WHERE account_id=$1",
      ["9001"]
    );
    expect(old.rows).toEqual([{evidence_key:"telegram.business_connection"}]);
    expect(await facts!.read("telegram","9001","test-bot-app")).toEqual([]);
    // Old and new app writers may both touch the same provider/account/key.
    // The old three-column UPSERT MUST retain its original conflict target.
    await facts!.record([legacy]);
    await db!.query(
      `INSERT INTO public.provider_account_capability_facts
        (provider,account_id,evidence_key,state,evidence_source,
         source_reference,observed_at,valid_until)
       VALUES ($1,$2,$3,'denied',$4,$5,$6,$7)
       ON CONFLICT (provider,account_id,evidence_key)
       DO UPDATE SET state=EXCLUDED.state`,
      [legacy.provider,legacy.accountId,legacy.key,legacy.source,
       legacy.sourceReference,new Date(legacy.observedAt),
       new Date(legacy.validUntil)]
    );
    const legacyState=await db!.query<{state:string}>(
      `SELECT state FROM public.provider_account_capability_facts
       WHERE provider=$1 AND account_id=$2 AND evidence_key=$3`,
      [legacy.provider,legacy.accountId,legacy.key]
    );
    expect(legacyState.rows).toEqual([{state:"denied"}]);
    expect((await facts!.read("telegram","9001","test-bot-app"))[0]?.state)
      .toBe("granted");
  });

  it("partitions account rights by OAuth app and deletes only the selected app",async()=>{
    const base=grant("telegram.rights.can_reply");
    const appA={...base,providerApplicationKey:"bot-app-A"};
    const appB={...base,providerApplicationKey:"bot-app-B",state:"denied" as const};
    await expect(facts!.record([appA,appB])).rejects.toThrow(/Mixed account/i);
    expect(await facts!.record([appA])).toBe(1);
    expect(await facts!.record([appB])).toBe(1);
    expect((await facts!.read("telegram","9001","bot-app-A"))[0]?.state)
      .toBe("granted");
    expect((await facts!.read("telegram","9001","bot-app-B"))[0]?.state)
      .toBe("denied");
    await facts!.deleteAccount("telegram","9001","bot-app-A");
    expect(await facts!.read("telegram","9001","bot-app-A")).toEqual([]);
    expect((await facts!.read("telegram","9001","bot-app-B"))).toHaveLength(1);
  });

  it("enforces database RLS by default with no anon/authenticated grants", async () => {
    const result = await db!.query<{ relrowsecurity: boolean; has_anon: boolean; has_auth: boolean }>(
      `SELECT c.relrowsecurity,
        coalesce(has_table_privilege('anon',c.oid,'SELECT'),false) AS has_anon,
        coalesce(has_table_privilege('authenticated',c.oid,'SELECT'),false) AS has_auth
       FROM pg_class c WHERE c.oid='public.provider_account_capability_facts_v2'::regclass`
    );
    expect(result.rows[0]?.relrowsecurity).toBe(true);
    expect(result.rows[0]?.has_anon).toBe(false);
    expect(result.rows[0]?.has_auth).toBe(false);
    for (const role of ["anon","authenticated"]) {
      await expect(db!.transaction(async tx=>{
        await tx.query("SET LOCAL ROLE "+role);
        await tx.query("SELECT count(*) FROM public.provider_account_capability_facts_v2");
      })).rejects.toThrow(/permission denied/i);
    }
  });
});
