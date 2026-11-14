import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { AuthenticatedWorkspacePortfolio } from "../src/auth/authenticated-workspace-portfolio.js";
import { PostgresWorkspaceConnectionIntents } from "../src/persistence/workspace-connection-intents.js";
import { PostgresWorkspaceShadowInspector } from "../src/persistence/workspace-routing-shadow.js";
import {
  PostgresWorkspaceConnectionRegistry, type WorkspacePrincipal,
  type VerifiedAccountProof, type WorkspaceConnection
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
const intents = db === undefined ? undefined : new PostgresWorkspaceConnectionIntents(db);
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
async function authorizedIntent(
  workspaceId: string, actor: WorkspacePrincipal, provider: string,
  providerApplicationKey = "ishikeit-test-app"
): Promise<{intentId:string;sessionId:string}> {
  const sessionId=randomUUID();
  const input={workspaceId,actor,provider,providerApplicationKey,sessionId,
    redirectUri:"https://apps.example.test/verified/callback"};
  const started=await intents!.begin(input);
  const consumed=await intents!.consume({...input,
    state:started.state,browserNonce:started.browserNonce});
  if(consumed===undefined) throw new Error("Fixture intent not consumed");
  return {intentId:consumed.intentId,sessionId};
}
async function link(
  workspaceId: string, actor: WorkspacePrincipal, provider: string, accountId: string
) {
  const gate=await authorizedIntent(workspaceId,actor,provider);
  return registry!.linkVerified({
    connectionId: randomUUID(), workspaceId, actor, providerApplicationKey: "ishikeit-test-app",
    ...gate,proof: proof(provider, accountId)
  });
}
async function activate(
  connectionId: string, workspaceId: string, actor: WorkspacePrincipal,
  provider: string, accountId: string,
  binding: {providerApplicationKey: string; providerConnectionId?: string;
    credentialAccountId?: string} = {providerApplicationKey:"ishikeit-test-app"}
) {
  return registry!.activateVerified({
    connectionId,workspaceId,actor,proof:proof(provider,accountId),...binding
  });
}

describe.skipIf(db === undefined)("private multi-workspace connection foundation (disposable PG17)", () => {
  beforeAll(async () => {
    const migration = await readFile("migrations/0010_ishikeit_workspace_connections.sql", "utf8");
    await db!.query(migration);
    const authMigration = await readFile("migrations/0011_ishikeit_connection_intents.sql", "utf8");
    await db!.query(authMigration);
    await db!.query(await readFile("migrations/0013_ishikeit_intent_auth_session.sql","utf8"));
    await db!.query(await readFile("migrations/0022_workspace_connection_intent_claims.sql","utf8"));
  });

  beforeEach(async () => {
    await db!.query(`TRUNCATE TABLE public.ishikeit_connection_intents,public.ishikeit_connection_audit,
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
        public.ishikeit_connection_intents,public.ishikeit_connection_audit,public.ishikeit_account_connections,
        public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
        public.ishikeit_workspaces`);
    } finally {
      await db!.close();
    }
  });

  it("shadows verified registry state without altering durable inbound or tenant ownership", async () => {
    const shadow = new PostgresWorkspaceShadowInspector(db!);
    const candidate = {provider:"meta",channel:"instagram",accountId:"verified-insta-A"};
    expect(await shadow.inspect(candidate)).toBe("unclaimed");
    const pending = await link(workspaceA,ownerA,"instagram",candidate.accountId);
    expect(await shadow.inspect(candidate)).toBe("inactive");
    await activate(pending.connectionId,workspaceA,ownerA,"instagram",candidate.accountId);
    expect(await shadow.inspect(candidate)).toBe("candidate_active");
    const unrelated = await link(workspaceB,ownerB,"instagram","verified-insta-B");
    await activate(unrelated.connectionId,workspaceB,ownerB,"instagram","verified-insta-B");
    expect(await shadow.inspect({...candidate,accountId:"verified-insta-B"}))
      .toBe("candidate_active");
    expect(await shadow.inspect({...candidate,accountId:"unclaimed-user"}))
      .toBe("unclaimed");
    await registry!.pause({
      workspaceId:workspaceA,connectionId:pending.connectionId,actor:ownerA
    });
    expect(await shadow.inspect(candidate)).toBe("inactive");
    const [connectionCount, inboundCount] = await Promise.all([
      db!.query<{ n: number }>("SELECT count(*)::int AS n FROM public.ishikeit_account_connections"),
      db!.query<{ n: number }>("SELECT count(*)::int AS n FROM public.ishikeit_connection_audit")
    ]);
    expect(connectionCount.rows[0]?.n).toBe(2);
    expect(inboundCount.rows[0]?.n).toBe(5);
  });

  it("compares a Telegram Business connection against exact owner/connection/bot in PG17", async () => {
    const shadow = new PostgresWorkspaceShadowInspector(db!);
    const proofIdentity = {botId:"1245678",ownerId:"66778899",connectionId:"business-A"};
    const other = {botId:"9876543",ownerId:"66778888",connectionId:"business-B"};
    const linkedA = await registry!.linkVerified({
      ...await authorizedIntent(workspaceA,ownerA,"telegram",proofIdentity.botId),
      connectionId:randomUUID(),workspaceId:workspaceA,actor:ownerA,
      providerApplicationKey:proofIdentity.botId,
      providerConnectionId:proofIdentity.connectionId,
      proof:proof("telegram",proofIdentity.ownerId)
    });
    const linkedB = await registry!.linkVerified({
      ...await authorizedIntent(workspaceB,ownerB,"telegram",other.botId),
      connectionId:randomUUID(),workspaceId:workspaceB,actor:ownerB,
      providerApplicationKey:other.botId,
      providerConnectionId:other.connectionId,
      proof:proof("telegram",other.ownerId)
    });
    expect(await shadow.inspectVerifiedTelegramBusiness(proofIdentity)).toBe("inactive");
    await activate(linkedA.connectionId,workspaceA,ownerA,"telegram",proofIdentity.ownerId,{
      providerApplicationKey:proofIdentity.botId,providerConnectionId:proofIdentity.connectionId
    });
    await activate(linkedB.connectionId,workspaceB,ownerB,"telegram",other.ownerId,{
      providerApplicationKey:other.botId,providerConnectionId:other.connectionId
    });
    expect(await shadow.inspectVerifiedTelegramBusiness(proofIdentity))
      .toBe("candidate_active");
    expect(await shadow.inspectVerifiedTelegramBusiness(other))
      .toBe("candidate_active");
    for (const altered of [
      {...proofIdentity,ownerId:other.ownerId},
      {...proofIdentity,botId:other.botId},
      {...proofIdentity,connectionId:other.connectionId}
    ]) expect(await shadow.inspectVerifiedTelegramBusiness(altered)).toBe("unclaimed");
    await registry!.pause({
      workspaceId:workspaceA,connectionId:linkedA.connectionId,actor:ownerA
    });
    expect(await shadow.inspectVerifiedTelegramBusiness(proofIdentity)).toBe("inactive");
    expect(await shadow.inspectVerifiedTelegramBusiness(other)).toBe("candidate_active");
  });

  it("refuses app/connection/credential substitution despite a matching provider account", async () => {
    const connected = await registry!.linkVerified({
      ...await authorizedIntent(workspaceA,ownerA,"telegram","app-A"),
      connectionId:randomUUID(),workspaceId:workspaceA,actor:ownerA,
      providerApplicationKey:"app-A",providerConnectionId:"business-A",
      credentialAccountId:"credential-A",proof:proof("telegram","owner-id-1")
    });
    const exact = {
      workspaceId:workspaceA,connectionId:connected.connectionId,actor:ownerA,
      proof:proof("telegram","owner-id-1"),
      providerApplicationKey:"app-A",providerConnectionId:"business-A",
      credentialAccountId:"credential-A"
    };
    for (const altered of [
      {...exact,providerApplicationKey:"app-B"},
      {...exact,providerConnectionId:"business-B"},
      {...exact,credentialAccountId:"credential-B"},
      {...exact,providerConnectionId:undefined},
      {...exact,credentialAccountId:undefined},
      {...exact,proof:proof("telegram","foreign-owner")}
    ]) {
      await expect(registry!.activateVerified(altered)).rejects.toThrow(
        /exact fresh provider (binding|identity) proof/i
      );
    }
    const before=await registry!.readForMember({
      workspaceId:workspaceA,connectionId:connected.connectionId,actor:ownerA
    });
    expect(before?.status).toBe("verifying");
    expect(before?.generation).toBe(1);
    const auditBefore=await db!.query<{event_type:string}>(
      "SELECT event_type FROM public.ishikeit_connection_audit WHERE connection_id=$1",
      [connected.connectionId]
    );
    expect(auditBefore.rows.map(x=>x.event_type)).toEqual(["link_verified"]);
    const activated=await registry!.activateVerified(exact);
    expect(activated.status).toBe("connected");
    expect(activated.generation).toBe(2);
    expect((await registry!.activeProviderAccount("telegram","owner-id-1"))?.connectionId)
      .toBe(connected.connectionId);
    await expect(registry!.activateVerified(exact)).rejects.toThrow(/exact fresh provider identity/i);
  });

  it("refuses an omitted application binding, even for records without a provider connection", async () => {
    const pending=await link(workspaceB,ownerB,"instagram","ig-account-B");
    await expect(registry!.activateVerified({
      connectionId:pending.connectionId,workspaceId:workspaceB,actor:ownerB,
      proof:proof("instagram","ig-account-B"),
      providerApplicationKey:"other-app"
    })).rejects.toThrow(/exact fresh provider binding proof/i);
    expect((await registry!.readForMember({
      workspaceId:workspaceB,connectionId:pending.connectionId,actor:ownerB
    }))?.status).toBe("verifying");
    expect((await activate(pending.connectionId,workspaceB,ownerB,"instagram","ig-account-B"))
      .status).toBe("connected");
  });

  it("links only a consumed, unexpired intent for exact workspace, actor, app and session", async () => {
    const sessionId=randomUUID();
    const start={workspaceId:workspaceA,actor:ownerA,provider:"instagram",
      providerApplicationKey:"app-A",sessionId,
      redirectUri:"https://apps.example.test/instagram/callback"};
    const minted=await intents!.begin(start);
    const row=await db!.query<{intent_id:string}>(
      "SELECT intent_id FROM public.ishikeit_connection_intents");
    const intentId=row.rows[0]!.intent_id;
    const input={intentId,sessionId,workspaceId:workspaceA,actor:ownerA,
      connectionId:randomUUID(),providerApplicationKey:"app-A",
      proof:proof("instagram","verified-account-A")};
    await expect(registry!.linkVerified(input)).rejects.toThrow(/unused session-bound/i);
    const completion=await intents!.consume({...start,state:minted.state,
      browserNonce:minted.browserNonce});
    expect(completion?.intentId).toBe(intentId);
    for (const altered of [
      {...input,sessionId:randomUUID()},
      {...input,providerApplicationKey:"another-app"},
      {...input,actor:ownerB},
      {...input,workspaceId:workspaceB,actor:ownerB},
      {...input,proof:proof("telegram","verified-account-A")}
    ]) await expect(registry!.linkVerified(altered))
      .rejects.toThrow(/(authorization denied|unused session-bound)/i);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount)
      .toBe(0);
    const linked=await registry!.linkVerified(input);
    expect(linked.status).toBe("verifying");
    const claimed=await db!.query<{claimed_connection_id:string;claimed_at:Date}>(
      "SELECT claimed_connection_id,claimed_at FROM public.ishikeit_connection_intents WHERE intent_id=$1",
      [intentId]);
    expect(claimed.rows[0]?.claimed_connection_id).toBe(linked.connectionId);
    expect(claimed.rows[0]?.claimed_at).toBeInstanceOf(Date);
    await expect(registry!.linkVerified({...input,connectionId:randomUUID(),
      proof:proof("instagram","another-account")})).rejects.toThrow(/unused session-bound/i);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount)
      .toBe(1);
  });

  it("fences concurrent claims of one consumed session-bound intent", async () => {
    const gate=await authorizedIntent(workspaceA,ownerA,"instagram","app-concurrent");
    const base={...gate,workspaceId:workspaceA,actor:ownerA,
      providerApplicationKey:"app-concurrent",proof:proof("instagram","one-account")};
    const results=await Promise.allSettled([
      registry!.linkVerified({...base,connectionId:randomUUID()}),
      registry!.linkVerified({...base,connectionId:randomUUID(),
        proof:proof("instagram","different-account")})
    ]);
    expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(x=>x.status==="rejected")).toHaveLength(1);
    const row=await db!.query<{claimed_connection_id:string}>(
      "SELECT claimed_connection_id FROM public.ishikeit_connection_intents WHERE intent_id=$1",
      [gate.intentId]);
    expect(row.rows[0]?.claimed_connection_id).toBe(
      (results.find(x=>x.status==="fulfilled") as PromiseFulfilledResult<WorkspaceConnection>)
        .value.connectionId
    );
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount)
      .toBe(1);
  });

  it("does not consume ownership intent on a conflicting provider account", async () => {
    await link(workspaceA,ownerA,"instagram","claimed-id");
    const gate=await authorizedIntent(workspaceB,ownerB,"instagram");
    const base={...gate,workspaceId:workspaceB,actor:ownerB,
      providerApplicationKey:"ishikeit-test-app",connectionId:randomUUID()};
    await expect(registry!.linkVerified({...base,proof:proof("instagram","claimed-id")}))
      .rejects.toThrow();
    const stillAvailable=await db!.query<{claimed_connection_id:string|null}>(
      "SELECT claimed_connection_id FROM public.ishikeit_connection_intents WHERE intent_id=$1",
      [gate.intentId]);
    expect(stillAvailable.rows[0]?.claimed_connection_id).toBeNull();
    const allowed=await registry!.linkVerified({...base,proof:proof("instagram","new-id")});
    expect(allowed.workspaceId).toBe(workspaceB);
  });

  it("rejects expired, unbound and absent-session claims even after callback", async () => {
    const gate=await authorizedIntent(workspaceA,ownerA,"instagram");
    const input={...gate,workspaceId:workspaceA,actor:ownerA,
      providerApplicationKey:"ishikeit-test-app",connectionId:randomUUID(),
      proof:proof("instagram","account-A")};
    await expect(registry!.linkVerified({...input,intentId:randomUUID()}))
      .rejects.toThrow(/unused session-bound/i);
    await expect(registry!.linkVerified({...input,sessionId:undefined as never})).rejects.toThrow();
    await db!.query(`UPDATE public.ishikeit_connection_intents
      SET expires_at=now()-interval '1 second',
          created_at=now()-interval '2 minutes'
      WHERE intent_id=$1`,[gate.intentId]);
    await expect(registry!.linkVerified(input)).rejects.toThrow(/unused session-bound/i);
    const row=await db!.query<{claimed_connection_id:string|null}>(
      "SELECT claimed_connection_id FROM public.ishikeit_connection_intents WHERE intent_id=$1",
      [gate.intentId]);
    expect(row.rows[0]?.claimed_connection_id).toBeNull();
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
  }, 15_000);

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
      providerApplicationKey:"ishikeit-test-app",
      intentId:randomUUID(),sessionId:randomUUID()
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
         EXISTS (
           SELECT 1 FROM aclexplode(
             coalesce(c.relacl,acldefault('r',c.relowner))
           ) priv
           WHERE priv.grantee=0 AND priv.privilege_type='SELECT'
         ) AS public_select
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
  it("binds one-use OAuth state to workspace, authenticated actor, provider app and secure browser", async () => {
    const begin = {
      workspaceId:workspaceA,actor:ownerA,sessionId:randomUUID(),provider:"instagram",
      providerApplicationKey:"app-test",redirectUri:"https://apps.example.test/oauth/instagram/callback"
    };
    const created = await intents!.begin(begin);
    expect(created.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(created.browserNonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(created.state).not.toBe(created.browserNonce);
    expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const rows = await db!.query<{
      state_hash:string;browser_nonce_hash:string;actor_subject:string
    }>("SELECT state_hash,browser_nonce_hash,actor_subject FROM public.ishikeit_connection_intents");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.actor_subject).toBe(ownerA.subject);
    expect(rows.rows[0]?.state_hash).toBe(createHash("sha256").update(created.state).digest("hex"));
    expect(rows.rows[0]?.browser_nonce_hash).toBe(
      createHash("sha256").update(created.browserNonce).digest("hex")
    );
    const callback = { ...begin,state:created.state,browserNonce:created.browserNonce };
    expect(await intents!.consume({...callback,workspaceId:workspaceB,actor:ownerB})).toBeUndefined();
    expect(await intents!.consume({...callback,provider:"tiktok"})).toBeUndefined();
    expect(await intents!.consume({...callback,providerApplicationKey:"foreign-app"})).toBeUndefined();
    expect(await intents!.consume({...callback,redirectUri:"https://other.example.test/callback"}))
      .toBeUndefined();
    const wrongNonce = Buffer.alloc(32,1).toString("base64url");
    expect(await intents!.consume({...callback,browserNonce:wrongNonce})).toBeUndefined();
    const consumed = await intents!.consume(callback);
    expect(consumed).toMatchObject({workspaceId:workspaceA,actor:ownerA,provider:"instagram"});
    expect(consumed?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(createHash("sha256").update(consumed!.codeVerifier).digest("base64url"))
      .toBe(created.codeChallenge);
    expect(await intents!.consume(callback)).toBeUndefined();
    expect(await intents!.consume(callback)).toBeUndefined();
  });

  it("prevents OAuth callback replay even with concurrent requests", async () => {
    const begin = {
      workspaceId:workspaceA,actor:ownerA,sessionId:randomUUID(),provider:"tiktok",
      providerApplicationKey:"tiktok-app",redirectUri:"https://apps.example.test/callback"
    };
    const minted = await intents!.begin(begin);
    const p = {...begin,state:minted.state,browserNonce:minted.browserNonce};
    const [a,b] = await Promise.all([intents!.consume(p),intents!.consume(p)]);
    expect([a,b].filter(Boolean)).toHaveLength(1);
  });

  it("rechecks workspace membership and grant role at the callback", async () => {
    const begin = {
      workspaceId:workspaceA,actor:ownerA,sessionId:randomUUID(),provider:"instagram",
      providerApplicationKey:"app-test",redirectUri:"https://apps.example.test/callback"
    };
    const mint = await intents!.begin(begin);
    const callback = {...begin,state:mint.state,browserNonce:mint.browserNonce};
    await db!.query(
      "UPDATE public.ishikeit_workspace_memberships SET state='revoked' WHERE workspace_id=$1",
      [workspaceA]
    );
    expect(await intents!.consume(callback)).toBeUndefined();
    await db!.query(
      "UPDATE public.ishikeit_workspace_memberships SET state='active',role='viewer' WHERE workspace_id=$1",
      [workspaceA]
    );
    expect(await intents!.consume(callback)).toBeUndefined();
    await db!.query(
      "UPDATE public.ishikeit_workspace_memberships SET role='owner' WHERE workspace_id=$1",
      [workspaceA]
    );
    const accepted = await intents!.consume(callback);
    expect(accepted?.actor).toEqual(ownerA);
    expect(await intents!.consume(callback)).toBeUndefined();
  });

  it("fences an OAuth callback against concurrent membership revocation", async () => {
    const begin = {
      workspaceId:workspaceA,actor:ownerA,sessionId:randomUUID(),provider:"instagram",
      providerApplicationKey:"app-test",redirectUri:"https://apps.example.test/callback"
    };
    const minted = await intents!.begin(begin);
    const callback = {...begin,state:minted.state,browserNonce:minted.browserNonce};
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const revoke = db!.transaction(async (tx) => {
      await tx.query(
        "UPDATE public.ishikeit_workspace_memberships SET state='revoked' WHERE workspace_id=$1",
        [workspaceA]
      );
      started();
      await gate;
    });
    await ready;
    let finished = false;
    const callbackResult = intents!.consume(callback).then((value) => {
      finished = true;
      return value;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve,150));
      expect(finished).toBe(false);
    } finally {
      release();
    }
    await revoke;
    expect(await callbackResult).toBeUndefined();
    expect((await db!.query<{consumed_at:Date|null}>(
      "SELECT consumed_at FROM public.ishikeit_connection_intents"
    )).rows[0]?.consumed_at).toBeNull();
  });

  it("rejects expired, malicious, or non-HTTPS redirect attempts without cross-tenant side effects", async () => {
    const begin = {
      workspaceId:workspaceA,actor:ownerA,sessionId:randomUUID(),provider:"instagram",
      providerApplicationKey:"app-test",redirectUri:"https://apps.example.test/callback"
    };
    await expect(intents!.begin({
      ...begin,redirectUri:"https://apps.example.test@evil.test/callback"
    })).rejects.toThrow();
    await expect(intents!.begin({...begin,redirectUri:"http://apps.example.test/callback"}))
      .rejects.toThrow();
    await expect(intents!.begin({...begin,redirectUri:"https://apps.example.test/callback#frag"}))
      .rejects.toThrow();
    await expect(intents!.begin({...begin,actor:ownerB})).rejects.toThrow(/authorization denied/i);
    const mint = await intents!.begin(begin);
    await db!.query(
      "UPDATE public.ishikeit_connection_intents SET expires_at=now()-interval '1 second',created_at=now()-interval '2 minutes'"
    );
    expect(await intents!.consume({
      ...begin,state:mint.state,browserNonce:mint.browserNonce
    })).toBeUndefined();
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount)
      .toBe(0);
  });

  it("keeps intent data RLS private with no browser grants or policies", async () => {
    const result = await db!.query<{
      relrowsecurity:boolean; anon_select:boolean; authenticated_select:boolean;num_policies:number
    }>(`SELECT c.relrowsecurity,
       EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')
         AND coalesce((SELECT has_table_privilege('anon',c.oid,'SELECT')
           FROM pg_roles WHERE rolname='anon'),false) AS anon_select,
       EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
         AND coalesce((SELECT has_table_privilege('authenticated',c.oid,'SELECT')
           FROM pg_roles WHERE rolname='authenticated'),false) AS authenticated_select,
       (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public'
         AND p.tablename=c.relname) AS num_policies
       FROM pg_class c WHERE c.oid='public.ishikeit_connection_intents'::regclass`);
    expect(result.rows[0]).toMatchObject({
      relrowsecurity:true,anon_select:false,authenticated_select:false,num_policies:0
    });
  });

  it("binds an OAuth intent to the EXACT verified login session, not only user and browser", async () => {
    const sessionOne=randomUUID();
    const sessionTwo=randomUUID();
    const request = {
      workspaceId:workspaceA,actor:ownerA,sessionId:sessionOne,
      provider:"instagram",providerApplicationKey:"app-test",
      redirectUri:"https://apps.example.test/callback"
    };
    const mint=await intents!.begin(request);
    const callback = {...request,state:mint.state,browserNonce:mint.browserNonce};
    expect(await intents!.consume({...callback,sessionId:sessionTwo})).toBeUndefined();
    await expect(intents!.consume({...callback,sessionId:undefined as never})).rejects.toThrow();
    const consumed=await intents!.consume(callback);
    expect(consumed?.workspaceId).toBe(workspaceA);
    expect(await intents!.consume(callback)).toBeUndefined();
    const row=await db!.query<{auth_session_id:string}>(
      "SELECT auth_session_id FROM public.ishikeit_connection_intents WHERE state_hash=$1",
      [createHash("sha256").update(mint.state).digest("hex")]
    );
    expect(row.rows[0]?.auth_session_id).toBe(sessionOne);
  });

  it("lists a bounded admin-only inventory without cross-workspace IDs, token references or revoked-member access",async()=>{
    const one=await link(workspaceA,ownerA,"instagram","account-A-1");
    await activate(one.connectionId,workspaceA,ownerA,"instagram","account-A-1");
    const two=await link(workspaceA,ownerA,"telegram","account-A-2");
    const foreign=await link(workspaceB,ownerB,"instagram","account-B-secret");
    await activate(foreign.connectionId,workspaceB,ownerB,"instagram","account-B-secret");
    await registry!.addMember({workspaceId:workspaceA,actor:ownerA,member:adminA,role:"admin"});
    await registry!.addMember({workspaceId:workspaceA,actor:ownerA,member:agentA,role:"viewer"});

    const first=await registry!.listForAdministrator({
      workspaceId:workspaceA,actor:ownerA,pageSize:1
    });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(first.items[0]!.connectionId);
    const nextCursor=first.nextCursor;
    if(nextCursor===undefined) throw new Error("Missing inventory pagination cursor");
    const second=await registry!.listForAdministrator({
      workspaceId:workspaceA,actor:adminA,pageSize:1,after:nextCursor
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    const results=[...first.items,...second.items];
    expect(new Set(results.map(row=>row.connectionId)))
      .toEqual(new Set([one.connectionId,two.connectionId]));
    expect(results.every(row=>row.workspaceId===workspaceA)).toBe(true);
    expect(results.some(row=>row.accountId==="account-B-secret")).toBe(false);
    expect(results.some(row=>row.status==="connected")).toBe(true);
    expect(results.some(row=>row.status==="verifying")).toBe(true);
    expect(Object.keys(results[0]!)).toEqual([
      "connectionId","workspaceId","provider","accountId","status","generation"
    ]);
    await expect(registry!.listForAdministrator({
      workspaceId:workspaceA,actor:agentA
    })).rejects.toThrow(/authorization denied/i);
    await expect(registry!.listForAdministrator({
      workspaceId:workspaceA,actor:ownerB
    })).rejects.toThrow(/authorization denied/i);
    await expect(registry!.listForAdministrator({
      workspaceId:workspaceB,actor:ownerA
    })).rejects.toThrow(/authorization denied/i);
    await expect(registry!.listForAdministrator({
      workspaceId:workspaceA,actor:ownerA,pageSize:51
    })).rejects.toThrow();
    await expect(registry!.listForAdministrator({
      workspaceId:workspaceA,actor:ownerA,after:"not-a-uuid"
    })).rejects.toThrow();
    await db!.query("UPDATE public.ishikeit_workspace_memberships SET state='revoked' WHERE workspace_id=$1 AND auth_subject=$2",
      [workspaceA,adminA.subject]);
    await expect(registry!.listForAdministrator({
      workspaceId:workspaceA,actor:adminA
    })).rejects.toThrow(/authorization denied/i);
    await db!.query("UPDATE public.ishikeit_workspaces SET state='suspended' WHERE workspace_id=$1",
      [workspaceA]);
    await expect(registry!.listForAdministrator({
      workspaceId:workspaceA,actor:ownerA
    })).rejects.toThrow(/authorization denied/i);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount)
      .toBe(3);
  });

  it("lists only the verified user's ACTIVE workspaces with exact roles and account totals",async()=>{
    const verifyAccessToken=vi.fn((token:string)=>{
      if(token!=="test-signed-session") return Promise.reject(new Error("Invalid login"));
      return Promise.resolve({
        principal:ownerA,sessionId:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString()
      });
    });
    const portfolio=new AuthenticatedWorkspacePortfolio({verifyAccessToken},db!);
    const a=await link(workspaceA,ownerA,"instagram","studio-verified-account");
    await activate(a.connectionId,workspaceA,ownerA,"instagram","studio-verified-account");
    const aPending=await link(workspaceA,ownerA,"telegram","other-pending-account");
    expect(aPending.status).toBe("verifying");
    await link(workspaceB,ownerB,"instagram","foreign-account");
    const first=await portfolio.list("test-signed-session");
    expect(first.items).toEqual([{
      workspaceId:workspaceA,displayName:"Workspace A",role:"owner",connectedAccounts:1
    }]);
    expect(first.nextCursor).toBeUndefined();
    await registry!.addMember({
      workspaceId:workspaceB,actor:ownerB,member:ownerA,role:"viewer"
    });
    const pages=await portfolio.list("test-signed-session",{pageSize:1});
    expect(pages.items).toHaveLength(1);
    expect(pages.nextCursor).toBe(pages.items[0]?.workspaceId);
    const cursor=pages.nextCursor;
    if(cursor===undefined) throw new Error("Expected a second workspace page");
    const second=await portfolio.list("test-signed-session",{
      pageSize:1,after:cursor
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    const all=[...pages.items,...second.items];
    expect(new Set(all.map(w=>w.workspaceId))).toEqual(new Set([workspaceA,workspaceB]));
    expect(all.find(w=>w.workspaceId===workspaceB)?.role).toBe("viewer");

    await db!.query("UPDATE public.ishikeit_workspaces SET state='suspended' WHERE workspace_id=$1",
      [workspaceB]);
    expect((await portfolio.list("test-signed-session")).items).toHaveLength(1);
    await db!.query("UPDATE public.ishikeit_workspaces SET state='active' WHERE workspace_id=$1",
      [workspaceB]);
    await db!.query("UPDATE public.ishikeit_workspace_memberships SET state='revoked' WHERE workspace_id=$1 AND auth_subject=$2",
      [workspaceB,ownerA.subject]);
    expect((await portfolio.list("test-signed-session")).items).toHaveLength(1);
    await expect(portfolio.list("forged-access-token")).rejects.toThrow(/invalid login/i);
  });

  it("binds Telegram Bot API Business to the exact OIDC owner and increments a fenced generation once",async()=>{
    const accountId="987654321";
    const pending=await link(workspaceA,ownerA,"telegram",accountId);
    const request={
      workspaceId:workspaceA,connectionId:pending.connectionId,actor:ownerA,
      providerApplicationKey:"ishikeit-test-app",
      ownerId:accountId,businessConnectionId:"tg-business-user-987654321",
      verifiedAt:new Date().toISOString()
    };
    expect(pending.status).toBe("verifying");
    const active=await registry!.activateTelegramBusiness(request);
    expect(active).toMatchObject({
      connectionId:pending.connectionId,workspaceId:workspaceA,
      provider:"telegram",accountId,status:"connected",generation:2
    });
    const database=await db!.query<{
      provider_connection_id:string;credential_account_id:string|null;generation:string
    }>(`SELECT provider_connection_id,credential_account_id,generation
       FROM public.ishikeit_account_connections WHERE connection_id=$1`,
      [pending.connectionId]);
    expect(database.rows[0]).toMatchObject({
      provider_connection_id:"tg-business-user-987654321",
      credential_account_id:null
    });
    await expect(registry!.activateTelegramBusiness(request)).rejects.toThrow();
    expect((await db!.query(
      "SELECT 1 FROM public.ishikeit_connection_audit WHERE connection_id=$1 AND event_type='activated'",
      [pending.connectionId]
    )).rowCount).toBe(1);
    await expect(registry!.activateTelegramBusiness({
      ...request,businessConnectionId:"different-business"
    })).rejects.toThrow();
  });

  it("refuses Telegram Business owner, app, membership and workspace substitutions atomically",async()=>{
    const pending=await link(workspaceA,ownerA,"telegram","987654321");
    const request={
      workspaceId:workspaceA,connectionId:pending.connectionId,actor:ownerA,
      providerApplicationKey:"ishikeit-test-app",
      ownerId:"987654321",businessConnectionId:"tg-business-verified-id",
      verifiedAt:new Date().toISOString()
    };
    await expect(registry!.activateTelegramBusiness({
      ...request,actor:ownerB
    })).rejects.toThrow(/authorization denied/i);
    await expect(registry!.activateTelegramBusiness({
      ...request,workspaceId:workspaceB
    })).rejects.toThrow(/authorization denied/i);
    await expect(registry!.activateTelegramBusiness({
      ...request,ownerId:"88888888"
    })).rejects.toThrow(/owner verification mismatch/i);
    await expect(registry!.activateTelegramBusiness({
      ...request,providerApplicationKey:"different-bot"
    })).rejects.toThrow(/binding has changed/i);
    expect((await db!.query(
      "SELECT provider_connection_id FROM public.ishikeit_account_connections WHERE connection_id=$1",
      [pending.connectionId]
    )).rows[0]).toMatchObject({provider_connection_id:null});
    await db!.query(
      "UPDATE public.ishikeit_workspace_memberships SET state='revoked' WHERE workspace_id=$1 AND auth_subject=$2",
      [workspaceA,ownerA.subject]
    );
    await expect(registry!.activateTelegramBusiness(request))
      .rejects.toThrow(/authorization denied/i);
  });

});
