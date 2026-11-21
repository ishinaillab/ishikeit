import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {beforeAll,afterAll,beforeEach,describe,expect,it} from "vitest";
import {PostgresDatabase} from "../src/persistence/postgres.js";
import {PostgresWorkspaceConnectionIntents} from "../src/persistence/workspace-connection-intents.js";
import {PostgresWorkspaceConnectionRegistry,type WorkspacePrincipal} from "../src/persistence/workspace-connections.js";
import {PostgresOAuthCredentialStore} from "../src/auth/oauth-store.js";
import {CredentialCipher} from "../src/auth/credential-cipher.js";

/** Disposable PostgreSQL 17 CI only. NEVER use production or a remote host. */
const uri=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(uri!==undefined){
  const u=new URL(uri);
  if(!["postgres:","postgresql:"].includes(u.protocol) ||
     !["localhost","127.0.0.1","::1"].includes(u.hostname) ||
     u.pathname!=="/ishikeit_outbox_test")
    throw Error("Refuse native tenant grant tests outside disposable PG17");
}
const db=uri===undefined?undefined:new PostgresDatabase(uri);
const intents=db===undefined?undefined:new PostgresWorkspaceConnectionIntents(db);
const registry=db===undefined?undefined:new PostgresWorkspaceConnectionRegistry(db);
const vault=db===undefined?undefined:new PostgresOAuthCredentialStore(
  db,new CredentialCipher(Buffer.alloc(32,0x41))
);
const ownerA:WorkspacePrincipal={issuer:"synthetic-issuer",subject:"owner-A"};
const ownerB:WorkspacePrincipal={issuer:"synthetic-issuer",subject:"owner-B"};
const appKey="instagram-login-1042452472116584";
let workspaceA="",workspaceB="";
const expiry=()=>new Date(Date.now()+86400000);
const proof=(accountId:string)=>({
  provider:"instagram",accountId,source:"oauth_grant" as const,
  sourceReference:appKey,verifiedAt:new Date().toISOString()
});
async function intent(workspaceId:string,actor:WorkspacePrincipal){
  const sessionId=randomUUID();
  const req={
    workspaceId,actor,sessionId,provider:"instagram",
    providerApplicationKey:appKey,
    redirectUri:"https://apps.ishinaillab.com/app/auth/connect/instagram/callback"
  };
  const start=await intents!.begin(req);
  const result=await intents!.consume({
    ...req,state:start.state,browserNonce:start.browserNonce
  });
  if(result===undefined)throw Error("Expected synthetic intent consume");
  return {intentId:result.intentId,sessionId:result.sessionId};
}
function credential(accountId:string){
  return {
    provider:"workspace-instagram",accountId,
    accessToken:"sensitive-tenant-token-"+accountId,
    scopes:["instagram_business_basic","instagram_business_manage_messages"],
    accessExpiresAt:expiry()
  };
}
async function link(
  workspaceId:string,actor:WorkspacePrincipal,accountId:string,
  failWriter=false
){
  const gate=await intent(workspaceId,actor);
  const connectionId=randomUUID();
  const input={
    ...gate,connectionId,workspaceId,actor,
    credentialAccountId:connectionId,providerApplicationKey:appKey,
    proof:proof(accountId)
  };
  if(failWriter)return {connectionId,gate,input};
  const linked=await registry!.linkVerified(input,async tx=>{
    await vault!.putInTransaction(tx,credential(connectionId));
  });
  return {connectionId,gate,input,linked};
}
describe.skipIf(db===undefined)("native Instagram grant custody under disposable PG17",()=>{
  beforeAll(async()=>{
    for(const m of [
      "0010_ishikeit_workspace_connections.sql",
      "0011_ishikeit_connection_intents.sql",
      "0013_ishikeit_intent_auth_session.sql",
      "0022_workspace_connection_intent_claims.sql"
    ])await db!.query(await readFile("migrations/"+m,"utf8"));
    await db!.query(`
      CREATE TABLE public.oauth_credentials(
        provider text NOT NULL,account_id text NOT NULL,
        access_token_ciphertext bytea NOT NULL,access_token_iv bytea NOT NULL,
        access_token_tag bytea NOT NULL,refresh_token_ciphertext bytea,
        refresh_token_iv bytea,refresh_token_tag bytea,
        scopes text[] NOT NULL DEFAULT '{}',access_expires_at timestamptz,
        refresh_expires_at timestamptz,token_version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(provider,account_id)
      );
      CREATE TABLE public.oauth_revocations(
        provider text NOT NULL,account_id text NOT NULL,
        reason text NOT NULL,revoked_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(provider,account_id)
      );
    `);
  });
  beforeEach(async()=>{
    await db!.query(`TRUNCATE TABLE
      public.ishikeit_connection_intents,public.ishikeit_connection_audit,
      public.ishikeit_account_connections,public.ishikeit_provider_accounts,
      public.ishikeit_workspace_memberships,public.ishikeit_workspaces`);
    await db!.query("TRUNCATE TABLE public.oauth_credentials,public.oauth_revocations");
    workspaceA=randomUUID();workspaceB=randomUUID();
    await registry!.createWorkspace({workspaceId:workspaceA,name:"A",owner:ownerA});
    await registry!.createWorkspace({workspaceId:workspaceB,name:"B",owner:ownerB});
  });
  afterAll(async()=>{
    try{
      await db!.query("DROP TABLE IF EXISTS public.oauth_revocations,public.oauth_credentials");
      await db!.query(`DROP TABLE IF EXISTS
        public.ishikeit_connection_intents,public.ishikeit_connection_audit,
        public.ishikeit_account_connections,public.ishikeit_provider_accounts,
        public.ishikeit_workspace_memberships,public.ishikeit_workspaces`);
    }finally{await db!.close();}
  });

  it("atomically links separately encrypted per-connection grants across two workspaces",async()=>{
    const a=await link(workspaceA,ownerA,"17841438662359631");
    const b=await link(workspaceB,ownerB,"17841438662359632");
    if(a.linked===undefined||b.linked===undefined)throw Error("Fixture failed to link");
    expect(a.linked.status).toBe("verifying");
    expect(b.linked.status).toBe("verifying");
    expect((await registry!.activeProviderAccount("instagram","17841438662359631")))
      .toBeUndefined();
    const creds=await db!.query<{provider:string;account_id:string;plaintext:string}>(
      "SELECT provider,account_id,encode(access_token_ciphertext,'hex') AS plaintext FROM public.oauth_credentials"
    );
    expect(creds.rows).toHaveLength(2);
    expect(creds.rows.every(x=>x.provider==="workspace-instagram")).toBe(true);
    for(const row of creds.rows){
      expect(row.plaintext).not.toContain("sensitive-tenant-token");
      expect((await vault!.get(row.provider,row.account_id))?.accessToken)
        .toBe("sensitive-tenant-token-"+row.account_id);
    }
    expect(await registry!.findForAdministrator({
      workspaceId:workspaceA,connectionId:b.connectionId,actor:ownerA
    })).toBeUndefined();
    await expect(registry!.findForAdministrator({
      workspaceId:workspaceA,connectionId:a.connectionId,actor:ownerB
    })).rejects.toThrow(/authorization denied/i);
    expect((await db!.query("SELECT * FROM public.ishikeit_connection_intents WHERE claimed_connection_id IS NOT NULL")).rowCount)
      .toBe(2);
  });

  it("rolls back connection, credential, intent claim and audit when encryption writer fails",async()=>{
    const pending=await link(workspaceA,ownerA,"17841438662359631",true);
    await expect(registry!.linkVerified(pending.input,async tx=>{
      await vault!.putInTransaction(tx,credential(pending.connectionId));
      throw Error("synthetic failed grant commit");
    })).rejects.toThrow(/synthetic failed grant commit/);
    expect((await db!.query("SELECT 1 FROM public.oauth_credentials")).rowCount).toBe(0);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount).toBe(0);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_connection_audit")).rowCount).toBe(0);
    const row=await db!.query<{claimed_connection_id:string|null}>(
      "SELECT claimed_connection_id FROM public.ishikeit_connection_intents WHERE intent_id=$1",
      [pending.gate.intentId]);
    expect(row.rows[0]?.claimed_connection_id).toBeNull();
    await registry!.linkVerified(pending.input,tx=>
      vault!.putInTransaction(tx,credential(pending.connectionId))
    );
    expect((await db!.query("SELECT 1 FROM public.oauth_credentials")).rowCount).toBe(1);
  });

  it("foreign workspace cannot take already claimed immutable account and cannot store its token",async()=>{
    await link(workspaceA,ownerA,"17841438662359631");
    const foreignAttempt=await link(workspaceB,ownerB,"17841438662359631",true);
    await expect(registry!.linkVerified(foreignAttempt.input,tx=>
      vault!.putInTransaction(tx,credential(foreignAttempt.connectionId))
    )).rejects.toThrow();
    expect(await vault!.get("workspace-instagram",foreignAttempt.connectionId)).toBeUndefined();
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount).toBe(1);
  });

  it("denies any global tenant-token listing or legacy upsert path",async()=>{
    const linked=await link(workspaceA,ownerA,"17841438662359631");
    await expect(vault!.latest("workspace-instagram")).rejects.toThrow(/exact authorized connection scope/);
    await expect(vault!.list("workspace-instagram")).rejects.toThrow(/exact authorized connection scope/);
    await expect(vault!.put(credential(randomUUID()))).rejects.toThrow(/exact authorized connection scope/);
    expect((await db!.query("SELECT 1 FROM public.oauth_credentials")).rowCount).toBe(1);
    expect(await vault!.get("workspace-instagram",linked.connectionId))
      .toMatchObject({accountId:linked.connectionId});
  });

  it("binds WhatsApp phone and Messaging account in encrypted tenant grant and rejects takeover",async()=>{
    const app="meta-wa-v4-1042452472116584-123456789012345";
    const phoneId="123456789012345";
    const messagingAccountId="987654321098765";
    async function whIntent(workspaceId:string,actor:WorkspacePrincipal){
      const sessionId=randomUUID();
      const request={workspaceId,actor,sessionId,provider:"whatsapp",
        providerApplicationKey:app,
        redirectUri:"https://apps.ishinaillab.com/app/auth/connect/whatsapp/embedded-v4"};
      const started=await intents!.begin(request);
      const used=await intents!.consume({...request,
        state:started.state,browserNonce:started.browserNonce});
      if(!used)throw Error("Expected WhatsApp owner intent");
      return {intentId:used.intentId,sessionId};
    }
    const first=await whIntent(workspaceA,ownerA);
    const connectionId=randomUUID();
    const sensitiveToken="whatsapp-business-grant-"+randomUUID();
    const grant={provider:"workspace-whatsapp",accountId:connectionId,
      accessToken:sensitiveToken,
      scopes:["whatsapp_business_management","whatsapp_business_messaging"],
      accessExpiresAt:expiry()};
    const claim={...first,connectionId,workspaceId:workspaceA,actor:ownerA,
      providerApplicationKey:app,providerConnectionId:messagingAccountId,
      credentialAccountId:connectionId,
      proof:{provider:"whatsapp",accountId:phoneId,
        source:"oauth_grant" as const,sourceReference:app,
        verifiedAt:new Date().toISOString()}
    };
    const record=await registry!.linkVerified(claim,tx=>
      vault!.putInTransaction(tx,grant));
    expect(record.status).toBe("verifying");
    const read=await registry!.findBindingForAdministrator({
      workspaceId:workspaceA,connectionId,actor:ownerA});
    expect(read).toMatchObject({
      provider:"whatsapp",accountId:phoneId,status:"verifying",
      providerConnectionId:messagingAccountId,providerApplicationKey:app,
      credentialAccountId:connectionId
    });
    const encrypted=await db!.query<{encoded:string}>(
      "SELECT encode(access_token_ciphertext,'hex') AS encoded FROM public.oauth_credentials");
    expect(encrypted.rows).toHaveLength(1);
    expect(encrypted.rows[0]?.encoded).not.toContain(sensitiveToken);
    expect((await vault!.get("workspace-whatsapp",connectionId))?.accessToken)
      .toBe(sensitiveToken);
    await expect(vault!.list("workspace-whatsapp")).rejects.toThrow(
      /exact authorized connection scope/);
    await expect(vault!.put(grant)).rejects.toThrow(
      /exact authorized connection scope/);
    expect(await registry!.findBindingForAdministrator({
      workspaceId:workspaceB,connectionId,actor:ownerB
    })).toBeUndefined();
    const second=await whIntent(workspaceB,ownerB);
    const otherConnection=randomUUID();
    await expect(registry!.linkVerified({
      ...claim,...second,connectionId:otherConnection,workspaceId:workspaceB,
      actor:ownerB,credentialAccountId:otherConnection,
      providerConnectionId:"111111111111111",
      proof:{...claim.proof,verifiedAt:new Date().toISOString()}
    },tx=>vault!.putInTransaction(tx,{
      ...grant,accountId:otherConnection
    }))).rejects.toThrow();
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount).toBe(1);
    expect(await vault!.get("workspace-whatsapp",otherConnection)).toBeUndefined();
  });

  it("keeps Messenger Page grant encrypted and unique across foreign workspaces",async()=>{
    const accountId="987654321098765",applicationKey="meta-messenger-1042452472116584";
    const redirectUri="https://apps.ishinaillab.com/app/auth/connect/messenger/callback";
    async function messengerIntent(workspaceId:string,actor:WorkspacePrincipal){
      const sessionId=randomUUID();
      const request={workspaceId,actor,sessionId,provider:"messenger",
        providerApplicationKey:applicationKey,redirectUri};
      const started=await intents!.begin(request);
      const consumed=await intents!.consume({...request,
        state:started.state,browserNonce:started.browserNonce});
      if(!consumed)throw Error("Expected owner Page claim intent");
      return {intentId:consumed.intentId,sessionId};
    }
    const sessionA=await messengerIntent(workspaceA,ownerA);
    const connectionA=randomUUID();
    const metaCredential={provider:"workspace-messenger",accountId:connectionA,
      accessToken:"confidential-messenger-page-"+connectionA,
      scopes:["pages_show_list","pages_manage_metadata","pages_messaging",
        "pages_read_engagement","business_management"],accessExpiresAt:expiry()};
    const claim={
      ...sessionA,connectionId:connectionA,workspaceId:workspaceA,actor:ownerA,
      credentialAccountId:connectionA,providerApplicationKey:applicationKey,
      proof:{provider:"messenger",accountId,source:"oauth_grant" as const,
        sourceReference:applicationKey,verifiedAt:new Date().toISOString()}
    };
    const linked=await registry!.linkVerified(claim,tx=>
      vault!.putInTransaction(tx,metaCredential));
    expect(linked.status).toBe("verifying");
    const rows=await db!.query<{provider:string;encoded:string}>(
      "SELECT provider,encode(access_token_ciphertext,'hex') AS encoded FROM public.oauth_credentials");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.provider).toBe("workspace-messenger");
    expect(rows.rows[0]?.encoded).not.toContain("confidential-messenger-page");
    expect((await vault!.get("workspace-messenger",connectionA))?.accessToken)
      .toBe(metaCredential.accessToken);
    await expect(vault!.list("workspace-messenger"))
      .rejects.toThrow(/exact authorized connection scope/);
    await expect(vault!.put(metaCredential))
      .rejects.toThrow(/exact authorized connection scope/);
    expect(await registry!.findForAdministrator({
      workspaceId:workspaceB,connectionId:connectionA,actor:ownerB
    })).toBeUndefined();
    const sessionB=await messengerIntent(workspaceB,ownerB);
    const otherId=randomUUID();
    await expect(registry!.linkVerified({
      ...sessionB,connectionId:otherId,workspaceId:workspaceB,actor:ownerB,
      credentialAccountId:otherId,providerApplicationKey:applicationKey,
      proof:{...claim.proof,verifiedAt:new Date().toISOString()}
    },tx=>vault!.putInTransaction(tx,{
      ...metaCredential,accountId:otherId
    }))).rejects.toThrow();
    expect(await vault!.get("workspace-messenger",otherId)).toBeUndefined();
    expect((await db!.query("SELECT 1 FROM public.ishikeit_account_connections")).rowCount).toBe(1);
  });

  it("isolates TikTok account-holder grants atomically without legacy token overwrite or cross-tenant claims",async()=>{
    const clientApp="tiktok-holder-987654321";
    async function linkTikTok(workspaceId:string,actor:WorkspacePrincipal,account:string){
      const authSessionId=randomUUID(),connectionId=randomUUID();
      const request={workspaceId,actor,sessionId:authSessionId,
        provider:"tiktok",providerApplicationKey:clientApp,
        redirectUri:"https://apps.ishinaillab.com/app/auth/connect/tiktok/callback/"};
      const created=await intents!.begin(request);
      const claim=await intents!.consume({...request,
        state:created.state,browserNonce:created.browserNonce});
      if(claim===undefined)throw Error("TikTok simulated owner grant not consumed");
      return registry!.linkVerified({
        workspaceId,actor,connectionId,
        intentId:claim.intentId,sessionId:authSessionId,
        providerApplicationKey:clientApp,credentialAccountId:connectionId,
        proof:{provider:"tiktok",accountId:account,source:"oauth_grant",
          sourceReference:clientApp,verifiedAt:new Date().toISOString()}
      },tx=>vault!.putInTransaction(tx,{
        provider:"workspace-tiktok",accountId:connectionId,
        accessToken:"tenant-tiktok-private-"+connectionId,
        refreshToken:"refresh-"+connectionId,
        scopes:["biz.manage"],accessExpiresAt:expiry(),
        refreshExpiresAt:new Date(Date.now()+31536000000)
      }));
    }
    const first=await linkTikTok(workspaceA,ownerA,"tiktok-owner-a");
    const second=await linkTikTok(workspaceB,ownerB,"tiktok-owner-b");
    expect(first.status).toBe("verifying");
    expect(second.status).toBe("verifying");
    const rows=await db!.query<{provider:string;account_id:string;ciphertext:string}>(
      "SELECT provider,account_id,encode(access_token_ciphertext,'hex') AS ciphertext FROM public.oauth_credentials"
    );
    expect(rows.rows).toHaveLength(2);
    for(const row of rows.rows){
      expect(row.provider).toBe("workspace-tiktok");
      expect(row.ciphertext).not.toContain("tenant-tiktok-private");
      expect((await vault!.get(row.provider,row.account_id))?.accessToken)
        .toBe("tenant-tiktok-private-"+row.account_id);
    }
    await expect(vault!.latest("workspace-tiktok")).rejects.toThrow(/scope/);
    await expect(vault!.list("workspace-tiktok")).rejects.toThrow(/scope/);
    await expect(vault!.put({
      provider:"workspace-tiktok",accountId:randomUUID(),
      accessToken:"unsafe",scopes:["biz.manage"]
    })).rejects.toThrow(/scope/);
    await expect(linkTikTok(workspaceB,ownerB,"tiktok-owner-a")).rejects.toThrow();
    expect((await db!.query(
      "SELECT count(*)::integer AS n FROM public.oauth_credentials"
    )).rows[0]?.n).toBe(2);
    expect(await registry!.findForAdministrator({
      workspaceId:workspaceA,connectionId:second.connectionId,actor:ownerA
    })).toBeUndefined();
  });

  it("rejects any writer attempt to store credentials in existing legacy provider namespace",async()=>{
    await expect(db!.transaction(tx=>vault!.putInTransaction(tx,{
      ...credential(randomUUID()),provider:"instagram"
    }))).rejects.toThrow(/isolated namespace/);
    expect((await db!.query("SELECT 1 FROM public.oauth_credentials")).rowCount).toBe(0);
  });
});
