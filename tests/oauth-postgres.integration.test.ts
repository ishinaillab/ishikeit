import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CredentialCipher } from "../src/auth/credential-cipher.js";
import { PostgresOAuthCredentialStore } from "../src/auth/oauth-store.js";
import { PostgresDatabase } from "../src/persistence/postgres.js";

/**
 * The same isolated PostgreSQL 17 service used by the Meta outbox CI tests.
 * Never create or modify OAuth tables in production or an arbitrary database.
 */
const connectionString = process.env.PG_OUTBOX_TEST_DATABASE_URL;
if (connectionString !== undefined) {
  const target = new URL(connectionString);
  if ((target.protocol !== "postgres:" && target.protocol !== "postgresql:")
    || !["127.0.0.1", "localhost", "::1"].includes(target.hostname)
    || target.pathname !== "/ishikeit_outbox_test") {
    throw new Error("Refusing Instagram OAuth integration outside isolated local CI PostgreSQL");
  }
}
const db = connectionString === undefined ? undefined : new PostgresDatabase(connectionString);
const store = db === undefined ? undefined
  : new PostgresOAuthCredentialStore(db, new CredentialCipher(Buffer.alloc(32, 37)));

describe.skipIf(db === undefined)("Instagram OAuth durable grant promotion on disposable PostgreSQL", () => {
  beforeAll(async () => {
    await db!.query(`
      CREATE TABLE public.oauth_credentials (
        provider text NOT NULL,
        account_id text NOT NULL,
        access_token_ciphertext bytea NOT NULL,
        access_token_iv bytea NOT NULL,
        access_token_tag bytea NOT NULL,
        refresh_token_ciphertext bytea,
        refresh_token_iv bytea,
        refresh_token_tag bytea,
        scopes text[] NOT NULL DEFAULT '{}',
        access_expires_at timestamptz,
        refresh_expires_at timestamptz,
        token_version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (provider,account_id),
        CHECK (octet_length(access_token_iv)=12),
        CHECK (octet_length(access_token_tag)=16)
      );
      CREATE TABLE public.oauth_revocations (
        provider text NOT NULL,
        account_id text NOT NULL,
        reason text NOT NULL,
        revoked_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (provider,account_id)
      );
      CREATE TABLE public.oauth_account_aliases (
        provider text NOT NULL,
        alias_account_id text NOT NULL,
        credential_account_id text NOT NULL,
        alias_kind text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (provider,alias_account_id)
      );
    `);
  });
  beforeEach(async () => {
    await db!.query("DELETE FROM public.oauth_account_aliases");
    await db!.query("DELETE FROM public.oauth_revocations");
    await db!.query("DELETE FROM public.oauth_credentials");
  });
  afterAll(async () => {
    try {
      await db!.query("DROP TABLE IF EXISTS public.oauth_account_aliases,public.oauth_revocations,public.oauth_credentials");
    } finally {
      await db!.close();
    }
  });

  it("atomically persists a grant and Professional account ID mapping", async () => {
    await store!.putWithAlias({
      provider: "instagram",
      accountId: "approved-app-subject",
      accessToken: "synthetic-token-1",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
      accessExpiresAt: new Date("2027-01-01T00:00:00Z")
    }, "17841438662359631", "instagram_professional_account");

    const credential = await store!.get("instagram", "approved-app-subject");
    expect(credential).toMatchObject({
      accountId: "approved-app-subject", accessToken: "synthetic-token-1", tokenVersion: 1
    });
    expect(await store!.resolveCredentialAccountId("instagram", "17841438662359631"))
      .toBe("approved-app-subject");
  });

  it("rejects alias hijacking and rolls back even a newly inserted credential", async () => {
    await store!.putWithAlias({
      provider: "instagram", accountId: "right-subject",
      accessToken: "right-token", scopes: ["instagram_business_basic"]
    }, "17841438662359631", "instagram_professional_account");

    await expect(store!.putWithAlias({
      provider: "instagram", accountId: "wrong-subject",
      accessToken: "wrong-token", scopes: ["instagram_business_basic"]
    }, "17841438662359631", "instagram_professional_account"))
      .rejects.toThrow(/already mapped to a different grant/i);

    expect(await store!.get("instagram", "wrong-subject")).toBeUndefined();
    expect(await store!.resolveCredentialAccountId("instagram", "17841438662359631"))
      .toBe("right-subject");
    expect((await store!.get("instagram", "right-subject"))?.accessToken).toBe("right-token");
  });

  it("allows owner renewal under the same subject without changing routing", async () => {
    await store!.putWithAlias({
      provider: "instagram", accountId: "same-subject",
      accessToken: "before-refresh", scopes: ["instagram_business_basic"]
    }, "17841438662359631", "instagram_professional_account");

    await store!.putWithAlias({
      provider: "instagram", accountId: "same-subject",
      accessToken: "after-refresh", scopes: ["instagram_business_basic"]
    }, "17841438662359631", "instagram_professional_account");

    expect(await store!.resolveCredentialAccountId("instagram", "17841438662359631"))
      .toBe("same-subject");
    expect(await store!.get("instagram", "same-subject")).toMatchObject({
      accessToken: "after-refresh", tokenVersion: 2
    });
  });
});
