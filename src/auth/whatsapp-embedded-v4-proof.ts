import {createHmac} from "node:crypto";
import {z} from "zod";

const numeric=z.string().regex(/^[1-9][0-9]{4,31}$/u);
const appKey=z.string().regex(/^[1-9][0-9]{4,31}$/u);
const version=z.string().regex(/^v[0-9]{1,2}\.[0-9]{1,2}$/u);
const exchangeCode=z.string().min(8).max(4096).regex(/^[A-Za-z0-9._~%-]+$/u);
const bearer=z.string().min(20).max(8192);
export const WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES=[
  "whatsapp_business_management","whatsapp_business_messaging"
] as const;

function obj(v:unknown):Record<string,unknown>|undefined{
  return v!==null&&typeof v==="object"&&!Array.isArray(v)
    ? v as Record<string,unknown> : undefined;
}
function str(v:unknown):string|undefined{
  return typeof v==="string"&&v.length>0?v:undefined;
}
function seconds(v:unknown):number|undefined{
  if(typeof v==="number"&&Number.isSafeInteger(v)&&v>=0)return v;
  if(typeof v==="string"&&/^\d{1,16}$/u.test(v)){
    const n=Number(v);
    if(Number.isSafeInteger(n))return n;
  }
  return undefined;
}
async function boundedJson(r:Response):Promise<Record<string,unknown>>{
  if(!r.ok||!r.body)throw Error("Meta WhatsApp provider request rejected");
  const chunks:Uint8Array[]=[];let n=0;
  const reader=r.body.getReader();
  try {
    while(true){
      const part=await reader.read();
      if(part.done)break;
      if(!part.value)continue;
      n+=part.value.byteLength;
      if(n>32768)throw Error("Meta WhatsApp provider payload too large");
      chunks.push(part.value);
    }
  }finally{
    await reader.cancel().catch(()=>undefined);
    reader.releaseLock();
  }
  let value:unknown;
  try{value=JSON.parse(Buffer.concat(chunks,n).toString("utf8")) as unknown;}
  catch{throw Error("Invalid Meta WhatsApp provider JSON");}
  const root=obj(value);
  if(root===undefined||root.error!==undefined)
    throw Error("Meta WhatsApp provider denied request");
  return root;
}

export interface VerifiedWhatsAppEmbeddedV4Grant {
  /** Immutable provider phone number identity, never E.164 or display name. */
  phoneNumberId:string;
  /** waba_id now represents a Messaging account ID. */
  messagingAccountId:string;
  /** Sensitive business-integration token; server-only, never return to JS. */
  businessToken:string;
  scopes:readonly string[];
  /** Locally bounded reauthorization window, not dynamic messaging access. */
  accessExpiresAt:Date;
}

/** Read-only proof ONLY, not a complete Hosted or JS SDK Embedded Signup flow.
 * The caller must independently bind FB.login's short-lived code and
 * WA_EMBEDDED_SIGNUP FINISH asset candidates to an original AAL2 owner,
 * same-site CSRF, one-use private intent and Meta event origin. This class
 * never registers a phone, subscribes a webhook or sends a message.
 */
export class WhatsAppEmbeddedV4BusinessGrantReader{
  readonly #appId:string;
  readonly #appSecret:string;
  readonly #graphVersion:string;
  readonly #fetch:typeof fetch;
  readonly #now:()=>Date;
  constructor(options:{
    appId:string;appSecret:string;graphVersion:string;
    fetchImpl?:typeof fetch;now?:()=>Date
  }){
    this.#appId=appKey.parse(options.appId);
    this.#appSecret=z.string().min(16).max(512).parse(options.appSecret);
    this.#graphVersion=version.parse(options.graphVersion);
    this.#fetch=options.fetchImpl??fetch;
    this.#now=options.now??(()=>new Date());
  }
  #url(path:string):URL{
    return new URL("https://graph.facebook.com/"+this.#graphVersion+"/"+path);
  }
  #appsecretProof(token:string):string{
    return createHmac("sha256",this.#appSecret).update(token).digest("hex");
  }
  async #read(url:URL,token?:string):Promise<Record<string,unknown>>{
    let response:Response;
    try{
      response=await this.#fetch(url.toString(),{
        method:"GET",redirect:"error",cache:"no-store",
        signal:AbortSignal.timeout(8000),
        headers:{
          accept:"application/json",
          ...(token===undefined?{}:{authorization:"Bearer "+token})
        }
      });
    }catch{throw Error("Meta WhatsApp provider unavailable");}
    return boundedJson(response);
  }
  async #inspect(token:string):Promise<{
    scopes:readonly string[];accessExpiresAt:Date
  }>{
    const u=this.#url("debug_token");
    u.searchParams.set("input_token",token);
    u.searchParams.set("access_token",this.#appId+"|"+this.#appSecret);
    const result=await this.#read(u);
    const data=obj(result.data);
    if(data?.is_valid!==true||data.app_id!==this.#appId)
      throw Error("Meta WhatsApp business token app identity invalid");
    // Tech Provider Embedded Signup exchanges code for a business integration
    // system user token. Do not silently accept ordinary User or Page grants.
    if(data.type!=="BUSINESS_INTEGRATION_SYSTEM_USER")
      throw Error("Meta Embedded Signup returned non-business grant");
    const scopes=Array.isArray(data.scopes)
      ?data.scopes.filter((s):s is string=>typeof s==="string"):[];
    if(!WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES.every(s=>scopes.includes(s)))
      throw Error("Meta business token lacks WhatsApp permissions");
    const exp=seconds(data.expires_at);
    if(exp!==undefined&&exp>0&&exp*1000<=this.#now().getTime()+120000)
      throw Error("Meta WhatsApp business token expired");
    const dataExp=seconds(data.data_access_expires_at);
    if(dataExp!==undefined&&dataExp>0&&
      dataExp*1000<=this.#now().getTime()+120000)
      throw Error("Meta WhatsApp business data access expired");
    const max=this.#now().getTime()+60*86400000;
    const expiry=Math.min(max,
      exp!==undefined&&exp>0?exp*1000:max,
      dataExp!==undefined&&dataExp>0?dataExp*1000:max);
    return {scopes,accessExpiresAt:new Date(expiry)};
  }
  async #checkAssets(token:string,accountId:string,phoneId:string):
    Promise<void>{
    // Parent ID is a Messaging account (legacy waba_id); it is not a
    // WhatsApp account (WAAC) ID. Don't convert IDs based on beta rollouts.
    const detail=this.#url(accountId);
    detail.searchParams.set("fields","id");
    detail.searchParams.set("appsecret_proof",this.#appsecretProof(token));
    const account=await this.#read(detail,token);
    if(account.id!==accountId)
      throw Error("Meta messaging account identity differs");
    const seen=new Set<string>();let after:string|undefined;let matched=false;
    for(let page=0;page<10;page++){
      const url=this.#url(accountId+"/phone_numbers");
      url.searchParams.set("fields","id,display_phone_number");
      url.searchParams.set("limit","100");
      url.searchParams.set("appsecret_proof",this.#appsecretProof(token));
      if(after!==undefined)url.searchParams.set("after",after);
      const inventory=await this.#read(url,token);
      if(!Array.isArray(inventory.data)||inventory.data.length>100)
        throw Error("Meta WhatsApp phone inventory missing or excessive");
      for(const record of inventory.data){
        if(obj(record)?.id===phoneId){matched=true;break;}
      }
      if(matched)break;
      const cursor=str(obj(obj(inventory.paging)?.cursors)?.after);
      if(cursor===undefined)break;
      if(!/^[A-Za-z0-9_-]{1,512}$/u.test(cursor)||seen.has(cursor))
        throw Error("Meta WhatsApp phone cursor malformed");
      seen.add(cursor);after=cursor;
    }
    if(!matched)
      throw Error("Meta business token cannot read the selected account phone");
    const direct=this.#url(phoneId);
    direct.searchParams.set("fields","id");
    direct.searchParams.set("appsecret_proof",this.#appsecretProof(token));
    const p=await this.#read(direct,token);
    if(p.id!==phoneId)
      throw Error("Meta business phone identity differs");
  }
  /** Server-only fresh identity check for manual activation. It does not
   * grant a messaging entitlement or perform any provider mutation.
   */
  async verifyExisting(input:{
    businessToken:string;messagingAccountId:string;phoneNumberId:string
  }):Promise<{scopes:readonly string[];accessExpiresAt:Date}>{
    const parsed=z.object({
      businessToken:bearer,
      messagingAccountId:numeric,
      phoneNumberId:numeric
    }).strict().parse(input);
    const proof=await this.#inspect(parsed.businessToken);
    await this.#checkAssets(parsed.businessToken,
      parsed.messagingAccountId,parsed.phoneNumberId);
    return proof;
  }
  /** Code is only accepted after the caller's own browser/owner proof.
   * Returns a dormant candidate grant; no registry ownership claim or send.
   */
  async exchangeAndVerify(input:{
    authorizationCode:string;messagingAccountId:string;phoneNumberId:string
  }):Promise<VerifiedWhatsAppEmbeddedV4Grant>{
    const parsed=z.object({
      authorizationCode:exchangeCode,
      messagingAccountId:numeric,
      phoneNumberId:numeric
    }).strict().parse(input);
    const exchange=this.#url("oauth/access_token");
    exchange.searchParams.set("client_id",this.#appId);
    exchange.searchParams.set("client_secret",this.#appSecret);
    exchange.searchParams.set("code",parsed.authorizationCode);
    // The Embedded Signup code expires after 30 seconds, so exchange
    // happens first, before inspecting assets or any downstream onboarding.
    const result=await this.#read(exchange);
    const token=bearer.parse(result.access_token);
    const inspected=await this.#inspect(token);
    await this.#checkAssets(token,parsed.messagingAccountId,parsed.phoneNumberId);
    // This time bound is a conservative reauthorization requirement, not
    // proof of future dynamic messaging authorization.
    return {
      phoneNumberId:parsed.phoneNumberId,
      messagingAccountId:parsed.messagingAccountId,
      businessToken:token,scopes:inspected.scopes,
      accessExpiresAt:inspected.accessExpiresAt
    };
  }
}
