import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { PostgresWorkspaceInvitations } from "../src/auth/workspace-member-invitations.js";

const raw=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(raw){
  const url=new URL(raw);
  if(!["postgres:","postgresql:"].includes(url.protocol)
    || !["localhost","127.0.0.1","::1"].includes(url.hostname)
    || url.pathname!=="/ishikeit_outbox_test")
    throw new Error("Workspace invitation tests require disposable local PostgreSQL 17");
}
const db=raw===undefined?undefined:new PostgresDatabase(raw);
const issuer="https://abcdefghijklmnopqrst.supabase.co/auth/v1";
const owner=randomUUID();
const workspace=randomUUID();
const invitee=randomUUID();
const email="new-member@example.com";
const proof={
  principal:{issuer,subject:owner},
  sessionId:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString()
};
const identity={
  verifyPrivilegedAccessToken:vi.fn((_token:string)=>{
    void _token;return Promise.resolve(proof);
  })
};
const provider={
  inviteUserByEmail:vi.fn(async (address:string)=>{
    await db!.query(
      "INSERT INTO auth.users(id,email,is_anonymous,email_confirmed_at) VALUES($1,$2,false,NULL)",
      [invitee,address]
    );
    return {userId:invitee,email:address};
  })
};
const service=db===undefined?undefined:new PostgresWorkspaceInvitations({
  db,principal:identity,provider,maxPerWorkspacePerDay:3
});
const invite=()=>({workspaceId:workspace,email,role:"agent" as const});
async function state(){
  const r=await db!.query<{state:string;auth_user_id:string|null;requested_role:string}>(
    "SELECT state,auth_user_id,requested_role FROM public.ishikeit_workspace_invitations ORDER BY requested_at"
  );
  return r.rows;
}
describe.skipIf(db===undefined)("tenant member invitation authentication & activation PG17",()=>{
  beforeAll(async()=>{
    await db!.query(`CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.users(
        id uuid PRIMARY KEY,email text,is_anonymous boolean NOT NULL DEFAULT false,
        deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz
      )`);
    await db!.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
    await db!.query(await readFile("migrations/0018_workspace_member_invitations.sql","utf8"));
  });
  beforeEach(async()=>{
    await db!.query(`TRUNCATE TABLE public.ishikeit_workspace_invitations,
      public.ishikeit_connection_audit,public.ishikeit_account_connections,
      public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
      public.ishikeit_workspaces`);
    await db!.query("DELETE FROM auth.users");
    await db!.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'owner@example.com',now())",[owner]);
    await db!.query("INSERT INTO public.ishikeit_workspaces(workspace_id,display_name) VALUES($1,'Private Studio')",[workspace]);
    await db!.query(
      "INSERT INTO public.ishikeit_workspace_memberships(workspace_id,auth_issuer,auth_subject,role) VALUES($1,$2,$3,'owner')",
      [workspace,issuer,owner]
    );
    vi.clearAllMocks();
    identity.verifyPrivilegedAccessToken.mockImplementation((_token:string)=>{
      void _token;return Promise.resolve(proof);
    });
    provider.inviteUserByEmail.mockImplementation(async address=>{
      await db!.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,NULL)",[invitee,address]);
      return {userId:invitee,email:address};
    });
  });
  afterAll(async()=>{
    try{
      await db!.query(`DROP TABLE
        public.ishikeit_workspace_invitations,
        public.ishikeit_connection_audit,public.ishikeit_account_connections,
        public.ishikeit_provider_accounts,public.ishikeit_workspace_memberships,
        public.ishikeit_workspaces`);
      await db!.query("DROP TABLE auth.users");
      await db!.query("DROP SCHEMA auth");
    }finally{await db!.close();}
  });
  it("sends approved invite but grants no membership until exact confirmed Auth identity",async()=>{
    const result=await service!.invite("trusted-aal2",invite());
    expect(result.status).toBe("invited");
    expect(identity.verifyPrivilegedAccessToken).toHaveBeenCalledOnce();
    expect(provider.inviteUserByEmail).toHaveBeenCalledWith(email);
    expect(await state()).toEqual([{state:"invited",auth_user_id:invitee,requested_role:"agent"}]);
    expect(await service!.activateConfirmedBatch()).toBe(0);
    await db!.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1",[invitee]);
    expect(await service!.activateConfirmedBatch()).toBe(1);
    const member=await db!.query<{role:string;auth_subject:string;state:string}>(
      "SELECT role,auth_subject,state FROM public.ishikeit_workspace_memberships WHERE auth_subject=$1",[invitee]
    );
    expect(member.rows[0]).toEqual({role:"agent",auth_subject:invitee,state:"active"});
    expect((await state())[0]?.state).toBe("activated");
    expect(await service!.activateConfirmedBatch()).toBe(0);
  });
  it("forbids owner / platform admin role injection before any provider interaction",async()=>{
    await expect(service!.invite("trusted-aal2",{
      workspaceId:workspace,email,role:"owner" as "agent"
    })).rejects.toThrow();
    await expect(service!.invite("trusted-aal2",{
      workspaceId:workspace,email,role:"super_admin" as "agent"
    })).rejects.toThrow();
    expect(provider.inviteUserByEmail).not.toHaveBeenCalled();
  });
  it("denies unverified AAL1, unrelated workspace, non-owner member, revoked owner and suspended tenant",async()=>{
    identity.verifyPrivilegedAccessToken.mockRejectedValueOnce(new Error("AAL2 required"));
    await expect(service!.invite("aal1",invite())).rejects.toThrow(/AAL2/i);
    await expect(service!.invite("trusted",{...invite(),workspaceId:randomUUID()}))
      .rejects.toThrow(/owner/i);
    await db!.query("UPDATE public.ishikeit_workspace_memberships SET role='admin' WHERE workspace_id=$1",[workspace]);
    await expect(service!.invite("trusted",invite())).rejects.toThrow(/owner/i);
    await db!.query("UPDATE public.ishikeit_workspace_memberships SET role='owner',state='revoked' WHERE workspace_id=$1",[workspace]);
    await expect(service!.invite("trusted",invite())).rejects.toThrow(/owner/i);
    await db!.query("UPDATE public.ishikeit_workspace_memberships SET state='active' WHERE workspace_id=$1",[workspace]);
    await db!.query("UPDATE public.ishikeit_workspaces SET state='suspended' WHERE workspace_id=$1",[workspace]);
    await expect(service!.invite("trusted",invite())).rejects.toThrow(/owner/i);
    expect(provider.inviteUserByEmail).not.toHaveBeenCalled();
  });
  it("does not promote existing verified Supabase users without an independent consent flow",async()=>{
    await db!.query(
      "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",[invitee,email]
    );
    await expect(service!.invite("aal2",invite())).rejects.toThrow(/consent/i);
    expect(provider.inviteUserByEmail).not.toHaveBeenCalled();
  });
  it("never retries an uncertain invite and preserves its reserved audit record",async()=>{
    provider.inviteUserByEmail.mockRejectedValueOnce(new Error("timeout after send"));
    const first=await service!.invite("aal2",invite());
    expect(first.status).toBe("pending_review");
    expect((await state())[0]).toMatchObject({state:"invite_requested",auth_user_id:null});
    await expect(service!.invite("aal2",invite())).rejects.toThrow();
    expect(provider.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(await service!.activateConfirmedBatch()).toBe(0);
  });
  it("fails closed when inviter loses ownership after delivery",async()=>{
    await service!.invite("aal2",invite());
    await db!.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1",[invitee]);
    await db!.query("UPDATE public.ishikeit_workspace_memberships SET state='revoked' WHERE auth_subject=$1",[owner]);
    expect(await service!.activateConfirmedBatch()).toBe(0);
    const member=await db!.query("SELECT 1 FROM public.ishikeit_workspace_memberships WHERE auth_subject=$1",[invitee]);
    expect(member.rowCount).toBe(0);
    expect((await state())[0]?.state).toBe("invited");
  });
  it("requires current active nondeleted nonbanned email-confirmed exact Auth ID",async()=>{
    await service!.invite("aal2",invite());
    const updates=[
      "UPDATE auth.users SET email='wrong@example.com' WHERE id=$1",
      "UPDATE auth.users SET deleted_at=now() WHERE id=$1",
      "UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1",
      "UPDATE auth.users SET is_anonymous=true WHERE id=$1"
    ];
    for(const change of updates){
      await db!.query("UPDATE auth.users SET email=$2,email_confirmed_at=now(),deleted_at=NULL,banned_until=NULL,is_anonymous=false WHERE id=$1",[invitee,email]);
      await db!.query(change,[invitee]);
      expect(await service!.activateConfirmedBatch()).toBe(0);
    }
    expect((await state())[0]?.state).toBe("invited");
  });
  it("keeps private invitation table closed to client grants and RLS enabled",async()=>{
    const x=await db!.query<{relrowsecurity:boolean;client_access:boolean}>(
      `SELECT c.relrowsecurity,EXISTS(
        SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        WHERE a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
          AND (a.grantee=0 OR a.grantee IN (
            SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated'
          )))
       ) AS client_access
       FROM pg_class c WHERE c.oid='public.ishikeit_workspace_invitations'::regclass`
    );
    expect(x.rows[0]).toEqual({relrowsecurity:true,client_access:false});
  });
});
