import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {beforeAll,beforeEach,afterAll,describe,expect,it} from "vitest";
import {PostgresDatabase} from "../src/persistence/postgres.js";
import {PostgresActiveDisconnectHold} from "../src/persistence/active-disconnect.js";

const uri=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(uri!==undefined){
  const p=new URL(uri);
  if(!["postgres:","postgresql:"].includes(p.protocol) ||
     !["localhost","127.0.0.1","::1"].includes(p.hostname)||
     p.pathname!=="/ishikeit_outbox_test")
    throw Error("Refusing disconnect integration tests outside disposable PG17");
}
const db=uri===undefined?undefined:new PostgresDatabase(uri);
const lifecycle=db===undefined?undefined:new PostgresActiveDisconnectHold(db);
const ownerA={issuer:"test-issuer",subject:"verified-owner-A"};
const ownerB={issuer:"test-issuer",subject:"verified-owner-B"};
const agent={issuer:"test-issuer",subject:"agent-A"};
let workspaceA:string,workspaceB:string;
const createdRoles:string[]=[];
async function fixture(account:string,status:"connected"|"verifying"|"paused"="connected"){
  const connectionId=randomUUID();
  await db!.query(
    `INSERT INTO public.ishikeit_provider_accounts
      (provider,provider_account_id,verification_source,verification_reference,verified_at)
     VALUES('telegram',$1,'provider_api','test_verified_immutable_identity',now())`,
    [account]);
  await db!.query(
    `INSERT INTO public.ishikeit_account_connections
      (connection_id,workspace_id,provider,provider_account_id,
       provider_application_key,status,generation,activated_at)
     VALUES ($1,$2,'telegram',$3,'test-bot',$4,2,
             CASE WHEN $4='verifying' THEN NULL ELSE now() END)`,
    [connectionId,workspaceA,account,status]);
  return connectionId;
}
async function enqueue(connectionId:string,leased=false,armed=false){
  const jobId=randomUUID();
  await db!.query(
    `INSERT INTO public.outbox
      (id,topic,partition_key,payload,workspace_id,connection_id,connection_generation,
       lease_token,lease_expires_at,meta_send_started_at)
     VALUES($1,'action.dispatch','private-test', '{"provider":"telegram"}'::jsonb,
            $2,$3,2,$4::uuid,
            CASE WHEN $4::uuid IS NULL THEN NULL ELSE now()+interval '5 minutes' END,
            CASE WHEN $5::boolean THEN now() ELSE NULL END)`,
    [jobId,workspaceA,connectionId,leased?randomUUID():null,armed]);
  return jobId;
}
describe.skipIf(db===undefined)("Priority 3 active disconnect quarantine (disposable PostgreSQL17)",()=>{
  beforeAll(async()=>{
    for(const role of ["anon","authenticated"]){
      const exists=await db!.query("SELECT 1 FROM pg_roles WHERE rolname=$1",[role]);
      if(exists.rowCount===0){await db!.query(`CREATE ROLE "${role}" NOLOGIN`);createdRoles.push(role);}
    }
    await db!.query(await readFile("migrations/0001_foundation.sql","utf8"));
    await db!.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
    await db!.query(await readFile("migrations/0012_ishikeit_event_tenant_provenance.sql","utf8"));
    await db!.query("ALTER TABLE public.outbox ADD COLUMN meta_send_started_at timestamptz");
    await db!.query(await readFile("migrations/0026_priority3_active_disconnect_quarantine.sql","utf8"));
    await db!.query(await readFile("migrations/0027_priority3_tenant_send_generation_fence.sql","utf8"));
  });
  beforeEach(async()=>{
    await db!.query(
      `TRUNCATE public.outbox,public.inbound_events,
         public.ishikeit_active_disconnect_cleanup,
         public.ishikeit_connection_audit,public.ishikeit_account_connections,
         public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
         public.ishikeit_workspaces CASCADE`);
    workspaceA=randomUUID();workspaceB=randomUUID();
    await db!.query(
      `INSERT INTO public.ishikeit_workspaces(workspace_id,display_name)
       VALUES($1,'A'),($2,'B')`,[workspaceA,workspaceB]);
    await db!.query(
      `INSERT INTO public.ishikeit_workspace_memberships
       (workspace_id,auth_issuer,auth_subject,role) VALUES
       ($1,$3,$4,'owner'),($2,$3,$5,'owner'),($1,$3,$6,'agent')`,
       [workspaceA,workspaceB,"test-issuer",ownerA.subject,ownerB.subject,agent.subject]);
  });
  afterAll(async()=>{
    try{
      await db!.query(
        `DROP TABLE IF EXISTS public.ishikeit_active_disconnect_cleanup,
         public.outbox,public.inbound_events,
         public.ishikeit_connection_audit,
         public.ishikeit_account_connections,public.ishikeit_provider_accounts,
         public.ishikeit_workspace_memberships,public.ishikeit_workspaces CASCADE`);
      for(const role of createdRoles)await db!.query(`DROP ROLE IF EXISTS "${role}"`);
    }finally{await db!.close();}
  });
  it("atomically freezes a live account, quarantines queue, and blocks another workspace claim",async()=>{
    const connectionId=await fixture("owner-3001");
    const queued=await enqueue(connectionId);
    const input={workspaceId:workspaceA,connectionId,actor:ownerA};
    const [first,second]=await Promise.all([
      lifecycle!.request(input),lifecycle!.request(input)
    ]);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      state:"pending",frozenGeneration:3,quarantinedJobs:1,
      uncertainInflightJobs:0,cleanupAttempts:0
    });
    const jobs=await db!.query(
      `SELECT dead_letter_reason,lease_token,dead_lettered_at
       FROM public.outbox WHERE id=$1`,[queued]);
    expect(jobs.rows[0]).toMatchObject({
      dead_letter_reason:"tenant_disconnect_quarantine",lease_token:null
    });
    expect(jobs.rows[0]?.dead_lettered_at).toBeTruthy();
    const connection=await db!.query(
      `SELECT status,generation,disconnected_at
       FROM public.ishikeit_account_connections WHERE connection_id=$1`,[connectionId]);
    expect(connection.rows[0]).toMatchObject({
      status:"disconnecting",generation:"3",disconnected_at:null
    });
    const audit=await db!.query(
      `SELECT count(*)::int AS n FROM public.ishikeit_connection_audit
        WHERE connection_id=$1 AND event_type='disconnect_requested'`,[connectionId]);
    expect(audit.rows[0]?.n).toBe(1);
    await expect(db!.query(
      `INSERT INTO public.ishikeit_account_connections
       (connection_id,workspace_id,provider,provider_account_id,provider_application_key)
       VALUES($1,$2,'telegram','owner-3001','test-bot')`,
      [randomUUID(),workspaceB]
    )).rejects.toThrow();
    expect(await lifecycle!.inspect(input)).toEqual(first);
  });

  it("refuses foreign/agent identities and never treats pending links as active",async()=>{
    const connectionId=await fixture("owner-3002");
    await expect(lifecycle!.request({
      workspaceId:workspaceA,connectionId,actor:ownerB
    })).rejects.toThrow(/authorization denied/i);
    await expect(lifecycle!.request({
      workspaceId:workspaceA,connectionId,actor:agent
    })).rejects.toThrow(/authorization denied/i);
    await expect(lifecycle!.request({
      workspaceId:workspaceB,connectionId,actor:ownerB
    })).rejects.toThrow(/not found/i);
    expect((await db!.query(
      "SELECT status FROM public.ishikeit_account_connections WHERE connection_id=$1",
      [connectionId])).rows[0]?.status).toBe("connected");
    const pendingId=await fixture("owner-3003","verifying");
    await expect(lifecycle!.request({
      workspaceId:workspaceA,connectionId:pendingId,actor:ownerA
    })).rejects.toThrow(/activated/i);
    expect((await db!.query(
      "SELECT count(*)::int AS n FROM public.ishikeit_active_disconnect_cleanup"
    )).rows[0]?.n).toBe(0);
  });

  it("quarantines leased and armed work without pretending it was unsent",async()=>{
    const connectionId=await fixture("owner-3004");
    const leased=await enqueue(connectionId,true);
    const armed=await enqueue(connectionId,true,true);
    const pending=await lifecycle!.request({
      workspaceId:workspaceA,connectionId,actor:ownerA});
    expect(pending).toMatchObject({
      quarantinedJobs:2,uncertainInflightJobs:2,state:"pending"
    });
    const rows=await db!.query(
      `SELECT id,lease_token,lease_expires_at,dead_lettered_at
         FROM public.outbox WHERE connection_id=$1`,[connectionId]);
    expect(rows.rows).toHaveLength(2);
    for(const row of rows.rows){
      expect([leased,armed]).toContain(row.id);
      expect(row.lease_token).toBeNull();
      expect(row.lease_expires_at).toBeNull();
      expect(row.dead_lettered_at).toBeTruthy();
    }
    expect((await db!.query(
      `SELECT status FROM public.ishikeit_account_connections
       WHERE connection_id=$1`,[connectionId])).rows[0]?.status)
      .toBe("disconnecting");
  });

  it("retains an already dead-lettered unknown tenant send as uncertain",async()=>{
    const connectionId=await fixture("owner-deadlettered-unknown");
    const jobId=randomUUID();
    await db!.query(
      `INSERT INTO public.outbox
        (id,topic,partition_key,payload,workspace_id,connection_id,
         connection_generation,tenant_send_started_at,dead_lettered_at,dead_letter_reason)
       VALUES($1,'action.dispatch','private-test','{}'::jsonb,$2,$3,2,
              now()-interval '1 minute',now(),'provider_outcome_unknown')`,
      [jobId,workspaceA,connectionId]
    );
    const hold=await lifecycle!.request({
      workspaceId:workspaceA,connectionId,actor:ownerA
    });
    expect(hold).toMatchObject({
      state:"pending",quarantinedJobs:0,uncertainInflightJobs:1
    });
    expect((await db!.query(
      "SELECT dead_letter_reason FROM public.outbox WHERE id=$1",[jobId]
    )).rows[0]?.dead_letter_reason).toBe("provider_outcome_unknown");
  });

  it("retains claim and sanitized retry evidence on provider cleanup failure",async()=>{
    const connectionId=await fixture("owner-3005","paused");
    const request=await lifecycle!.request({
      workspaceId:workspaceA,connectionId,actor:ownerA});
    const input={workspaceId:workspaceA,connectionId,
      frozenGeneration:request.frozenGeneration,errorCode:"provider_timeout",
      retryAfterSeconds:120};
    expect(await lifecycle!.recordCleanupFailure(input)).toMatchObject({
      state:"retry_required",cleanupAttempts:1
    });
    expect((await lifecycle!.recordCleanupFailure(input)).cleanupAttempts).toBe(2);
    const stored=await db!.query(
      `SELECT last_error_code,next_retry_at,provider_verified_at
         FROM public.ishikeit_active_disconnect_cleanup
         WHERE connection_id=$1`,[connectionId]);
    expect(stored.rows[0]?.last_error_code).toBe("provider_timeout");
    expect(stored.rows[0]?.next_retry_at).toBeTruthy();
    expect(stored.rows[0]?.provider_verified_at).toBeNull();
    await expect(lifecycle!.recordCleanupFailure({...input,
      errorCode:"token:secret"})).rejects.toThrow();
    await expect(lifecycle!.recordCleanupFailure({
      ...input,frozenGeneration:request.frozenGeneration-1
    })).rejects.toThrow(/stale/i);
    expect((await db!.query(
      `SELECT disconnected_at FROM public.ishikeit_account_connections
       WHERE connection_id=$1`,[connectionId])).rows[0]?.disconnected_at).toBeNull();
  });

  it("fails closed and rolls back a freeze when its private migration is missing",async()=>{
    const connectionId=await fixture("owner-3006");
    const jobId=await enqueue(connectionId);
    const request={workspaceId:workspaceA,connectionId,actor:ownerA};
    await db!.query("DROP TABLE public.ishikeit_active_disconnect_cleanup");
    try{
      await expect(lifecycle!.request(request)).rejects.toThrow();
      const connection=await db!.query(
        "SELECT status,generation FROM public.ishikeit_account_connections WHERE connection_id=$1",
        [connectionId]);
      expect(connection.rows[0]).toMatchObject({status:"connected",generation:"2"});
      const job=await db!.query(
        "SELECT dead_lettered_at,lease_token FROM public.outbox WHERE id=$1",[jobId]);
      expect(job.rows[0]).toMatchObject({dead_lettered_at:null,lease_token:null});
    }finally{
      await db!.query(await readFile(
        "migrations/0026_priority3_active_disconnect_quarantine.sql","utf8"));
    }
  });

  it("refuses a legacy disconnecting claim without this protected cleanup record",async()=>{
    const connectionId=await fixture("owner-3007");
    await db!.query(
      "UPDATE public.ishikeit_account_connections SET status='disconnecting',generation=3 WHERE connection_id=$1",
      [connectionId]);
    await expect(lifecycle!.request({
      workspaceId:workspaceA,connectionId,actor:ownerA
    })).rejects.toThrow(/protected reconciliation/i);
    expect((await db!.query(
      "SELECT count(*)::int AS n FROM public.ishikeit_active_disconnect_cleanup"
    )).rows[0]?.n).toBe(0);
  });

  it("denies real anon and authenticated roles all cleanup ledger access",async()=>{
    for(const role of ["anon","authenticated"]){
      const rights=await db!.query<{can_read:boolean;can_write:boolean}>(
        `SELECT has_table_privilege($1,'public.ishikeit_active_disconnect_cleanup','SELECT')
                 AS can_read,
                has_table_privilege($1,'public.ishikeit_active_disconnect_cleanup','UPDATE')
                 AS can_write`,[role]);
      expect(rights.rows[0]).toMatchObject({can_read:false,can_write:false});
      await db!.transaction(async tx=>{
        await tx.query(`SET LOCAL ROLE "${role}"`);
        await expect(tx.query(
          "SELECT count(*) FROM public.ishikeit_active_disconnect_cleanup"
        )).rejects.toThrow(/permission denied/i);
      }).catch(error=>{
        // SET LOCAL ROLE denial aborts this intentionally negative transaction.
        if(!/permission denied/i.test(String(error)))throw error;
      });
    }
  });
});
