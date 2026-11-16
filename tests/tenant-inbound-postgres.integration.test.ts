import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CanonicalEvent } from "../src/domain/events.js";
import type { ActionEnvelope } from "../src/domain/actions.js";
import { PostgresInboundEventRepository } from "../src/persistence/inbound.js";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { PostgresTenantInboundStaging, type TenantIngressBinding } from "../src/persistence/tenant-inbound.js";
import { INBOUND_ACCEPTED_TOPIC } from "../src/persistence/outbox.js";
import {normalizeTelegramUpdate} from "../src/channels/telegram-normalizer.js";
import {TelegramNativeTenantSendPolicy} from "../src/auth/workspace-telegram-send-policy.js";

/** Dedicated disposable PG17 only. Never connect this suite to production. */
const uri=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(uri!==undefined){
  const u=new URL(uri);
  if(!["postgres:","postgresql:"].includes(u.protocol) ||
     !["127.0.0.1","localhost","::1"].includes(u.hostname) ||
     u.pathname!=="/ishikeit_outbox_test"){
    throw Error("Tenant ingress tests refuse non-disposable database");
  }
}
const db=uri===undefined?undefined:new PostgresDatabase(uri);
const store=db===undefined?undefined:new PostgresTenantInboundStaging(db);
const workspaceA=randomUUID();
const workspaceB=randomUUID();
const connectionA=randomUUID();
const connectionB=randomUUID();
const bindingA:TenantIngressBinding={
  workspaceId:workspaceA,connectionId:connectionA,connectionGeneration:1,
  provider:"meta",providerAccountId:"account-A",providerApplicationKey:"test-app"
};
const bindingB:TenantIngressBinding={
  workspaceId:workspaceB,connectionId:connectionB,connectionGeneration:1,
  provider:"meta",providerAccountId:"account-B",providerApplicationKey:"test-app"
};
const digest=(text:string)=>createHash("sha256").update(text).digest("hex");

function event(accountId="account-A",suffix="1"):CanonicalEvent {
  return {
    schemaVersion:2,specversion:"1.0",id:"test-event-"+suffix,
    source:"urn:ishikeit:test:verified",type:"message.received",
    provider:"meta",channel:"messenger",capability:"messaging",
    accountId,eventType:"message.received",
    providerEventId:"provider-"+suffix,
    receivedAt:"2026-11-13T12:00:00.000Z",content:[],
    data:{synthetic:true}
  };
}
function identity(key:string=randomUUID()){
  return {deduplicationKey:"trusted:"+key,partitionKey:"shared-conversation"};
}

describe.skipIf(db===undefined)("dormant tenant-bound ingress under PostgreSQL 17",()=>{
  beforeAll(async()=>{
    await db!.query(`
      CREATE TABLE public.inbound_events (
        id uuid PRIMARY KEY,
        provider text NOT NULL,channel text NOT NULL,capability text NOT NULL,
        account_id text NOT NULL,event_type text NOT NULL,
        provider_event_id text,provider_message_id text,
        deduplication_key text NOT NULL UNIQUE,
        partition_key text NOT NULL,payload_hash text NOT NULL,
        normalized_payload jsonb NOT NULL,schema_version integer NOT NULL,
        status text NOT NULL,occurred_at timestamptz,
        received_at timestamptz NOT NULL,
        processed_at timestamptz,attempt_count integer NOT NULL DEFAULT 0,
        last_error text,processing_outcome text,handoff_reason text
      );
      CREATE TABLE public.outbox (
        id uuid PRIMARY KEY,topic text NOT NULL,partition_key text NOT NULL,
        payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db!.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
    await db!.query(await readFile("migrations/0012_ishikeit_event_tenant_provenance.sql","utf8"));
    await db!.query(await readFile("migrations/0023_ishikeit_validate_event_tenant_provenance.sql","utf8"));
    await db!.query(
      `INSERT INTO public.ishikeit_workspaces(workspace_id,display_name)
       VALUES($1,'A'),($2,'B')`,[workspaceA,workspaceB]
    );
    await db!.query(
      `INSERT INTO public.ishikeit_provider_accounts
       (provider,provider_account_id,verification_source,verification_reference,verified_at)
       VALUES ('meta','account-A','provider_api','synthetic',now()),
              ('meta','account-B','provider_api','synthetic',now())`
    );
    await db!.query(
      `INSERT INTO public.ishikeit_account_connections
       (connection_id,workspace_id,provider,provider_account_id,
        provider_application_key,status)
       VALUES($1,$2,'meta','account-A','test-app','connected'),
             ($3,$4,'meta','account-B','test-app','connected')`,
      [connectionA,workspaceA,connectionB,workspaceB]
    );
  });
  beforeEach(async()=>{
    await db!.query("DELETE FROM public.outbox");
    await db!.query("DELETE FROM public.inbound_events");
    await db!.query(
      `UPDATE public.ishikeit_account_connections
       SET status='connected',generation=1
       WHERE connection_id IN ($1,$2)`,[connectionA,connectionB]
    );
    await db!.query(
      "UPDATE public.ishikeit_workspaces SET state='active' WHERE workspace_id IN ($1,$2)",
      [workspaceA,workspaceB]
    );
  });
  afterAll(async()=>{
    try{
      await db!.query("DROP TABLE IF EXISTS public.inbound_events,public.outbox");
      await db!.query(`DROP TABLE IF EXISTS
        public.ishikeit_connection_audit,
        public.ishikeit_account_connections,
        public.ishikeit_provider_accounts,
        public.ishikeit_workspace_memberships,
        public.ishikeit_workspaces`);
    }finally{await db!.close();}
  });

  it("atomically persists a proven ACTIVE tenant generation and parked event, never a legacy row",async()=>{
    const key=identity();const hash=digest("signed-body-A");
    expect(await store!.ingestVerified(event(),key,hash,bindingA)).toBe("created");
    const result=await db!.query<{
      id:string;workspace_id:string;connection_id:string;
      connection_generation:string;status:string;account_id:string
    }>("SELECT id,workspace_id,connection_id,connection_generation,status,account_id FROM public.inbound_events");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      workspace_id:workspaceA,connection_id:connectionA,
      status:"persisted",account_id:"account-A"
    });
    expect(Number(result.rows[0]!.connection_generation)).toBe(1);
    const outbox=await db!.query<{
      topic:string;workspace_id:string;connection_id:string;
      connection_generation:string;payload:{schemaVersion:number;eventId:string}
    }>("SELECT topic,workspace_id,connection_id,connection_generation,payload FROM public.outbox");
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]!.topic).toBe(INBOUND_ACCEPTED_TOPIC);
    expect(outbox.rows[0]!.workspace_id).toBe(workspaceA);
    expect(outbox.rows[0]!.connection_id).toBe(connectionA);
    expect(Number(outbox.rows[0]!.connection_generation)).toBe(1);
    expect(outbox.rows[0]!.payload).toEqual({schemaVersion:1,eventId:result.rows[0]!.id});
  });

  it("denies legacy processing of a verified tenant event and cannot publish unscoped replies",async()=>{
    const key=identity();const hash=digest("tenant-isolation");
    expect(await store!.ingestVerified(event(),key,hash,bindingA)).toBe("created");
    const result=await db!.query<{id:string}>(
      "SELECT id FROM public.inbound_events WHERE deduplication_key=$1",
      [key.deduplicationKey]
    );
    const id=result.rows[0]!.id;
    const legacy=new PostgresInboundEventRepository(db!);
    expect(await legacy.get(id)).toMatchObject({id,tenantBound:true});
    await legacy.markProcessing(id);
    await legacy.recordFailure(id,"must-not-leak");
    const reply:ActionEnvelope={
      schemaVersion:1,idempotencyKey:id+":reply:0",
      provider:"meta",capability:"messaging",operation:"message.send",
      orderingKey:"shared-conversation",
      target:{channel:"messenger",accountId:"account-A",recipientId:"synthetic"},
      body:{part:{kind:"text",text:"must not be sent"}}
    };
    await expect(legacy.complete(id,[reply],{outcome:"handled"}))
      .rejects.toThrow(/Native tenant ingress cannot use legacy action publication/);
    const eventRow=await db!.query<{
      status:string;processed_at:Date|null;attempt_count:number;last_error:string|null
    }>(
      "SELECT status,processed_at,attempt_count,last_error FROM public.inbound_events WHERE id=$1",
      [id]
    );
    expect(eventRow.rows[0]).toMatchObject({
      status:"persisted",processed_at:null,attempt_count:0,last_error:null
    });
    const counts=await db!.query<{n:string}>(
      "SELECT count(*)::text AS n FROM public.outbox"
    );
    expect(counts.rows[0]?.n).toBe("1");
  });

  it("replaying a completed legacy event never creates a different provider action",async()=>{
    const source=event(),id=randomUUID();
    await db!.query(
      `INSERT INTO public.inbound_events
        (id,provider,channel,capability,account_id,event_type,provider_event_id,
         deduplication_key,partition_key,payload_hash,normalized_payload,
         schema_version,status,received_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,'persisted',$13)`,
      [id,source.provider,source.channel,source.capability,source.accountId,
       source.eventType,source.providerEventId??null,"legacy:"+id,
       "legacy-partition",digest("legacy-body"),JSON.stringify(source),
       source.schemaVersion,new Date(source.receivedAt)]
    );
    const legacy=new PostgresInboundEventRepository(db!);
    const a:ActionEnvelope={
      schemaVersion:1,idempotencyKey:id+":original",
      provider:"meta",capability:"messaging",operation:"message.send",
      orderingKey:"legacy-partition",
      target:{channel:"messenger",accountId:"account-A",recipientId:"synthetic"},
      body:{part:{kind:"text",text:"first"}}
    };
    expect((await legacy.get(id))?.tenantBound).toBeUndefined();
    await legacy.markProcessing(id);
    await legacy.complete(id,[a],{outcome:"handled"});
    await legacy.complete(id,[{...a,idempotencyKey:id+":unexpected"}],{outcome:"handled"});
    expect((await db!.query<{n:string}>(
      "SELECT count(*)::text AS n FROM public.outbox WHERE topic='action.dispatch'"
    )).rows[0]?.n).toBe("1");
  });

  it("deduplicates the same signed body and exact tenant once, even if receivedAt changes",async()=>{
    const key=identity(),hash=digest("stable-signed-body");
    expect(await store!.ingestVerified(event(),key,hash,bindingA)).toBe("created");
    const redelivered={...event(),receivedAt:"2026-11-13T12:00:05.000Z"};
    expect(await store!.ingestVerified(redelivered,key,hash,bindingA)).toBe("duplicate");
    const counts=await db!.query<{inbound:string;outbox:string}>(
      `SELECT (SELECT count(*) FROM public.inbound_events)::text AS inbound,
              (SELECT count(*) FROM public.outbox)::text AS outbox`
    );
    expect(counts.rows[0]).toEqual({inbound:"1",outbox:"1"});
  });

  it("keeps concurrent same-tenant webhook redeliveries idempotent",async()=>{
    const key=identity(),hash=digest("same-payload-concurrent");
    const outcomes=await Promise.all([
      store!.ingestVerified(event(),key,hash,bindingA),
      store!.ingestVerified(event(),key,hash,bindingA)
    ]);
    expect(outcomes.sort()).toEqual(["created","duplicate"]);
    const counts=await db!.query<{inbound:string;outbox:string}>(
      `SELECT (SELECT count(*) FROM public.inbound_events)::text AS inbound,
              (SELECT count(*) FROM public.outbox)::text AS outbox`
    );
    expect(counts.rows[0]).toEqual({inbound:"1",outbox:"1"});
  });

  it("rolls back both durable writes if the outbox cannot accept the parked event",async()=>{
    await db!.query(
      `ALTER TABLE public.outbox ADD CONSTRAINT tenant_inbound_rollback_test_ck
       CHECK (topic <> 'inbound.event.accepted')`
    );
    try {
      await expect(store!.ingestVerified(
        event(),identity(),digest("signed-body-rollback"),bindingA
      )).rejects.toThrow();
      const counts=await db!.query<{inbound:string;outbox:string}>(
        `SELECT (SELECT count(*) FROM public.inbound_events)::text AS inbound,
                (SELECT count(*) FROM public.outbox)::text AS outbox`
      );
      expect(counts.rows[0]).toEqual({inbound:"0",outbox:"0"});
    }finally{
      await db!.query(
        "ALTER TABLE public.outbox DROP CONSTRAINT tenant_inbound_rollback_test_ck"
      );
    }
  });

  it("refuses global dedup collision across two workspaces and never creates a foreign outbox",async()=>{
    const key=identity("same-provider-key"),hash=digest("signed-body-shared");
    expect(await store!.ingestVerified(event(),key,hash,bindingA)).toBe("created");
    await expect(store!.ingestVerified(
      event("account-B"),key,hash,bindingB
    )).rejects.toThrow(/deduplication ownership collision/);
    await expect(store!.ingestVerified(
      event(),key,digest("tampered-body"),bindingA
    )).rejects.toThrow(/deduplication ownership collision/);
    await expect(store!.ingestVerified(
      event(),{...key,partitionKey:"unexpected-conversation"},hash,bindingA
    )).rejects.toThrow(/deduplication ownership collision/);
    await expect(store!.ingestVerified(
      {...event(),channel:"instagram"},key,hash,bindingA
    )).rejects.toThrow(/deduplication ownership collision/);
    const rows=await db!.query<{workspace_id:string}>(
      "SELECT workspace_id FROM public.outbox");
    expect(rows.rows.map(row=>row.workspace_id)).toEqual([workspaceA]);
  });

  it("rejects substituted app, account, workspace, connection or generation before durable writes",async()=>{
    const mismatches:TenantIngressBinding[]=[
      {...bindingA,providerApplicationKey:"other-app"},
      {...bindingA,providerAccountId:"account-B"},
      {...bindingA,workspaceId:workspaceB},
      {...bindingA,connectionId:connectionB},
      {...bindingA,connectionGeneration:2},
      {...bindingA,providerConnectionId:"unverified-other-connection"}
    ];
    for(const binding of mismatches){
      await expect(store!.ingestVerified(
        event(),identity(),digest("signed-body-A"),binding
      )).rejects.toThrow();
    }
    const counts=await db!.query<{n:string}>(
      "SELECT count(*)::text AS n FROM public.inbound_events");
    expect(counts.rows[0]!.n).toBe("0");
  });

  it("blocks suspended workspaces and revoked connections without guessing owner",async()=>{
    await db!.query(
      "UPDATE public.ishikeit_workspaces SET state='suspended' WHERE workspace_id=$1",
      [workspaceA]
    );
    await expect(store!.ingestVerified(
      event(),identity(),digest("a"),bindingA
    )).rejects.toThrow();
    await db!.query(
      "UPDATE public.ishikeit_workspaces SET state='active' WHERE workspace_id=$1",
      [workspaceA]
    );
    await db!.query(
      "UPDATE public.ishikeit_account_connections SET status='paused',generation=2 WHERE connection_id=$1",
      [connectionA]
    );
    await expect(store!.ingestVerified(
      event(),identity(),digest("b"),bindingA
    )).rejects.toThrow();
    await expect(store!.ingestVerified(
      event(),identity(),digest("c"),{...bindingA,connectionGeneration:2}
    )).rejects.toThrow();
  });

  it("holds its connection SHARE lock until durable insert completes; concurrent revoke prevents stale generation",async()=>{
    let unblock!:()=>void;
    let signal!:()=>void;
    const acquired=new Promise<void>(resolve=>{signal=resolve;});
    const pending=new Promise<void>(resolve=>{unblock=resolve;});
    const revoke=db!.transaction(async tx=>{
      await tx.query("SELECT connection_id FROM public.ishikeit_account_connections WHERE connection_id=$1 FOR UPDATE",[connectionA]);
      signal();
      await pending;
      await tx.query(
        "UPDATE public.ishikeit_account_connections SET status='paused',generation=2 WHERE connection_id=$1",
        [connectionA]
      );
    });
    await acquired;
    const inbound=store!.ingestVerified(event(),identity(),digest("racing-event"),bindingA);
    unblock();
    await revoke;
    await expect(inbound).rejects.toThrow(/connection unavailable or stale/);
    const count=await db!.query<{n:string}>("SELECT count(*)::text AS n FROM public.inbound_events");
    expect(count.rows[0]!.n).toBe("0");
  });

  it("refuses WhatsApp consent and LatePoint booking semantics until their transaction projections exist",async()=>{
    await expect(store!.ingestVerified(
      {...event(),channel:"whatsapp"},identity(),digest("opt-out"),bindingA
    )).rejects.toThrow(/side effects/);
    await expect(store!.ingestVerified(
      {...event(),provider:"latepoint"},identity(),digest("booking"),
      {...bindingA,provider:"latepoint"}
    )).rejects.toThrow(/side effects/);
    await expect(store!.ingestVerified(
      {...event(),capability:"payments"},identity(),digest("payment"),bindingA
    )).rejects.toThrow(/side effects/);
    expect((await db!.query<{n:string}>(
      "SELECT count(*)::text AS n FROM public.outbox"
    )).rows[0]!.n).toBe("0");
  });

  it("rejects invalid trusted context, malformed digests and unverified event identity",async()=>{
    await expect(store!.ingestVerified(
      event(),identity(),"not-a-sha256",bindingA
    )).rejects.toThrow();
    await expect(store!.ingestVerified(
      event(),{deduplicationKey:"",partitionKey:"key"},digest("body"),bindingA
    )).rejects.toThrow();
    await expect(store!.ingestVerified(
      event("account-B"),identity(),digest("body"),bindingA
    )).rejects.toThrow(/provider identity mismatch/);
  });
  it("binds a genuine Telegram Business owner to the bot-sourced signed inbound without cross-tenant fallback",async()=>{
    const conn=randomUUID(),bot="987654321",ownerId="876543210",businessId="business-verified-001";
    await db!.query(
      "INSERT INTO public.ishikeit_provider_accounts(provider,provider_account_id,verification_source,verification_reference,verified_at) VALUES('telegram',$1,'provider_api','test-current-getBusinessConnection',now())",
      [ownerId]);
    await db!.query(
      "INSERT INTO public.ishikeit_account_connections(connection_id,workspace_id,provider,provider_account_id,provider_application_key,provider_connection_id,status,generation,activated_at) VALUES($1,$2,'telegram',$3,$4,$5,'connected',2,now())",
      [conn,workspaceA,ownerId,"telegram-oidc-"+bot,businessId]);
    const input={update_id:70001,business_message:{
      message_id:11,date:Math.floor(Date.now()/1000),
      business_connection_id:businessId,
      chat:{id:123456789,type:"private"},
      from:{id:123456789,is_bot:false},
      text:"hello"}};
    const event=normalizeTelegramUpdate(input,bot)[0]!;
    expect(event.accountId).toBe(bot);
    const binding:TenantIngressBinding={
      workspaceId:workspaceA,connectionId:conn,connectionGeneration:2,
      provider:"telegram",providerAccountId:ownerId,
      providerApplicationKey:"telegram-oidc-"+bot,providerConnectionId:businessId
    };
    expect(await store!.ingestVerified(event,identity(),digest("telegram-signed"),binding))
      .toBe("created");
    const stored=await db!.query<{account_id:string;provider:string;normalized_payload:{
      accountId:string;source:string;identityId:string;data:{businessConnectionId:string}
    }}>(
      "SELECT account_id,provider,normalized_payload FROM public.inbound_events LIMIT 1");
    expect(stored.rows[0]?.account_id).toBe(ownerId);
    expect(stored.rows[0]?.provider).toBe("telegram");
    expect(stored.rows[0]?.normalized_payload.accountId).toBe(ownerId);
    expect(stored.rows[0]?.normalized_payload.source)
      .toBe("urn:ishikeit:source:telegram:bot:"+bot);
    expect(stored.rows[0]?.normalized_payload.data.businessConnectionId).toBe(businessId);
    expect(stored.rows[0]?.normalized_payload.identityId).toBe("123456789");

    // Independent policy: this same exact stored, tenant-stamped signed
    // inbound must be required before any native Telegram Business reply.
    const req={
      workspaceId:workspaceA,connectionId:conn,connectionGeneration:2,
      provider:"telegram",providerApplicationKey:"telegram-oidc-"+bot,
      providerAccountId:ownerId,providerConnectionId:businessId,
      channel:"bot",recipientId:"123456789",actionDigest:digest("canonical-action")
    };
    const observed:string[]=[];
    const reader={
      inspect:(id:string)=>{
        observed.push(id);
        return Promise.resolve({connectionId:id,ownerId,enabled:true,canReply:true});
      }
    };
    const policy=new TelegramNativeTenantSendPolicy({
      trustedBotClientId:bot,reader,db:db!});
    const proof=await policy.authorize(req);
    expect(proof).toMatchObject({...req,allowed:true});
    expect(Date.parse(proof.expiresAt)-Date.parse(proof.observedAt)).toBe(15000);
    expect(observed).toEqual([businessId]);
    await expect(policy.authorize({...req,recipientId:"555555555"}))
      .rejects.toThrow(/verified recent customer/i);
    await expect(policy.authorize({...req,connectionGeneration:1}))
      .rejects.toThrow(/verified recent customer/i);
    await expect(policy.authorize({...req,providerAccountId:"999999999"}))
      .rejects.toThrow(/verified recent customer/i);
    await expect(policy.authorize({...req,providerConnectionId:"other-business"}))
      .rejects.toThrow(/verified recent customer/i);
    const revoked=new TelegramNativeTenantSendPolicy({
      trustedBotClientId:bot,db:db!,
      reader:{inspect:()=>Promise.resolve({connectionId:businessId,ownerId,enabled:false,canReply:true})}
    });
    await expect(revoked.authorize(req)).rejects.toThrow(/permission not current/i);
    const rightRemoved=new TelegramNativeTenantSendPolicy({
      trustedBotClientId:bot,db:db!,
      reader:{inspect:()=>Promise.resolve({connectionId:businessId,ownerId,enabled:true,canReply:false})}
    });
    await expect(rightRemoved.authorize(req)).rejects.toThrow(/permission not current/i);
    await db!.query("UPDATE public.inbound_events SET occurred_at=now()-interval '25 hours'");
    await expect(policy.authorize(req)).rejects.toThrow(/verified recent customer/i);

    for(const bad of [
      {...binding,providerAccountId:"someone-else"},
      {...binding,providerConnectionId:"another-business"},
      {...binding,providerApplicationKey:"telegram-oidc-111111111"}
    ])await expect(store!.ingestVerified(
      event,identity(),digest("bad-account"),bad)).rejects.toThrow();
    const forged={...event,data:{...event.data as object,businessConnectionId:"another-business"}};
    await expect(store!.ingestVerified(forged,identity(),digest("bad-data"),binding))
      .rejects.toThrow(/Business message identity mismatch/);
  });
  it("does not let a Meta messenger alias or wrong product channel cross a native connection",async()=>{
    const conn=randomUUID(),account="987654321900000";
    await db!.query(
      "INSERT INTO public.ishikeit_provider_accounts(provider,provider_account_id,verification_source,verification_reference,verified_at) VALUES('messenger',$1,'provider_api','test-page',now())",
      [account]);
    await db!.query(
      "INSERT INTO public.ishikeit_account_connections(connection_id,workspace_id,provider,provider_account_id,provider_application_key,status) VALUES($1,$2,'messenger',$3,'meta-messenger-987654321','connected')",
      [conn,workspaceA,account]);
    const binding:TenantIngressBinding={
      workspaceId:workspaceA,connectionId:conn,connectionGeneration:1,
      provider:"messenger",providerAccountId:account,
      providerApplicationKey:"meta-messenger-987654321"
    };
    expect(await store!.ingestVerified(
      {...event(account,"native-messenger"),channel:"messenger"},
      identity(),digest("signed-meta-page"),binding)).toBe("created");
    await expect(store!.ingestVerified(
      {...event(account,"wrong-platform"),channel:"instagram"},
      identity(),digest("cross-platform"),binding)).rejects.toThrow(
        /provider identity mismatch/);
    const rows=await db!.query<{n:string}>("SELECT count(*)::text AS n FROM public.inbound_events");
    expect(rows.rows[0]?.n).toBe("1");
  });

});
