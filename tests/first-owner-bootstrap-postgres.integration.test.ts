import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { PostgresFirstOwnerBootstrap } from "../src/auth/postgres-first-owner-bootstrap.js";
import { PostgresInitialAdminProvisioning } from "../src/auth/managed-initial-admin.js";
import { vi } from "vitest";

const connectionString=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(connectionString!==undefined){
  const url=new URL(connectionString);
  if(!["postgres:","postgresql:"].includes(url.protocol)
    || !["localhost","127.0.0.1","::1"].includes(url.hostname)
    || url.pathname!=="/ishikeit_outbox_test"){
    throw new Error("Initial-owner integration tests require isolated disposable local PG17");
  }
}
const db=connectionString===undefined?undefined:new PostgresDatabase(connectionString);
const service=db===undefined?undefined:new PostgresFirstOwnerBootstrap(db);
const origin="https://abcdefghijklmnopqrst.supabase.co";
let ownerId="";
const email="verified-owner@example.com";
function input(override:Record<string,string>={}){
  return {
    projectUrl:origin,
    approvedUserId:ownerId,
    expectedEmail:email,
    workspaceName:"Owner-approved workspace",
    approvedBy:"operator:verified-human",
    approvalReference:"approval-ticket-20261102",
    ...override
  };
}
async function counts(){
  const rows=await db!.query<{
    workspaces:number;members:number;audits:number;connections:number
  }>(
    `SELECT
      (SELECT count(*)::int FROM public.ishikeit_workspaces) workspaces,
      (SELECT count(*)::int FROM public.ishikeit_workspace_memberships) members,
      (SELECT count(*)::int FROM public.ishikeit_initial_owner_bootstrap) audits,
      (SELECT count(*)::int FROM public.ishikeit_account_connections) connections`
  );
  return rows.rows[0];
}
describe.skipIf(db===undefined)("verified initial owner bootstrap on disposable PostgreSQL 17",()=>{
  beforeAll(async()=>{
    await db!.query(`CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.users(
        id uuid PRIMARY KEY,email text,
        email_confirmed_at timestamptz,
        is_anonymous boolean NOT NULL DEFAULT false,
        deleted_at timestamptz,banned_until timestamptz
      );`);
    await db!.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
    await db!.query(await readFile("migrations/0016_initial_owner_bootstrap_audit.sql","utf8"));
    await db!.query(await readFile("migrations/0017_managed_platform_admin_provisioning.sql","utf8"));
  });
  beforeEach(async()=>{
    await db!.query(`TRUNCATE TABLE public.ishikeit_platform_administrators,
      public.ishikeit_initial_admin_provisioning,public.ishikeit_initial_owner_bootstrap,
      public.ishikeit_connection_audit,public.ishikeit_account_connections,
      public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
      public.ishikeit_workspaces`);
    // auth.users is referenced by the global admin FK; after child cleanup,
    // use DELETE instead of an independently issued TRUNCATE.
    await db!.query("DELETE FROM auth.users");
    ownerId=randomUUID();
    await db!.query(
      "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
      [ownerId,email]
    );
    await db!.query(
      `INSERT INTO public.ishikeit_initial_admin_provisioning
         (email_address,approval_reference,approved_by,state,requested_at,invited_at,auth_user_id)
       VALUES($1,'approval-ticket-20261102','operator:verified-human',
         'invited',now(),now(),$2)`,
      [email,ownerId]
    );
  });
  afterAll(async()=>{
    try{
      await db!.query(`DROP TABLE IF EXISTS
        public.ishikeit_platform_administrators,
        public.ishikeit_initial_admin_provisioning,
        public.ishikeit_initial_owner_bootstrap,
        public.ishikeit_connection_audit,public.ishikeit_account_connections,
        public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
        public.ishikeit_workspaces`);
      await db!.query("DROP TABLE auth.users");
      await db!.query("DROP SCHEMA auth");
    }finally{await db!.close();}
  });
  it("atomically assigns exact confirmed Auth UUID, canonical issuer, workspace owner and private approval audit",async()=>{
    const result=await service!.execute(input());
    expect(result.ownerUserId).toBe(ownerId);
    expect(result.authIssuer).toBe(origin+"/auth/v1");
    expect(result.workspaceId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(await counts()).toEqual({
      workspaces:1,members:1,audits:1,connections:0
    });
    const rows=await db!.query<{
      workspace_id:string;auth_issuer:string;auth_subject:string;role:string;
      state:string;approved_by:string;approval_reference:string
    }>(
      `SELECT m.workspace_id,m.auth_issuer,m.auth_subject,m.role,m.state,
        a.approved_by,a.approval_reference
       FROM public.ishikeit_workspace_memberships m
       JOIN public.ishikeit_initial_owner_bootstrap a
         ON a.workspace_id=m.workspace_id`
    );
    expect(rows.rows[0]).toMatchObject({
      workspace_id:result.workspaceId,auth_issuer:origin+"/auth/v1",
      auth_subject:ownerId,role:"owner",state:"active",
      approved_by:"operator:verified-human",
      approval_reference:"approval-ticket-20261102"
    });
    expect(Object.keys(rows.rows[0]!)).not.toContain("email");
    const admin=await db!.query<{role:string;state:string}>(
      "SELECT role,state FROM public.ishikeit_platform_administrators WHERE user_id=$1",[ownerId]
    );
    expect(admin.rows[0]).toEqual({role:"super_admin",state:"active"});
  });
  it("rejects missing invitation acceptance/confirmed email, deleted, banned and anonymous accounts",async()=>{
    const updates=[
      "UPDATE auth.users SET email_confirmed_at=NULL",
      "UPDATE auth.users SET deleted_at=now()",
      "UPDATE auth.users SET banned_until=now()+interval '1 day'",
      "UPDATE auth.users SET is_anonymous=true"
    ];
    for(const sql of updates){
      await db!.query(
        "UPDATE auth.users SET email_confirmed_at=now(),deleted_at=NULL,banned_until=NULL,is_anonymous=false"
      );
      await db!.query(sql);
      await expect(service!.execute(input())).rejects.toThrow(/verified/i);
      expect(await counts()).toMatchObject({workspaces:0,members:0,audits:0});
    }
  });
  it("rejects wrong user ID or email even if another confirmed Supabase account exists",async()=>{
    await expect(service!.execute(input({approvedUserId:randomUUID()})))
      .rejects.toThrow(/verified/i);
    await expect(service!.execute(input({expectedEmail:"wrong@example.com"})))
      .rejects.toThrow(/verified/i);
    expect(await counts()).toMatchObject({workspaces:0,members:0,audits:0});
  });
  it("rejects foreign project, HTTP, invalid approval and prevents implicit authorization",async()=>{
    for(const projectUrl of [
      "http://abcdefghijklmnopqrst.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co.evil.test",
      "https://abcdefghijklmnopqrst.supabase.co/other",
      "https://abcdefghijklmnopqrst.supabase.co/?role=owner"
    ]){
      await expect(service!.execute(input({projectUrl}))).rejects.toThrow();
    }
    await expect(service!.execute(input({approvalReference:"unknown"})))
      .rejects.toThrow();
    await expect(service!.execute(input({approvedBy:""}))).rejects.toThrow();
    expect(await counts()).toMatchObject({workspaces:0,members:0,audits:0});
  });
  it("denies privilege grant without a recorded exact approved invitation",async()=>{
    await db!.query("DELETE FROM public.ishikeit_initial_admin_provisioning");
    await expect(service!.execute(input())).rejects.toThrow(/approved Auth invitation/i);
    expect(await counts()).toMatchObject({workspaces:0,members:0,audits:0});
  });
  it("automatically invites, waits for real email verification and activates once",async()=>{
    await db!.query("DELETE FROM public.ishikeit_initial_admin_provisioning");
    await db!.query("DELETE FROM auth.users WHERE id=$1",[ownerId]);
    const invite=vi.fn(async (address:string)=>{
      expect(address).toBe(email);
      await db!.query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,NULL)",
        [ownerId,email]
      );
      return {userId:ownerId,email};
    });
    const provisioning=new PostgresInitialAdminProvisioning({
      db:db!,invitation:{inviteUserByEmail:invite},
      approval:{
        projectUrl:origin,email,workspaceName:"Owner-approved workspace",
        approvedBy:"operator:verified-human",approvalReference:"approval-ticket-20261102"
      }
    });
    expect(await provisioning.run()).toEqual({status:"pending_email_confirmation"});
    expect(invite).toHaveBeenCalledTimes(1);
    expect(await counts()).toMatchObject({workspaces:0,members:0,audits:0});
    expect(await provisioning.run()).toEqual({status:"pending_email_confirmation"});
    expect(invite).toHaveBeenCalledTimes(1);
    await db!.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1",[ownerId]);
    const done=await provisioning.reconcile();
    expect(done.status).toBe("activated");
    expect(await counts()).toMatchObject({workspaces:1,members:1,audits:1});
    expect(await provisioning.reconcile()).toEqual({status:"already_activated"});
    const role=await db!.query<{state:string}>(
      "SELECT state FROM public.ishikeit_platform_administrators WHERE user_id=$1",[ownerId]
    );
    expect(role.rows[0]?.state).toBe("active");
  });
  it("does not repeat an uncertain invitation; reconciles when official Auth user appears",async()=>{
    await db!.query("DELETE FROM public.ishikeit_initial_admin_provisioning");
    await db!.query("DELETE FROM auth.users WHERE id=$1",[ownerId]);
    const invite=vi.fn(async (_address:string)=>{
      void _address;
      await db!.query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,NULL)",
        [ownerId,email]
      );
      throw new Error("transport lost after sending");
    });
    const provisioning=new PostgresInitialAdminProvisioning({
      db:db!,invitation:{inviteUserByEmail:invite},
      approval:{
        projectUrl:origin,email,workspaceName:"Owner-approved workspace",
        approvedBy:"operator:verified-human",approvalReference:"approval-ticket-20261102"
      }
    });
    expect(await provisioning.run()).toEqual({status:"ambiguous_invitation"});
    expect(await provisioning.reconcile()).toEqual({status:"pending_email_confirmation"});
    expect(await provisioning.run()).toEqual({status:"pending_email_confirmation"});
    expect(invite).toHaveBeenCalledTimes(1);
  });

  it("denies replay and cannot create a second initial owner after bootstrap",async()=>{
    await service!.execute(input());
    await expect(service!.execute(input()))
      .rejects.toThrow(/established instance/i);
    expect(await counts()).toEqual({
      workspaces:1,members:1,audits:1,connections:0
    });
  });
  it("denies bootstrap if a workspace already exists, including suspended workspace",async()=>{
    await db!.query(
      "INSERT INTO public.ishikeit_workspaces(workspace_id,display_name,state) VALUES($1,'Existing','suspended')",
      [randomUUID()]
    );
    await expect(service!.execute(input())).rejects.toThrow(/established instance/i);
    expect(await counts()).toMatchObject({workspaces:1,members:0,audits:0});
  });
  it("serializes concurrent operator attempts; exactly one succeeds",async()=>{
    const attempts=await Promise.allSettled([
      service!.execute(input()),service!.execute(input())
    ]);
    expect(attempts.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    expect(attempts.filter(x=>x.status==="rejected")).toHaveLength(1);
    expect(await counts()).toEqual({
      workspaces:1,members:1,audits:1,connections:0
    });
  });
  it("keeps approval audit inaccessible to public/client Supabase roles",async()=>{
    const result=await db!.query<{
      relrowsecurity:boolean;client_access:boolean;policy_count:number
    }>(`SELECT c.relrowsecurity,
        EXISTS(
          SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
          WHERE acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
            AND (acl.grantee=0 OR acl.grantee IN (
              SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated')
            ))
        ) AS client_access,
        (SELECT count(*)::int FROM pg_policies p
          WHERE p.schemaname='public' AND p.tablename=c.relname) policy_count
       FROM pg_class c WHERE c.oid='public.ishikeit_initial_owner_bootstrap'::regclass`);
    expect(result.rows[0]).toMatchObject({
      relrowsecurity:true,client_access:false,policy_count:0
    });
  });
});
