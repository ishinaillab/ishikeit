import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { CredentialCipher, EncryptedCredentialValue } from "./credential-cipher.js";
import type { SupabaseAuthPrincipalVerifier, VerifiedIshikeitSession } from "./supabase-workspace-principal.js";
import type { SupabaseEmailOtpClient, SupabaseIssuedTokens } from "./supabase-email-otp.js";
import type { AuthenticatedWorkspacePortfolio, WorkspacePage } from "./authenticated-workspace-portfolio.js";
import type { PostgresDatabase, SqlExecutor } from "../persistence/postgres.js";

const bearer = z.string().min(20).max(4096).regex(/^[A-Za-z0-9_-]+$/u);
const normalizedEmail = z.email().min(3).max(320).transform(x=>x.trim().toLowerCase());
const otp = z.string().regex(/^[0-9]{6,8}$/u);
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function newSecret(): string { return randomBytes(32).toString("base64url"); }
function safeEqual(a: string, b: string): boolean {
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length && timingSafeEqual(x,y);
}
function encrypted(ciphertext: Buffer, iv: Buffer, tag: Buffer): EncryptedCredentialValue {
  return { ciphertext,iv,tag };
}
interface ChallengeRow extends pg.QueryResultRow { email_address:string }
interface RateRow extends pg.QueryResultRow { hits:number }
interface MemberRow extends pg.QueryResultRow { eligible:boolean }
interface BrowserSessionRow extends pg.QueryResultRow {
  user_id:string; auth_session_id:string;
  access_ciphertext:Buffer; access_iv:Buffer; access_tag:Buffer;
  refresh_ciphertext:Buffer; refresh_iv:Buffer; refresh_tag:Buffer;
  access_expires_at:Date; session_expires_at:Date;
}

export interface BrowserAuthSuccess {
  cookieValue:string;
  csrfToken:string;
}
export interface BrowserIdentitySummary {
  sessionId:string;
  expiresAt:string;
  csrfToken:string;
  workspaces:WorkspacePage;
}

/** Server-held Supabase tokens. The browser receives ONLY a random opaque cookie
 * and CSRF token, never a Supabase access/refresh token or user role assertion.
 * All SQL writes use the privileged, private server-side DB connection.
 */
export class PrivateBrowserAuthService {
  readonly #origin:string;
  readonly #csrfKey:Buffer;
  constructor(private readonly deps:{
    projectUrl:string;
    db:Pick<PostgresDatabase,"query"|"transaction">;
    cipher:CredentialCipher;
    auth:Pick<SupabaseAuthPrincipalVerifier,"verifyAccessToken">;
    otp:Pick<SupabaseEmailOtpClient,"sendOtp"|"verifyOtp"|"refresh"|"revoke">;
    portfolio:Pick<AuthenticatedWorkspacePortfolio,"list">;
    csrfKeyBase64:string;
  }){
    const origin=new URL(deps.projectUrl);
    if (origin.protocol!=="https:" || !/^[a-z0-9]{20}\.supabase\.co$/u.test(origin.hostname)
      || origin.pathname!=="/" || origin.search || origin.hash || origin.username
      || origin.password || origin.port) throw new Error("Invalid project origin");
    this.#origin=origin.origin+"/auth/v1";
    const key=Buffer.from(deps.csrfKeyBase64,"base64");
    if(key.length!==32 || key.toString("base64")!==deps.csrfKeyBase64)
      throw new Error("Browser CSRF key must be 32 bytes of canonical base64");
    this.#csrfKey=key;
  }

  csrfForCookie(cookie: string): string {
    bearer.parse(cookie);
    return createHmac("sha256",this.#csrfKey)
      .update("ishikeit-browser-csrf-v1\0"+cookie).digest("base64url");
  }
  assertCsrf(cookie: string, submitted: string | undefined): void {
    if(typeof submitted!=="string" || !/^[A-Za-z0-9_-]{43}$/u.test(submitted)
      || !safeEqual(this.csrfForCookie(cookie),submitted)) {
      throw new Error("Invalid browser CSRF token");
    }
  }

  async #limit(bucket:string,max:number,seconds:number):Promise<boolean> {
    const result=await this.deps.db.query<RateRow>(
      `INSERT INTO public.ishikeit_browser_auth_limits(bucket_hash,hits,reset_at)
       VALUES($1,1,now()+$2::integer*interval '1 second')
       ON CONFLICT(bucket_hash) DO UPDATE SET
         hits=CASE WHEN ishikeit_browser_auth_limits.reset_at<=now() THEN 1
                   ELSE ishikeit_browser_auth_limits.hits+1 END,
         reset_at=CASE WHEN ishikeit_browser_auth_limits.reset_at<=now()
                      THEN now()+$2::integer*interval '1 second'
                      ELSE ishikeit_browser_auth_limits.reset_at END
       RETURNING hits`,[sha256(bucket),seconds]
    );
    return (result.rows[0]?.hits??max+1)<=max;
  }

  async begin(emailInput:string,networkId:string):Promise<string> {
    const email=normalizedEmail.parse(emailInput);
    const loginCookie=newSecret();
    const passed=await Promise.all([
      this.#limit("otp:email:"+email,3,900),
      this.#limit("otp:remote:"+networkId,30,900)
    ]);
    // Always respond identically to avoid exposing whether a user exists.
    if(passed.every(Boolean)){
      await this.deps.db.query(
        `INSERT INTO public.ishikeit_browser_login_attempts
         (challenge_hash,email_address,expires_at)
         VALUES($1,$2,now()+interval '10 minutes')`,
        [sha256(loginCookie),email]
      );
      const known=await this.deps.db.query<MemberRow>(
        `SELECT EXISTS(
           SELECT 1 FROM auth.users u
           JOIN public.ishikeit_workspace_memberships m
             ON m.auth_subject=u.id::text AND m.auth_issuer=$1
           JOIN public.ishikeit_workspaces w ON w.workspace_id=m.workspace_id
           WHERE lower(u.email)=$2 AND u.is_anonymous=false
             AND m.state='active' AND w.state='active'
         ) AS eligible`,[this.#origin,email]
      );
      if(known.rows[0]?.eligible===true){
        try { await this.deps.otp.sendOtp(email); }
        catch { /* Stable public response; provider/transport failures are not exposed. */ }
      }
    }
    return loginCookie;
  }

  async #consumeLogin(cookie:string,code:string,networkId:string):Promise<string|undefined>{
    bearer.parse(cookie);otp.parse(code);
    if(!await this.#limit("verify:remote:"+networkId,30,900))return undefined;
    const result=await this.deps.db.query<ChallengeRow>(
      `UPDATE public.ishikeit_browser_login_attempts
        SET tries=tries+1
        WHERE challenge_hash=$1 AND completed_at IS NULL
          AND expires_at>now() AND tries<5
        RETURNING email_address`,[sha256(cookie)]
    );
    return result.rows[0]?.email_address;
  }

  async verify(loginCookie:string,code:string,networkId:string):Promise<BrowserAuthSuccess> {
    const email=await this.#consumeLogin(loginCookie,code,networkId);
    if(email===undefined)throw new Error("Login verification rejected");
    const tokens=await this.deps.otp.verifyOtp(email,code);
    const verified=await this.deps.auth.verifyAccessToken(tokens.access_token);
    const memberships=await this.deps.portfolio.list(tokens.access_token,{pageSize:1});
    if(memberships.items.length===0){
      try{ await this.deps.otp.revoke(tokens.access_token); }catch{/* deny */ }
      throw new Error("Login verification rejected");
    }
    const result=await this.deps.db.transaction(async tx=>{
      const consumed=await tx.query(
        `UPDATE public.ishikeit_browser_login_attempts SET completed_at=now()
         WHERE challenge_hash=$1 AND completed_at IS NULL AND expires_at>now()
         RETURNING challenge_hash`,[sha256(loginCookie)]
      );
      if(consumed.rowCount!==1)throw new Error("Login verification rejected");
      const value=newSecret();
      await this.#insertSession(tx,value,tokens,verified);
      return value;
    });
    return {cookieValue:result,csrfToken:this.csrfForCookie(result)};
  }

  async #insertSession(tx:SqlExecutor,value:string,tokens:SupabaseIssuedTokens,
    verified:VerifiedIshikeitSession):Promise<void>{
    const hash=sha256(value);
    const access=this.deps.cipher.encrypt(tokens.access_token,"ishikeit-browser-v1\0"+hash+"\0access");
    const refresh=this.deps.cipher.encrypt(tokens.refresh_token,"ishikeit-browser-v1\0"+hash+"\0refresh");
    await tx.query(
      `INSERT INTO public.ishikeit_browser_sessions(
        session_hash,user_id,auth_session_id,
        access_ciphertext,access_iv,access_tag,
        refresh_ciphertext,refresh_iv,refresh_tag,
        access_expires_at,session_expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '12 hours')`,
      [hash,verified.principal.subject,verified.sessionId,
        access.ciphertext,access.iv,access.tag,
        refresh.ciphertext,refresh.iv,refresh.tag,new Date(verified.expiresAt)]
    );
  }

  async #load(tx:SqlExecutor,cookie:string,locked:boolean):Promise<BrowserSessionRow> {
    bearer.parse(cookie);
    const result=await tx.query<BrowserSessionRow>(
      `SELECT user_id,auth_session_id,access_ciphertext,access_iv,access_tag,
         refresh_ciphertext,refresh_iv,refresh_tag,access_expires_at,session_expires_at
       FROM public.ishikeit_browser_sessions
       WHERE session_hash=$1 AND revoked_at IS NULL AND session_expires_at>now()
       ${locked?"FOR UPDATE":""}`,[sha256(cookie)]
    );
    if(result.rows[0]===undefined)throw new Error("Browser session unavailable");
    return result.rows[0];
  }

  async #bearer(cookie:string):Promise<{access:string;verified:VerifiedIshikeitSession}> {
    const row=await this.deps.db.transaction(tx=>this.#load(tx,cookie,false));
    if(row.access_expires_at.getTime()<=Date.now()+5000)throw new Error("Browser session refresh required");
    const access=this.deps.cipher.decrypt(
      encrypted(row.access_ciphertext,row.access_iv,row.access_tag),
      "ishikeit-browser-v1\0"+sha256(cookie)+"\0access"
    );
    const verified=await this.deps.auth.verifyAccessToken(access);
    if(verified.principal.subject!==row.user_id || verified.sessionId!==row.auth_session_id)
      throw new Error("Browser session unavailable");
    return {access,verified};
  }

  /** CSRF recovery for an unexpired BFF cookie when its Supabase access
   * token has expired. It never returns a bearer token or grants membership.
   * Strict same-origin HTTP transport must guard the response.
   */
  async csrf(cookie:string):Promise<string> {
    bearer.parse(cookie);
    const result=await this.deps.db.query(
      `SELECT 1 FROM public.ishikeit_browser_sessions
       WHERE session_hash=$1 AND revoked_at IS NULL AND session_expires_at>now()`,
      [sha256(cookie)]
    );
    if(result.rowCount!==1)throw new Error("Browser session unavailable");
    return this.csrfForCookie(cookie);
  }

  async get(cookie:string):Promise<BrowserIdentitySummary> {
    const {access,verified}=await this.#bearer(cookie);
    const workspaces=await this.deps.portfolio.list(access,{pageSize:50});
    if(workspaces.items.length===0)throw new Error("Browser workspace membership unavailable");
    return {sessionId:verified.sessionId,expiresAt:verified.expiresAt,
      csrfToken:this.csrfForCookie(cookie),workspaces};
  }

  async listWorkspaces(cookie:string,after?:string):Promise<WorkspacePage> {
    const {access}=await this.#bearer(cookie);
    return this.deps.portfolio.list(access,{
      pageSize:20,...(after===undefined?{}:{after})
    });
  }

  /** Atomic row lock serializes rotating Supabase refresh tokens across tabs
   * and all Hostinger replicas. Never retry an ambiguous refresh response:
   * the IdP may have already rotated the one-time-use refresh token.
   */
  async refresh(cookie:string):Promise<BrowserIdentitySummary> {
    bearer.parse(cookie);
    const value=await this.deps.db.transaction(async tx=>{
      const row=await this.#load(tx,cookie,true);
      const hash=sha256(cookie);
      const refresh=this.deps.cipher.decrypt(
        encrypted(row.refresh_ciphertext,row.refresh_iv,row.refresh_tag),
        "ishikeit-browser-v1\0"+hash+"\0refresh"
      );
      const tokens=await this.deps.otp.refresh(refresh);
      const verified=await this.deps.auth.verifyAccessToken(tokens.access_token);
      if(verified.principal.subject!==row.user_id || verified.sessionId!==row.auth_session_id)
        throw new Error("Session refresh identity mismatch");
      const accessNew=this.deps.cipher.encrypt(tokens.access_token,"ishikeit-browser-v1\0"+hash+"\0access");
      const refreshNew=this.deps.cipher.encrypt(tokens.refresh_token,"ishikeit-browser-v1\0"+hash+"\0refresh");
      await tx.query(
        `UPDATE public.ishikeit_browser_sessions SET
          access_ciphertext=$2,access_iv=$3,access_tag=$4,
          refresh_ciphertext=$5,refresh_iv=$6,refresh_tag=$7,
          access_expires_at=$8,updated_at=now()
         WHERE session_hash=$1 AND revoked_at IS NULL`,
        [hash,accessNew.ciphertext,accessNew.iv,accessNew.tag,
          refreshNew.ciphertext,refreshNew.iv,refreshNew.tag,new Date(verified.expiresAt)]
      );
      return {access:tokens.access_token,verified};
    });
    const workspaces=await this.deps.portfolio.list(value.access,{pageSize:50});
    if(workspaces.items.length===0)throw new Error("Browser workspace membership unavailable");
    return {sessionId:value.verified.sessionId,expiresAt:value.verified.expiresAt,
      csrfToken:this.csrfForCookie(cookie),workspaces};
  }

  async logout(cookie:string):Promise<void>{
    bearer.parse(cookie);
    // Revoke LOCAL cookie first, regardless of remote provider availability.
    const hash=sha256(cookie);
    const row=await this.deps.db.transaction(async tx=>{
      const previous=await tx.query<BrowserSessionRow>(
        `UPDATE public.ishikeit_browser_sessions SET revoked_at=now()
         WHERE session_hash=$1 AND revoked_at IS NULL
         RETURNING user_id,auth_session_id,access_ciphertext,access_iv,access_tag,
                   refresh_ciphertext,refresh_iv,refresh_tag,access_expires_at,session_expires_at`,
        [hash]
      );
      return previous.rows[0];
    });
    if(row!==undefined){
      try {
        const access=this.deps.cipher.decrypt(
          encrypted(row.access_ciphertext,row.access_iv,row.access_tag),
          "ishikeit-browser-v1\0"+hash+"\0access"
        );
        await this.deps.otp.revoke(access);
      }catch{ /* Local revocation is immediate and permanent. */ }
    }
  }
}
