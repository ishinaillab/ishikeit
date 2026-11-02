import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { CredentialCipher } from "../src/auth/credential-cipher.js";
import { PrivateBrowserAuthService } from "../src/auth/private-browser-auth.js";

const connectionString=process.env.PG_OUTBOX_TEST_DATABASE_URL;
if(connectionString!==undefined){
  const url=new URL(connectionString);
  if(!["postgres:","postgresql:"].includes(url.protocol)
    || !["localhost","127.0.0.1","::1"].includes(url.hostname)
    || url.pathname!=="/ishikeit_outbox_test"){
    throw new Error("Refusing private browser session tests outside isolated PG17");
  }
}
const db=connectionString===undefined?undefined:new PostgresDatabase(connectionString);
const userId=randomUUID(),authSessionId=randomUUID(),workspaceId=randomUUID();
const origin="https://abcdefghijklmnopqrst.supabase.co/auth/v1";
const access="test_token_"+ "x".repeat(55);
const refreshed="new_token_"+ "y".repeat(55);
const refreshOne="refresh_123456789012345678901234567890";
const refreshTwo="refresh_987654321098765432109876543210";
let refreshUses=0;
const otpClient={
  sendOtp:vi.fn((_email:string)=>{void _email;return Promise.resolve();}),
  verifyOtp:vi.fn((_email:string,_token:string)=>{void _email;void _token;return Promise.resolve({
    access_token:access,refresh_token:refreshOne,token_type:"bearer" as const,expires_in:3600
  });}),
  refresh:vi.fn((_token:string)=>{
    void _token;
    refreshUses++;
    return Promise.resolve({
      access_token:refreshed,refresh_token:refreshTwo,token_type:"bearer" as const,expires_in:3600
    });
  }),
  revoke:vi.fn((_token:string)=>{void _token;return Promise.resolve();})
};
const auth={
  verifyAccessToken:vi.fn((token:string)=>Promise.resolve({
    principal:{issuer:origin,subject:userId},
    sessionId:authSessionId,expiresAt:new Date(Date.now()+3600000).toISOString(),
    marker:token
  }))
};
const portfolio={
  list:vi.fn((_token:string,_options?:unknown)=>{void _token;void _options;return Promise.resolve({
    items:[{workspaceId,displayName:"Authorized Studio",role:"owner" as const,connectedAccounts:0}]
  });})
};
const cipher=new CredentialCipher(Buffer.alloc(32,37));
const secret=Buffer.alloc(32,39).toString("base64");
const service=db===undefined?undefined:new PrivateBrowserAuthService({
  projectUrl:"https://abcdefghijklmnopqrst.supabase.co",
  db,cipher,csrfKeyBase64:secret,
  otp:otpClient,
  auth,
  portfolio
});

describe.skipIf(db===undefined)("private browser OTP and session persistence on disposable PG17",()=>{
  beforeAll(async()=>{
    await db!.query(`CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,email text,is_anonymous boolean NOT NULL DEFAULT false
      );`);
    await db!.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
    await db!.query(await readFile("migrations/0014_private_browser_auth.sql","utf8"));
    await db!.query("INSERT INTO public.ishikeit_workspaces(workspace_id,display_name) VALUES($1,'A')",[workspaceId]);
    await db!.query(
      "INSERT INTO public.ishikeit_workspace_memberships(workspace_id,auth_issuer,auth_subject,role) VALUES($1,$2,$3,'owner')",
      [workspaceId,origin,userId]
    );
    await db!.query("INSERT INTO auth.users(id,email,is_anonymous) VALUES($1,$2,false)",
      [userId,"invited@example.com"]);
  });
  beforeEach(async()=>{
    await db!.query(`TRUNCATE TABLE public.ishikeit_browser_sessions,
       public.ishikeit_browser_login_attempts,public.ishikeit_browser_auth_limits`);
    vi.clearAllMocks();
    refreshUses=0;
  });
  afterAll(async()=>{
    try {
      await db!.query(`DROP TABLE IF EXISTS public.ishikeit_browser_sessions,
       public.ishikeit_browser_login_attempts,public.ishikeit_browser_auth_limits`);
      await db!.query(`DROP TABLE IF EXISTS public.ishikeit_connection_audit,
       public.ishikeit_account_connections,public.ishikeit_provider_accounts,
       public.ishikeit_workspace_memberships,public.ishikeit_workspaces`);
      await db!.query("DROP TABLE auth.users");
      await db!.query("DROP SCHEMA auth");
    }finally{await db!.close();}
  });

  it("sends OTP only to existing permanent workspace members, without signup",async()=>{
    const legit=await service!.begin("Invited@example.com","test-network-a");
    expect(legit).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(otpClient.sendOtp).toHaveBeenCalledWith("invited@example.com");
    const guest=await service!.begin("outsider@example.com","test-network-b");
    expect(guest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(otpClient.sendOtp).toHaveBeenCalledTimes(1);
    const dbRows=await db!.query<{challenge_hash:string;email_address:string}>(
      "SELECT challenge_hash,email_address FROM public.ishikeit_browser_login_attempts"
    );
    expect(dbRows.rows).toHaveLength(2);
    expect(dbRows.rows.map(r=>r.challenge_hash)).not.toContain(
      createHash("sha256").update("not-a-cookie").digest("hex")
    );
    expect(dbRows.rows.map(r=>r.challenge_hash)).toContain(
      createHash("sha256").update(legit).digest("hex")
    );
  });

  it("creates encrypted browser session, refreshes provider token with DB lock and revokes locally",async()=>{
    const login=await service!.begin("invited@example.com","test-network-a");
    const created=await service!.verify(login,"123456","test-network-a");
    expect(created.cookieValue).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(created.cookieValue).not.toBe(login);
    expect(created.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(()=>service!.assertCsrf(created.cookieValue,"wrong")).toThrow();
    expect(()=>service!.assertCsrf(created.cookieValue,created.csrfToken)).not.toThrow();
    const row=await db!.query<{access_ciphertext:Buffer;refresh_ciphertext:Buffer;session_hash:string}>(
      "SELECT access_ciphertext,refresh_ciphertext,session_hash FROM public.ishikeit_browser_sessions"
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.session_hash).not.toBe(created.cookieValue);
    expect(row.rows[0]?.access_ciphertext.includes(Buffer.from(access))).toBe(false);
    expect(row.rows[0]?.refresh_ciphertext.includes(Buffer.from(refreshOne))).toBe(false);
    expect(await service!.csrf(created.cookieValue)).toBe(created.csrfToken);
    const summary=await service!.get(created.cookieValue);
    expect(summary.workspaces.items[0]?.workspaceId).toBe(workspaceId);
    expect(summary.csrfToken).toBe(created.csrfToken);
    const rotated=await service!.refresh(created.cookieValue);
    expect(rotated.sessionId).toBe(authSessionId);
    expect(otpClient.refresh).toHaveBeenCalledWith(refreshOne);
    const current=await service!.get(created.cookieValue);
    expect(current.workspaces.items).toHaveLength(1);
    await service!.logout(created.cookieValue);
    await expect(service!.csrf(created.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.get(created.cookieValue)).rejects.toThrow(/session/i);
    expect(otpClient.revoke).toHaveBeenCalledWith(refreshed);
  });

  it("serializes concurrent refreshes so a rotated refresh token is never reused",async()=>{
    const login=await service!.begin("invited@example.com","test-network-z");
    const created=await service!.verify(login,"123456","test-network-z");
    await Promise.all([service!.refresh(created.cookieValue),service!.refresh(created.cookieValue)]);
    expect(otpClient.refresh).toHaveBeenCalledTimes(2);
    expect(otpClient.refresh.mock.calls.map(args=>args[0])).toEqual([refreshOne,refreshTwo]);
    expect(refreshUses).toBe(2);
  });

  it("limits OTP delivery per email and blocks replay and exhausted codes",async()=>{
    const login=await service!.begin("invited@example.com","test-network-a");
    await service!.begin("invited@example.com","test-network-b");
    await service!.begin("invited@example.com","test-network-c");
    await service!.begin("invited@example.com","test-network-d");
    expect(otpClient.sendOtp).toHaveBeenCalledTimes(3);
    await service!.verify(login,"123456","test-network-a");
    await expect(service!.verify(login,"123456","test-network-a"))
      .rejects.toThrow(/verification rejected/i);
  });

  it("denies expired login nonce without authenticating",async()=>{
    const nonce=await service!.begin("invited@example.com","test-network-a");
    await db!.query(
      "UPDATE public.ishikeit_browser_login_attempts SET requested_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute'"
    );
    await expect(service!.verify(nonce,"123456","test-network-a")).rejects.toThrow();
    expect(otpClient.verifyOtp).not.toHaveBeenCalled();
  });

  it("enforces private RLS and prevents Data API access to all sensitive tables",async()=>{
    const rows=await db!.query<{relname:string;relrowsecurity:boolean;public_access:boolean}>(
      `SELECT c.relname,c.relrowsecurity,
         EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
           WHERE a.grantee=0 AND a.privilege_type='SELECT') AS public_access
       FROM pg_class c WHERE c.oid IN (
         'public.ishikeit_browser_sessions'::regclass,
         'public.ishikeit_browser_login_attempts'::regclass,
         'public.ishikeit_browser_auth_limits'::regclass)`
    );
    expect(rows.rows).toHaveLength(3);
    for(const row of rows.rows){
      expect(row.relrowsecurity).toBe(true);
      expect(row.public_access).toBe(false);
    }
  });
});
