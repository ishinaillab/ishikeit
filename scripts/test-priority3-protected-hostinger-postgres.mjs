import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import pg from "pg";
import {createReleaseFence,reconcileCompletedExternalStep} from "./priority3-protected-hostinger-release.mjs";

const connection=process.env.PG_OUTBOX_TEST_DATABASE_URL;
const directory=process.env.ISHIKEIT_PROTECTED_DB_MIGRATIONS_DIR;
const cfg={
  appSha:"a".repeat(40),dbSha:"b".repeat(40),
  oldUuid:"01a1d96f-bc54-70a0-ae01-504fa9a27c72",
  oldSha:"c".repeat(40),mode:"deploy"
};
test("actual two Priority 3 SQL migrations CAS, pending external step and generation fencing on disposable PostgreSQL17",async()=>{
  assert.ok(connection&&directory,"Disposable PostgreSQL17 and official pinned DB migrations required");
  const url=new URL(connection);
  assert.ok(["127.0.0.1","localhost"].includes(url.hostname),"Refuse remote database");
  assert.equal(url.pathname,"/ishikeit_outbox_test","Refuse non-test database");
  const db=new pg.Client({connectionString:connection,connectionTimeoutMillis:4000});
  await db.connect();
  try{
    await db.query("DROP TABLE IF EXISTS public.ishikeit_release_ownership CASCADE");
    for(const f of [
      "20261115021500_priority3_release_ownership_fence.sql",
      "20261115030147_priority3_release_external_step_hold.sql"
    ]){
      const sql=readFileSync(join(directory,f),"utf8");
      assert.ok(sql.length>700,"Missing authentic checked-in DB migration");
      await db.query(sql);
    }
    const a=createReleaseFence((...args)=>db.query(...args));
    const b=createReleaseFence((...args)=>db.query(...args));
    await a.acquire(cfg);
    await assert.rejects(b.acquire(cfg),/Another release/);
    await a.check(cfg);
    await a.releaseUnarmed(cfg);
    await assert.rejects(a.check(cfg),/invalid or stale/);
    await b.acquire(cfg);
    await b.check(cfg);
    await b.arm(cfg);
    await assert.rejects(reconcileCompletedExternalStep((...args)=>db.query(...args),cfg),
      /expired matching/);
    await assert.rejects(b.check(cfg),/stale/);
    await assert.rejects(b.releaseUnarmed(cfg),/Refuse/);
    let row=(await db.query("SELECT generation,pending_external_step,verified_app_deploy_at FROM public.ishikeit_release_ownership WHERE scope=$1",
      ["ishikeit_priority3_production"])).rows[0];
    assert.equal(row.pending_external_step,"app_deploy");
    assert.equal(row.verified_app_deploy_at,null);
    await db.query("UPDATE public.ishikeit_release_ownership SET expires_at=clock_timestamp()-interval '1 minute'");
    const c=createReleaseFence((...args)=>db.query(...args));
    await assert.rejects(c.acquire(cfg),/unresolved/);
    row=(await db.query("SELECT pending_external_step FROM public.ishikeit_release_ownership")).rows[0];
    assert.equal(row.pending_external_step,"app_deploy","External uncertainty survived expired lease");
    await assert.rejects(reconcileCompletedExternalStep((...args)=>db.query(...args),
      {...cfg,dbSha:"f".repeat(40)}),/expired matching/);
    row=(await db.query("SELECT pending_external_step FROM public.ishikeit_release_ownership")).rows[0];
    assert.equal(row.pending_external_step,"app_deploy");
    // A real controller calls this only AFTER authoritative Hostinger exact
    // commit/health readbacks. Here the method's database CAS is tested alone.
    await reconcileCompletedExternalStep((...args)=>db.query(...args),cfg);
    row=(await db.query("SELECT pending_external_step,holder_digest,verified_app_deploy_at FROM public.ishikeit_release_ownership")).rows[0];
    assert.equal(row.pending_external_step,null);
    assert.equal(row.holder_digest,null);
    assert.ok(row.verified_app_deploy_at instanceof Date);
    await assert.rejects(reconcileCompletedExternalStep((...args)=>db.query(...args),cfg),
      /expired matching/);
    const d=createReleaseFence((...args)=>db.query(...args));
    await d.acquire(cfg);
    await d.arm(cfg);
    await d.renew(cfg);
    await d.resolve(cfg);
    row=(await db.query("SELECT generation,pending_external_step,holder_digest,verified_app_deploy_at FROM public.ishikeit_release_ownership")).rows[0];
    assert.equal(row.pending_external_step,null);
    assert.equal(row.holder_digest,null);
    assert.ok(row.verified_app_deploy_at instanceof Date);
    const revoked=await db.query("SELECT COUNT(*)::int AS count FROM public.ishikeit_release_ownership WHERE holder_digest IS NULL AND pending_external_step IS NULL");
    assert.equal(revoked.rows[0].count,1);
  }finally{
    try{await db.query("DROP TABLE IF EXISTS public.ishikeit_release_ownership CASCADE")}finally{await db.end()}
  }
});
