import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresDatabase } from "../src/persistence/postgres.js";
import { CredentialCipher } from "../src/auth/credential-cipher.js";
import {
  PrivateBrowserAuthService, BrowserLoginSessionSetupError,
  BrowserMfaEnrollmentRateLimited, BrowserMfaPendingEnrollment,
  type BrowserOtpFailureDiagnostic
} from "../src/auth/private-browser-auth.js";
import { PostgresBrowserAuthMaintenance } from "../src/auth/private-browser-auth-maintenance.js";

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
const userId=randomUUID(),authSessionId=randomUUID(),workspaceId=randomUUID(),factorId=randomUUID();
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
  verifyPrivilegedAccessToken:vi.fn((token:string)=>{
    if(!token.startsWith("mfa_access_"))
      return Promise.reject(new Error("Multi-factor authentication required"));
    return Promise.resolve({principal:{issuer:origin,subject:userId},sessionId:authSessionId,
      expiresAt:new Date(Date.now()+3600000).toISOString()});
  }),
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
const otpDiagnostics=vi.fn((entry:BrowserOtpFailureDiagnostic)=>{void entry;});
const mfa={
  enroll:vi.fn((_token:string)=>{
    void _token;
    const id=mfa.enroll.mock.calls.length===1?factorId:randomUUID();
    return db!.query(
      "INSERT INTO auth.mfa_factors(id,user_id,status,factor_type) VALUES($1,$2,'unverified','totp')",
      [id,userId]
    ).then(()=>({factorId:id,secret:"JBSWY3DPEHPK3PXP"}));
  }),
  unenroll:vi.fn((_token:string,ref:string)=>{
    void _token;
    return db!.query("DELETE FROM auth.mfa_factors WHERE id=$1 AND status='unverified'",[ref])
      .then(result=>{
        if(result.rowCount!==1)throw new Error("MFA factor not available");
      });
  }),
  challengeAndVerify:vi.fn((_token:string,factor:string,_code:string)=>{
    void _token;void _code;
    return db!.transaction(async tx=>{
      const changed=await tx.query("UPDATE auth.mfa_factors SET status='verified' WHERE id=$1",
        [factor]);
      if(changed.rowCount!==1)throw new Error("Invalid factor");
      await tx.query("UPDATE auth.sessions SET aal='aal2',factor_id=$2 WHERE id=$1",
        [authSessionId,factor]);
      return {
        access_token:"mfa_access_"+"x".repeat(60),
        refresh_token:"mfa_refresh_"+"z".repeat(55),
        token_type:"bearer" as const,expires_in:3600
      };
    });
  })
};
const memberInvites={invite:vi.fn((_token:string,_input:{workspaceId:string;email:string;role:"admin"|"agent"|"viewer"})=>{
  void _token;void _input;return Promise.resolve({invitationId:randomUUID(),status:"invited" as const});
})};
const service=db===undefined?undefined:new PrivateBrowserAuthService({
  projectUrl:"https://abcdefghijklmnopqrst.supabase.co",
  db,cipher,csrfKeyBase64:secret,onOtpFailure:otpDiagnostics,
  otp:otpClient,
  mfa,
  auth,
  portfolio,memberInvites
});

describe.skipIf(db===undefined)("private browser OTP and session persistence on disposable PG17",()=>{
  beforeAll(async()=>{
    await db!.query(`CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,email text,is_anonymous boolean NOT NULL DEFAULT false,
        email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz
      );`);
    await db!.query(await readFile("migrations/0010_ishikeit_workspace_connections.sql","utf8"));
    await db!.query(await readFile("migrations/0014_private_browser_auth.sql","utf8"));
    await db!.query(await readFile("migrations/0015_browser_login_email_encryption.sql","utf8"));
    await db!.query(await readFile("migrations/0019_browser_otp_email_link_resume.sql","utf8"));
    await db!.query(`CREATE TABLE IF NOT EXISTS auth.mfa_factors(
      id uuid PRIMARY KEY,user_id uuid NOT NULL,status text NOT NULL,
      factor_type text NOT NULL,created_at timestamptz DEFAULT now() NOT NULL)`);
    await db!.query(`CREATE TABLE IF NOT EXISTS auth.sessions(
      id uuid PRIMARY KEY,user_id uuid NOT NULL,aal text NOT NULL DEFAULT 'aal1',
      factor_id uuid)`);
    await db!.query("INSERT INTO public.ishikeit_workspaces(workspace_id,display_name) VALUES($1,'A')",[workspaceId]);
    await db!.query(
      "INSERT INTO public.ishikeit_workspace_memberships(workspace_id,auth_issuer,auth_subject,role) VALUES($1,$2,$3,'owner')",
      [workspaceId,origin,userId]
    );
    await db!.query("INSERT INTO auth.users(id,email,is_anonymous,email_confirmed_at) VALUES($1,$2,false,now())",
      [userId,"invited@example.com"]);
  });
  beforeEach(async()=>{
    await db!.query("TRUNCATE TABLE auth.mfa_factors,auth.sessions");
    await db!.query("INSERT INTO auth.sessions(id,user_id,aal) VALUES($1,$2,'aal1')",
      [authSessionId,userId]);
    await db!.query(`TRUNCATE TABLE public.ishikeit_browser_sessions,
       public.ishikeit_browser_login_attempts,public.ishikeit_browser_auth_limits`);
    vi.clearAllMocks();
    refreshUses=0;
    await db!.query(
      "UPDATE auth.users SET email_confirmed_at=now(),deleted_at=NULL,banned_until=NULL WHERE id=$1",
      [userId]
    );
  });
  afterAll(async()=>{
    try {
      await db!.query(`DROP TABLE IF EXISTS public.ishikeit_browser_sessions,
       public.ishikeit_browser_login_attempts,public.ishikeit_browser_auth_limits`);
      await db!.query(`DROP TABLE IF EXISTS public.ishikeit_connection_audit,
       public.ishikeit_account_connections,public.ishikeit_provider_accounts,
       public.ishikeit_workspace_memberships,public.ishikeit_workspaces`);
      await db!.query("DROP TABLE auth.sessions");
      await db!.query("DROP TABLE auth.mfa_factors");
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
    const dbRows=await db!.query<{
      challenge_hash:string;email_ciphertext:Buffer;email_iv:Buffer;email_tag:Buffer
    }>(
      "SELECT challenge_hash,email_ciphertext,email_iv,email_tag FROM public.ishikeit_browser_login_attempts"
    );
    expect(dbRows.rows.every(r=>
      r.email_ciphertext.length>0 && r.email_iv.length===12 && r.email_tag.length===16
      && !r.email_ciphertext.includes(Buffer.from("invited@example.com"))
      && !r.email_ciphertext.includes(Buffer.from("outsider@example.com"))
    )).toBe(true);
    const columns=await db!.query<{column_name:string}>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ishikeit_browser_login_attempts'
         AND column_name='email_address'`
    );
    expect(columns.rows).toHaveLength(0);
    expect(dbRows.rows).toHaveLength(2);
    expect(dbRows.rows.map(r=>r.challenge_hash)).not.toContain(
      createHash("sha256").update("not-a-cookie").digest("hex")
    );
    expect(dbRows.rows.map(r=>r.challenge_hash)).toContain(
      createHash("sha256").update(legit).digest("hex")
    );
  });


  it("recognizes only an unexpired, emailed, unconsumed, cookie-bound code challenge",async()=>{
    const active=await service!.begin("invited@example.com","entry-ip");
    const guest=await service!.begin("stranger@example.com","guest-ip");
    expect(await service!.hasPendingEmailOtp(active)).toBe(true);
    expect(await service!.hasPendingEmailOtp(guest)).toBe(false);
    expect(await service!.hasPendingEmailOtp("not-a-cookie")).toBe(false);
    const row=await db!.query<{
      email_lookup_hash:string;otp_sent_at:Date|null
    }>("SELECT email_lookup_hash,otp_sent_at FROM public.ishikeit_browser_login_attempts WHERE challenge_hash=$1",
      [createHash("sha256").update(active).digest("hex")]);
    expect(row.rows[0]?.email_lookup_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(row.rows[0]?.otp_sent_at).toBeInstanceOf(Date);
    expect(row.rows[0]?.email_lookup_hash).not.toBe(
      createHash("sha256").update("invited@example.com").digest("hex")
    );
    await db!.query(
      "UPDATE public.ishikeit_browser_login_attempts SET tries=5 WHERE challenge_hash=$1",
      [createHash("sha256").update(active).digest("hex")]
    );
    expect(await service!.hasPendingEmailOtp(active)).toBe(false);
  });

  it("restores email code entry across browsers without sending another OTP or bypassing code verification",async()=>{
    const original=await service!.begin("invited@example.com","send-ip");
    const resumed=await service!.resumeEmailOtp("invited@example.com","email-link-ip");
    expect(resumed).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(resumed).not.toBe(original);
    expect(await service!.hasPendingEmailOtp(resumed)).toBe(true);
    expect(otpClient.sendOtp).toHaveBeenCalledTimes(1);
    expect(otpClient.verifyOtp).not.toHaveBeenCalled();
    const row=await db!.query<{
      email_ciphertext:Buffer;email_lookup_hash:string;expires_at:Date
    }>(
      "SELECT email_ciphertext,email_lookup_hash,expires_at FROM public.ishikeit_browser_login_attempts WHERE challenge_hash=$1",
      [createHash("sha256").update(resumed).digest("hex")]
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]?.email_ciphertext.includes(
      Buffer.from("invited@example.com"))).toBe(false);
    expect(row.rows[0]?.email_lookup_hash).toMatch(/^[a-f0-9]{64}$/u);
    const verified=await service!.verify(resumed,"123456","email-link-ip");
    expect(verified.cookieValue).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(otpClient.verifyOtp).toHaveBeenCalledWith("invited@example.com","123456");
    expect(await service!.hasPendingEmailOtp(resumed)).toBe(false);
    expect(otpClient.sendOtp).toHaveBeenCalledTimes(1);
  });

  it("never adopts a non-emailed, expired or completed challenge and limits cross-browser resume requests",async()=>{
    const guest=await service!.begin("unknown@example.com","unknown-ip");
    const pretender=await service!.resumeEmailOtp("unknown@example.com","resume-unknown");
    expect(pretender).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(await service!.hasPendingEmailOtp(guest)).toBe(false);
    expect(await service!.hasPendingEmailOtp(pretender)).toBe(false);
    await expect(service!.verify(pretender,"123456","resume-unknown"))
      .rejects.toThrow();
    expect(otpClient.verifyOtp).not.toHaveBeenCalled();
    const first=await service!.begin("invited@example.com","replay-ip");
    const child1=await service!.resumeEmailOtp("invited@example.com","restore-ip-1");
    const child2=await service!.resumeEmailOtp("invited@example.com","restore-ip-2");
    const child3=await service!.resumeEmailOtp("invited@example.com","restore-ip-3");
    const blocked=await service!.resumeEmailOtp("invited@example.com","restore-ip-4");
    expect(await service!.hasPendingEmailOtp(child1)).toBe(true);
    expect(await service!.hasPendingEmailOtp(child2)).toBe(true);
    expect(await service!.hasPendingEmailOtp(child3)).toBe(true);
    expect(await service!.hasPendingEmailOtp(blocked)).toBe(false);
    expect(otpClient.sendOtp).toHaveBeenCalledTimes(1);
    await db!.query(
      "UPDATE public.ishikeit_browser_login_attempts SET completed_at=now() WHERE challenge_hash=$1",
      [createHash("sha256").update(first).digest("hex")]
    );
    // A still-unconsumed transferable challenge is independently bounded and
    // cannot grant access without Supabase OTP. Account-level guessing also
    // remains 10/900s and per-challenge tries<5.
    expect(await service!.hasPendingEmailOtp(first)).toBe(false);
  });

  it("does not resume an expired original OTP after email link navigation",async()=>{
    await service!.begin("invited@example.com","expired-send-ip");
    await db!.query(
      "UPDATE public.ishikeit_browser_login_attempts SET requested_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute'"
    );
    const resumed=await service!.resumeEmailOtp("invited@example.com","expired-link-ip");
    expect(await service!.hasPendingEmailOtp(resumed)).toBe(false);
    await expect(service!.verify(resumed,"123456","expired-link-ip")).rejects.toThrow();
    expect(otpClient.verifyOtp).not.toHaveBeenCalled();
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
    const summary=await service!.sessionStatus(created.cookieValue);
    expect(summary).toMatchObject({status:"mfa_required",csrfToken:created.csrfToken});
    expect("workspaces" in summary).toBe(false);
    await expect(service!.get(created.cookieValue)).rejects.toThrow(/multi-factor/i);
    await expect(service!.listWorkspaces(created.cookieValue)).rejects.toThrow(/multi-factor/i);
    const rotated=await service!.refresh(created.cookieValue);
    expect(rotated.status).toBe("mfa_required");
    expect(rotated).not.toHaveProperty("workspaces");
    expect(otpClient.refresh).toHaveBeenCalledWith(refreshOne);
    await service!.logout(created.cookieValue);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_browser_sessions")).rowCount).toBe(0);
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

  it("revokes an already issued Supabase session after downstream identity failure",async()=>{
    const login=await service!.begin("invited@example.com","test-network-a");
    auth.verifyAccessToken.mockRejectedValueOnce(new Error("User authentication invalid"));
    await expect(service!.verify(login,"123456","test-network-a"))
      .rejects.toThrow(BrowserLoginSessionSetupError);
    expect(otpClient.revoke).toHaveBeenCalledTimes(1);
    expect(otpClient.revoke).toHaveBeenCalledWith(access);
    expect(otpDiagnostics).toHaveBeenCalledWith({
      stage:"principal",reason:"identity_invalid"
    });
    const browserRows=await db!.query("SELECT 1 FROM public.ishikeit_browser_sessions");
    expect(browserRows.rowCount).toBe(0);
    const pending=await db!.query<{completed_at:Date|null}>(
      "SELECT completed_at FROM public.ishikeit_browser_login_attempts"
    );
    expect(pending.rows[0]?.completed_at).toBeNull();
  });

  it("reports 2xx provider payload failures as setup errors without secrets or token replay",async()=>{
    const login=await service!.begin("invited@example.com","test-network-b");
    otpClient.verifyOtp.mockRejectedValueOnce(
      new Error("Supabase authentication response invalid")
    );
    await expect(service!.verify(login,"123456","test-network-b"))
      .rejects.toThrow(BrowserLoginSessionSetupError);
    expect(otpDiagnostics).toHaveBeenCalledWith({
      stage:"provider_exchange",reason:"upstream_response_invalid"
    });
    expect(otpClient.revoke).not.toHaveBeenCalled();
  });

  it("limits OTP delivery per email and blocks replay and exhausted codes",async()=>{
    const login=await service!.begin("invited@example.com","test-network-a");
    await service!.begin("invited@example.com","test-network-b");
    await service!.begin("invited@example.com","test-network-c");
    await service!.begin("invited@example.com","test-network-d");
    // The app enforces an independent email cooldown even if Supabase's
    // provider quota is configured more permissively.
    expect(otpClient.sendOtp).toHaveBeenCalledTimes(1);
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

  it("uses keyed nonreversible rate buckets instead of predictable email SHA-256",async()=>{
    await service!.begin("invited@example.com","test-network-a");
    const rows=await db!.query<{bucket_hash:string}>(
      "SELECT bucket_hash FROM public.ishikeit_browser_auth_limits"
    );
    const guess=createHash("sha256").update("otp:email:invited@example.com").digest("hex");
    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.rows.some(row=>row.bucket_hash===guess)).toBe(false);
    expect(rows.rows.every(row=>/^[0-9a-f]{64}$/u.test(row.bucket_hash))).toBe(true);
  });

  it("removes only expired private records, preserving active session and current throttles",async()=>{
    const active=await service!.begin("invited@example.com","test-network-a");
    const old=await service!.begin("outsider@example.com","test-network-b");
    const session=await service!.verify(active,"123456","test-network-a");
    await db!.query(
      "UPDATE public.ishikeit_browser_login_attempts SET expires_at=now()-interval '1 second',requested_at=now()-interval '11 minutes' WHERE challenge_hash=$1",
      [createHash("sha256").update(old).digest("hex")]
    );
    await db!.query(
      "INSERT INTO public.ishikeit_browser_auth_limits(bucket_hash,hits,reset_at) VALUES($1,2,now()-interval '25 hours')",
      ["f".repeat(64)]
    );
    const cleaner=new PostgresBrowserAuthMaintenance(db!);
    const removed=await cleaner.runOnce();
    expect(removed.expiredAttempts).toBe(1);
    expect(removed.expiredSessions).toBe(0);
    expect(removed.oldRateBuckets).toBe(1);
    expect((await db!.query(
      "SELECT 1 FROM public.ishikeit_browser_sessions WHERE session_hash=$1",
      [createHash("sha256").update(session.cookieValue).digest("hex")]
    )).rowCount).toBe(1);
    await db!.query(
      "UPDATE public.ishikeit_browser_sessions SET created_at=now()-interval '13 hours',session_expires_at=now()-interval '1 second'"
    );
    const expired=await cleaner.runOnce();
    expect(expired.expiredSessions).toBe(1);
    await expect(service!.csrf(session.cookieValue)).rejects.toThrow(/session/i);
  });

  it("refuses unconfirmed, banned and deleted Auth users even if their membership is active",async()=>{
    const cases=[
      "UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1",
      "UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1",
      "UPDATE auth.users SET deleted_at=now() WHERE id=$1"
    ];
    for(let i=0;i<cases.length;i++){
      await db!.query(
        "UPDATE auth.users SET email_confirmed_at=now(),deleted_at=NULL,banned_until=NULL WHERE id=$1",
        [userId]
      );
      await db!.query(cases[i]!,[userId]);
      await service!.begin("invited@example.com","network-"+i);
      await db!.query("TRUNCATE public.ishikeit_browser_auth_limits");
    }
    expect(otpClient.sendOtp).not.toHaveBeenCalled();
    await db!.query(
      "UPDATE auth.users SET email_confirmed_at=now(),deleted_at=NULL,banned_until=NULL WHERE id=$1",
      [userId]
    );
    await service!.begin("invited@example.com","valid-network");
    expect(otpClient.sendOtp).toHaveBeenCalledTimes(1);
  });

  it("throttles OTP verification across different nonces and remote addresses for one account",async()=>{
    const nonces=[
      await service!.begin("invited@example.com","network-x"),
      await service!.begin("invited@example.com","network-y"),
      await service!.begin("invited@example.com","network-z")
    ];
    for(let i=0;i<10;i++){
      otpClient.verifyOtp.mockRejectedValueOnce(new Error("simulated rejected OTP"));
      await expect(service!.verify(
        nonces[Math.floor(i/5)]!,"111111","remote-"+i
      )).rejects.toThrow("simulated rejected OTP");
    }
    await expect(service!.verify(nonces[2]!,"111111","new-remote"))
      .rejects.toThrow(/verification rejected/i);
    expect(otpClient.verifyOtp).toHaveBeenCalledTimes(10);
    const count=await db!.query<{hits:number}>(
      "SELECT hits FROM public.ishikeit_browser_auth_limits WHERE hits>10"
    );
    expect(count.rows.some(row=>row.hits===11)).toBe(true);
  });

  it("requires MFA step-up before inviting workspace members through BFF",async()=>{
    const nonce=await service!.begin("invited@example.com","one-ip");
    const logged=await service!.verify(nonce,"123456","one-ip");
    const input={workspaceId,email:"new-member@example.com",role:"viewer" as const};
    await expect(service!.inviteWorkspaceMember(logged.cookieValue,input))
      .rejects.toThrow(/multi-factor/i);
    expect(memberInvites.invite).not.toHaveBeenCalled();
    await service!.enrollTotp(logged.cookieValue);
    const stepped=await service!.verifyTotp(logged.cookieValue,factorId,"123456");
    await expect(service!.inviteWorkspaceMember(logged.cookieValue,input))
      .rejects.toThrow(/session/i);
    expect((await service!.inviteWorkspaceMember(stepped.cookieValue,input)).status).toBe("invited");
    expect(memberInvites.invite).toHaveBeenCalledTimes(1);
    expect((await service!.get(stepped.cookieValue)).memberInvitationsEnabled).toBe(true);
  });

  it("enrolls only for a freshly verified workspace user, verifies TOTP and rotates tokens",async()=>{
    const nonce=await service!.begin("invited@example.com","one-ip");
    const session=await service!.verify(nonce,"123456","one-ip");
    expect(await service!.listTotpFactors(session.cookieValue)).toMatchObject({
      factors:[],pendingCount:0,canEnroll:true
    });
    const enrollment=await service!.enrollTotp(session.cookieValue);
    expect(enrollment).toEqual({factorId,secret:"JBSWY3DPEHPK3PXP"});
    expect(await service!.listTotpFactors(session.cookieValue)).toMatchObject({
      factors:[],pendingCount:1,canEnroll:true
    });
    const verified=await service!.verifyTotp(session.cookieValue,factorId,"234567");
    expect(verified.sessionId).toBe(authSessionId);
    expect(verified.workspaces.items).toHaveLength(1);
    expect(verified.cookieValue).not.toBe(session.cookieValue);
    expect(verified.csrfToken).not.toBe(session.csrfToken);
    await expect(service!.csrf(session.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.get(session.cookieValue)).rejects.toThrow(/session/i);
    expect(await service!.listTotpFactors(verified.cookieValue)).toMatchObject({
      factors:[factorId],pendingCount:0,canEnroll:true
    });
    const previous=await db!.query<{access_ciphertext:Buffer}>(
      "SELECT access_ciphertext FROM public.ishikeit_browser_sessions"
    );
    expect(previous.rows[0]?.access_ciphertext.includes(Buffer.from("mfa_access_"))).toBe(false);
    const backup=await service!.enrollTotp(verified.cookieValue);
    expect(backup.factorId).not.toBe(factorId);
    expect(auth.verifyPrivilegedAccessToken).toHaveBeenCalled();
    await expect(service!.verifyTotp(verified.cookieValue,randomUUID(),"123456"))
      .rejects.toThrow(/not available/i);
  });

  it("blocks duplicate pending enrollments without consuming rate budget",async()=>{
    const nonce=await service!.begin("invited@example.com","pending-guard-ip");
    const session=await service!.verify(nonce,"123456","pending-guard-ip");
    const first=await service!.enrollTotp(session.cookieValue);
    expect(first.secret).toBe("JBSWY3DPEHPK3PXP");
    await expect(service!.enrollTotp(session.cookieValue))
      .rejects.toBeInstanceOf(BrowserMfaPendingEnrollment);
    expect(mfa.enroll).toHaveBeenCalledTimes(1);
    expect((await service!.listTotpFactors(session.cookieValue)).pendingCount).toBe(1);
    await service!.clearIncompleteTotp(session.cookieValue);
    const next=await service!.enrollTotp(session.cookieValue);
    expect(next.factorId).not.toBe(first.factorId);
    expect(mfa.enroll).toHaveBeenCalledTimes(2);
  });

  it("makes repeated MFA enrollments explicitly rate limited, not 403 provider errors",async()=>{
    const nonce=await service!.begin("invited@example.com","rate-guard-ip");
    const session=await service!.verify(nonce,"123456","rate-guard-ip");
    for(let i=0;i<3;i++){
      await service!.enrollTotp(session.cookieValue);
      await service!.clearIncompleteTotp(session.cookieValue);
    }
    await expect(service!.enrollTotp(session.cookieValue))
      .rejects.toBeInstanceOf(BrowserMfaEnrollmentRateLimited);
    expect(mfa.enroll).toHaveBeenCalledTimes(3);
  });

  it("resets only incomplete TOTP enrollment through owner-bound provider API",async()=>{
    const nonce=await service!.begin("invited@example.com","recovery-network");
    const session=await service!.verify(nonce,"123456","recovery-network");
    const pending=await service!.enrollTotp(session.cookieValue);
    expect((await service!.listTotpFactors(session.cookieValue)).pendingCount).toBe(1);
    const result=await service!.clearIncompleteTotp(session.cookieValue);
    expect(result).toEqual({cleared:1});
    expect(mfa.unenroll).toHaveBeenCalledWith(access,pending.factorId);
    expect((await service!.listTotpFactors(session.cookieValue)).pendingCount).toBe(0);
    expect((await db!.query("SELECT 1 FROM auth.mfa_factors")).rowCount).toBe(0);
  });

  it("does not permit AAL1 to reset incomplete backup alongside a verified device",async()=>{
    const nonce=await service!.begin("invited@example.com","backup-network");
    const session=await service!.verify(nonce,"123456","backup-network");
    await service!.enrollTotp(session.cookieValue);
    const stepped=await service!.verifyTotp(session.cookieValue,factorId,"123456");
    const backup=await service!.enrollTotp(stepped.cookieValue);
    expect((await service!.listTotpFactors(stepped.cookieValue)).pendingCount).toBe(1);
    const normal=await db!.query<{count:string}>(
      "SELECT count(*)::text AS count FROM auth.mfa_factors WHERE status='verified'");
    expect(normal.rows[0]?.count).toBe("1");
    auth.verifyPrivilegedAccessToken.mockRejectedValueOnce(
      new Error("Multi-factor authentication required")
    );
    await expect(service!.clearIncompleteTotp(stepped.cookieValue))
      .rejects.toThrow(/multi-factor/i);
    expect(mfa.unenroll).not.toHaveBeenCalled();
    expect(await service!.clearIncompleteTotp(stepped.cookieValue)).toEqual({cleared:1});
    expect(mfa.unenroll).toHaveBeenCalledWith(
      "mfa_access_"+"x".repeat(60),backup.factorId);
    const factors=await service!.listTotpFactors(stepped.cookieValue);
    expect(factors).toMatchObject({factors:[factorId],pendingCount:0,canEnroll:true});
  });


  it("fails closed for signed-out provider sessions before CSRF or token refresh",async()=>{
    const login=await service!.begin("invited@example.com","revoked-provider-ip");
    const session=await service!.verify(login,"123456","revoked-provider-ip");
    expect((await service!.sessionStatus(session.cookieValue)).status).toBe("mfa_required");
    await db!.query("DELETE FROM auth.sessions WHERE id=$1",[authSessionId]);
    await expect(service!.csrf(session.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.sessionStatus(session.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.get(session.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.refresh(session.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.listTotpFactors(session.cookieValue)).rejects.toThrow(/session/i);
    expect(otpClient.refresh).not.toHaveBeenCalled();
    const erased=await new PostgresBrowserAuthMaintenance(db!).runOnce();
    expect(erased.expiredSessions).toBe(1);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_browser_sessions")).rowCount).toBe(0);
  });

  it("reclaims only orphaned BFF sessions while preserving the verified live provider-bound row",async()=>{
    const first=await service!.verify(
      await service!.begin("invited@example.com","orphan-ip-1"),"123456","orphan-ip-1"
    );
    const good=await service!.verify(
      await service!.begin("invited@example.com","orphan-ip-2"),"123456","orphan-ip-2"
    );
    // Simulate a remote provider logout of one session without reading
    // encrypted refresh/access tokens or touching the current user's other session.
    const orphanSessionId=randomUUID();
    await db!.query(
      "UPDATE public.ishikeit_browser_sessions SET auth_session_id=$2 WHERE session_hash=$1",
      [createHash("sha256").update(first.cookieValue).digest("hex"),orphanSessionId]
    );
    await expect(service!.csrf(first.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.sessionStatus(first.cookieValue)).rejects.toThrow(/session/i);
    expect((await service!.sessionStatus(good.cookieValue)).status).toBe("mfa_required");
    const result=await new PostgresBrowserAuthMaintenance(db!).runOnce();
    expect(result.expiredSessions).toBe(1);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_browser_sessions")).rowCount).toBe(1);
    expect((await service!.sessionStatus(good.cookieValue)).status).toBe("mfa_required");
  });

  it("rotates the BFF cookie and CSRF on AAL2 step-up; logout destroys active local session",async()=>{
    const first=await service!.verify(
      await service!.begin("invited@example.com","logout-verified-ip"),
      "123456","logout-verified-ip"
    );
    expect((await service!.sessionStatus(first.cookieValue)).status).toBe("mfa_required");
    await service!.enrollTotp(first.cookieValue);
    const second=await service!.verifyTotp(first.cookieValue,factorId,"123456");
    expect(second.cookieValue).not.toBe(first.cookieValue);
    expect(second.csrfToken).not.toBe(first.csrfToken);
    expect((await service!.sessionStatus(second.cookieValue)).status).toBe("authenticated");
    await expect(service!.get(first.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.csrf(first.cookieValue)).rejects.toThrow(/session/i);
    await service!.logout(second.cookieValue);
    await expect(service!.sessionStatus(second.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.csrf(second.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.refresh(second.cookieValue)).rejects.toThrow(/session/i);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_browser_sessions")).rowCount).toBe(0);
    expect(otpClient.revoke).toHaveBeenCalledWith("mfa_access_"+"x".repeat(60));
  });

  it("recovers with backup factor after a new AAL1 login without exposing workspaces",async()=>{
    const initial=await service!.verify(
      await service!.begin("invited@example.com","backup-setup-ip"),
      "123456","backup-setup-ip"
    );
    await service!.enrollTotp(initial.cookieValue);
    const primary=await service!.verifyTotp(initial.cookieValue,factorId,"123456");
    const backup=await service!.enrollTotp(primary.cookieValue);
    const protectedSession=await service!.verifyTotp(primary.cookieValue,backup.factorId,"234567");
    expect((await service!.sessionStatus(protectedSession.cookieValue)).status)
      .toBe("authenticated");
    const factors=await db!.query<{id:string;status:string}>(
      "SELECT id,status FROM auth.mfa_factors ORDER BY id"
    );
    expect(factors.rows.filter(f=>f.status==="verified")).toHaveLength(2);
    const fresh=await service!.verify(
      await service!.begin("invited@example.com","recover-backup-ip"),
      "123456","recover-backup-ip"
    );
    const emailOnly=await service!.sessionStatus(fresh.cookieValue);
    expect(emailOnly.status).toBe("mfa_required");
    expect(emailOnly).not.toHaveProperty("workspaces");
    await expect(service!.listWorkspaces(fresh.cookieValue)).rejects.toThrow(/multi-factor/i);
    const recovered=await service!.verifyTotp(fresh.cookieValue,backup.factorId,"345678");
    expect((await service!.sessionStatus(recovered.cookieValue)).status)
      .toBe("authenticated");
    expect((await service!.get(recovered.cookieValue)).workspaces.items).toHaveLength(1);
    const binding=await db!.query<{matches:boolean}>(
      "SELECT factor_id=$1::uuid AS matches FROM auth.sessions WHERE id=$2",
      [backup.factorId,authSessionId]
    );
    expect(binding.rows[0]?.matches).toBe(true);
  });

  it("makes logout locally final even when remote provider revocation is unavailable",async()=>{
    const fresh=await service!.verify(
      await service!.begin("invited@example.com","logout-fail-ip"),
      "123456","logout-fail-ip"
    );
    otpClient.revoke.mockRejectedValueOnce(new Error("Remote service unavailable"));
    await service!.logout(fresh.cookieValue);
    expect((await db!.query("SELECT 1 FROM public.ishikeit_browser_sessions")).rowCount).toBe(0);
    await expect(service!.csrf(fresh.cookieValue)).rejects.toThrow(/session/i);
    await expect(service!.sessionStatus(fresh.cookieValue)).rejects.toThrow(/session/i);
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
