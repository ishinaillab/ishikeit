import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {beforeAll,beforeEach,afterAll,describe,expect,it} from "vitest";
import {PostgresDatabase} from "../src/persistence/postgres.js";
import {PostgresWorkspaceConnectionRegistry,type WorkspacePrincipal} from
  "../src/persistence/workspace-connections.js";
import {PostgresWorkspaceConnectionIntents} from
  "../src/persistence/workspace-connection-intents.js";
import {PostgresAccountCapabilityFacts} from
  "../src/persistence/account-capability-facts.js";

/** Uses disposable localhost PG17 only. Never production or Supabase. */
const uri=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(uri!==undefined){
  const x=new URL(uri);
  if(!["postgres:","postgresql:"].includes(x.protocol)||
    !["localhost","127.0.0.1","::1"].includes(x.hostname)||
    x.pathname!=="/ishikeit_outbox_test")
    throw Error("Refuse tenant capability tests outside disposable PostgreSQL");
}
const db=uri===undefined?undefined:new PostgresDatabase(uri);
const registry=db&&new PostgresWorkspaceConnectionRegistry(db);
const intents=db&&new PostgresWorkspaceConnectionIntents(db);
const facts=db&&new PostgresAccountCapabilityFacts(db);
const ownerA:WorkspacePrincipal={issuer:"synthetic-issuer",subject:"owner-a"};
const ownerB:WorkspacePrincipal={issuer:"synthetic-issuer",subject:"owner-b"};
const viewer:WorkspacePrincipal={issuer:"synthetic-issuer",subject:"viewer-a"};
let workspaceA:string,workspaceB:string;
function observed(key:string,accountId:string,provider="telegram",
  state:"granted"|"denied"="granted",offsetMs=0){
  const start=new Date(Date.now()-120000+offsetMs);
  const end=new Date(start.getTime()+300000);
  return {
    provider,accountId,key,state,providerApplicationKey:"native-capability-test-app",
    source:"provider_connection_readback" as const,
    sourceReference:"getBusinessConnection",
    observedAt:start.toISOString(),validUntil:end.toISOString()
  };
}
function scoped(connectionId:string,fact:ReturnType<typeof observed>){
  return {...fact,sourceConnectionId:connectionId};
}
async function claim(workspaceId:string,actor:WorkspacePrincipal,
  provider:string,accountId:string){
  const sessionId=randomUUID(),connectionId=randomUUID();
  const request={workspaceId,actor,sessionId,provider,
    providerApplicationKey:"native-capability-test-app",
    redirectUri:"https://apps.example.test/connect/callback"};
  const started=await intents!.begin(request);
  const consumed=await intents!.consume({...request,state:started.state,
    browserNonce:started.browserNonce});
  if(!consumed)throw Error("Missing owner intent");
  return registry!.linkVerified({
    connectionId,intentId:consumed.intentId,sessionId,
    workspaceId,actor,providerApplicationKey:request.providerApplicationKey,
    proof:{provider,accountId,source:"provider_api",
      sourceReference:"authorized-provider-id",
      verifiedAt:new Date().toISOString()}
  });
}
describe.skipIf(db===undefined)("AAL2 caller-facing capability evidence under disposable PostgreSQL 17",()=>{
  beforeAll(async()=>{
    for(const name of [
      "0009_provider_account_capability_facts.sql",
      "0024_provider_capability_application_scope.sql",
      "0010_ishikeit_workspace_connections.sql",
      "0011_ishikeit_connection_intents.sql",
      "0013_ishikeit_intent_auth_session.sql",
      "0022_workspace_connection_intent_claims.sql"
    ])await db!.query(await readFile("migrations/"+name,"utf8"));
  });
  beforeEach(async()=>{
    await db!.query(`TRUNCATE TABLE public.ishikeit_connection_intents,
      public.ishikeit_connection_audit,public.ishikeit_account_connections,
      public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
      public.ishikeit_workspaces,public.provider_account_capability_facts_v2,
        public.provider_account_capability_facts`);
    workspaceA=randomUUID();workspaceB=randomUUID();
    await registry!.createWorkspace({workspaceId:workspaceA,name:"Workspace A",owner:ownerA});
    await registry!.createWorkspace({workspaceId:workspaceB,name:"Workspace B",owner:ownerB});
  });
  afterAll(async()=>{
    try{
      await db!.query(`DROP TABLE IF EXISTS
        public.ishikeit_connection_intents,public.ishikeit_connection_audit,
        public.ishikeit_account_connections,public.ishikeit_provider_accounts,
        public.ishikeit_workspace_memberships,public.ishikeit_workspaces,
        public.provider_account_capability_facts_v2,
        public.provider_account_capability_facts`);
    }finally{await db!.close();}
  });
  it("serves exact live owner account, latest verified Telegram rights and no send permits",async()=>{
    const one=await claim(workspaceA,ownerA,"telegram","9001");
    await facts!.record([
      scoped(one.connectionId,observed("telegram.business_connection","9001")),
      scoped(one.connectionId,observed("telegram.rights.can_reply","9001"))
    ]);
    const snapshot=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:one.connectionId,actor:ownerA
    });
    expect(snapshot.connection).toMatchObject({
      workspaceId:workspaceA,accountId:"9001",status:"verifying"
    });
    expect(snapshot.capability.tenantSendingEnabled).toBe(false);
    expect(snapshot.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("available");
    expect(snapshot.capability.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({key:"telegram.rights.can_reply",status:"granted"})
    ]));
    expect(JSON.stringify(snapshot)).not.toContain("getBusinessConnection");
    expect(JSON.stringify(snapshot)).not.toContain("sourceReference");
    expect((await db!.query("SELECT * FROM public.ishikeit_account_connections"))
      .rowCount).toBe(1);
  });
  it("never leaks facts from a different provider/account or workspace",async()=>{
    const one=await claim(workspaceA,ownerA,"telegram","9001");
    const two=await claim(workspaceB,ownerB,"telegram","9002");
    await facts!.record([
      scoped(one.connectionId,observed("telegram.business_connection","9001")),
      scoped(one.connectionId,observed("telegram.rights.can_reply","9001"))
    ]);
    const target=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceB,connectionId:two.connectionId,actor:ownerB
    });
    expect(target.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("unverified");
    expect(target.capability.evidence.every(x=>x.status==="unknown")).toBe(true);
    await expect(registry!.capabilitiesForAdministrator({
      workspaceId:workspaceB,connectionId:one.connectionId,actor:ownerB
    })).rejects.toThrow(/not found/i);
    await expect(registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:one.connectionId,actor:ownerB
    })).rejects.toThrow(/authorization denied/i);
  });
  it("expires and revokes verified permission dynamically, rather than restoring historical grants",async()=>{
    const conn=await claim(workspaceA,ownerA,"telegram","9001");
    await facts!.record([
      scoped(conn.connectionId,observed("telegram.business_connection","9001")),
      scoped(conn.connectionId,observed("telegram.rights.can_reply","9001"))
    ]);
    await facts!.record([
      scoped(conn.connectionId,observed("telegram.rights.can_reply","9001","telegram","denied",60000))
    ]);
    const denied=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:conn.connectionId,actor:ownerA
    });
    expect(denied.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("needs_permission");
    expect(denied.capability.evidence.find(x=>x.key==="telegram.rights.can_reply")
      ?.status).toBe("denied");
    const expired=scoped(conn.connectionId,observed("telegram.rights.can_reply","9001",
      "telegram","denied",100000));
    expired.validUntil=new Date(Date.now()-1000).toISOString();
    // The newest denial is already expired, and must never resurrect
    // the older valid "granted" observation.
    expect(await facts!.record([expired])).toBe(1);
    const latest=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:conn.connectionId,actor:ownerA
    });
    expect(latest.capability.tenantSendingEnabled).toBe(false);
    expect(latest.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("unverified");
    expect(latest.capability.evidence.find(x=>x.key==="telegram.rights.can_reply")
      ?.status).toBe("expired");
  });
  it("does not inherit prior owner rights after a provider account transfer",async()=>{
    const first=await claim(workspaceA,ownerA,"telegram","9001");
    await facts!.record([
      scoped(first.connectionId,observed("telegram.business_connection","9001")),
      scoped(first.connectionId,observed("telegram.rights.can_reply","9001"))
    ]);
    const before=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:first.connectionId,actor:ownerA
    });
    expect(before.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("available");

    await registry!.requestDisconnect({
      workspaceId:workspaceA,connectionId:first.connectionId,actor:ownerA
    });
    const during=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:first.connectionId,actor:ownerA
    });
    expect(during.connection.status).toBe("disconnecting");
    expect(during.capability.evidence.every(x=>x.status==="unknown")).toBe(true);
    // Simulate completed provider cleanup ONLY inside disposable PostgreSQL.
    // Production cleanup is separately gated and must not be inferred here.
    await db!.query(`UPDATE public.ishikeit_account_connections
      SET status='disconnected',disconnected_at=now(),generation=generation+1
      WHERE workspace_id=$1 AND connection_id=$2 AND status='disconnecting'`,
      [workspaceA,first.connectionId]);

    const second=await claim(workspaceB,ownerB,"telegram","9001");
    const inherited=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceB,connectionId:second.connectionId,actor:ownerB
    });
    expect(inherited.capability.tenantSendingEnabled).toBe(false);
    expect(inherited.capability.evidence.every(x=>x.status==="unknown")).toBe(true);
    expect(inherited.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("unverified");

    // A delayed old-owner readback may be INSERTED after relink but was
    // OBSERVED before the new owner's connection existed. Do not resurrect
    // historical rights simply because recorded_at is newer.
    const staleReadback=new Date(Date.now()-1500).toISOString();
    const olderThanNewLink=["telegram.business_connection","telegram.rights.can_reply"]
      .map(key=>({
        ...scoped(first.connectionId,observed(key,"9001")),
        observedAt:staleReadback,
        validUntil:new Date(Date.now()+300000).toISOString()
      }));
    await facts!.record(olderThanNewLink);
    const stale=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceB,connectionId:second.connectionId,actor:ownerB
    });
    expect(stale.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("unverified");
    expect(stale.capability.evidence.every(x=>x.status==="unknown")).toBe(true);

    // Only a genuinely NEW provider readback taken after the current owner
    // claim may contribute to the second workspace's capability preview.
    const freshObservedAt=new Date().toISOString();
    await facts!.record([
      {...scoped(second.connectionId,observed("telegram.business_connection","9001")),
        observedAt:freshObservedAt},
      {...scoped(second.connectionId,observed("telegram.rights.can_reply","9001")),
        observedAt:freshObservedAt}
    ]);
    const refreshed=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceB,connectionId:second.connectionId,actor:ownerB
    });
    expect(refreshed.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("available");
    expect((await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:first.connectionId,actor:ownerA
    })).capability.evidence.every(x=>x.status==="unknown")).toBe(true);
  });
  it("cannot adopt unbound legacy account/application proof as this live connection",async()=>{
    const current=await claim(workspaceA,ownerA,"telegram","9001");
    // A legacy producer has the same provider/account/app but no current
    // verified workspace connection, so it MUST be invisible in Channels.
    await facts!.record([
      observed("telegram.business_connection","9001"),
      observed("telegram.rights.can_reply","9001")
    ]);
    const preview=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:current.connectionId,actor:ownerA
    });
    expect(preview.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("unverified");
    expect(preview.capability.evidence.every(x=>x.status==="unknown")).toBe(true);
    expect(preview.capability.tenantSendingEnabled).toBe(false);
  });

  it("never inherits an in-flight old owner proof completed after a same-app transfer",async()=>{
    const original=await claim(workspaceA,ownerA,"telegram","9001");
    await registry!.requestDisconnect({
      workspaceId:workspaceA,connectionId:original.connectionId,actor:ownerA
    });
    // Simulate completed provider revocation ONLY inside disposable PG17.
    await db!.query("UPDATE public.ishikeit_account_connections "+
      "SET status='disconnected',disconnected_at=now(),generation=generation+1 "+
      "WHERE connection_id=$1 AND workspace_id=$2 AND status='disconnecting'",
      [original.connectionId,workspaceA]);
    const replacement=await claim(workspaceB,ownerB,"telegram","9001");
    // An old callback started before transfer but completed AFTER relink.
    // The observation and recording times are later than new claim creation.
    await new Promise<void>((resolve)=>setTimeout(resolve,20));
    const completedAt=new Date().toISOString();
    await facts!.record([
      {...scoped(original.connectionId,observed("telegram.business_connection","9001")),
        observedAt:completedAt,
        validUntil:new Date(Date.now()+300000).toISOString()},
      {...scoped(original.connectionId,observed("telegram.rights.can_reply","9001")),
        observedAt:completedAt,
        validUntil:new Date(Date.now()+300000).toISOString()}
    ]);
    const preview=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceB,connectionId:replacement.connectionId,actor:ownerB
    });
    expect(preview.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("unverified");
    expect(preview.capability.evidence.every(x=>x.status==="unknown")).toBe(true);
    expect(preview.capability.tenantSendingEnabled).toBe(false);
  });

  it("never presents a different OAuth application's cached grants as current permissions",async()=>{
    const connection=await claim(workspaceA,ownerA,"telegram","9001");
    await facts!.record([
      {...scoped(connection.connectionId,observed("telegram.business_connection","9001")),
        providerApplicationKey:"different-telegram-bot"},
      {...scoped(connection.connectionId,observed("telegram.rights.can_reply","9001")),
        providerApplicationKey:"different-telegram-bot"}
    ]);
    const unrelated=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:connection.connectionId,actor:ownerA
    });
    expect(unrelated.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("unverified");
    expect(unrelated.capability.evidence.every(x=>x.status==="unknown")).toBe(true);

    await facts!.record([
      {...scoped(connection.connectionId,observed("telegram.business_connection","9001")),
        providerApplicationKey:"native-capability-test-app"},
      {...scoped(connection.connectionId,observed("telegram.rights.can_reply","9001")),
        providerApplicationKey:"native-capability-test-app"}
    ]);
    const authorized=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:connection.connectionId,actor:ownerA
    });
    expect(authorized.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("available");
    expect(authorized.capability.tenantSendingEnabled).toBe(false);
    await facts!.record([
      {...scoped(connection.connectionId,observed("telegram.rights.can_reply","9001","telegram","denied",1000)),
        providerApplicationKey:"different-telegram-bot"}
    ]);
    const preserved=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:connection.connectionId,actor:ownerA
    });
    expect(preserved.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("available");
  });

  it("rejects revoked owner and unrelated viewer even with current facts",async()=>{
    const conn=await claim(workspaceA,ownerA,"telegram","9001");
    await registry!.addMember({workspaceId:workspaceA,actor:ownerA,
      member:viewer,role:"viewer"});
    await expect(registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:conn.connectionId,actor:viewer
    })).rejects.toThrow(/authorization denied/i);
    await db!.query(`UPDATE public.ishikeit_workspace_memberships
      SET state='revoked' WHERE workspace_id=$1 AND auth_subject=$2`,
      [workspaceA,ownerA.subject]);
    await expect(registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:conn.connectionId,actor:ownerA
    })).rejects.toThrow(/authorization denied/i);
  });
});