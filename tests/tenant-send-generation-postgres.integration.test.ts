import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {beforeAll,beforeEach,afterAll,describe,it,expect} from "vitest";
import {PostgresDatabase} from "../src/persistence/postgres.js";
import {PostgresTenantSendAdmission,type NativeTenantSendPolicy} from "../src/persistence/tenant-send-admission.js";
import {PostgresActiveDisconnectHold} from "../src/persistence/active-disconnect.js";

const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(url!==undefined){
  const p=new URL(url);
  if(!["postgres:","postgresql:"].includes(p.protocol) ||
     !["127.0.0.1","localhost","::1"].includes(p.hostname) ||
     p.pathname!=="/ishikeit_outbox_test")
    throw Error("Refusing send admission tests outside disposable PostgreSQL17");
}
const db=url===undefined?undefined:new PostgresDatabase(url);
const goodPolicy:NativeTenantSendPolicy={authorize:request=>Promise.resolve({
  ...request,allowed:true,observedAt:new Date().toISOString(),
  expiresAt:new Date(Date.now()+20000).toISOString()
})};
const sender=db&&new PostgresTenantSendAdmission(db,goodPolicy);
const disconnect=db&&new PostgresActiveDisconnectHold(db);
let workspaceA:string,workspaceB:string;
const owner={issuer:"verified-test",subject:"owner-A"};
async function linked(account:string,workspace:string,status="connected"){
  const connectionId=randomUUID();
  await db!.query(`INSERT INTO public.ishikeit_provider_accounts
    (provider,provider_account_id,verification_source,verification_reference,verified_at)
    VALUES('telegram',$1,'provider_api','verified-tenant',now())`,[account]);
  await db!.query(`INSERT INTO public.ishikeit_account_connections
    (connection_id,workspace_id,provider,provider_account_id,provider_application_key,
     provider_connection_id,status,generation,activated_at)
    VALUES($1,$2,'telegram',$3,'test-application','test-business-connection-123',$4,2,now())`,
    [connectionId,workspace,account,status]);
  return connectionId;
}
async function linkedMessenger(page:string,workspace:string){
  const connectionId=randomUUID();
  await db!.query(`INSERT INTO public.ishikeit_provider_accounts
    (provider,provider_account_id,verification_source,verification_reference,verified_at)
    VALUES('messenger',$1,'provider_api','synthetic-page-readback',now())`,[page]);
  await db!.query(`INSERT INTO public.ishikeit_account_connections
    (connection_id,workspace_id,provider,provider_account_id,provider_application_key,
     status,generation,activated_at)
    VALUES($1,$2,'messenger',$3,'test-application','connected',2,now())`,
    [connectionId,workspace,page]);
  return connectionId;
}
async function leased(conn:string,workspace:string,generation=2,topic="action.dispatch"){
  const id=randomUUID(),leaseToken=randomUUID();
  const owner=await db!.query<{provider:string;provider_account_id:string;provider_connection_id:string|null}>(
    "SELECT provider,provider_account_id,provider_connection_id FROM public.ishikeit_account_connections WHERE connection_id=$1",
    [conn]
  );
  const account=owner.rows[0];
  if(!account)throw Error("Synthetic connection is missing");
  const payload={
    schemaVersion:1,idempotencyKey:id,provider:account.provider==="messenger"?"meta":"telegram",
    capability:"messaging",operation:"message.send",orderingKey:"test-recipient",
    target:{channel:account.provider==="telegram"?"bot":"messenger",
      accountId:account.provider_account_id,
      recipientId:"synthetic-recipient",
      ...(account.provider==="telegram"
        ?{businessConnectionId:account.provider_connection_id}:{})},
    body:{part:{kind:"text",text:"synthetic-test-only"}}
  };
  await db!.query(`INSERT INTO public.outbox(
    id,topic,partition_key,payload,workspace_id,connection_id,connection_generation,
    lease_token,lease_expires_at)
    VALUES($1,$2,'test-recipient',$7::jsonb,$3,$4,$5,
      $6,clock_timestamp()+interval '5 minutes')`,
    [id,topic,workspace,conn,generation,leaseToken,JSON.stringify(payload)]);
  return {id,leaseToken,payload};
}
function admit(connectionId:string,job:{id:string;leaseToken:string},
  workspaceId=workspaceA,connectionGeneration=2){
  return {
    workspaceId,connectionId,connectionGeneration,
    provider:"telegram",providerApplicationKey:"test-application",
    outboxId:job.id,leaseToken:job.leaseToken
  };
}
describe.skipIf(db===undefined)("Priority 3 native tenant send generation fence (disposable PG17)",()=>{
  beforeAll(async()=>{
    await db!.query(await readFile("migrations/0001_foundation.sql","utf8"));
    await db!.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
    await db!.query(await readFile("migrations/0012_ishikeit_event_tenant_provenance.sql","utf8"));
    await db!.query("ALTER TABLE public.outbox ADD COLUMN meta_send_started_at timestamptz");
    await db!.query(await readFile("migrations/0026_priority3_active_disconnect_quarantine.sql","utf8"));
    await db!.query(await readFile("migrations/0027_priority3_tenant_send_generation_fence.sql","utf8"));
  });
  beforeEach(async()=>{
    await db!.query(`TRUNCATE public.outbox,public.inbound_events,
      public.ishikeit_active_disconnect_cleanup,public.ishikeit_connection_audit,
      public.ishikeit_account_connections,public.ishikeit_provider_accounts,
      public.ishikeit_workspace_memberships,public.ishikeit_workspaces CASCADE`);
    workspaceA=randomUUID();workspaceB=randomUUID();
    await db!.query(`INSERT INTO public.ishikeit_workspaces(workspace_id,display_name)
      VALUES($1,'A'),($2,'B')`,[workspaceA,workspaceB]);
    await db!.query(`INSERT INTO public.ishikeit_workspace_memberships
      (workspace_id,auth_issuer,auth_subject,role)
      VALUES($1,$3,$4,'owner'),($2,$3,'other-owner','owner')`,
      [workspaceA,workspaceB,owner.issuer,owner.subject]);
  });
  afterAll(async()=>{
    try{
      await db!.query(`DROP TABLE IF EXISTS
        public.ishikeit_active_disconnect_cleanup,public.outbox,public.inbound_events,
        public.ishikeit_connection_audit,public.ishikeit_account_connections,
        public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
        public.ishikeit_workspaces CASCADE`);
    }finally{await db!.close();}
  });
  it("arms an exact current-generation leased job once, with durable uncertain-send timestamp",async()=>{
    const connectionId=await linked("tenant-owner-1",workspaceA);
    const job=await leased(connectionId,workspaceA);
    const input=admit(connectionId,job);
    const a=await sender!.armLeasedSend(input);
    expect(a).toMatchObject({
      connectionId,workspaceId:workspaceA,outboxId:job.id,connectionGeneration:2
    });
    expect(Date.now()-Date.parse(a.armedAt)).toBeLessThan(5000);
    expect(a.authorizedAction).toEqual(job.payload);
    expect(a.authorizationDigest).toMatch(/^[a-f0-9]{64}$/u);
    await expect(sender!.armLeasedSend(input)).rejects.toThrow(/generation or lease unavailable/i);
    const stored=await db!.query(
      "SELECT tenant_send_started_at FROM public.outbox WHERE id=$1",[job.id]);
    expect(stored.rows[0]?.tenant_send_started_at).toBeTruthy();
  });
  it("refuses all native sends when no trusted provider authorization service is wired",async()=>{
    const connectionId=await linked("tenant-owner-unwired",workspaceA);
    const job=await leased(connectionId,workspaceA);
    const without=new PostgresTenantSendAdmission(db!);
    await expect(without.armLeasedSend(admit(connectionId,job)))
      .rejects.toThrow(/authorization verifier is not configured/i);
    expect((await db!.query("SELECT tenant_send_started_at FROM public.outbox WHERE id=$1",
      [job.id])).rows[0]?.tenant_send_started_at).toBeNull();
  });
  it("rejects swapped, stale, long-lived and unauthorizing provider readbacks",async()=>{
    const connectionId=await linked("tenant-owner-rights",workspaceA);
    const job=await leased(connectionId,workspaceA);
    const policies:NativeTenantSendPolicy[]=[
      {authorize:r=>Promise.resolve({...r,allowed:true,
        providerAccountId:"other-tenant",observedAt:new Date().toISOString(),
        expiresAt:new Date(Date.now()+20000).toISOString()})},
      {authorize:r=>Promise.resolve({...r,allowed:true,
        observedAt:new Date(Date.now()-60000).toISOString(),
        expiresAt:new Date(Date.now()+20000).toISOString()})},
      {authorize:r=>Promise.resolve({...r,allowed:true,
        observedAt:new Date().toISOString(),
        expiresAt:new Date(Date.now()+90000).toISOString()})},
      {authorize:r=>Promise.resolve({...r,allowed:false as true,
        observedAt:new Date().toISOString(),
        expiresAt:new Date(Date.now()+20000).toISOString()})}
    ];
    for(const policy of policies){
      await expect(new PostgresTenantSendAdmission(db!,policy)
        .armLeasedSend(admit(connectionId,job))).rejects.toThrow();
      expect((await db!.query("SELECT tenant_send_started_at FROM public.outbox WHERE id=$1",
        [job.id])).rows[0]?.tenant_send_started_at).toBeNull();
    }
  });
  it("rechecks exact database payload after outside-transaction rights readback",async()=>{
    const connectionId=await linked("tenant-owner-race",workspaceA);
    const job=await leased(connectionId,workspaceA);
    let allow!:()=>void;
    let read!:()=>void;
    const readbackStarted=new Promise<void>(resolve=>{read=resolve;});
    const readbackAllowed=new Promise<void>(resolve=>{allow=resolve;});
    const blocker:NativeTenantSendPolicy={
      authorize:async request=>{
        read();
        await readbackAllowed;
        return goodPolicy.authorize(request);
      }
    };
    const attempt=new PostgresTenantSendAdmission(db!,blocker)
      .armLeasedSend(admit(connectionId,job));
    await readbackStarted;
    // Prove no SQL lock is held across the external readback.
    await db!.query("UPDATE public.outbox SET payload=jsonb_set(payload,'{body,part,text}',to_jsonb($2::text)) WHERE id=$1",
      [job.id,"changed-after-permission-check"]);
    allow();
    await expect(attempt).rejects.toThrow(/action changed/i);
    expect((await db!.query("SELECT tenant_send_started_at FROM public.outbox WHERE id=$1",
      [job.id])).rows[0]?.tenant_send_started_at).toBeNull();
  });
  it("rejects a current provider rights proof after the owner freezes the connection",async()=>{
    const connectionId=await linked("tenant-owner-race-freeze",workspaceA);
    const job=await leased(connectionId,workspaceA);
    let allow!:()=>void;
    let read!:()=>void;
    const readbackStarted=new Promise<void>(resolve=>{read=resolve;});
    const readbackAllowed=new Promise<void>(resolve=>{allow=resolve;});
    const blocker:NativeTenantSendPolicy={
      authorize:async request=>{
        read();
        await readbackAllowed;
        return goodPolicy.authorize(request);
      }
    };
    const attempt=new PostgresTenantSendAdmission(db!,blocker)
      .armLeasedSend(admit(connectionId,job));
    await readbackStarted;
    const frozen=await disconnect!.request({
      workspaceId:workspaceA,connectionId,actor:owner});
    expect(frozen.frozenGeneration).toBe(3);
    allow();
    await expect(attempt).rejects.toThrow(/generation or lease unavailable/i);
    expect((await db!.query(
      "SELECT status FROM public.ishikeit_account_connections WHERE connection_id=$1",
      [connectionId])).rows[0]?.status).toBe("disconnecting");
  });
  it("rejects wrong generation, workspace, app, provider, lease and topic without marking sends",async()=>{
    const connectionId=await linked("tenant-owner-2",workspaceA);
    const job=await leased(connectionId,workspaceA);
    const base=admit(connectionId,job);
    const wrong=[
      {...base,connectionGeneration:3},
      {...base,workspaceId:workspaceB},
      {...base,providerApplicationKey:"other-application"},
      {...base,provider:"instagram"},
      {...base,leaseToken:randomUUID()},
      {...base,connectionId:randomUUID()}
    ];
    const other=await leased(connectionId,workspaceA,2,"inbound.accepted");
    wrong.push(admit(connectionId,other));
    for(const i of wrong)
      await expect(sender!.armLeasedSend(i)).rejects.toThrow(/unavailable/i);
    expect((await db!.query(
      "SELECT tenant_send_started_at FROM public.outbox WHERE id=$1",
      [job.id])).rows[0]?.tenant_send_started_at).toBeNull();
  });
  it("refuses tenant payload substitution despite a valid native account and job lease",async()=>{
    const connectionId=await linked("tenant-owner-payload",workspaceA);
    const variants=[
      (p:Record<string,unknown>)=>({...p,provider:"meta"}),
      (p:Record<string,unknown>)=>({...p,capability:"marketing"}),
      (p:Record<string,unknown>)=>({...p,operation:"message.template.send"}),
      (p:Record<string,unknown>)=>({...p,orderingKey:"other-conversation"}),
      (p:Record<string,unknown>)=>({...p,
        target:{...(p["target"] as object),accountId:"foreign-account"}}),
      (p:Record<string,unknown>)=>({...p,
        target:{...(p["target"] as object),channel:"instagram"}}),
      (p:Record<string,unknown>)=>({...p,
        target:{...(p["target"] as object),recipientId:""}}),
      (p:Record<string,unknown>)=>({...p,
        target:{...(p["target"] as object),businessConnectionId:"foreign-connection"}}),
      (p:Record<string,unknown>)=>({...p,body:{part:{kind:"unknown"}}}),
      (p:Record<string,unknown>)=>({...p,target:{
        ...(p["target"] as object),crossAccountOverride:"other-user"
      }}),
      ()=>({schemaVersion:1})
    ];
    for(const mutate of variants){
      const job=await leased(connectionId,workspaceA);
      await db!.query("UPDATE public.outbox SET payload=$2::jsonb WHERE id=$1",
        [job.id,JSON.stringify(mutate(job.payload))]);
      await expect(sender!.armLeasedSend(admit(connectionId,job)))
        .rejects.toThrow(/payload provenance|business connection identity/);
      expect((await db!.query(
        "SELECT tenant_send_started_at FROM public.outbox WHERE id=$1",[job.id]
      )).rows[0]?.tenant_send_started_at).toBeNull();
    }
  });

  it("accepts only the matching Messenger Page and Meta provider for that tenant",async()=>{
    const page="987654321098765";
    const connectionId=await linkedMessenger(page,workspaceA);
    const job=await leased(connectionId,workspaceA);
    const trusted={...admit(connectionId,job),provider:"messenger"};
    const admitted=await sender!.armLeasedSend(trusted);
    expect(admitted).toMatchObject({
      workspaceId:workspaceA,connectionId,outboxId:job.id
    });
    const other=await leased(connectionId,workspaceA);
    await expect(sender!.armLeasedSend({
      ...admit(connectionId,other),provider:"telegram"
    })).rejects.toThrow(/unavailable/);
    const foreign=await leased(connectionId,workspaceA);
    await db!.query(
      `UPDATE public.outbox SET payload=jsonb_set(payload,'{target,accountId}',to_jsonb($2::text)) WHERE id=$1`,
      [foreign.id,"other-page"]
    );
    await expect(sender!.armLeasedSend({
      ...admit(connectionId,foreign),provider:"messenger"
    })).rejects.toThrow(/payload provenance/);
  });

  it("rejects disabled account, expired lease and already quarantined work",async()=>{
    const connectionId=await linked("tenant-owner-3",workspaceA,"paused");
    const job=await leased(connectionId,workspaceA);
    await expect(sender!.armLeasedSend(admit(connectionId,job)))
      .rejects.toThrow(/unavailable/i);
    await db!.query(
      "UPDATE public.ishikeit_account_connections SET status='connected' WHERE connection_id=$1",
      [connectionId]);
    await db!.query(
      "UPDATE public.outbox SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",
      [job.id]);
    await expect(sender!.armLeasedSend(admit(connectionId,job)))
      .rejects.toThrow(/unavailable/i);
    await db!.query(
      "UPDATE public.outbox SET lease_expires_at=now()+interval '5 minutes',dead_lettered_at=now() WHERE id=$1",
      [job.id]);
    await expect(sender!.armLeasedSend(admit(connectionId,job)))
      .rejects.toThrow(/unavailable/i);
  });
  it("atomic disconnect refuses stale permits and preserves an already armed send as uncertain",async()=>{
    const connectionId=await linked("tenant-owner-4",workspaceA);
    const first=await leased(connectionId,workspaceA);
    await sender!.armLeasedSend(admit(connectionId,first));
    const second=await leased(connectionId,workspaceA);
    const frozen=await disconnect!.request({
      workspaceId:workspaceA,connectionId,actor:owner
    });
    expect(frozen).toMatchObject({
      state:"pending",frozenGeneration:3,
      quarantinedJobs:2,uncertainInflightJobs:2
    });
    await expect(sender!.armLeasedSend(admit(connectionId,second)))
      .rejects.toThrow(/unavailable/i);
    const all=await db!.query(
      "SELECT dead_lettered_at,tenant_send_started_at FROM public.outbox WHERE connection_id=$1 ORDER BY created_at",
      [connectionId]);
    expect(all.rows).toHaveLength(2);
    expect(all.rows.every(x=>x.dead_lettered_at!==null)).toBe(true);
    expect(all.rows.filter(x=>x.tenant_send_started_at!==null)).toHaveLength(1);
  });
  it("concurrent disconnect/arming cannot make a post-disconnect untracked send",async()=>{
    const connectionId=await linked("tenant-owner-5",workspaceA);
    const job=await leased(connectionId,workspaceA);
    const [send,freeze]=await Promise.allSettled([
      sender!.armLeasedSend(admit(connectionId,job)),
      disconnect!.request({workspaceId:workspaceA,connectionId,actor:owner})
    ]);
    expect(freeze.status).toBe("fulfilled");
    if(send.status==="fulfilled"){
      expect(freeze.status==="fulfilled"&&freeze.value.uncertainInflightJobs)
        .toBeGreaterThanOrEqual(1);
    }else{
      expect(String(send.reason)).toMatch(/unavailable/i);
      expect(freeze.status==="fulfilled"&&freeze.value.uncertainInflightJobs).toBe(1);
    }
    const current=await db!.query(
      "SELECT status,generation FROM public.ishikeit_account_connections WHERE connection_id=$1",
      [connectionId]);
    expect(current.rows[0]).toMatchObject({status:"disconnecting",generation:"3"});
  });
  it("allows only one competing worker to arm the same lease",async()=>{
    const connectionId=await linked("tenant-owner-6",workspaceA);
    const job=await leased(connectionId,workspaceA);
    const contenders=await Promise.allSettled([
      sender!.armLeasedSend(admit(connectionId,job)),
      sender!.armLeasedSend(admit(connectionId,job))
    ]);
    expect(contenders.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    expect(contenders.filter(x=>x.status==="rejected")).toHaveLength(1);
  });
});
