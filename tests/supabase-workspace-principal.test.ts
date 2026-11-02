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
function fakeDb(active: boolean, fail = false): Pick<PostgresDatabase,"query"> {
  return {
    query: vi.fn((sql: string, params?: readonly unknown[]) => {
      if(fail) throw new Error("db secret must never appear");
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
  dbFail?:boolean; fetchFail?:boolean; calls?: ReturnType<typeof vi.fn>;
} = {}) {
  const observed = opts.calls ?? vi.fn();
  return new SupabaseAuthPrincipalVerifier({
    projectUrl:origin,publishableKey:key,db:fakeDb(opts.active ?? true,opts.dbFail),
    now:()=>now,
    fetchImpl: (url,options) => {
      observed(url,options);
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
      accessToken:jwt(),workspaceId:"123e4567-e89b-42d3-a456-426614174000",
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
