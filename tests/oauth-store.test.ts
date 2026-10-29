import { describe, expect, it, vi } from "vitest";
import { CredentialCipher } from "../src/auth/credential-cipher.js";
import { PostgresOAuthCredentialStore } from "../src/auth/oauth-store.js";
import type { PostgresDatabase, SqlExecutor } from "../src/persistence/postgres.js";

describe("PostgresOAuthCredentialStore", () => {
  it("persists an absent access expiry as SQL NULL", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const executor: SqlExecutor = {
      query: vi.fn((text: string, values?: readonly unknown[]) => {
        calls.push(values === undefined ? { text } : { text, values });
        return Promise.resolve({ rows: [], rowCount: 0 } as never);
      })
    };
    const db = {
      transaction: async <T>(work: (tx: SqlExecutor) => Promise<T>) => work(executor)
    } as unknown as PostgresDatabase;
    const store = new PostgresOAuthCredentialStore(
      db,
      new CredentialCipher(Buffer.alloc(32, 7))
    );

    await store.put({
      provider: "tiktok-marketing",
      accountId: "advertiser-1",
      accessToken: "marketing-access",
      scopes: []
    });

    const insert = calls.find(({ text }) => text.includes("INSERT INTO oauth_credentials"));
    expect(insert).toBeDefined();
    expect(insert?.values?.[9]).toBeNull();
  });
  it("commits encrypted Instagram grant and alias within one database transaction", async () => {
    const sql: string[] = [];
    let transactions = 0;
    const executor: SqlExecutor = {
      query: vi.fn((text: string) => {
        sql.push(text);
        return Promise.resolve({ rows: [], rowCount: 1 } as never);
      })
    };
    const db = {
      transaction: async <T>(work: (tx: SqlExecutor) => Promise<T>) => {
        transactions += 1;
        return work(executor);
      },
      query: vi.fn(() => { throw new Error("No autocommit alias writes permitted"); })
    } as unknown as PostgresDatabase;
    const store = new PostgresOAuthCredentialStore(
      db, new CredentialCipher(Buffer.alloc(32, 7))
    );

    await store.putWithAlias({
      provider: "instagram",
      accountId: "oauth-subject",
      accessToken: "provider-long-lived",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"]
    }, "17841438662359631", "instagram_professional_account");

    expect(transactions).toBe(1);
    expect(sql).toHaveLength(3);
    expect(sql[0]).toContain("INSERT INTO oauth_credentials");
    expect(sql[1]).toContain("DELETE FROM oauth_revocations");
    expect(sql[2]).toContain("INSERT INTO oauth_account_aliases");
    expect(sql[2]).toContain("WHERE oauth_account_aliases.credential_account_id=EXCLUDED.credential_account_id");
    expect(sql[2]).toContain("RETURNING alias_account_id");
  });

  it("throws on conflicting existing alias so the transaction cannot commit", async () => {
    let committed = false;
    const executor: SqlExecutor = {
      query: vi.fn((text: string) => Promise.resolve({
        rows: [],
        rowCount: text.includes("RETURNING alias_account_id") ? 0 : 1
      } as never))
    };
    const db = {
      transaction: async <T>(work: (tx: SqlExecutor) => Promise<T>) => {
        const result = await work(executor);
        committed = true;
        return result;
      }
    } as unknown as PostgresDatabase;
    const store = new PostgresOAuthCredentialStore(
      db, new CredentialCipher(Buffer.alloc(32, 7))
    );

    await expect(store.putWithAlias({
      provider: "instagram",
      accountId: "wrong-oauth-subject",
      accessToken: "should-not-be-committed",
      scopes: ["instagram_business_basic"]
    }, "17841438662359631", "instagram_professional_account"))
      .rejects.toThrow(/already mapped/i);
    expect(committed).toBe(false);
  });

});
