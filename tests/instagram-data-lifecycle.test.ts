import { describe, expect, it, vi } from "vitest";
import { PostgresInstagramDataLifecycle } from "../src/privacy/instagram-data-lifecycle.js";

describe("Instagram account deletion includes durable hashed conversation state", () => {
  it("deletes only scoped Instagram handoff and native routing partitions before inbound data", async () => {
    const executed: { sql: string; args: readonly unknown[] }[] = [];
    const txQuery = vi.fn((sql: string, args: readonly unknown[] = []) => {
      executed.push({ sql, args });
      return Promise.resolve({ rowCount: 2, rows: [] });
    });
    const dbQuery = vi.fn((sql: string, args: readonly unknown[] = []) => {
      void sql;
      void args;
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    const db = {
      query: dbQuery,
      transaction: (work: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
        work({ query: txQuery })
    };
    const oauth = {
      resolveCredentialAccountId: vi.fn().mockResolvedValue("studio-ig"),
      aliasesForCredential: vi.fn().mockResolvedValue(["studio-ig-alias"]),
      revoke: vi.fn().mockResolvedValue(undefined)
    };
    const reader = new PostgresInstagramDataLifecycle(db as never, oauth as never);
    const result = await reader.requestDeletion("studio-ig", "https://apps.ishinaillab.com");
    expect(result.statusUrl).toMatch(/^https:\/\/apps\.ishinaillab\.com\/ishikeit\/privacy\/data-deletion\/status\/[a-f0-9]{36}$/u);
    expect(executed.map(x => x.sql)).toEqual([
      expect.stringContaining("DELETE FROM public.provider_account_capability_facts"),
      expect.stringContaining("DELETE FROM public.meta_handoff_blocks"),
      expect.stringContaining("DELETE FROM public.meta_native_routing_ownership"),
      expect.stringContaining("DELETE FROM outbox_attempts"),
      expect.stringContaining("DELETE FROM outbox o"),
      expect.stringContaining("DELETE FROM inbound_events")
    ]);
    expect(executed[0]?.args).toEqual([["studio-ig", "studio-ig-alias"]]);
    for (const index of [1, 2]) {
      expect(executed[index]?.sql).toContain("provider='meta' AND channel='instagram'");
      expect(executed[index]?.sql).toContain("account_id=ANY($1::text[])");
      expect(executed[index]?.args).toEqual([["studio-ig", "studio-ig-alias"]]);
    }
    expect(oauth.revoke).toHaveBeenCalledWith("instagram", "studio-ig", "data_deletion");
    const [successSql, successArgs] = dbQuery.mock.calls[1]!;
    expect(successSql).toContain("status='completed'");
    expect(JSON.parse(successArgs?.[1] as string)).toMatchObject({
      inboundEvents: 2, outboxRows: 2, outboxAttempts: 2, handoffBlocks: 2, nativeRoutingRows: 2
    });
  });

  it("clears cached Instagram account grants on deauthorization", async () => {
    const dbQuery = vi.fn().mockResolvedValue({ rowCount: 2, rows: [] });
    const oauth = {
      resolveCredentialAccountId: vi.fn().mockResolvedValue("studio-ig"),
      aliasesForCredential: vi.fn().mockResolvedValue(["studio-ig-alias"]),
      revoke: vi.fn().mockResolvedValue(undefined)
    };
    const reader = new PostgresInstagramDataLifecycle({ query: dbQuery } as never, oauth as never);
    await reader.deauthorize("studio-ig");
    expect(dbQuery.mock.calls[0]?.[0]).toContain("DELETE FROM public.provider_account_capability_facts");
    expect(dbQuery.mock.calls[0]?.[1]).toEqual([["studio-ig", "studio-ig-alias"]]);
    expect(oauth.revoke).toHaveBeenCalledWith("instagram", "studio-ig", "deauthorized");
  });

  it("does not claim deletion complete after a transaction failure", async () => {
    const dbQuery = vi.fn((sql: string, args: readonly unknown[] = []) => {
      void sql;
      void args;
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    const db = {
      query: dbQuery,
      transaction: () => Promise.reject(new Error("database transaction unavailable"))
    };
    const oauth = {
      resolveCredentialAccountId: vi.fn().mockResolvedValue("studio-ig"),
      aliasesForCredential: vi.fn().mockResolvedValue([]),
      revoke: vi.fn().mockResolvedValue(undefined)
    };
    const reader = new PostgresInstagramDataLifecycle(db as never, oauth as never);
    await expect(reader.requestDeletion("studio-ig", "https://apps.ishinaillab.com"))
      .rejects.toThrow("database transaction unavailable");
    const lastSql = dbQuery.mock.calls.at(-1)?.[0];
    expect(lastSql).toContain("status='failed'");
  });
});
