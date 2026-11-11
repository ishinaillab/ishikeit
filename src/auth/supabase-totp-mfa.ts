import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { SupabaseIssuedTokens } from "./supabase-email-otp.js";

const uuid=z.string().uuid();
const code=z.string().regex(/^[0-9]{6}$/u);
const totpEnrollment=z.object({
  id:uuid,
  type:z.literal("totp"),
  totp:z.object({
    secret:z.string().min(16).max(128).regex(/^[A-Z2-7]+$/u),
    uri:z.string().max(2048).optional()
  })
}).passthrough();
const challengeResponse=z.object({id:uuid}).passthrough();
const verifiedTokens=z.object({
  access_token:z.string().min(40).max(8192),
  // Supabase refresh tokens are opaque (12 characters in verified production).
  refresh_token:z.string().min(1).max(4096),
  token_type:z.literal("bearer"),
  expires_in:z.number().int().min(60).max(86400)
}).passthrough();

export interface TotpEnrollment {
  factorId:string;
  secret:string;
}

/** Narrow server-to-server adapter for *documented* GoTrue MFA endpoints.
 * Auth codes, bearer tokens, QR secrets or responses are never logged.
 * Browser only gets the one-time secret after a verified, CSRF-protected
 * enrollment request; never return Supabase access/refresh tokens.
 */
export class SupabaseTotpMfaClient {
  readonly #base:string;
  readonly #key:string;
  readonly #fetch:typeof fetch;
  readonly #timeout:number;
  constructor(options:{
    projectUrl:string;
    publishableKey:string;
    fetchImpl?:typeof fetch;
    timeoutMs?:number;
  }){
    const url=new URL(options.projectUrl);
    if(url.protocol!=="https:" || !/^[a-z0-9]{20}\.supabase\.co$/u.test(url.hostname)
      || url.pathname!=="/" || url.search!=="" || url.hash!==""
      || url.port!=="" || url.username!=="" || url.password!==""){
      throw new Error("Supabase TOTP requires exact project HTTPS origin");
    }
    if(!/^sb_publishable_[A-Za-z0-9_-]{8,200}$/u.test(options.publishableKey))
      throw new Error("Supabase TOTP requires a project publishable key");
    this.#base=url.origin+"/auth/v1";
    this.#key=options.publishableKey;
    this.#fetch=options.fetchImpl??fetch;
    this.#timeout=z.number().int().min(1000).max(15000).parse(options.timeoutMs??7000);
  }
  async #request(path:string,token:string,body:Record<string,unknown>,
    method:"POST"|"DELETE"="POST"):Promise<unknown>{
    let response:Response;
    try{
      response=await this.#fetch(this.#base+path,{
        method,redirect:"error",cache:"no-store",
        headers:{
          apikey:this.#key,authorization:"Bearer "+token,
          accept:"application/json","content-type":"application/json"
        },
        body:JSON.stringify(body),signal:AbortSignal.timeout(this.#timeout)
      });
    }catch{throw new Error("MFA provider unavailable");}
    if(!response.ok)throw new Error("MFA provider rejected the request");
    try{
      // GoTrue's enrollment payload contains a QR SVG with an SVG rectangle
      // for every QR module; even a normal TOTP QR can exceed 32 KiB.
      // Bound that endpoint separately while keeping tiny challenge/verify
      // responses on the original defensive 32 KiB ceiling.
      const maxBytes=method==="POST" && path==="/factors" ? 1024*1024 : 32768;
      const size=response.headers.get("content-length");
      if(size!==null && (!Number.isFinite(Number(size)) || Number(size)<0 || Number(size)>maxBytes))
        throw new Error("Invalid MFA response length");
      const reader=response.body?.getReader();
      if(reader===undefined)throw new Error("Missing MFA response");
      const chunks:Uint8Array[]=[];
      let total=0;
      try{
        for(;;){
          const next=await reader.read();
          if(next.done)break;
          if(next.value===undefined)continue;
          total+=next.value.byteLength;
          if(total>maxBytes){
            await reader.cancel().catch(()=>undefined);
            throw new Error("MFA response too large");
          }
          chunks.push(next.value);
        }
      }finally{reader.releaseLock();}
      return JSON.parse(Buffer.concat(chunks,total).toString("utf8")) as unknown;
    }catch{throw new Error("Invalid MFA provider response");}
  }
  /** Official owner-session deletion; the caller must check factor ownership,
   * status=unverified and CSRF before reaching this transport.
   * Provider independently checks this JWT's user and factor authorization.
   */
  async unenroll(token:string,factorId:string):Promise<void>{
    const id=uuid.parse(factorId);
    const raw=await this.#request("/factors/"+id,token,{},"DELETE");
    const result=z.object({id:uuid}).passthrough().safeParse(raw);
    if(!result.success || result.data.id!==id)
      throw new Error("Invalid MFA provider response");
  }
  async enroll(token:string):Promise<TotpEnrollment>{
    // GoTrue checks friendly_name uniqueness INCLUDING unverified factors.
    // Never reuse the empty default, or a failed one-time setup blocks retries.
    const name="Ishikeit Authenticator "+randomBytes(8).toString("hex");
    const raw=await this.#request("/factors",token,{
      factor_type:"totp",friendly_name:name
    });
    const parsed=totpEnrollment.safeParse(raw);
    const uri=parsed.success ? parsed.data.totp.uri : undefined;
    if(!parsed.success || (uri!==undefined && !uri.startsWith("otpauth://totp/"))){
      // If GoTrue already created a factor but the response fails validation,
      // discard only that newly-created UNVERIFIED factor via the official
      // Auth endpoint. No provider secret is recorded or surfaced.
      const id=z.object({id:uuid}).passthrough().safeParse(raw);
      if(id.success){
        try {await this.unenroll(token,id.data.id);}catch{/* recoverable in UI */}
      }
      throw new Error("Invalid MFA provider response");
    }
    return {factorId:parsed.data.id,secret:parsed.data.totp.secret};
  }
  async challengeAndVerify(token:string,factorId:string,otpCode:string):
    Promise<SupabaseIssuedTokens>{
    const id=uuid.parse(factorId);
    const authCode=code.parse(otpCode);
    const challenge=await this.#request("/factors/"+id+"/challenge",token,{});
    let challengeId:string;
    try{challengeId=challengeResponse.parse(challenge).id;}
    catch{throw new Error("Invalid MFA provider response");}
    const result=await this.#request("/factors/"+id+"/verify",token,{
      challenge_id:challengeId,code:authCode
    });
    try{return verifiedTokens.parse(result);}
    catch{throw new Error("Invalid MFA provider response");}
  }
}
