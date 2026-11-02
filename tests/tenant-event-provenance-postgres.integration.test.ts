import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";

/**
 * Separate sequential CI command: outbox/inbound integration suites own the
 * same table names and MUST finish before these DDL-backed tests begin.
 * Never connect this test to production or another non-disposable database.
 */
const connectionString = process.env.PG_OUTBOX_TEST_DATABASE_URL;
if (connectionString !== undefined) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || url.pathname !== "/ishikeit_outbox_test") {
    throw new Error("Refusing tenant event provenance tests outside disposable local PG17");
  }
}
const db = connectionString === undefined ? undefined : new PostgresDatabase(connectionString);
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const connectionA = randomUUID();
const connectionB = randomUUID();

describe.skipIf(db === undefined)("nullable tenant provenance across inbox/outbox (isolated PG17)", () => {
  beforeAll(async () => {
    await db!.query(`CREATE TABLE public.inbound_events (
      id uuid PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.outbox (
      id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
    );`);
    await db!.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
    await db!.query(await readFile("migrations/0012_ishikeit_event_tenant_provenance.sql","utf8"));

    await db!.query(
      "INSERT INTO public.ishikeit_workspaces(workspace_id,display_name) VALUES($1,'A'),($2,'B')",
      [workspaceA,workspaceB]
    );
    await db!.query(
      `INSERT INTO public.ishikeit_provider_accounts
       (provider,provider_account_id,verification_source,verification_reference,verified_at)
       VALUES('instagram','identity-A','provider_api','synthetic-test',now()),
             ('instagram','identity-B','provider_api','synthetic-test',now())`
    );
    await db!.query(
      `INSERT INTO public.ishikeit_account_connections
       (connection_id,workspace_id,provider,provider_account_id,provider_application_key,status)
       VALUES ($1,$2,'instagram','identity-A','test-app','connected'),
              ($3,$4,'instagram','identity-B','test-app','connected')`,
      [connectionA,workspaceA,connectionB,workspaceB]
    );
  });

  afterAll(async () => {
    try {
      await db!.query("DROP TABLE IF EXISTS public.inbound_events, public.outbox");
      await db!.query(`DROP TABLE IF EXISTS public.ishikeit_connection_audit,
        public.ishikeit_account_connections, public.ishikeit_provider_accounts,
        public.ishikeit_workspace_memberships, public.ishikeit_workspaces`);
    } finally {
      await db!.close();
    }
  });

  it("preserves pre-migration legacy rows as UNKNOWN rather than guessing owner", async () => {
    const id = randomUUID();
    await db!.query("INSERT INTO public.inbound_events(id) VALUES ($1)",[id]);
    await db!.query("INSERT INTO public.outbox(id) VALUES ($1)",[id]);
    for (const table of ["inbound_events","outbox"]) {
      const r = await db!.query<{workspace_id:string|null;connection_id:string|null}>(
        `SELECT workspace_id,connection_id FROM public.${table} WHERE id=$1`,[id]
      );
      expect(r.rows[0]).toMatchObject({workspace_id:null,connection_id:null});
    }
  });

  it("allows precisely bound tenant records while rejecting foreign connection injection", async () => {
    for (const table of ["inbound_events","outbox"]) {
      const good = randomUUID();
      await db!.query(
        `INSERT INTO public.${table}
         (id,workspace_id,connection_id,connection_generation)
         VALUES($1,$2,$3,1)`,[good,workspaceA,connectionA]
      );
      const rows = await db!.query<{workspace_id:string;connection_id:string}>(
        `SELECT workspace_id,connection_id FROM public.${table} WHERE id=$1`,[good]
      );
      expect(rows.rows[0]).toEqual({workspace_id:workspaceA,connection_id:connectionA});
      await expect(db!.query(
        `INSERT INTO public.${table}
         (id,workspace_id,connection_id,connection_generation)
         VALUES($1,$2,$3,1)`,[randomUUID(),workspaceB,connectionA]
      )).rejects.toThrow();
      await expect(db!.query(
        `INSERT INTO public.${table}
         (id,workspace_id,connection_id,connection_generation)
         VALUES($1,$2,$3,NULL)`,[randomUUID(),workspaceA,connectionA]
      )).rejects.toThrow();
      await expect(db!.query(
        `INSERT INTO public.${table}
         (id,workspace_id,connection_id,connection_generation)
         VALUES($1,$2,NULL,1)`,[randomUUID(),workspaceA]
      )).rejects.toThrow();
    }
  });

  it("permits workspace-bound non-provider jobs but blocks unknown workspace claims", async () => {
    await db!.query(
      "INSERT INTO public.outbox(id,workspace_id) VALUES($1,$2)",
      [randomUUID(),workspaceA]
    );
    await expect(db!.query(
      "INSERT INTO public.inbound_events(id,workspace_id) VALUES($1,$2)",
      [randomUUID(),randomUUID()]
    )).rejects.toThrow();
    await db!.query(
      `INSERT INTO public.outbox(id,workspace_id,connection_id,connection_generation)
       VALUES($1,$2,$3,2)`,[randomUUID(),workspaceB,connectionB]
    );
  });

  it("retains RLS and no public/client roles on both durable queues", async () => {
    const rows = await db!.query<{relname:string;relrowsecurity:boolean;public_select:boolean}>(
      `SELECT c.relname,c.relrowsecurity,
       EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
         WHERE a.grantee=0 AND a.privilege_type='SELECT') AS public_select
       FROM pg_class c WHERE c.oid IN ('public.inbound_events'::regclass,'public.outbox'::regclass)`
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.public_select).toBe(false);
    }
  });
});
