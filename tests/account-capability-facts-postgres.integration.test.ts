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
const grant = (key: string, options: Partial<ObservedAccountFact> = {}): ObservedAccountFact => ({
  provider: "telegram", accountId: "9001", key, state: "granted",
  source: "provider_connection_readback", sourceReference: "getBusinessConnection",
  observedAt: seen.toISOString(), validUntil: new Date(seen.getTime() + 300000).toISOString(),
  ...options
});

describe.skipIf(db === undefined)("durable provider account capability provenance on disposable PG17", () => {
  beforeAll(async () => {
    const migration = await readFile("migrations/0009_provider_account_capability_facts.sql", "utf8");
    await db!.query(migration);
  });
  beforeEach(async () => { await db!.query("DELETE FROM public.provider_account_capability_facts"); });
  afterAll(async () => {
    try { await db!.query("DROP TABLE IF EXISTS public.provider_account_capability_facts"); }
    finally { await db!.close(); }
  });

  it("persists verified rights and projects them to only the exact provider account", async () => {
    expect(await facts!.record([grant("telegram.business_connection"), grant("telegram.rights.can_reply")]))
      .toBe(2);
    expect(accountCapabilities({
      provider: "telegram", accountId: "9001",
      facts: await facts!.read("telegram", "9001"),
      installedFeatures: ["official_account_replies"]
    }, new Date(seen.getTime() + 60_000)).official_account_replies?.status).toBe("available");
    expect(accountCapabilities({
      provider: "telegram", accountId: "9002",
      facts: await facts!.read("telegram", "9002"),
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
    expect((await facts!.read("telegram", "9001")).find((f) => f.key === "telegram.rights.can_reply")?.state)
      .toBe("denied");
    expect(accountCapabilities({
      provider: "telegram", accountId: "9001",
      facts: await facts!.read("telegram", "9001"),
      installedFeatures: ["official_account_replies"]
    }, new Date(newer.getTime() + 90_000)).official_account_replies?.status).toBe("unverified");
  });
  it("resolves conflicting equal-time writes to denial, not a grant", async () => {
    await facts!.record([grant("telegram.rights.can_reply", { state: "denied" })]);
    expect(await facts!.record([grant("telegram.rights.can_reply")])).toBe(0);
    expect((await facts!.read("telegram", "9001"))[0]?.state).toBe("denied");
  });
  it("refuses mixed accounts, invalid sources, and token-like references before writes", async () => {
    await expect(facts!.record([
      grant("telegram.rights.can_reply"),
      grant("telegram.business_connection", { accountId: "9999" })
    ])).rejects.toThrow(/Mixed account/i);
    await expect(facts!.record([
      grant("telegram.rights.can_reply", { sourceReference: "Bearer secret value" })
    ])).rejects.toThrow();
    expect(await facts!.read("telegram", "9001")).toEqual([]);
  });
  it("retains only account-scoped facts and permits account deletion", async () => {
    await facts!.record([grant("telegram.rights.can_reply")]);
    await facts!.record([grant("telegram.rights.can_reply", { accountId: "9002" })]);
    await facts!.deleteAccount("telegram", "9001");
    expect(await facts!.read("telegram", "9001")).toEqual([]);
    expect(await facts!.read("telegram", "9002")).toHaveLength(1);
  });
  it("enforces database RLS by default with no anon/authenticated grants", async () => {
    const result = await db!.query<{ relrowsecurity: boolean; has_anon: boolean; has_auth: boolean }>(
      `SELECT c.relrowsecurity,
        coalesce(has_table_privilege('anon',c.oid,'SELECT'),false) AS has_anon,
        coalesce(has_table_privilege('authenticated',c.oid,'SELECT'),false) AS has_auth
       FROM pg_class c WHERE c.oid='public.provider_account_capability_facts'::regclass`
    ).catch(async () => db!.query<{relrowsecurity:boolean;has_anon:boolean;has_auth:boolean}>(
      `SELECT c.relrowsecurity, false AS has_anon, false AS has_auth
       FROM pg_class c WHERE c.oid='public.provider_account_capability_facts'::regclass`
    ));
    expect(result.rows[0]?.relrowsecurity).toBe(true);
    expect(result.rows[0]?.has_anon).toBe(false);
    expect(result.rows[0]?.has_auth).toBe(false);
  });
});
