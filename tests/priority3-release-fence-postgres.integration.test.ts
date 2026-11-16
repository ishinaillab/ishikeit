import {randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import {beforeAll,beforeEach,afterAll,describe,expect,it} from "vitest";
import {PostgresDatabase} from "../src/persistence/postgres.js";
import {PostgresPriority3ReleaseFence} from "../src/operations/priority3-release-fence.js";

const connectionString=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(connectionString!==undefined){
  const url=new URL(connectionString);
  if(!["postgres:","postgresql:"].includes(url.protocol) ||
    !["127.0.0.1","localhost","::1"].includes(url.hostname) ||
    url.pathname!=="/ishikeit_outbox_test"){
    throw Error("Refusing release fencing schema outside disposable PG17");
  }
}
const db=connectionString===undefined?undefined:new PostgresDatabase(connectionString);
const fence=db===undefined?undefined:new PostgresPriority3ReleaseFence(db);
const scope="priority3-production-release";
const appMainSha="a".repeat(40),dbMainSha="b".repeat(40);
const secret=()=>randomBytes(32).toString("base64url");
const request=(holderSecret:string)=>({
  scope,holderSecret,appMainSha,dbMainSha,ttlSeconds:120
});
describe.skipIf(db===undefined)("atomic Priority 3 release-owner fencing (disposable PG17)",()=>{
  beforeAll(async()=>{
    // Emulate pre-existing Supabase client roles at migration time, not
    // fallback privilege assertions against nonexistent roles.
    await db!.query("CREATE ROLE anon NOLOGIN");
    await db!.query("CREATE ROLE authenticated NOLOGIN");
    await db!.query(await readFile("migrations/0025_priority3_release_ownership_fence.sql","utf8"));
    await db!.query(await readFile("migrations/0028_priority3_release_external_step_hold.sql","utf8"));
  });
  beforeEach(async()=>{
    await db!.query("TRUNCATE public.ishikeit_release_ownership");
  });
  afterAll(async()=>{
    try{
      await db!.query("DROP TABLE public.ishikeit_release_ownership");
      await db!.query("DROP ROLE anon");
      await db!.query("DROP ROLE authenticated");
    }finally{await db!.close();}
  });
  it("admits only one of simultaneous independent holders and exposes no token",async()=>{
    const one=secret(),two=secret();
    const [a,b]=await Promise.all([
      fence!.acquire(request(one)),fence!.acquire(request(two))
    ]);
    expect([a,b].filter(x=>x!==undefined)).toHaveLength(1);
    const winningSecret=a===undefined?two:one;
    const losingSecret=a===undefined?one:two;
    const winning=a??b!;
    expect(winning.generation).toBe(1);
    expect(await fence!.check({...request(winningSecret),
      generation:winning.generation})).toBe(true);
    expect(await fence!.check({...request(losingSecret),
      generation:winning.generation})).toBe(false);
    expect(await fence!.acquire(request(losingSecret))).toBeUndefined();
    const readback=await fence!.inspect(scope);
    expect(readback).toMatchObject({
      active:true,generation:1,appMainSha,dbMainSha
    });
    expect(JSON.stringify(readback)).not.toContain(winningSecret);
    const privateFields=await db!.query<{n:number}>(
      "SELECT count(*)::integer AS n FROM public.ishikeit_release_ownership WHERE length(holder_digest)=32"
    );
    expect(privateFields.rows[0]?.n).toBe(1);
  });

  it("invalidates a released owner and only admits a new generation",async()=>{
    const oldSecret=secret(),newSecret=secret();
    const old=await fence!.acquire(request(oldSecret));
    expect(old).toBeDefined();
    expect(await fence!.release({...request(oldSecret),
      generation:old!.generation})).toBe(true);
    expect(await fence!.check({...request(oldSecret),
      generation:old!.generation})).toBe(false);
    expect(await fence!.renew({...request(oldSecret),
      generation:old!.generation})).toBeUndefined();
    const next=await fence!.acquire(request(newSecret));
    expect(next?.generation).toBeGreaterThan(old!.generation);
    expect(await fence!.release({...request(oldSecret),
      generation:old!.generation})).toBe(false);
    expect(await fence!.check({...request(newSecret),
      generation:next!.generation,appMainSha:"f".repeat(40)})).toBe(false);
    const updated=await fence!.renew({...request(newSecret),
      generation:next!.generation});
    expect(updated?.generation).toBe(next!.generation);
  });

  it("fences expired holders without letting an old timestamp renew",async()=>{
    const oldSecret=secret(),newSecret=secret();
    const first=await fence!.acquire(request(oldSecret));
    await db!.query(
      "UPDATE public.ishikeit_release_ownership SET expires_at=clock_timestamp()-interval '1 second' WHERE scope=$1",
      [scope]
    );
    expect(await fence!.check({...request(oldSecret),
      generation:first!.generation})).toBe(false);
    expect(await fence!.renew({...request(oldSecret),
      generation:first!.generation})).toBeUndefined();
    const second=await fence!.acquire(request(newSecret));
    expect(second?.generation).toBeGreaterThan(first!.generation);
    expect(await fence!.release({...request(oldSecret),
      generation:first!.generation})).toBe(false);
    expect(await fence!.check({...request(newSecret),
      generation:second!.generation})).toBe(true);
  });

  it("durably blocks a second release holder when an external step may still be running",async()=>{
    const firstSecret=secret(),otherSecret=secret();
    const first=await fence!.acquire(request(firstSecret));
    expect(first).toBeDefined();
    const held={...request(firstSecret),generation:first!.generation,
      step:"schema_migration" as const};
    expect(await fence!.beginExternalStep(held)).toBe(true);
    // A live lease or successful renewal must not admit a second hosted
    // mutation while the previous external step is unresolved.
    expect(await fence!.check(held)).toBe(false);
    expect(await fence!.renew(held)).toMatchObject({
      generation:first!.generation
    });
    expect(await fence!.check(held)).toBe(false);
    expect(await fence!.beginExternalStep(held)).toBe(false);
    expect(await fence!.release(held)).toBe(false);
    expect(await fence!.acquire(request(otherSecret))).toBeUndefined();
    const current=await fence!.inspect(scope);
    expect(current).toMatchObject({
      active:true,generation:first!.generation,
      pendingExternalStep:"schema_migration"
    });
    expect(current).toHaveProperty("pendingExternalStepAt",expect.any(String));
    // Hostinger builds and Supabase hosted migration submissions may finish
    // after the local lease expires. Expiry is NOT a provider failure receipt.
    await db!.query(
      "UPDATE public.ishikeit_release_ownership SET expires_at=clock_timestamp()-interval '1 second' WHERE scope=$1",
      [scope]
    );
    expect(await fence!.check(held)).toBe(false);
    expect(await fence!.renew(held)).toBeUndefined();
    expect(await fence!.release(held)).toBe(false);
    expect(await fence!.acquire(request(otherSecret))).toBeUndefined();
    expect(await fence!.inspect(scope)).toMatchObject({
      active:false,generation:first!.generation,
      pendingExternalStep:"schema_migration"
    });
    // No untrusted caller-controlled 'success' or 'force abort' API exists.
  });

  it("serializes competing external release admission attempts at one generation",async()=>{
    const owner=secret(),first=await fence!.acquire(request(owner));
    const proof={...request(owner),generation:first!.generation};
    const candidates=await Promise.all([
      fence!.beginExternalStep({...proof,step:"app_deploy"}),
      fence!.beginExternalStep({...proof,step:"schema_migration"})
    ]);
    expect(candidates.filter(Boolean)).toHaveLength(1);
    const observed=await fence!.inspect(scope);
    expect(["app_deploy","schema_migration"]).toContain(observed.active
      ?observed.pendingExternalStep:null);
    expect(await fence!.release(proof)).toBe(false);
    expect(await fence!.acquire(request(secret()))).toBeUndefined();
  });

  it("rejects wrong owner, generation, pinned SHAs, invalid step and stale claim",async()=>{
    const current=secret(),first=await fence!.acquire(request(current));
    const identity={...request(current),generation:first!.generation};
    expect(await fence!.beginExternalStep({...identity,
      holderSecret:secret(),step:"schema_migration"})).toBe(false);
    expect(await fence!.beginExternalStep({...identity,
      appMainSha:"f".repeat(40),step:"schema_migration"})).toBe(false);
    expect(await fence!.beginExternalStep({...identity,
      generation:first!.generation+1,step:"schema_migration"})).toBe(false);
    await expect(fence!.beginExternalStep({...identity,
      step:"unrecognized" as "app_deploy"})).rejects.toThrow(/Unsupported/);
    expect((await fence!.inspect(scope)).active).toBe(true);
    expect(await fence!.release(identity)).toBe(true);
    expect(await fence!.beginExternalStep({...identity,
      step:"app_deploy"})).toBe(false);
    expect(await fence!.acquire(request(secret()))).toBeDefined();
  });

  it("fails closed on malformed holder secrets, unsupported TTL and unknown scopes",async()=>{
    await expect(fence!.acquire({...request(secret()),holderSecret:"bad"}))
      .rejects.toThrow();
    await expect(fence!.acquire({...request(secret()),appMainSha:"main"}))
      .rejects.toThrow();
    await expect(fence!.acquire({...request(secret()),ttlSeconds:36000}))
      .rejects.toThrow();
    await expect(fence!.inspect("not a supported scope space"))
      .rejects.toThrow();
    expect(await fence!.inspect(scope)).toMatchObject({active:false});
  });

  it("enables RLS and no publicly granted read/write for the private table",async()=>{
    const rows=await db!.query<{
      relrowsecurity:boolean;public_select:boolean;public_update:boolean
    }>(
      `SELECT c.relrowsecurity,
         EXISTS(SELECT 1 FROM aclexplode(
           coalesce(c.relacl,acldefault('r',c.relowner))) a
           WHERE a.grantee=0 AND a.privilege_type='SELECT') AS public_select,
         EXISTS(SELECT 1 FROM aclexplode(
           coalesce(c.relacl,acldefault('r',c.relowner))) a
           WHERE a.grantee=0 AND a.privilege_type='UPDATE') AS public_update
         FROM pg_class c WHERE c.oid='public.ishikeit_release_ownership'::regclass`
    );
    expect(rows.rows[0]).toMatchObject({
      relrowsecurity:true,public_select:false,public_update:false
    });
    for(const role of ["anon","authenticated"]){
      const permissions=await db!.query<{can_read:boolean;can_write:boolean}>(
        "SELECT has_table_privilege($1,'public.ishikeit_release_ownership','SELECT') AS can_read, "+
        "has_table_privilege($1,'public.ishikeit_release_ownership','UPDATE') AS can_write",
        [role]
      );
      expect(permissions.rows[0]).toEqual({can_read:false,can_write:false});
      await expect(db!.transaction(async tx=>{
        await tx.query("SET LOCAL ROLE "+role);
        await tx.query("SELECT count(*) FROM public.ishikeit_release_ownership");
      })).rejects.toThrow(/permission denied/i);
    }
  });
});
