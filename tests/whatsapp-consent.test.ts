import { describe, expect, it, vi } from "vitest";
import type { PostgresDatabase, SqlExecutor } from "../src/persistence/postgres.js";
import { PostgresWhatsAppConsentStore } from "../src/persistence/whatsapp-consent.js";
import { PostgresInboundStore } from "../src/persistence/inbound.js";
import { metaIngressIdentity, normalizeMetaEnvelope } from "../src/channels/meta-normalizer.js";

const key = Buffer.alloc(32, 17).toString("base64");
const account = "123456789012";
const recipient = "639123456789";

describe("WhatsApp private consent verification", () => {
  it("looks up active appointment consent by HMAC, not by plaintext recipient", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ active: true }] });
    const store = new PostgresWhatsAppConsentStore({ query } as unknown as PostgresDatabase, key);
    await expect(store.hasActiveConsent(account, recipient, "appointment_updates")).resolves.toBe(true);
    const [, params] = (query.mock.calls as Array<[string, readonly unknown[]]>)[0]!;
    expect(params[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(params[0]).not.toContain(recipient);
    expect(params[1]).toBe("appointment_updates");
  });

  it("denies missing opt-ins and different recipient identities", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ active: false }] });
    const store = new PostgresWhatsAppConsentStore({ query } as unknown as PostgresDatabase, key);
    await expect(store.hasActiveConsent(account, recipient, "appointment_updates")).resolves.toBe(false);
    await store.hasActiveConsent(account, "639123456788", "appointment_updates");
    expect((query.mock.calls as Array<[string, readonly unknown[]]>)[0]?.[1]?.[0])
      .not.toBe((query.mock.calls as Array<[string, readonly unknown[]]>)[1]?.[1]?.[0]);
    await expect(store.hasActiveConsent("wrong-account", recipient, "appointment_updates"))
      .rejects.toThrow(/Invalid WhatsApp/);
  });

  it("revokes an active consent without logging or storing phone numbers", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const store = new PostgresWhatsAppConsentStore({ query } as unknown as PostgresDatabase, key);
    const tx = { query } as unknown as SqlExecutor;
    const when = new Date("2026-10-29T00:00:00.000Z");
    await store.revokeInTransaction(tx, account, recipient, "89fb5263-e127-4982-b04e-7dd48374a227", when);
    const [sql, params] = (query.mock.calls as Array<[string, readonly unknown[]]>)[0]!;
    expect(sql).toContain("INSERT INTO public.meta_whatsapp_template_opt_outs");
    expect(sql).toContain("ON CONFLICT");
    expect(params[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(params[1]).toBe("89fb5263-e127-4982-b04e-7dd48374a227");
    expect(params[2]).toEqual(when);
    expect(sql).not.toContain(recipient);
    const [update] = (query.mock.calls as Array<[string, readonly unknown[]]>)[1]!;
    expect(update).toContain("UPDATE public.meta_whatsapp_template_opt_ins");
    expect(update).toContain("GREATEST(now(),consented_at");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("revokes a verified WhatsApp STOP in the same durable ingest transaction", async () => {
    const calls: string[] = [];
    const query = vi.fn().mockImplementation((sql: string) => {
      calls.push(sql.includes("INSERT INTO inbound_events") ? "inbound"
        : sql.includes("INSERT INTO outbox") ? "outbox" : "other");
      return Promise.resolve({ rowCount: 1, rows: [{ id: "created" }] });
    });
    const tx = { query } as unknown as SqlExecutor;
    const db = {
      transaction: (work: (executor: SqlExecutor) => Promise<unknown>) => work(tx)
    } as unknown as PostgresDatabase;
    const revokeInTransaction = vi.fn().mockImplementation(() => {
      calls.push("revoke");
      return Promise.resolve();
    });
    const store = new PostgresInboundStore(db, { revokeInTransaction });
    const [event] = normalizeMetaEnvelope({
      object: "whatsapp_business_account",
      entry: [{ id: "waba-1", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: account },
        messages: [{
          id: "wamid-stop", from: recipient, timestamp: "1790000000",
          type: "text", text: { body: "STOP" }
        }]
      } }] }]
    });
    if (event === undefined) throw new Error("missing normalized event");
    await expect(store.ingest(event, metaIngressIdentity(event), "a".repeat(64)))
      .resolves.toBe("created");
    expect(revokeInTransaction).toHaveBeenCalledWith(tx, account, recipient, expect.any(String), expect.any(Date));
    expect(calls).toEqual(["inbound", "revoke", "outbox"]);
  });

  it("denies stale opt-ins after an explicit STOP tombstone at final dispatch", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ active: false }] });
    const store = new PostgresWhatsAppConsentStore({ query } as unknown as PostgresDatabase, key);
    await expect(store.hasActiveConsent(account, recipient, "appointment_updates"))
      .resolves.toBe(false);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("meta_whatsapp_template_opt_outs");
    expect(sql).toContain("stopped.opted_out_at >= meta_whatsapp_template_opt_ins.consented_at");
  });

  it("does not insert a delayed opt-in if a newer STOP tombstone exists", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });
    const store = new PostgresWhatsAppConsentStore({ query } as unknown as PostgresDatabase, key);
    const tx = { query } as unknown as SqlExecutor;
    await store.grantInTransaction(
      tx, account, recipient, "89fb5263-e127-4982-b04e-7dd48374a227",
      new Date("2026-10-28T23:59:00.000Z")
    );
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("SELECT 1 FROM public.meta_whatsapp_template_opt_outs");
    expect(sql).toContain("opted_out_at >= LEAST(");
    expect(sql).toContain("LEAST($3::timestamptz,now())");
  });

  it("does not treat normal WhatsApp text as opt-out", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: "created" }] });
    const tx = { query } as unknown as SqlExecutor;
    const db = {
      transaction: async (work: (executor: SqlExecutor) => Promise<unknown>) => await work(tx)
    } as unknown as PostgresDatabase;
    const revokeInTransaction = vi.fn();
    const store = new PostgresInboundStore(db, { revokeInTransaction });
    const [event] = normalizeMetaEnvelope({
      object: "whatsapp_business_account",
      entry: [{ id: "waba-1", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: account },
        messages: [{
          id: "wamid-normal", from: recipient, timestamp: "1790000000",
          type: "text", text: { body: "I'd like a nail appointment" }
        }]
      } }] }]
    });
    if (event === undefined) throw new Error("missing normalized event");
    await store.ingest(event, metaIngressIdentity(event), "b".repeat(64));
    expect(revokeInTransaction).not.toHaveBeenCalled();
  });
});
