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
    provider,accountId,key,state,
    source:"provider_connection_readback" as const,
    sourceReference:"getBusinessConnection",
    observedAt:start.toISOString(),validUntil:end.toISOString()
  };
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
      public.ishikeit_workspaces,public.provider_account_capability_facts`);
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
        public.provider_account_capability_facts`);
    }finally{await db!.close();}
  });
  it("serves exact live owner account, latest verified Telegram rights and no send permits",async()=>{
    const one=await claim(workspaceA,ownerA,"telegram","9001");
    await facts!.record([
      observed("telegram.business_connection","9001"),
      observed("telegram.rights.can_reply","9001")
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
      observed("telegram.business_connection","9001"),
      observed("telegram.rights.can_reply","9001")
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
      observed("telegram.business_connection","9001"),
      observed("telegram.rights.can_reply","9001")
    ]);
    await facts!.record([
      observed("telegram.rights.can_reply","9001","telegram","denied",60000)
    ]);
    const denied=await registry!.capabilitiesForAdministrator({
      workspaceId:workspaceA,connectionId:conn.connectionId,actor:ownerA
    });
    expect(denied.capability.features.find(x=>x.id==="official_account_replies")
      ?.evidenceStatus).toBe("needs_permission");
    expect(denied.capability.evidence.find(x=>x.key==="telegram.rights.can_reply")
      ?.status).toBe("denied");
    const expired=observed("telegram.rights.can_reply","9001",
      "telegram","denied",100000);
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