import { describe, expect, it, vi } from "vitest";
import { CredentialCipher } from "../src/auth/credential-cipher.js";
import {
  PostgresOAuthCredentialStore,
  type OAuthCredential
} from "../src/auth/oauth-store.js";
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
    } as unknown as Omit<OAuthCredential, "tokenVersion">);

    const insert = calls.find(({ text }) => text.includes("INSERT INTO oauth_credentials"));
    expect(insert).toBeDefined();
    expect(insert?.values?.[9]).toBeNull();
  });
});
