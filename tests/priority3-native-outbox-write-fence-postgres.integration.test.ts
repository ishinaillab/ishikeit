import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {PostgresDatabase} from "../src/persistence/postgres.js";

// Only disposable, isolated PG17. Never access production or a shared test DB.
const url=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(url!==undefined){
  const p=new URL(url);
  if(!["postgres:","postgresql:"].includes(p.protocol) ||
     !["localhost","127.0.0.1","::1"].includes(p.hostname) ||
     p.pathname!=="/ishikeit_outbox_test")
    throw Error("Refusing native outbox write-fence tests outside disposable PG17");
}
const db=url===undefined?undefined:new PostgresDatabase(url);
let ws:string,connA:string,connB:string;
async function enqueue(connectionId:string,workspaceId:string,generation:number){
  const id=randomUUID();
  await db!.query(
    `INSERT INTO public.outbox
      (id,topic,partition_key,payload,workspace_id,connection_id,connection_generation)
     VALUES($1,'action.dispatch','synthetic','{}'::jsonb,$2,$3,$4::bigint)`,
    [id,workspaceId,connectionId,generation]
  );
  return id;
}
describe.skipIf(db===undefined)("Priority 3 native outbox write integrity fence (disposable PG17)",()=>{
  beforeAll(async()=>{
    for(const name of [
      "0001_foundation.sql","0010_ishikeit_workspace_connections.sql",
      "0012_ishikeit_event_tenant_provenance.sql",
      "0027_priority3_tenant_send_generation_fence.sql",
      "0029_priority3_native_outbox_write_fence.sql"
    ])await db!.query(await readFile("migrations/"+name,"utf8"));
  });
  beforeEach(async()=>{
    await db!.query(`TRUNCATE public.outbox,public.inbound_events,
      public.ishikeit_connection_audit,public.ishikeit_account_connections,
      public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
      public.ishikeit_workspaces CASCADE`);
    ws=randomUUID();connA=randomUUID();connB=randomUUID();
    await db!.query(
      "INSERT INTO public.ishikeit_workspaces(workspace_id,display_name) VALUES($1,'Synthetic')",
      [ws]
    );
    await db!.query(
      `INSERT INTO public.ishikeit_provider_accounts
      (provider,provider_account_id,verification_source,verification_reference,verified_at)
      VALUES('telegram','native-A','provider_api','verified-test',now()),
            ('telegram','native-B','provider_api','verified-test',now())`
    );
    await db!.query(
      `INSERT INTO public.ishikeit_account_connections
       (connection_id,workspace_id,provider,provider_account_id,provider_application_key,
        status,generation,activated_at)
       VALUES($1,$3,'telegram','native-A','test-bot','connected',2,now()),
             ($2,$3,'telegram','native-B','test-bot','connected',2,now())`,
      [connA,connB,ws]
    );
  });
  afterAll(async()=>{
    try{
      await db!.query(`DROP TABLE IF EXISTS public.outbox,public.inbound_events,
        public.ishikeit_connection_audit,public.ishikeit_account_connections,
        public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
        public.ishikeit_workspaces CASCADE`);
      await db!.query(
        "DROP FUNCTION IF EXISTS public.ishikeit_guard_native_outbox_write()");
    }finally{await db!.close();}
  });

  it("admits only live, exact-generation tenant queues; blocks paused and frozen accounts",async()=>{
    const accepted=await enqueue(connA,ws,2);
    expect((await db!.query("SELECT id FROM public.outbox WHERE id=$1",[accepted]))
      .rowCount).toBe(1);
    await expect(enqueue(connA,ws,3)).rejects.toThrow(/native outbox|connection unavailable/i);
    await db!.query(
      "UPDATE public.ishikeit_account_connections SET status='paused' WHERE connection_id=$1",
      [connA]
    );
    await expect(enqueue(connA,ws,2)).rejects.toThrow(/native outbox|connection unavailable/i);
    await db!.query(
      `UPDATE public.ishikeit_account_connections
         SET status='disconnecting',generation=3 WHERE connection_id=$1`,
      [connA]
    );
    await expect(enqueue(connA,ws,3)).rejects.toThrow(/native outbox|connection unavailable/i);
    await expect(enqueue(connA,ws,2)).rejects.toThrow(/native outbox|connection unavailable/i);
  });

  it("rejects provenance reassignment, including a rewrite within the same workspace",async()=>{
    const id=await enqueue(connA,ws,2);
    await expect(db!.query(
      `UPDATE public.outbox SET connection_id=$2 WHERE id=$1`,[id,connB]
    )).rejects.toThrow(/native outbox|immutable/i);
    await expect(db!.query(
      `UPDATE public.outbox SET connection_generation=3 WHERE id=$1`,[id]
    )).rejects.toThrow(/native outbox|immutable/i);
    expect((await db!.query(
      "SELECT connection_id,connection_generation FROM public.outbox WHERE id=$1",
      [id])).rows[0]).toMatchObject({connection_id:connA,connection_generation:"2"});
  });

  it("preserves legacy and connectionless workspace tasks, and does not disturb normal job state updates",async()=>{
    const legacy=randomUUID(),workspaceOnly=randomUUID();
    await db!.query(
      `INSERT INTO public.outbox(id,topic,partition_key,payload)
       VALUES($1,'action.dispatch','legacy','{}'::jsonb)`,[legacy]
    );
    await db!.query(
      `INSERT INTO public.outbox(id,topic,partition_key,payload,workspace_id)
       VALUES($1,'action.dispatch','workspace-only','{}'::jsonb,$2)`,
      [workspaceOnly,ws]
    );
    const native=await enqueue(connA,ws,2);
    await db!.query("UPDATE public.outbox SET attempt_count=attempt_count+1 WHERE id=$1",
      [native]);
    expect((await db!.query(
      "SELECT attempt_count FROM public.outbox WHERE id=$1",[native]
    )).rows[0]?.attempt_count).toBe(1);
    expect((await db!.query(
      "SELECT count(*)::int AS n FROM public.outbox WHERE id=ANY($1::uuid[])",
      [[legacy,workspaceOnly]]
    )).rows[0]?.n).toBe(2);
  });

  it("replaying the additive migration preserves its single trigger and rejects stale writes",async()=>{
    await db!.query(await readFile(
      "migrations/0029_priority3_native_outbox_write_fence.sql","utf8"
    ));
    const trigger=await db!.query<{name:string;enabled:string}>(
      `SELECT tgname AS name,tgenabled AS enabled
         FROM pg_trigger WHERE tgrelid='public.outbox'::regclass
           AND tgname='ishikeit_native_outbox_write_fence'`
    );
    expect(trigger.rows).toEqual([{
      name:"ishikeit_native_outbox_write_fence",enabled:"O"
    }]);
    const f=await db!.query<{security_definer:boolean;public_execute:boolean}>(
      `SELECT p.prosecdef AS security_definer,
         EXISTS(
           SELECT 1 FROM aclexplode(coalesce(
             p.proacl,acldefault('f',p.proowner))) a
           WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
         ) AS public_execute
       FROM pg_proc p
       WHERE p.oid='public.ishikeit_guard_native_outbox_write()'::regprocedure`
    );
    expect(f.rows[0]).toEqual({security_definer:false,public_execute:false});
    await expect(enqueue(connA,ws,3)).rejects.toThrow(/native outbox|connection unavailable/i);
  });

  it("blocks a connection freeze while a native outbox insert is uncommitted",async()=>{
    let release!:()=>void,signal!:()=>void;
    const inserted=new Promise<void>(resolve=>{signal=resolve;});
    const held=new Promise<void>(resolve=>{release=resolve;});
    const pendingWrite=db!.transaction(async tx=>{
      await tx.query(
        `INSERT INTO public.outbox
         (id,topic,partition_key,payload,workspace_id,connection_id,connection_generation)
         VALUES($1,'action.dispatch','race','{}'::jsonb,$2,$3,2)`,
        [randomUUID(),ws,connA]
      );
      signal();
      await held;
    });
    await inserted;
    let frozen=false;
    const freeze=db!.query(
      "UPDATE public.ishikeit_account_connections SET status='disconnecting',generation=3 WHERE connection_id=$1",
      [connA]).then(()=>{frozen=true;});
    try{
      await new Promise(resolve=>setTimeout(resolve,90));
      expect(frozen).toBe(false);
    }finally{
      release();
    }
    await pendingWrite;
    await freeze;
    expect(frozen).toBe(true);
    await expect(enqueue(connA,ws,2)).rejects.toThrow(/native outbox|connection unavailable/i);
  });
});
