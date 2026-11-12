import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { CredentialCipher, EncryptedCredentialValue } from "./credential-cipher.js";
import type { SupabaseAuthPrincipalVerifier, VerifiedIshikeitSession } from "./supabase-workspace-principal.js";
import type { SupabaseEmailOtpClient, SupabaseIssuedTokens } from "./supabase-email-otp.js";
import type { SupabaseTotpMfaClient, TotpEnrollment } from "./supabase-totp-mfa.js";
import type { AuthenticatedWorkspacePortfolio, WorkspacePage } from "./authenticated-workspace-portfolio.js";
import type { PostgresDatabase, SqlExecutor } from "../persistence/postgres.js";
import type { PostgresWorkspaceInvitations, InviteSummary } from "./workspace-member-invitations.js";

const bearer = z.string().min(20).max(4096).regex(/^[A-Za-z0-9_-]+$/u);
const normalizedEmail = z.email().min(3).max(320).transform(x=>x.trim().toLowerCase());
const otp = z.string().regex(/^[0-9]{6,10}$/u);
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
interface ChallengeRow extends pg.QueryResultRow {
  email_ciphertext:Buffer; email_iv:Buffer; email_tag:Buffer
}
interface RateRow extends pg.QueryResultRow { hits:number }
interface PendingChallengeRow extends pg.QueryResultRow { present:boolean }
interface TotpFactorRow extends pg.QueryResultRow {
  id:string; status:string; factor_type:string;
  created_at?:Date;label?:string
}
interface MfaPolicyRow extends pg.QueryResultRow { sign_in_2fa_enabled:boolean }
export interface BrowserMfaDevice {
  factorId:string;label:string;enrolledAt:string;enabled:boolean;
}
export interface BrowserMfaFactorStatus {
  factors:readonly string[];
  devices:readonly BrowserMfaDevice[];
  pendingCount:number;canEnroll:boolean;signIn2faEnabled:boolean;
}
export type BrowserMfaSettingsChange =
  | {signedOut:false;cookieValue:string;csrfToken:string}
  | {signedOut:true;removed:number};
export type BrowserMfaSettingsMutation =
  | {kind:"sign_in";enabled:boolean;proofFactorId:string;code:string}
  | {kind:"remove";factorId:string;proofFactorId:string;code:string}
  | {kind:"disable_app";proofFactorId:string;code:string}
  | {kind:"rename";factorId:string;name:string;proofFactorId:string;code:string};
export class BrowserMfaPartialDeletionError extends Error {
  constructor(){
    super("Provider factor removal requires a fresh authoritative check");
    this.name="BrowserMfaPartialDeletionError";
  }
}
export class BrowserMfaLastAuthenticatorError extends Error {
  constructor(){super("An existing verified authenticator is required to approve changes");
    this.name="BrowserMfaLastAuthenticatorError";}
}
/** Public error classes avoid converting enrollment throttles into generic 403. */
export class BrowserMfaEnrollmentRateLimited extends Error {
  constructor(){super("MFA enrollment rate limited");this.name="BrowserMfaEnrollmentRateLimited";}
}
export class BrowserMfaPendingEnrollment extends Error {
  constructor(){super("Incomplete MFA setup exists");this.name="BrowserMfaPendingEnrollment";}
}
export type BrowserMfaFailureReason =
  "rate_limited"|"incomplete_setup"|"provider_unavailable"
  |"provider_rejected"|"provider_response_invalid"|"invalid_session"|"unexpected";
function mfaReason(error:unknown):BrowserMfaFailureReason {
  if(error instanceof BrowserMfaEnrollmentRateLimited)return "rate_limited";
  if(error instanceof BrowserMfaPendingEnrollment)return "incomplete_setup";
  if(!(error instanceof Error))return "unexpected";
  switch(error.message){
    case "MFA provider unavailable":return "provider_unavailable";
    case "MFA provider rejected the request":return "provider_rejected";
    case "Invalid MFA provider response":return "provider_response_invalid";
    case "Browser session unavailable":
    case "Browser session refresh required":
    case "User authentication invalid":return "invalid_session";
    default:return "unexpected";
  }
}
interface CountRow extends pg.QueryResultRow { n:number }
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

/** Only fixed, non-sensitive stage classifications may be written to logs. */
export type BrowserOtpFailureStage =
  "challenge" | "provider_exchange" | "principal" | "workspace" | "session";
export type BrowserOtpFailureReason =
  "invalid_challenge" | "upstream_rejected" | "upstream_unavailable"
  | "upstream_response_invalid" | "identity_invalid" | "identity_unavailable"
  | "session_validation_unavailable" | "unexpected_failure";
export type BrowserOtpFailureDiagnostic = {
  stage:BrowserOtpFailureStage; reason:BrowserOtpFailureReason;
};
function browserOtpReason(error:unknown):BrowserOtpFailureReason {
  if(!(error instanceof Error))return "unexpected_failure";
  switch(error.message) {
    case "Login verification rejected": return "invalid_challenge";
    case "Supabase authentication rejected": return "upstream_rejected";
    case "Supabase authentication service unavailable": return "upstream_unavailable";
    case "Supabase authentication response invalid": return "upstream_response_invalid";
    case "User authentication invalid": return "identity_invalid";
    case "User authentication unavailable": return "identity_unavailable";
    case "User session verification unavailable": return "session_validation_unavailable";
    default: return "unexpected_failure";
  }
}

/** A code may already have been consumed by Supabase, so retrying it is wrong. */
export class BrowserLoginSessionSetupError extends Error {
  constructor() {
    super("Secure browser session could not be established");
    this.name="BrowserLoginSessionSetupError";
  }
}
export interface BrowserIdentitySummary {
  sessionId:string;
  expiresAt:string;
  csrfToken:string;
  workspaces:WorkspacePage;
  memberInvitationsEnabled?:boolean;
}
/** MFA step-up never returns workspace names, roles, or invitations to AAL1. */
export type BrowserSessionView =
  | (BrowserIdentitySummary & {status:"authenticated"})
  | {status:"mfa_required";csrfToken:string;expiresAt:string};
/** Rotated BFF cookie is only for the HttpOnly Set-Cookie response header. */
export interface BrowserMfaStepupSuccess extends BrowserIdentitySummary {
  cookieValue:string;
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
    auth:Pick<SupabaseAuthPrincipalVerifier,"verifyAccessToken"|"verifyPrivilegedAccessToken">;
    mfa:Pick<SupabaseTotpMfaClient,"enroll"|"challengeAndVerify"|"unenroll">;
    otp:Pick<SupabaseEmailOtpClient,"sendOtp"|"verifyOtp"|"refresh"|"revoke">;
    portfolio:Pick<AuthenticatedWorkspacePortfolio,"list">;
    memberInvites?:Pick<PostgresWorkspaceInvitations,"invite">;
    csrfKeyBase64:string;
    onOtpFailure?: (diagnostic:BrowserOtpFailureDiagnostic)=>void;
    /** Fixed enums only. Never log raw provider errors or any TOTP secret. */
    onMfaEnrollmentFailure?: (diagnostic:{stage:"session"|"policy"|"provider";reason:BrowserMfaFailureReason})=>void;
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

  /** HMAC instead of plain SHA-256 keeps common email addresses and remote
   * network identifiers out of offline dictionary attacks against rate data. */
  #rateBucket(bucket:string):string {
    return createHmac("sha256",this.#csrfKey)
      .update("ishikeit-browser-rate-v1\0"+bucket)
      .digest("hex");
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
       RETURNING hits`,[this.#rateBucket(bucket),seconds]
    );
    return (result.rows[0]?.hits??max+1)<=max;
  }

  /** HMAC-SHA256 lookup, not a reversible/plain hash of email. */
  #emailLookup(email:string):string {
    return createHmac("sha256",this.#csrfKey)
      .update("ishikeit-browser-email-lookup-v1\0"+email).digest("hex");
  }

  /** An email link in the requesting browser should resume the code form.
   * The response never includes the email, code, or private user data. */
  async hasPendingEmailOtp(cookie:string):Promise<boolean>{
    if(!bearer.safeParse(cookie).success)return false;
    const result=await this.deps.db.query<PendingChallengeRow>(
      `SELECT EXISTS(
         SELECT 1 FROM public.ishikeit_browser_login_attempts
         WHERE challenge_hash=$1 AND completed_at IS NULL
           AND expires_at>now() AND tries<5 AND otp_sent_at IS NOT NULL
       ) AS present`,[sha256(cookie)]
    );
    return result.rows[0]?.present===true;
  }

  /** Email links can be opened in a different browser. A new, unrelated
   * nonce is issued only when a genuine recent OTP dispatch is recorded.
   * The recipient must still enter their emailed OTP, and the existing
   * per-attempt, account, IP and provider rate limits remain mandatory.
   * An indistinguishable, unusable nonce is returned on any blocked lookup.
   */
  async resumeEmailOtp(emailInput:string,networkId:string):Promise<string>{
    const email=normalizedEmail.parse(emailInput);
    const cookie=newSecret();
    const passed=await Promise.all([
      this.#limit("otp:resume:email:"+email,3,900),
      this.#limit("otp:resume:remote:"+networkId,30,900)
    ]);
    if(!passed.every(Boolean))return cookie;
    const hash=sha256(cookie);
    const value=this.deps.cipher.encrypt(
      email,"ishikeit-browser-v1\0"+hash+"\0email"
    );
    await this.deps.db.query(
      `INSERT INTO public.ishikeit_browser_login_attempts
        (challenge_hash,email_ciphertext,email_iv,email_tag,
         email_lookup_hash,expires_at,otp_sent_at)
       SELECT $1,$2,$3,$4,$5,source.expires_at,source.otp_sent_at
       FROM public.ishikeit_browser_login_attempts AS source
       WHERE source.email_lookup_hash=$5
         AND source.otp_sent_at IS NOT NULL
         AND source.completed_at IS NULL AND source.tries<5
         AND source.expires_at>now()
       ORDER BY source.otp_sent_at DESC,source.expires_at DESC LIMIT 1`,
      [hash,value.ciphertext,value.iv,value.tag,this.#emailLookup(email)]
    );
    return cookie;
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
      const hash=sha256(loginCookie);
      const emailValue=this.deps.cipher.encrypt(
        email,"ishikeit-browser-v1\0"+hash+"\0email"
      );
      await this.deps.db.query(
        `INSERT INTO public.ishikeit_browser_login_attempts
         (challenge_hash,email_ciphertext,email_iv,email_tag,
          email_lookup_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
        [hash,emailValue.ciphertext,emailValue.iv,emailValue.tag,
         this.#emailLookup(email)]
      );
      const known=await this.deps.db.query<MemberRow>(
        `SELECT EXISTS(
           SELECT 1 FROM auth.users u
           JOIN public.ishikeit_workspace_memberships m
             ON m.auth_subject=u.id::text AND m.auth_issuer=$1
           JOIN public.ishikeit_workspaces w ON w.workspace_id=m.workspace_id
           WHERE lower(u.email)=$2 AND u.is_anonymous=false
             AND m.state='active' AND w.state='active'
             AND u.email_confirmed_at IS NOT NULL
             AND u.deleted_at IS NULL
             AND (u.banned_until IS NULL OR u.banned_until <= now())
         ) AS eligible`,[this.#origin,email]
      );
      // Ishikeit cooldown is independent of Supabase's configurable email
      // quota and must not be confused with a provider-issued permission.
      if(known.rows[0]?.eligible===true && await this.#limit(
        "otp:cooldown:"+email,1,60
      )){
        try {
          await this.deps.otp.sendOtp(email);
          // An emailed link cannot be adopted unless OTP dispatch succeeded.
          await this.deps.db.query(
            `UPDATE public.ishikeit_browser_login_attempts
             SET otp_sent_at=now()
             WHERE challenge_hash=$1 AND completed_at IS NULL
               AND expires_at>now()`,[hash]
          );
        }catch {/* Same generic public result; never disclose provider state. */}
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
        RETURNING email_ciphertext,email_iv,email_tag`,[sha256(cookie)]
    );
    const row=result.rows[0];
    if(row===undefined)return undefined;
    const email=this.deps.cipher.decrypt(
      encrypted(row.email_ciphertext,row.email_iv,row.email_tag),
      "ishikeit-browser-v1\0"+sha256(cookie)+"\0email"
    );
    // Account-wide verification throttle is mandatory in addition to the
    // cookie's five attempts and network limit. A new nonce or proxy source
    // cannot reset the total number of guesses against one invited account.
    if(!await this.#limit("verify:account:"+email,10,900))return undefined;
    return email;
  }

  async verify(loginCookie:string,code:string,networkId:string):Promise<BrowserAuthSuccess> {
    let stage:BrowserOtpFailureStage="challenge";
    let issued:SupabaseIssuedTokens|undefined;
    try {
      const email=await this.#consumeLogin(loginCookie,code,networkId);
      if(email===undefined)throw new Error("Login verification rejected");
      stage="provider_exchange";
      issued=await this.deps.otp.verifyOtp(email,code);
      stage="principal";
      const verified=await this.deps.auth.verifyAccessToken(issued.access_token);
      stage="workspace";
      const memberships=await this.deps.portfolio.list(issued.access_token,{pageSize:1});
      if(memberships.items.length===0)throw new Error("Login verification rejected");
      stage="session";
      const result=await this.deps.db.transaction(async tx=>{
        const consumed=await tx.query(
          `UPDATE public.ishikeit_browser_login_attempts SET completed_at=now()
           WHERE challenge_hash=$1 AND completed_at IS NULL AND expires_at>now()
           RETURNING challenge_hash`,[sha256(loginCookie)]
        );
        if(consumed.rowCount!==1)throw new Error("Login verification rejected");
        const value=newSecret();
        await this.#insertSession(tx,value,issued!,verified);
        return value;
      });
      return {cookieValue:result,csrfToken:this.csrfForCookie(result)};
    }catch(error){
      // The Auth provider may have consumed a correct email code and issued
      // a live session before a downstream local check failed. Always try
      // to revoke that token. No sensitive token or original error is logged.
      if(issued!==undefined){
        try {await this.deps.otp.revoke(issued.access_token);}catch{/* fail closed locally */}
      }
      const reason=browserOtpReason(error);
      try {this.deps.onOtpFailure?.({stage,reason});}catch{/* diagnostics never affect auth */}
      // Provider payload errors on a 2xx response can also mean the OTP was
      // consumed; distinguish setup failure from a truly invalid OTP.
      if(issued!==undefined || reason==="upstream_response_invalid")
        throw new BrowserLoginSessionSetupError();
      throw error;
    }
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
    // A BFF row is never valid unless its exact provider session still exists.
    // Orphaned records must be rejected even before decrypting/refreshing tokens.
    const result=await tx.query<BrowserSessionRow>(
      `SELECT b.user_id,b.auth_session_id,b.access_ciphertext,b.access_iv,b.access_tag,
         b.refresh_ciphertext,b.refresh_iv,b.refresh_tag,b.access_expires_at,b.session_expires_at
       FROM public.ishikeit_browser_sessions AS b
       JOIN auth.sessions AS s
         ON s.id=b.auth_session_id AND s.user_id=b.user_id
       WHERE b.session_hash=$1 AND b.revoked_at IS NULL AND b.session_expires_at>now()
       ${locked?"FOR UPDATE OF b":""}`,[sha256(cookie)]
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
      `SELECT 1 FROM public.ishikeit_browser_sessions AS b
       JOIN auth.sessions AS s ON s.id=b.auth_session_id AND s.user_id=b.user_id
       WHERE b.session_hash=$1 AND b.revoked_at IS NULL AND b.session_expires_at>now()`,
      [sha256(cookie)]
    );
    if(result.rowCount!==1)throw new Error("Browser session unavailable");
    return this.csrfForCookie(cookie);
  }

  /**
   * Ordinary workspace read access follows the user's explicit sign-in 2FA
   * preference. Sensitive mutations independently require enabled-factor
   * AAL2 regardless of this preference.
   */
  async #describeSession(
    access:string,verified:VerifiedIshikeitSession,cookie:string
  ):Promise<BrowserSessionView>{
    const eligible=await this.deps.portfolio.list(access,{pageSize:1});
    if(eligible.items.length===0)throw new Error("Browser workspace membership unavailable");
    const policy=await this.deps.db.query<MfaPolicyRow>(
      `SELECT sign_in_2fa_enabled FROM public.ishikeit_browser_mfa_policies
       WHERE user_id=$1::uuid`,[verified.principal.subject]
    );
    if(policy.rows[0]?.sign_in_2fa_enabled===false){
      const workspaces=await this.deps.portfolio.list(access,{pageSize:50});
      if(workspaces.items.length===0)throw new Error("Browser workspace membership unavailable");
      return {status:"authenticated",sessionId:verified.sessionId,
        expiresAt:verified.expiresAt,csrfToken:this.csrfForCookie(cookie),workspaces,
        memberInvitationsEnabled:this.deps.memberInvites!==undefined};
    }
    try{
      const mfa=await this.deps.auth.verifyPrivilegedAccessToken(access);
      if(mfa.principal.subject!==verified.principal.subject
        || mfa.principal.issuer!==verified.principal.issuer
        || mfa.sessionId!==verified.sessionId)
        throw new Error("Browser privilege session mismatch");
    }catch(error){
      // Provider outage and unexpected security errors MUST fail closed.
      if(error instanceof Error && error.message==="Multi-factor authentication required")
        return {status:"mfa_required",csrfToken:this.csrfForCookie(cookie),
          expiresAt:verified.expiresAt};
      throw error;
    }
    const workspaces=await this.deps.portfolio.list(access,{pageSize:50});
    if(workspaces.items.length===0)throw new Error("Browser workspace membership unavailable");
    return {status:"authenticated",sessionId:verified.sessionId,
      expiresAt:verified.expiresAt,csrfToken:this.csrfForCookie(cookie),workspaces,
      memberInvitationsEnabled:this.deps.memberInvites!==undefined};
  }

  async sessionStatus(cookie:string):Promise<BrowserSessionView>{
    const {access,verified}=await this.#bearer(cookie);
    return this.#describeSession(access,verified,cookie);
  }

  async get(cookie:string):Promise<BrowserIdentitySummary>{
    const session=await this.sessionStatus(cookie);
    if(session.status!=="authenticated")throw new Error("Multi-factor authentication required");
    return session;
  }

  async listWorkspaces(cookie:string,after?:string):Promise<WorkspacePage>{
    await this.get(cookie);
    const {access}=await this.#bearer(cookie);
    return this.deps.portfolio.list(access,{
      pageSize:20,...(after===undefined?{}:{after})
    });
  }

  /** Atomic row lock serializes rotating Supabase refresh tokens across tabs
   * and all Hostinger replicas. Never retry an ambiguous refresh response:
   * the IdP may have already rotated the one-time-use refresh token.
   */
  async refresh(cookie:string):Promise<BrowserSessionView> {
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
    return this.#describeSession(value.access,value.verified,cookie);
  }

  /**
   * Enumerate only the currently verified TOTP factor IDs for the exact
   * bearer-verified user. Factor secrets and provider Auth tokens are never
   * included in this read-only response.
   */
  async listTotpFactors(cookie:string):Promise<BrowserMfaFactorStatus> {
    const {access,verified}=await this.#bearer(cookie);
    const eligible=await this.deps.portfolio.list(access,{pageSize:1});
    if(eligible.items.length===0)throw new Error("Workspace authorization required");
    const [rows,policy]=await Promise.all([
      this.deps.db.query<TotpFactorRow>(
        `SELECT f.id,f.status::text AS status,f.factor_type::text AS factor_type,
           f.created_at,
           COALESCE(l.display_name,NULLIF(
             CASE WHEN f.friendly_name LIKE 'Ishikeit Authenticator %'
               THEN '' ELSE f.friendly_name END,'')) AS label
         FROM auth.mfa_factors AS f
         LEFT JOIN public.ishikeit_browser_totp_labels AS l
           ON l.user_id=f.user_id AND l.factor_id=f.id
         WHERE f.user_id=$1::uuid
         ORDER BY f.created_at ASC,f.id ASC`,
        [verified.principal.subject]
      ),
      this.deps.db.query<MfaPolicyRow>(
        `SELECT sign_in_2fa_enabled FROM public.ishikeit_browser_mfa_policies
         WHERE user_id=$1::uuid`,[verified.principal.subject]
      )
    ]);
    const verifiedTotp=rows.rows.filter(x=>
      x.status==="verified" && x.factor_type==="totp");
    const devices=verifiedTotp.map((f,i)=>({
      factorId:z.string().uuid().parse(f.id),
      label:f.label?.trim() || (i===0?"Primary authenticator":
        i===1?"Backup authenticator":"Authenticator "+String(i+1)),
      enrolledAt:f.created_at instanceof Date && Number.isFinite(f.created_at.getTime())
        ? f.created_at.toISOString():"",
      enabled:true
    }));
    const factors=devices.map(d=>d.factorId);
    const pendingCount=rows.rows.filter(x=>
      x.status==="unverified" && x.factor_type==="totp").length;
    let canEnroll=verifiedTotp.length===0;
    if(verifiedTotp.length>0){
      try{await this.deps.auth.verifyPrivilegedAccessToken(access);canEnroll=true;}
      catch{/* No backup enrollment without active AAL2. */}
    }
    return {factors,devices,pendingCount,canEnroll,
      signIn2faEnabled:policy.rows[0]?.sign_in_2fa_enabled!==false};
  }

  /** An explicit, CSRF-protected user action can reset only incomplete,
   * unverified TOTP enrollments. A verified factor is NEVER removed here.
   * This uses GoTrue's official owner-bound DELETE /factors/:id endpoint.
   */
  async clearIncompleteTotp(cookie:string):Promise<{cleared:number}>{
    const {verified}=await this.#bearer(cookie);
    if(!await this.#limit("mfa:reset:"+verified.principal.subject,5,900))
      throw new Error("MFA reset rate limited");
    return this.deps.db.transaction(async tx=>{
      const row=await this.#load(tx,cookie,true);
      const hash=sha256(cookie);
      const token=this.deps.cipher.decrypt(
        encrypted(row.access_ciphertext,row.access_iv,row.access_tag),
        "ishikeit-browser-v1\0"+hash+"\0access"
      );
      const fresh=await this.deps.auth.verifyAccessToken(token);
      if(fresh.principal.subject!==row.user_id || fresh.sessionId!==row.auth_session_id)
        throw new Error("Browser session unavailable");
      const existing=await tx.query<CountRow>(
        `SELECT count(*)::integer AS n FROM auth.mfa_factors
         WHERE user_id=$1::uuid AND status='verified'`,[row.user_id]
      );
      if((existing.rows[0]?.n??0)>0)
        await this.deps.auth.verifyPrivilegedAccessToken(token);
      const pages=await this.deps.portfolio.list(token,{pageSize:1});
      if(pages.items.length===0)throw new Error("Workspace authorization required");
      const pending=await tx.query<TotpFactorRow>(
        `SELECT id,status::text AS status,factor_type::text AS factor_type
         FROM auth.mfa_factors
         WHERE user_id=$1::uuid AND status='unverified' AND factor_type='totp'
         ORDER BY created_at ASC,id ASC LIMIT 10`,[row.user_id]
      );
      let cleared=0;
      for(const factor of pending.rows){
        await this.deps.mfa.unenroll(token,z.string().uuid().parse(factor.id));
        cleared++;
      }
      return {cleared};
    });
  }

  /**
   * Enroll initial factor after AAL1. Adding another factor to an MFA-protected
   * account MUST first prove existing aal2 and current second factor.
   * The returned one-time TOTP secret must never be cached or persisted by UI.
   */
  async enrollTotp(cookie:string,deviceName:string):Promise<TotpEnrollment> {
    const friendlyName=z.string().trim().min(1).max(64)
      .refine(name=>[...name].every(ch=>ch.charCodeAt(0)>31 && ch.charCodeAt(0)!==127)).parse(deviceName);
    let stage:"session"|"policy"|"provider"="session";
    try{
      const {verified}=await this.#bearer(cookie);
      stage="policy";
      return await this.deps.db.transaction(async tx=>{
        const row=await this.#load(tx,cookie,true);
        const hash=sha256(cookie);
        const token=this.deps.cipher.decrypt(
          encrypted(row.access_ciphertext,row.access_iv,row.access_tag),
          "ishikeit-browser-v1\0"+hash+"\0access"
        );
        const fresh=await this.deps.auth.verifyAccessToken(token);
        if(fresh.principal.subject!==row.user_id || fresh.sessionId!==row.auth_session_id)
          throw new Error("Browser session unavailable");
        const existing=await tx.query<CountRow>(
          `SELECT count(*)::int AS n FROM auth.mfa_factors
           WHERE user_id=$1::uuid AND status='verified'`,
          [row.user_id]
        );
        if((existing.rows[0]?.n??0)>0)
          await this.deps.auth.verifyPrivilegedAccessToken(token);
        const pages=await this.deps.portfolio.list(token,{pageSize:1});
        if(pages.items.length===0)throw new Error("Workspace authorization required");
        // Only one incomplete secret should exist at a time. Do NOT burn
        // enrollment quota, create more GoTrue factors or lose the first
        // one-time secret while this factor is unresolved.
        const pending=await tx.query<CountRow>(
          `SELECT count(*)::int AS n FROM auth.mfa_factors
           WHERE user_id=$1::uuid AND status='unverified' AND factor_type='totp'`,
          [row.user_id]
        );
        if((pending.rows[0]?.n??0)>0)throw new BrowserMfaPendingEnrollment();
        if(!await this.#limit("mfa:enroll:"+verified.principal.subject,3,900))
          throw new BrowserMfaEnrollmentRateLimited();
        stage="provider";
        return this.deps.mfa.enroll(token,friendlyName);
      });
    }catch(error){
      try{this.deps.onMfaEnrollmentFailure?.({stage,reason:mfaReason(error)});}
      catch{/* diagnostic hooks never affect security */}
      throw error;
    }
  }

  /**
   * Create a provider challenge and verify it, while holding an exact
   * BFF session row lock. Replace rotated tokens in the SAME transaction.
   * Never let a browser choose a challenge ID or send provider bearer tokens.
   */
  async verifyTotp(cookie:string,factorId:string,code:string):Promise<BrowserMfaStepupSuccess> {
    const id=z.string().uuid().parse(factorId);
    const passcode=z.string().regex(/^[0-9]{6}$/u).parse(code);
    const {verified}=await this.#bearer(cookie);
    if(!await this.#limit("mfa:verify:"+verified.principal.subject,10,900))
      throw new Error("MFA verification rate limited");
    const result=await this.deps.db.transaction(async tx=>{
      const row=await this.#load(tx,cookie,true);
      const oldHash=sha256(cookie);
      const oldAccess=this.deps.cipher.decrypt(
        encrypted(row.access_ciphertext,row.access_iv,row.access_tag),
        "ishikeit-browser-v1\0"+oldHash+"\0access"
      );
      const current=await this.deps.auth.verifyAccessToken(oldAccess);
      if(current.principal.subject!==row.user_id || current.sessionId!==row.auth_session_id)
        throw new Error("Browser session unavailable");
      const allowed=await tx.query<TotpFactorRow>(
        `SELECT id,status::text AS status FROM auth.mfa_factors
         WHERE user_id=$1::uuid AND id=$2::uuid AND factor_type='totp'
           AND status IN ('verified','unverified')
           AND (status='unverified' OR NOT EXISTS(
             SELECT 1 FROM public.ishikeit_browser_disabled_totp_factors d
             WHERE d.user_id=$1::uuid AND d.factor_id=$2::uuid))
         LIMIT 1`,[row.user_id,id]
      );
      if(allowed.rows[0]===undefined)throw new Error("MFA factor not available");
      const eligible=await this.deps.portfolio.list(oldAccess,{pageSize:1});
      if(eligible.items.length===0)throw new Error("Workspace authorization required");
      const tokens=await this.deps.mfa.challengeAndVerify(oldAccess,id,passcode);
      const next=await this.deps.auth.verifyAccessToken(tokens.access_token);
      if(next.principal.subject!==row.user_id || next.sessionId!==row.auth_session_id)
        throw new Error("MFA session identity mismatch");
      // MFA is a privilege transition: rotate the opaque browser cookie
      // and its associated encryption AAD, *atomically*, so a pre-step-up
      // AAL1 cookie cannot access the upgraded provider session.
      const nextCookie=newSecret();
      const nextHash=sha256(nextCookie);
      const accessNew=this.deps.cipher.encrypt(tokens.access_token,
        "ishikeit-browser-v1\0"+nextHash+"\0access");
      const refreshNew=this.deps.cipher.encrypt(tokens.refresh_token,
        "ishikeit-browser-v1\0"+nextHash+"\0refresh");
      const updated=await tx.query(
        `UPDATE public.ishikeit_browser_sessions SET
           session_hash=$2,
           access_ciphertext=$3,access_iv=$4,access_tag=$5,
           refresh_ciphertext=$6,refresh_iv=$7,refresh_tag=$8,
           access_expires_at=$9,updated_at=now()
         WHERE session_hash=$1 AND revoked_at IS NULL`,
        [oldHash,nextHash,
          accessNew.ciphertext,accessNew.iv,accessNew.tag,
          refreshNew.ciphertext,refreshNew.iv,refreshNew.tag,new Date(next.expiresAt)]
      );
      if(updated.rowCount!==1)throw new Error("Browser session unavailable");
      return {access:tokens.access_token,verified:next,cookieValue:nextCookie};
    });
    // Issuer must prove AAL2 bound to the exact currently verified factor.
    // No response tokens or cookie are sent to the client on failed readback.
    await this.deps.auth.verifyPrivilegedAccessToken(result.access);
    const workspaces=await this.deps.portfolio.list(result.access,{pageSize:50});
    if(workspaces.items.length===0)throw new Error("Workspace authorization required");
    return {
      cookieValue:result.cookieValue,
      sessionId:result.verified.sessionId,expiresAt:result.verified.expiresAt,
      csrfToken:this.csrfForCookie(result.cookieValue),workspaces,
      memberInvitationsEnabled:this.deps.memberInvites!==undefined
    };
  }

  /**
   * Native GoTrue factor lifecycle, with a fresh challenge, AAL2 and live
   * session/factor binding. A user-selected "Turn off authentication app"
   * calls provider unenroll for EVERY TOTP factor, never a disabled flag.
   * Provider deletes cannot be rolled back by a local PostgreSQL transaction:
   * on partial failures revoke BFF sessions and demand a fresh provider read.
   */
  async changeMfaSettings(cookie:string,
    mutation:BrowserMfaSettingsMutation):Promise<BrowserMfaSettingsChange>{
    const proofId=z.string().uuid().parse(mutation.proofFactorId);
    const passcode=z.string().regex(/^[0-9]{6}$/u).parse(mutation.code);
    const targetId=mutation.kind==="remove" || mutation.kind==="rename"
      ? z.string().uuid().parse(mutation.factorId):undefined;
    const newName=mutation.kind==="rename"
      ? z.string().trim().min(1).max(64)
        .refine(name=>[...name].every(ch=>ch.charCodeAt(0)>31 && ch.charCodeAt(0)!==127)).parse(mutation.name)
      :undefined;
    const first=await this.#bearer(cookie);
    if(!await this.#limit("mfa:manage:"+first.verified.principal.subject,8,900))
      throw new BrowserMfaEnrollmentRateLimited();
    let issued:SupabaseIssuedTokens|undefined;
    let removedByProvider=0;
    try{
      const result=await this.deps.db.transaction(async tx=>{
        const row=await this.#load(tx,cookie,true);
        const oldHash=sha256(cookie);
        const access=this.deps.cipher.decrypt(
          encrypted(row.access_ciphertext,row.access_iv,row.access_tag),
          "ishikeit-browser-v1\0"+oldHash+"\0access");
        const current=await this.deps.auth.verifyAccessToken(access);
        if(current.principal.subject!==row.user_id ||
          current.sessionId!==row.auth_session_id)
          throw new Error("Browser session unavailable");
        const membership=await this.deps.portfolio.list(access,{pageSize:1});
        if(membership.items.length===0)
          throw new Error("Workspace authorization required");
        await tx.query(
          "INSERT INTO public.ishikeit_browser_mfa_policies(user_id) VALUES($1::uuid) ON CONFLICT(user_id) DO NOTHING",
          [row.user_id]);
        const policy=await tx.query<MfaPolicyRow>(
          "SELECT sign_in_2fa_enabled FROM public.ishikeit_browser_mfa_policies WHERE user_id=$1::uuid FOR UPDATE",
          [row.user_id]);
        const all=await tx.query<TotpFactorRow>(
          "SELECT id,status::text AS status,factor_type::text AS factor_type FROM auth.mfa_factors WHERE user_id=$1::uuid AND factor_type='totp' ORDER BY created_at ASC,id ASC",
          [row.user_id]);
        const verified=all.rows.filter(x=>x.status==="verified");
        const oldFlags=await tx.query<CountRow>(
          "SELECT count(*)::int AS n FROM public.ishikeit_browser_disabled_totp_factors WHERE user_id=$1::uuid",
          [row.user_id]);
        // Old flags must be migrated by a secure provider unenroll, never
        // silently reactivated with old secrets by a new release.
        if((oldFlags.rows[0]?.n??0)!==0)
          throw new Error("Legacy authenticator migration required");
        if(!verified.some(x=>x.id===proofId))
          throw new BrowserMfaLastAuthenticatorError();
        if(targetId!==undefined && !verified.some(x=>x.id===targetId))
          throw new Error("Authenticator not available");
        if(mutation.kind==="remove" && verified.length>1 && targetId===proofId)
          throw new Error("Choose another authenticator to approve removal");
        if(mutation.kind==="sign_in"
          && (policy.rows[0]?.sign_in_2fa_enabled!==false)===mutation.enabled)
          throw new Error("Sign-in 2FA already in requested state");
        issued=await this.deps.mfa.challengeAndVerify(access,proofId,passcode);
        const next=await this.deps.auth.verifyAccessToken(issued.access_token);
        if(next.principal.subject!==row.user_id ||
          next.sessionId!==row.auth_session_id)
          throw new Error("MFA session identity mismatch");
        await this.deps.auth.verifyPrivilegedAccessToken(issued.access_token);
        const proof=await tx.query<CountRow>(
          "SELECT count(*)::integer AS n FROM auth.sessions WHERE id=$1::uuid AND user_id=$2::uuid AND aal='aal2' AND factor_id=$3::uuid",
          [row.auth_session_id,row.user_id,proofId]);
        if(proof.rows[0]?.n!==1)
          throw new Error("Fresh authenticator proof required");
        let signOut=false;
        if(mutation.kind==="sign_in"){
          await tx.query(
            "UPDATE public.ishikeit_browser_mfa_policies SET sign_in_2fa_enabled=$2,updated_at=now() WHERE user_id=$1::uuid",
            [row.user_id,mutation.enabled]);
          await tx.query(
            "INSERT INTO public.ishikeit_browser_mfa_security_events(user_id,event_kind) VALUES($1::uuid,$2)",
            [row.user_id,mutation.enabled?"sign_in_2fa_enabled":"sign_in_2fa_disabled"]);
        }else if(mutation.kind==="rename"){
          if(targetId===undefined || newName===undefined)
            throw new Error("Invalid authenticator rename");
          await tx.query(
            "INSERT INTO public.ishikeit_browser_totp_labels(user_id,factor_id,display_name) VALUES($1::uuid,$2::uuid,$3) ON CONFLICT(user_id,factor_id) DO UPDATE SET display_name=excluded.display_name,changed_at=now()",
            [row.user_id,targetId,newName]);
          await tx.query(
            "INSERT INTO public.ishikeit_browser_mfa_security_events(user_id,event_kind,factor_id) VALUES($1::uuid,'authenticator_renamed',$2::uuid)",
            [row.user_id,targetId]);
        }else{
          const targets=mutation.kind==="disable_app"
            ? [...all.rows.filter(x=>x.id!==proofId),...all.rows.filter(x=>x.id===proofId)]
            : verified.filter(x=>x.id===targetId);
          signOut=targets.some(x=>x.id===proofId);
          for(const factor of targets){
            // Supabase manages the secret; never DELETE auth.mfa_factors in SQL.
            await this.deps.mfa.unenroll(issued.access_token,factor.id);
            removedByProvider++;
            await tx.query(
              "INSERT INTO public.ishikeit_browser_mfa_security_events(user_id,event_kind,factor_id) VALUES($1::uuid,'authenticator_removed',$2::uuid)",
              [row.user_id,factor.id]);
          }
          if(mutation.kind==="disable_app"){
            await tx.query(
              "INSERT INTO public.ishikeit_browser_mfa_security_events(user_id,event_kind) VALUES($1::uuid,'totp_method_disabled')",
              [row.user_id]);
          }
        }
        if(signOut){
          // Removing the factor that authenticated this AAL2 session invalidates
          // it immediately; the owner signs in again with email OTP and
          // reenrolls a fresh factor as needed. No stale AAL2 cookie survives.
          await tx.query(
            "UPDATE public.ishikeit_browser_sessions SET revoked_at=now(),updated_at=now() WHERE user_id=$1::uuid AND revoked_at IS NULL",
            [row.user_id]);
          return {signedOut:true as const,removed:removedByProvider};
        }
        const cookieValue=newSecret();
        const hash=sha256(cookieValue);
        const nextAccess=this.deps.cipher.encrypt(
          issued.access_token,"ishikeit-browser-v1\0"+hash+"\0access");
        const nextRefresh=this.deps.cipher.encrypt(
          issued.refresh_token,"ishikeit-browser-v1\0"+hash+"\0refresh");
        const updated=await tx.query(
          "UPDATE public.ishikeit_browser_sessions SET session_hash=$2,access_ciphertext=$3,access_iv=$4,access_tag=$5,refresh_ciphertext=$6,refresh_iv=$7,refresh_tag=$8,access_expires_at=$9,updated_at=now() WHERE session_hash=$1 AND revoked_at IS NULL",
          [oldHash,hash,nextAccess.ciphertext,nextAccess.iv,nextAccess.tag,
            nextRefresh.ciphertext,nextRefresh.iv,nextRefresh.tag,
            new Date(next.expiresAt)]);
        if(updated.rowCount!==1)throw new Error("Browser session unavailable");
        await tx.query(
          "UPDATE public.ishikeit_browser_sessions SET revoked_at=now(),updated_at=now() WHERE user_id=$1::uuid AND session_hash<>$2 AND revoked_at IS NULL",
          [row.user_id,hash]);
        return {signedOut:false as const,cookieValue,
          csrfToken:this.csrfForCookie(cookieValue)};
      });
      if(result.signedOut && issued!==undefined){
        try{await this.deps.otp.revoke(issued.access_token);}
        catch{/* all browser sessions were already invalidated */}
      }
      return result;
    }catch(error){
      if(issued!==undefined){
        try{await this.deps.otp.revoke(issued.access_token);}
        catch{/* do not restore consumed proof */}
      }
      if(removedByProvider>0){
        // Provider changes may have partially succeeded. Local transaction
        // rollback cannot restore deleted TOTP secrets. Retain a durable
        // security event outside the aborted transaction and invalidate
        // browser sessions so the next login re-reads GoTrue factor state.
        try{
          await this.deps.db.transaction(async tx=>{
            await tx.query(
              "UPDATE public.ishikeit_browser_sessions SET revoked_at=now(),updated_at=now() WHERE user_id=$1::uuid AND revoked_at IS NULL",
              [first.verified.principal.subject]);
            await tx.query(
              "INSERT INTO public.ishikeit_browser_mfa_security_events(user_id,event_kind) VALUES($1::uuid,'authenticator_removal_partial')",
              [first.verified.principal.subject]);
          });
        }catch{/* provider-bound validation remains fail-closed */}
        throw new BrowserMfaPartialDeletionError();
      }
      throw error;
    }
  }

  /**
   * Browser sends only its opaque BFF session cookie, CSRF and non-owner
   * workspace invitation details. Supabase bearer remains server-private.
   * The workspace invitation service independently checks current MFA,
   * session, and exact active workspace ownership before inviting.
   */
  async inviteWorkspaceMember(cookie:string,input:{
    workspaceId:string;email:string;role:"admin"|"agent"|"viewer";
  }):Promise<InviteSummary>{
    if(this.deps.memberInvites===undefined)
      throw new Error("Workspace invitations unavailable");
    const {access,verified}=await this.#bearer(cookie);
    const privileged=await this.deps.auth.verifyPrivilegedAccessToken(access);
    if(privileged.principal.subject!==verified.principal.subject
      || privileged.principal.issuer!==verified.principal.issuer
      || privileged.sessionId!==verified.sessionId)
      throw new Error("Browser privilege session mismatch");
    return this.deps.memberInvites.invite(access,input);
  }

  async logout(cookie:string):Promise<void>{
    bearer.parse(cookie);
    // Revoke LOCAL cookie first, regardless of remote provider availability.
    const hash=sha256(cookie);
    const row=await this.deps.db.transaction(async tx=>{
      // Delete secret-bearing record FIRST: even a failed remote signout
      // cannot leave usable BFF tokens in storage.
      const previous=await tx.query<BrowserSessionRow>(
        `DELETE FROM public.ishikeit_browser_sessions WHERE session_hash=$1
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
