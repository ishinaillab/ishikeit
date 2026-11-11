import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SupabaseAuthPrincipalVerifier } from "../src/auth/supabase-workspace-principal.js";
import { AuthenticatedWorkspaceConnectionIntents } from "../src/auth/authenticated-workspace-connection.js";
import type { PostgresDatabase } from "../src/persistence/postgres.js";

const project = "abcdefghijklmnopqrst";
const origin = `https://${project}.supabase.co`;
const issuer = origin + "/auth/v1";
const key = "sb_publishable_testing_isolated_no_real_key";
const subject = randomUUID();
const sessionId = randomUUID();
const now = Date.parse("2026-11-02T02:00:00Z");

function jwt(overrides: Record<string,unknown> = {}): string {
  const payload = {
    iss:issuer,aud:"authenticated",sub:subject,session_id:sessionId,
    role:"authenticated",exp:Math.floor((now+3600000)/1000),...overrides
  };
  const header = Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url");
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return header+"."+data+".synthetic_signature_only_not_accepted_by_real_auth";
}
function fakeDb(active: boolean, fail = false, factorVerified = true, sessionAal2 = true): Pick<PostgresDatabase,"query"> {
  return {
    query: vi.fn((sql: string, params?: readonly unknown[]) => {
      if(fail) throw new Error("db secret must never appear");
      if(sql.includes("auth.mfa_factors")){
        // The factor must belong to the exact live AAL2 session, not merely
        // be any verified backup device enrolled on the same user account.
        expect(sql).toContain("s.id=$1::uuid AND s.user_id=$2::uuid");
        expect(sql).toContain("s.aal='aal2'");
        expect(sql).toContain("f.id=s.factor_id AND f.user_id=s.user_id");
        expect(sql).toContain("f.status='verified'");
        expect(sql).toContain("ishikeit_browser_disabled_totp_factors");
        expect(sql).toContain("d.factor_id=f.id");
        expect(params).toEqual([sessionId,subject]);
        return Promise.resolve({rows:[{verified:factorVerified && sessionAal2}],rowCount:1});
      }
      expect(sql).toContain("auth.sessions");
      expect(params).toEqual([sessionId,subject]);
      return Promise.resolve({rows:[{active}],rowCount:1});
    })
  } as unknown as Pick<PostgresDatabase,"query">;
}
function fakeResponse(status = 200, overrides: Record<string,unknown> = {}) {
  const body = {
    id:subject,role:"authenticated",is_anonymous:false,...overrides
  };
  return new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json"}
  });
}
function verifier(opts: {
  status?:number;user?:Record<string,unknown>;active?:boolean;
  dbFail?:boolean; fetchFail?:boolean; factorVerified?:boolean; sessionAal2?:boolean;
  calls?: (url: string | URL | Request, options?: RequestInit) => void;
} = {}) {
  return new SupabaseAuthPrincipalVerifier({
    projectUrl:origin,publishableKey:key,
    db:fakeDb(opts.active ?? true,opts.dbFail,opts.factorVerified ?? true,opts.sessionAal2 ?? true),
    now:()=>now,
    fetchImpl: (url,options) => {
      opts.calls?.(url,options);
      if(opts.fetchFail) return Promise.reject(new Error("secret upstream content"));
      return Promise.resolve(fakeResponse(opts.status ?? 200,opts.user));
    }
  });
}

describe("trusted Supabase Auth user and live session workspace boundary", () => {
  it("gets current user from the exact official Auth server and checks live session",async()=>{
    const calls=vi.fn();
    const subjectVerifier=verifier({calls});
    const token=jwt();
    const verified=await subjectVerifier.verifyAccessToken(token);
    expect(verified).toEqual({
      principal:{issuer,subject},
      sessionId,
      expiresAt:new Date(now+3600000).toISOString()
    });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls).toHaveBeenCalledWith(issuer+"/user",expect.objectContaining({
      method:"GET",redirect:"error",cache:"no-store",
      headers:{Authorization:"Bearer "+token,apikey:key,Accept:"application/json"}
    }));
  });

  it("rejects expired, foreign issuer, unsupported audience/role and malformed tokens BEFORE fetch",async()=>{
    const calls=vi.fn();
    const subjectVerifier=verifier({calls});
    for(const token of [
      "arbitrary-token-not-a-jwt",
      jwt({iss:"https://evil.example/auth/v1"}),
      jwt({aud:"service_role"}),
      jwt({role:"service_role"}),
      jwt({exp:Math.floor(now/1000)-60}),
      jwt({sub:randomUUID()})
    ]){
      await expect(subjectVerifier.verifyAccessToken(token)).rejects.toThrow();
    }
    // The wrong subject is NOT rejected before fetch; the trusted response
    // must identify whether the exact signed token belongs to that subject.
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("rejects server-side identity mismatch, anonymous accounts and banned accounts",async()=>{
    await expect(verifier({user:{id:randomUUID()}}).verifyAccessToken(jwt()))
      .rejects.toThrow(/authentication invalid/i);
    await expect(verifier({user:{is_anonymous:true}}).verifyAccessToken(jwt()))
      .rejects.toThrow(/authentication invalid/i);
    await expect(verifier({user:{role:"service_role"}}).verifyAccessToken(jwt()))
      .rejects.toThrow(/authentication invalid/i);
    await expect(verifier({user:{banned_until:new Date(now+600000).toISOString()}})
      .verifyAccessToken(jwt())).rejects.toThrow(/authentication invalid/i);
  });

  it("rejects revoked signed-out sessions despite valid token and user readback",async()=>{
    await expect(verifier({active:false}).verifyAccessToken(jwt()))
      .rejects.toThrow(/authentication invalid/i);
    await expect(verifier({dbFail:true}).verifyAccessToken(jwt()))
      .rejects.toThrow("User session verification unavailable");
  });

  it("fails closed on upstream rejection or outage without logging provider response",async()=>{
    await expect(verifier({status:401}).verifyAccessToken(jwt()))
      .rejects.toThrow("User authentication invalid");
    await expect(verifier({status:503}).verifyAccessToken(jwt()))
      .rejects.toThrow("User authentication unavailable");
    await expect(verifier({fetchFail:true}).verifyAccessToken(jwt()))
      .rejects.toThrow("User authentication unavailable");
  });

  it("rejects confused projects, HTTP, and service-role/secret credentials at setup",()=>{
    const db=fakeDb(true);
    for(const bad of [
      "http://"+project+".supabase.co",
      "https://"+project+".supabase.co.evil.example",
      "https://"+project+".supabase.co/anything",
      "https://"+project+".supabase.co/?redirect=evil"
    ]){
      expect(()=>new SupabaseAuthPrincipalVerifier({
        projectUrl:bad,publishableKey:key,db
      })).toThrow();
    }
    for(const badKey of ["service_role_secret","sb_secret_real_secret_key","fake"]){
      expect(()=>new SupabaseAuthPrincipalVerifier({
        projectUrl:origin,publishableKey:badKey,db
      })).toThrow(/publishable key/i);
    }
  });

  it("requires aal2 verified through the exact Supabase bearer AND a current enrolled factor",async()=>{
    const verified=verifier();
    await expect(verified.verifyPrivilegedAccessToken(jwt()))
      .rejects.toThrow("Multi-factor authentication required");
    await expect(verified.verifyPrivilegedAccessToken(jwt({aal:"aal1"})))
      .rejects.toThrow("Multi-factor authentication required");
    await expect(verified.verifyPrivilegedAccessToken(jwt({aal:"aal2"})))
      .resolves.toMatchObject({principal:{issuer,subject},sessionId});
    await expect(verifier({factorVerified:false})
      .verifyPrivilegedAccessToken(jwt({aal:"aal2"})))
      .rejects.toThrow("Multi-factor authentication required");
    await expect(verifier({dbFail:true})
      .verifyPrivilegedAccessToken(jwt({aal:"aal2"})))
      .rejects.toThrow(/verification unavailable/i);
  });

  it("rejects stale AAL2 after the session-bound primary is unenrolled, even if a backup is verified",async()=>{
    // SQL must join this session's factor_id. An unrelated verified backup
    // factor must never make the result true once the original is removed.
    await expect(verifier({factorVerified:false})
      .verifyPrivilegedAccessToken(jwt({aal:"aal2"})))
      .rejects.toThrow("Multi-factor authentication required");
  });

  it("rejects an issuer-signed AAL2 JWT after the live session has been downgraded",async()=>{
    await expect(verifier({sessionAal2:false})
      .verifyPrivilegedAccessToken(jwt({aal:"aal2"})))
      .rejects.toThrow("Multi-factor authentication required");
  });

  it("denies account connection when only aal1 is present without touching storage",async()=>{
    const begin=vi.fn();
    const consume=vi.fn();
    const facade=new AuthenticatedWorkspaceConnectionIntents(verifier(),{begin,consume});
    const request={
      accessToken:jwt(),workspaceId:"123e4567-e89b-42d3-a456-426614174000",
      provider:"instagram",providerApplicationKey:"test-app",
      redirectUri:"https://apps.example.test/callback"
    };
    await expect(facade.begin(request)).rejects.toThrow(/multi-factor/i);
    await expect(facade.consume({
      ...request,state:"valid-authorizer-state-123456789",
      browserNonce:"valid-browser-nonce-123456789"
    })).rejects.toThrow(/multi-factor/i);
    expect(begin).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("never accepts principal or role from an untrusted connect request",async()=>{
    const identity=verifier();
    const begin=vi.fn((input: unknown) => {
      expect(input).toMatchObject({
        actor:{issuer,subject},sessionId,workspaceId:"123e4567-e89b-42d3-a456-426614174000"
      });
      return Promise.resolve({state:"s",browserNonce:"n",codeChallenge:"c",expiresAt:"2027-01-01T00:00:00Z"});
    });
    const consume=vi.fn((input:unknown)=>{
      expect(input).toMatchObject({actor:{issuer,subject},sessionId});
      return Promise.resolve(undefined);
    });
    const facade = new AuthenticatedWorkspaceConnectionIntents(identity,{
      begin,consume
    });
    const req={
      accessToken:jwt({aal:"aal2"}),workspaceId:"123e4567-e89b-42d3-a456-426614174000",
      provider:"instagram",providerApplicationKey:"test-app",
      redirectUri:"https://apps.example.test/callback"
    };
    await facade.begin(req);
    await facade.consume({...req,state:"valid-authorizer-state-123456789",browserNonce:"valid-browser-nonce-123456789"});
    expect(begin).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledTimes(1);
    await expect(facade.begin({...req,actor:{issuer:"fake",subject:"attacker"}} as typeof req))
      .rejects.toThrow();
  });

  it("does not call intent storage without a valid live session",async()=>{
    const fakeIntents={begin:vi.fn(),consume:vi.fn()};
    const facade = new AuthenticatedWorkspaceConnectionIntents(
      verifier({active:false}),fakeIntents
    );
    await expect(facade.begin({
      accessToken:jwt(),workspaceId:randomUUID(),provider:"instagram",
      providerApplicationKey:"test-app",redirectUri:"https://apps.example.test/callback"
    })).rejects.toThrow(/authentication invalid/i);
    expect(fakeIntents.begin).not.toHaveBeenCalled();
  });
});
