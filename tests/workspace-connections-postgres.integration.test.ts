import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import {
  PostgresWorkspaceConnectionRegistry, type WorkspacePrincipal,
  type VerifiedAccountProof
} from "../src/persistence/workspace-connections.js";

/** DDL and ownership tests MUST run only on disposable CI PostgreSQL 17. */
const connectionString = process.env.PG_OUTBOX_TEST_DATABASE_URL;
if (connectionString !== undefined) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || url.pathname !== "/ishikeit_outbox_test") {
    throw new Error("Refusing tenant-schema integration tests outside disposable local PostgreSQL");
  }
}
const db = connectionString === undefined ? undefined : new PostgresDatabase(connectionString);
const registry = db === undefined ? undefined : new PostgresWorkspaceConnectionRegistry(db);
const ownerA: WorkspacePrincipal = { issuer: "verified-session-issuer", subject: "owner-A" };
const ownerB: WorkspacePrincipal = { issuer: "verified-session-issuer", subject: "owner-B" };
const agentA: WorkspacePrincipal = { issuer: "verified-session-issuer", subject: "agent-A" };
const adminA: WorkspacePrincipal = { issuer: "verified-session-issuer", subject: "admin-A" };
let workspaceA = "";
let workspaceB = "";

function proof(provider: string, accountId: string): VerifiedAccountProof {
  return {
    provider, accountId, source: "provider_api",
    sourceReference: "verified-provider-identity",
    verifiedAt: new Date().toISOString()
  };
}
async function link(
  workspaceId: string, actor: WorkspacePrincipal, provider: string, accountId: string
) {
  return registry!.linkVerified({
    connectionId: randomUUID(), workspaceId, actor, providerApplicationKey: "ishikeit-test-app",
    proof: proof(provider, accountId)
  });
}
async function activate(
  connectionId: string, workspaceId: string, actor: WorkspacePrincipal,
  provider: string, accountId: string
) {
  return registry!.activateVerified({
    connectionId,workspaceId,actor,proof:proof(provider,accountId)
  });
}

describe.skipIf(db === undefined)("private multi-workspace connection foundation (disposable PG17)", () => {
  beforeAll(async () => {
    const migration = await readFile("migrations/0010_ishikeit_workspace_connections.sql", "utf8");
    await db!.query(migration);
  });

  beforeEach(async () => {
    await db!.query(`TRUNCATE TABLE public.ishikeit_connection_audit,
      public.ishikeit_account_connections,public.ishikeit_provider_accounts,
      public.ishikeit_workspace_memberships,public.ishikeit_workspaces`);
    workspaceA = randomUUID();
    workspaceB = randomUUID();
    await registry!.createWorkspace({ workspaceId:workspaceA,name:"Workspace A",owner:ownerA });
    await registry!.createWorkspace({ workspaceId:workspaceB,name:"Workspace B",owner:ownerB });
  });

  afterAll(async () => {
    try {
      await db!.query(`DROP TABLE IF EXISTS
        public.ishikeit_connection_audit,public.ishikeit_account_connections,
        public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
        public.ishikeit_workspaces`);
    } finally {
      await db!.close();
    }
  });

  it("does not route an account while verifying; activates only verified exact account", async () => {
    const linked = await link(workspaceA,ownerA,"telegram","verified-immutable-id-1");
    expect(linked.status).toBe("verifying");
    expect(linked.generation).toBe(1);
    expect(await registry!.activeProviderAccount("telegram","verified-immutable-id-1"))
      .toBeUndefined();

    await expect(activate(linked.connectionId,workspaceA,ownerA,"telegram","wrong-account"))
      .rejects.toThrow(/exact fresh provider identity/i);
    const active = await activate(
      linked.connectionId,workspaceA,ownerA,"telegram","verified-immutable-id-1"
    );
    expect(active.status).toBe("connected");
    expect(active.generation).toBe(2);
    expect(await registry!.activeProviderAccount("telegram","verified-immutable-id-1"))
      .toEqual(active);
    expect(await registry!.activeProviderAccount("telegram","another-id"))
      .toBeUndefined();
  });

  it("keeps two workspaces, providers and multiple same-provider accounts independent", async () => {
    const a1 = await link(workspaceA,ownerA,"instagram","insta-account-A");
    const a2 = await link(workspaceA,ownerA,"instagram","insta-account-B");
    const b = await link(workspaceB,ownerB,"instagram","insta-account-C");
    const otherProvider = await link(workspaceB,ownerB,"telegram","insta-account-A");
    await activate(a1.connectionId,workspaceA,ownerA,"instagram","insta-account-A");
    await activate(a2.connectionId,workspaceA,ownerA,"instagram","insta-account-B");
    await activate(b.connectionId,workspaceB,ownerB,"instagram","insta-account-C");
    await activate(otherProvider.connectionId,workspaceB,ownerB,"telegram","insta-account-A");

    expect((await registry!.activeProviderAccount("instagram","insta-account-C"))?.workspaceId)
      .toBe(workspaceB);
    expect((await registry!.activeProviderAccount("instagram","insta-account-A"))?.workspaceId)
      .toBe(workspaceA);
    expect((await registry!.activeProviderAccount("telegram","insta-account-A"))?.workspaceId)
      .toBe(workspaceB);
    expect(await registry!.readForMember({
      workspaceId: workspaceB, connectionId: a1.connectionId,actor:ownerB
    })).toBeUndefined();
    await expect(registry!.readForMember({
      workspaceId: workspaceA, connectionId: a1.connectionId,actor:ownerB
    })).rejects.toThrow(/authorization denied/i);
  });

  it("rejects simultaneous ownership claims even under concurrency; rolls back loser", async () => {
    const attempts = await Promise.allSettled([
      link(workspaceA,ownerA,"messenger","same-provider-account"),
      link(workspaceB,ownerB,"messenger","same-provider-account")
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((a) => a.status === "rejected")).toHaveLength(1);
    const rows = await db!.query<{n: number}>(
      `SELECT count(*)::int AS n FROM public.ishikeit_account_connections
       WHERE provider='messenger' AND provider_account_id='same-provider-account'`
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it("requires owner to add members, admin to manage connections, never agent/viewer", async () => {
    const member = { workspaceId: workspaceA, actor:ownerA, member:agentA, role:"agent" as const };
    await registry!.addMember(member);
    await registry!.addMember({
      workspaceId:workspaceA,actor:ownerA,member:adminA,role:"admin"
    });
    await expect(registry!.addMember({
      workspaceId:workspaceA,actor:adminA,
      member:{issuer:"verified-session-issuer",subject:"stranger"},role:"owner"
    })).rejects.toThrow(/authorization denied/i);
    await expect(link(workspaceA,agentA,"telegram","agent-wants-to-link"))
      .rejects.toThrow(/authorization denied/i);
    await expect(link(workspaceA,ownerB,"telegram","foreign-wants-to-link"))
      .rejects.toThrow(/authorization denied/i);

    const good = await link(workspaceA,adminA,"telegram","admin-link");
    expect(good.status).toBe("verifying");
    expect((await registry!.readForMember({
      workspaceId:workspaceA,connectionId:good.connectionId,actor:agentA
    }))?.accountId).toBe("admin-link");
    await expect(registry!.pause({
      workspaceId:workspaceA,connectionId:good.connectionId,actor:agentA
    })).rejects.toThrow(/authorization denied/i);
  });

  it("pauses and fences a generation; disconnecting retains global ownership", async () => {
    const pending = await link(workspaceA,ownerA,"whatsapp","phone-id-42");
    const active = await activate(
      pending.connectionId,workspaceA,ownerA,"whatsapp","phone-id-42"
    );
    const paused = await registry!.pause({
      workspaceId:workspaceA,connectionId:active.connectionId,actor:ownerA
    });
    expect(paused.status).toBe("paused");
    expect(paused.generation).toBe(active.generation+1);
    expect(await registry!.activeProviderAccount("whatsapp","phone-id-42"))
      .toBeUndefined();

    const disconnecting = await registry!.requestDisconnect({
      workspaceId:workspaceA,connectionId:paused.connectionId,actor:ownerA
    });
    expect(disconnecting.status).toBe("disconnecting");
    expect(disconnecting.generation).toBe(paused.generation+1);
    expect(await registry!.requestDisconnect({
      workspaceId:workspaceA,connectionId:paused.connectionId,actor:ownerA
    })).toEqual(disconnecting);
    await expect(link(workspaceB,ownerB,"whatsapp","phone-id-42")).rejects.toThrow();

    const audit = await db!.query<{event_type:string}>(
      `SELECT event_type FROM public.ishikeit_connection_audit
       WHERE connection_id=$1 ORDER BY recorded_at,event_type`,[paused.connectionId]
    );
    expect(audit.rows.filter(x=>x.event_type==="disconnect_requested")).toHaveLength(1);
  });

  it("refuses old, future or malformed provider proof and preserves empty registry", async () => {
    const base = {
      connectionId:randomUUID(),workspaceId:workspaceA,actor:ownerA,
      providerApplicationKey:"ishikeit-test-app"
    };
    await expect(registry!.linkVerified({
      ...base,proof:{...proof("telegram","old"),verifiedAt:"2024-01-01T00:00:00Z"}
    })).rejects.toThrow(/recent provider identity verification/i);
    await expect(registry!.linkVerified({
      ...base,proof:{...proof("telegram","future"),
        verifiedAt:new Date(Date.now()+300000).toISOString()}
    })).rejects.toThrow(/recent provider identity verification/i);
    await expect(registry!.linkVerified({
      ...base,proof:{...proof("telegram","invalid"),
        sourceReference:"Bearer a-token secret"}
    })).rejects.toThrow();
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount)
      .toBe(0);
  });

  it("enforces RLS and revoked client grants on EVERY private account table", async () => {
    const rows = await db!.query<{
      relname: string; relrowsecurity: boolean; public_select: boolean;
    }>(`SELECT c.relname,c.relrowsecurity,
         has_table_privilege('public', c.oid, 'SELECT') AS public_select
       FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
       WHERE ns.nspname='public' AND c.relname IN (
         'ishikeit_workspaces','ishikeit_workspace_memberships',
         'ishikeit_provider_accounts','ishikeit_account_connections',
         'ishikeit_connection_audit') ORDER BY c.relname`);
    expect(rows.rows).toHaveLength(5);
    for (const row of rows.rows) {
      expect(row.relrowsecurity,row.relname).toBe(true);
      expect(row.public_select,row.relname).toBe(false);
    }
    const policies = await db!.query(
      `SELECT * FROM pg_policies WHERE schemaname='public' AND
        tablename LIKE 'ishikeit_%'`
    );
    expect(policies.rows).toEqual([]);
  });
});
