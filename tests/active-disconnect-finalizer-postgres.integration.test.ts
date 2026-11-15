import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {beforeAll,afterAll,beforeEach,describe,expect,it} from "vitest";
import {PostgresDatabase} from "../src/persistence/postgres.js";
import {PostgresActiveDisconnectHold} from "../src/persistence/active-disconnect.js";
import {PostgresActiveDisconnectFinalizer,
  type ProviderDisconnectBinding,type ProviderDisconnectVerification} from
  "../src/persistence/active-disconnect-finalizer.js";

const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(url!==undefined){
  const parsed=new URL(url);
  if(!["postgres:","postgresql:"].includes(parsed.protocol)||
     !["127.0.0.1","localhost","::1"].includes(parsed.hostname)||
     parsed.pathname!=="/ishikeit_outbox_test")
    throw Error("Refusing finalizer tests outside disposable localhost PostgreSQL17");
}
const db=url===undefined?undefined:new PostgresDatabase(url);
const hold=db&&new PostgresActiveDisconnectHold(db);
const actor={issuer:"offline-verified-test-issuer",subject:"owner-one"};
let workspaceA:string,workspaceB:string;
function proof(
  b:ProviderDisconnectBinding,method:ProviderDisconnectVerification["method"]
):ProviderDisconnectVerification{
  return {
    disconnected:true,provider:b.provider,providerAccountId:b.providerAccountId,
    providerApplicationKey:b.providerApplicationKey,
    providerConnectionId:b.providerConnectionId,
    method,observedAt:new Date().toISOString()
  };
}
async function connection(
  provider:string,account:string,workspace?:string,
  options?:{providerConnectionId?:string;credentialAccountId?:string|null}
):Promise<string>{
  const id=randomUUID(),ws=workspace??workspaceA;
  await db!.query(
    `INSERT INTO public.ishikeit_provider_accounts
      (provider,provider_account_id,verification_source,verification_reference,verified_at)
     VALUES($1,$2,'provider_api','verified-native-test-owner',now())`,
    [provider,account]);
  const credential=options?.credentialAccountId===undefined
    ?(provider==="telegram"?null:id):options.credentialAccountId;
  await db!.query(
    `INSERT INTO public.ishikeit_account_connections
      (connection_id,workspace_id,provider,provider_account_id,
       provider_application_key,provider_connection_id,credential_account_id,
       status,generation,activated_at)
     VALUES($1,$2,$3,$4,'native-test-app',$5,$6,'connected',2,now())`,
    [id,ws,provider,account,options?.providerConnectionId??null,credential]);
  return id;
}
async function requested(connectionId:string){
  return hold!.request({workspaceId:workspaceA,connectionId,actor});
}
describe.skipIf(db===undefined)("Priority 3 verified active disconnect finalization (disposable PostgreSQL17)",()=>{
  beforeAll(async()=>{
    for(const name of [
      "0001_foundation.sql",
      "0010_ishikeit_workspace_connections.sql",
      "0012_ishikeit_event_tenant_provenance.sql"
    ])await db!.query(await readFile("migrations/"+name,"utf8"));
    await db!.query("ALTER TABLE public.outbox ADD COLUMN meta_send_started_at timestamptz");
    await db!.query(await readFile(
      "migrations/0026_priority3_active_disconnect_quarantine.sql","utf8"));
    await db!.query(await readFile(
      "migrations/0027_priority3_tenant_send_generation_fence.sql","utf8"));
    await db!.query(`CREATE TABLE public.oauth_credentials (
      provider text NOT NULL,account_id text NOT NULL,
      access_token_ciphertext bytea NOT NULL DEFAULT decode('01','hex'),
      PRIMARY KEY(provider,account_id)
    )`);
    await db!.query(`CREATE TABLE public.oauth_revocations(
      provider text NOT NULL,account_id text NOT NULL,reason text NOT NULL,
      revoked_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(provider,account_id)
    )`);
  });
  beforeEach(async()=>{
    await db!.query("TRUNCATE public.oauth_credentials,public.oauth_revocations");
    await db!.query(
      `TRUNCATE public.outbox,public.inbound_events,
        public.ishikeit_active_disconnect_cleanup,
        public.ishikeit_connection_audit,public.ishikeit_account_connections,
        public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
        public.ishikeit_workspaces CASCADE`);
    workspaceA=randomUUID();workspaceB=randomUUID();
    await db!.query(
      "INSERT INTO public.ishikeit_workspaces(workspace_id,display_name) VALUES($1,'A'),($2,'B')",
      [workspaceA,workspaceB]);
    await db!.query(
      `INSERT INTO public.ishikeit_workspace_memberships
       (workspace_id,auth_issuer,auth_subject,role)
       VALUES($1,$3,$4,'owner'),($2,$3,'other-owner','owner')`,
      [workspaceA,workspaceB,actor.issuer,actor.subject]);
  });
  afterAll(async()=>{
    try{
      await db!.query("DROP TABLE IF EXISTS public.oauth_revocations,public.oauth_credentials");
      await db!.query(
        `DROP TABLE IF EXISTS public.ishikeit_active_disconnect_cleanup,
         public.outbox,public.inbound_events,public.ishikeit_connection_audit,
         public.ishikeit_account_connections,public.ishikeit_provider_accounts,
         public.ishikeit_workspace_memberships,public.ishikeit_workspaces CASCADE`);
    }finally{await db!.close();}
  });

  it("accepts only exact fresh Telegram Business disabled readback; finalizes once and frees claim",async()=>{
    const id=await connection("telegram","telegram-owner-A",undefined,{
      providerConnectionId:"business-A"});
    const frozen=await requested(id);
    let checked=0;
    const finalizer=new PostgresActiveDisconnectFinalizer(db!,{
      verifyDisconnected:b=>{
        checked++;
        expect(b).toMatchObject({
          provider:"telegram",providerAccountId:"telegram-owner-A",
          providerConnectionId:"business-A",frozenGeneration:frozen.frozenGeneration
        });
        return Promise.resolve(proof(b,"telegram_business_disabled"));
      }
    });
    const input={workspaceId:workspaceA,connectionId:id,
      frozenGeneration:frozen.frozenGeneration};
    const done=await finalizer.finalize(input);
    expect(done).toMatchObject({
      disconnectedGeneration:4,method:"telegram_business_disabled"
    });
    expect(await finalizer.finalize(input)).toEqual(done);
    expect(checked).toBe(1);
    expect((await db!.query(
      "SELECT status,generation,disconnected_at FROM public.ishikeit_account_connections WHERE connection_id=$1",
      [id])).rows[0]).toMatchObject({status:"disconnected",generation:"4"});
    expect((await db!.query(
      "SELECT cleanup_state,provider_cleanup_method FROM public.ishikeit_active_disconnect_cleanup WHERE connection_id=$1",
      [id])).rows[0]).toMatchObject({
        cleanup_state:"complete",provider_cleanup_method:"telegram_business_disabled"
    });
    await db!.query(
      `INSERT INTO public.ishikeit_account_connections
        (connection_id,workspace_id,provider,provider_account_id,provider_application_key)
       VALUES($1,$2,'telegram','telegram-owner-A','other-bot')`,
      [randomUUID(),workspaceB]);
  });

  it("deletes the exact native TikTok credential only, preserving legacy and another workspace",async()=>{
    const id=await connection("tiktok","tiktok-openid-A");
    const other=await connection("tiktok","tiktok-openid-B",workspaceB);
    await db!.query(
      `INSERT INTO public.oauth_credentials(provider,account_id)
       VALUES('workspace-tiktok',$1),('workspace-tiktok',$2),('tiktok','legacy-app-subject')`,
      [id,other]);
    const frozen=await requested(id);
    const verifier=new PostgresActiveDisconnectFinalizer(db!,{
      verifyDisconnected:b=>Promise.resolve(proof(b,"tiktok_business_holder_revoked"))
    });
    await verifier.finalize({
      workspaceId:workspaceA,connectionId:id,frozenGeneration:frozen.frozenGeneration
    });
    const rows=await db!.query<{provider:string;account_id:string}>(
      "SELECT provider,account_id FROM public.oauth_credentials ORDER BY provider,account_id");
    expect(rows.rows).toEqual([
      {provider:"tiktok",account_id:"legacy-app-subject"},
      {provider:"workspace-tiktok",account_id:other}
    ]);
    expect((await db!.query(
      "SELECT reason FROM public.oauth_revocations WHERE provider='workspace-tiktok' AND account_id=$1",
      [id])).rows[0]?.reason).toBe("workspace_verified_disconnect");
    expect((await db!.query(
      "SELECT status FROM public.ishikeit_account_connections WHERE connection_id=$1",
      [other])).rows[0]?.status).toBe("connected");
  });

  it("rejects wrong owner/app, stale proof, or provider method without altering claim or token",async()=>{
    const id=await connection("tiktok","tiktok-openid-C");
    await db!.query(
      "INSERT INTO public.oauth_credentials(provider,account_id) VALUES('workspace-tiktok',$1)",
      [id]);
    const frozen=await requested(id);
    const input={workspaceId:workspaceA,connectionId:id,
      frozenGeneration:frozen.frozenGeneration};
    const bad=[
      (b:ProviderDisconnectBinding)=>({...proof(b,"tiktok_business_holder_revoked"),
        providerAccountId:"foreign-owner"}),
      (b:ProviderDisconnectBinding)=>({...proof(b,"tiktok_business_holder_revoked"),
        providerApplicationKey:"wrong-app"}),
      (b:ProviderDisconnectBinding)=>({...proof(b,"tiktok_business_holder_revoked"),
        observedAt:"2020-01-01T00:00:00.000Z"}),
      (b:ProviderDisconnectBinding)=>proof(b,"telegram_business_disabled")
    ];
    for(const fake of bad){
      const gate=new PostgresActiveDisconnectFinalizer(db!,{
        verifyDisconnected:b=>Promise.resolve(fake(b))
      });
      await expect(gate.finalize(input)).rejects.toThrow(/mismatch|fresh/i);
    }
    expect((await db!.query(
      "SELECT status FROM public.ishikeit_account_connections WHERE connection_id=$1",
      [id])).rows[0]?.status).toBe("disconnecting");
    expect((await db!.query(
      "SELECT 1 FROM public.oauth_credentials WHERE provider='workspace-tiktok' AND account_id=$1",
      [id])).rowCount).toBe(1);
  });

  it("never finalizes with in-flight uncertainty or newly reinserted unquarantined tenant work",async()=>{
    const id=await connection("telegram","telegram-owner-D",undefined,{
      providerConnectionId:"business-D"});
    await db!.query(
      `INSERT INTO public.outbox
       (id,topic,partition_key,payload,workspace_id,connection_id,connection_generation,
        lease_token,lease_expires_at)
       VALUES($1,'test','p','{}'::jsonb,$2,$3,2,$4,now()+interval '5 minutes')`,
      [randomUUID(),workspaceA,id,randomUUID()]);
    const frozen=await requested(id);
    let checked=0;
    const gate=new PostgresActiveDisconnectFinalizer(db!,{
      verifyDisconnected:b=>{checked++;return Promise.resolve(proof(b,"telegram_business_disabled"))}
    });
    await expect(gate.finalize({
      workspaceId:workspaceA,connectionId:id,frozenGeneration:frozen.frozenGeneration
    })).rejects.toThrow(/in-flight/i);
    expect(checked).toBe(0);
    const safeId=await connection("telegram","telegram-owner-E",undefined,{
      providerConnectionId:"business-E"});
    const other=await requested(safeId);
    // Simulate a stale producer violating its own generation admission fence.
    await db!.query(
      `INSERT INTO public.outbox
       (id,topic,partition_key,payload,workspace_id,connection_id,connection_generation)
       VALUES($1,'test','p','{}'::jsonb,$2,$3,2)`,
      [randomUUID(),workspaceA,safeId]);
    await expect(gate.finalize({
      workspaceId:workspaceA,connectionId:safeId,frozenGeneration:other.frozenGeneration
    })).rejects.toThrow(/unquarantined/i);
    expect(checked).toBe(1);
  });

  it("rejects unsupported Instagram/WhatsApp readbacks and foreign shared-credential custody",async()=>{
    const insta=await connection("instagram","ig-owner-C");
    const phone=await connection("whatsapp","wa-owner-C");
    let checked=0;
    const arbitrary=new PostgresActiveDisconnectFinalizer(db!,{
      verifyDisconnected:b=>{checked++;return Promise.resolve(proof(b,"meta_page_app_unsubscribed"))}
    });
    for(const id of [insta,phone]){
      const frozen=await requested(id);
      await expect(arbitrary.finalize({
        workspaceId:workspaceA,connectionId:id,frozenGeneration:frozen.frozenGeneration
      })).rejects.toThrow(/no verified safe provider-specific/i);
    }
    expect(checked).toBe(0);
    const shared=await connection("tiktok","tiktok-openid-shared",undefined,{
      credentialAccountId:"legacy-global-token"});
    await db!.query(
      "INSERT INTO public.oauth_credentials(provider,account_id) VALUES('tiktok','legacy-global-token')");
    const holdState=await requested(shared);
    const legit=new PostgresActiveDisconnectFinalizer(db!,{
      verifyDisconnected:b=>Promise.resolve(proof(b,"tiktok_business_holder_revoked"))
    });
    await expect(legit.finalize({
      workspaceId:workspaceA,connectionId:shared,
      frozenGeneration:holdState.frozenGeneration
    })).rejects.toThrow(/shared or foreign/i);
    expect((await db!.query(
      "SELECT 1 FROM public.oauth_credentials WHERE provider='tiktok' AND account_id='legacy-global-token'"
    )).rowCount).toBe(1);
  });
});
