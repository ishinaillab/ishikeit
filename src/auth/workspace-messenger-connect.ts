import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedWorkspaceConnectionIntents } from "./authenticated-workspace-connection.js";
import type { PostgresOAuthCredentialStore } from "./oauth-store.js";
import type { PostgresWorkspaceConnectionRegistry, WorkspacePrincipal } from "../persistence/workspace-connections.js";

const uuid = z.string().uuid();
const pageIdSchema = z.string().regex(/^[1-9][0-9]{4,31}$/u);
const appIdSchema = z.string().regex(/^[1-9][0-9]{4,31}$/u);
const oauthCodeSchema = z.string().min(8).max(4096)
  .regex(/^[A-Za-z0-9._~%-]+$/u);
const stateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const bearerSchema = z.string().min(20).max(8192);
const graphVersionSchema = z.string().regex(/^v[0-9]{1,2}\.[0-9]{1,2}$/u);
export const MESSENGER_REQUIRED_SCOPES = [
  "pages_show_list", "pages_manage_metadata", "pages_messaging",
  "pages_read_engagement", "business_management"
] as const;

function asObject(value:unknown):Record<string,unknown>|undefined {
  return typeof value==="object"&&value!==null&&!Array.isArray(value)
    ? value as Record<string,unknown> : undefined;
}
function stringField(value:unknown):string|undefined {
  return typeof value==="string"&&value.length>0 ? value : undefined;
}
function numberField(value:unknown):number|undefined {
  const n=typeof value==="number"?value
    :typeof value==="string"&&/^\d+$/u.test(value)?Number(value):NaN;
  return Number.isSafeInteger(n)&&n>=0 ? n : undefined;
}
function scopeList(value:unknown):string[] {
  return Array.isArray(value)
    ? value.filter((v):v is string=>typeof v==="string")
    : [];
}
function pageRights(value:unknown):string[] {
  return Array.isArray(value)
    ? value.filter((v):v is string=>typeof v==="string")
    : [];
}
async function limitedJson(response:Response):Promise<Record<string,unknown>> {
  if(!response.ok||!response.body)throw Error("Meta provider request rejected");
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let total=0;
  try {
    for(;;){
      const next=await reader.read();
      if(next.done)break;
      if(!next.value)continue;
      total+=next.value.byteLength;
      if(total>32768)throw Error("Meta provider response exceeded bound");
      chunks.push(next.value);
    }
  }finally{
    await reader.cancel().catch(()=>undefined);
    reader.releaseLock();
  }
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.concat(chunks,total).toString("utf8")) as unknown;}
  catch{throw Error("Meta provider response was not valid JSON");}
  const root=asObject(parsed);
  if(!root||root.error!==undefined)throw Error("Meta provider returned error");
  return root;
}

export interface MessengerPageGrant {
  readonly pageId:string;
  readonly accessToken:string;
  readonly scopes:readonly string[];
  readonly accessExpiresAt:Date;
}
export interface MessengerPageClient {
  authorizationUrl(state:string,redirectUri:string):string;
  exchangeAndProve(code:string,redirectUri:string,pageId:string):Promise<MessengerPageGrant>;
  verifyPage(pageAccessToken:string,expectedPageId:string):Promise<void>;
}

/** A read-only Messenger Page proof. No Page subscription, POST Graph call,
 * outbound send, arbitrary redirect, client token, or default tenant claim.
 * Facebook Login for Business must be configured for User access tokens;
 * Business Integration System User grants are deliberately rejected.
 */
export class MetaMessengerPageClient implements MessengerPageClient {
  readonly #appId:string;
  readonly #appSecret:string;
  readonly #version:string;
  readonly #configId:string;
  readonly #fetch:typeof fetch;
  readonly #now:()=>Date;
  constructor(options:{
    appId:string;appSecret:string;graphVersion:string;configId:string;
    fetchImpl?:typeof fetch;now?:()=>Date;
  }){
    this.#appId=appIdSchema.parse(options.appId);
    this.#appSecret=z.string().min(16).max(512).parse(options.appSecret);
    this.#version=graphVersionSchema.parse(options.graphVersion);
    this.#configId=appIdSchema.parse(options.configId);
    this.#fetch=options.fetchImpl??fetch;
    this.#now=options.now??(()=>new Date());
  }
  authorizationUrl(state:string,redirectUri:string):string {
    stateSchema.parse(state);
    this.#redirect(redirectUri);
    const url=new URL("https://www.facebook.com/"+this.#version+"/dialog/oauth");
    url.searchParams.set("client_id",this.#appId);
    url.searchParams.set("config_id",this.#configId);
    url.searchParams.set("response_type","code");
    url.searchParams.set("redirect_uri",redirectUri);
    url.searchParams.set("state",state);
    return url.toString();
  }
  #redirect(value:string):void {
    const url=new URL(value);
    if(url.protocol!=="https:"||url.port||url.username||url.password||
      url.search||url.hash||url.toString()!==value)
      throw Error("Messenger callback must be an exact registered HTTPS URI");
  }
  async #read(url:URL,bearer?:string):Promise<Record<string,unknown>> {
    let response:Response;
    try{
      response=await this.#fetch(url.toString(),{
        method:"GET",redirect:"error",cache:"no-store",
        headers:{
          accept:"application/json",
          ...(bearer===undefined?{}:{authorization:"Bearer "+bearer})
        },
        signal:AbortSignal.timeout(8000)
      });
    }catch{throw Error("Meta provider request unavailable");}
    return limitedJson(response);
  }
  #url(resource:string):URL {
    return new URL("https://graph.facebook.com/"+this.#version+"/"+resource);
  }
  #proof(bearer:string):string {
    return createHmac("sha256",this.#appSecret).update(bearer).digest("hex");
  }
  async #debugToken(token:string):Promise<Record<string,unknown>> {
    const url=this.#url("debug_token");
    url.searchParams.set("input_token",token);
    url.searchParams.set("access_token",this.#appId+"|"+this.#appSecret);
    const response=await this.#read(url);
    const data=asObject(response.data);
    if(!data||data.is_valid!==true||
      String(data.app_id)!==this.#appId)
      throw Error("Meta grant has unverified issuing application");
    const expiry=numberField(data.expires_at);
    if(expiry!==undefined&&expiry>0&&expiry*1000<=this.#now().getTime()+120000)
      throw Error("Meta grant expired");
    return data;
  }
  async #pageIdentity(token:string,expected:string):Promise<void> {
    const url=this.#url("me");
    url.searchParams.set("fields","id");
    url.searchParams.set("appsecret_proof",this.#proof(token));
    const result=await this.#read(url,token);
    if(result.id!==expected)throw Error("Meta Page identity mismatch");
  }
  async verifyPage(pageAccessToken:string,expectedPageId:string):Promise<void> {
    const pageId=pageIdSchema.parse(expectedPageId);
    const token=bearerSchema.parse(pageAccessToken);
    const debug=await this.#debugToken(token);
    if(debug.type!=="PAGE"||
      (debug.profile_id!==undefined&&stringField(debug.profile_id)!==pageId))
      throw Error("Meta access token is not for the selected Page");
    await this.#pageIdentity(token,pageId);
  }
  async exchangeAndProve(code:string,redirectUri:string,pageId:string):
    Promise<MessengerPageGrant> {
    oauthCodeSchema.parse(code);
    this.#redirect(redirectUri);
    const chosenPage=pageIdSchema.parse(pageId);
    const url=this.#url("oauth/access_token");
    url.searchParams.set("client_id",this.#appId);
    url.searchParams.set("client_secret",this.#appSecret);
    url.searchParams.set("redirect_uri",redirectUri);
    url.searchParams.set("code",code);
    const exchange=await this.#read(url);
    const userToken=bearerSchema.parse(exchange.access_token);
    const debug=await this.#debugToken(userToken);
    if(debug.type!=="USER")throw Error("Meta login did not return a User grant");
    const scopes=scopeList(debug.scopes);
    if(!MESSENGER_REQUIRED_SCOPES.every(s=>scopes.includes(s)))
      throw Error("Meta User grant lacks required Messenger/Page permissions");
    const now=this.#now().getTime();
    const userExpires=numberField(debug.expires_at);
    if(userExpires===undefined||userExpires===0||
      userExpires*1000<=now+120000)
      throw Error("Meta User grant expiration unverified");
    const dataExpires=numberField(debug.data_access_expires_at);
    if(dataExpires!==undefined&&dataExpires>0&&
      dataExpires*1000<=now+120000)
      throw Error("Meta User data-access grant expired");

    // Never follow provider-supplied next URLs: page with server-generated,
    // bounded cursors against the exact trusted Graph host only.
    let cursor:string|undefined;
    const seen=new Set<string>();
    let selectedToken:string|undefined;
    for(let page=0;page<10;page++){
      const listUrl=this.#url("me/accounts");
      listUrl.searchParams.set("fields","id,access_token,tasks");
      listUrl.searchParams.set("limit","100");
      listUrl.searchParams.set("appsecret_proof",this.#proof(userToken));
      if(cursor!==undefined)listUrl.searchParams.set("after",cursor);
      const listed=await this.#read(listUrl,userToken);
      const rows=Array.isArray(listed.data)?listed.data:[];
      if(rows.length>100)throw Error("Meta Page inventory response exceeded limit");
      for(const record of rows){
        const item=asObject(record);
        if(!item||item.id!==chosenPage)continue;
        const tasks=pageRights(item.tasks);
        if(!tasks.includes("MESSAGING")||!tasks.includes("MODERATE"))
          throw Error("Owner lacks Messenger and moderation Page tasks");
        selectedToken=bearerSchema.parse(item.access_token);
        break;
      }
      if(selectedToken)break;
      const paging=asObject(listed.paging);
      const after=stringField(asObject(paging?.cursors)?.after);
      if(after===undefined)break;
      if(!/^[A-Za-z0-9_-]{1,512}$/u.test(after)||seen.has(after))
        throw Error("Meta Page inventory cursor unsafe");
      seen.add(after);cursor=after;
    }
    if(!selectedToken)throw Error("Selected Page was not granted by Meta owner");
    // Meta granular Page scopes can restrict a User's otherwise granted
    // permissions to specific Page IDs. The account list alone is not
    // evidence that every app permission covers the selected Page.
    if(Array.isArray(debug.granular_scopes)){
      for(const required of [
        "pages_show_list","pages_manage_metadata","pages_messaging",
        "pages_read_engagement"
      ]){
        const scoped=debug.granular_scopes
          .map(asObject).filter((entry):entry is Record<string,unknown>=>
            entry!==undefined&&entry.scope===required);
        const targeted=scoped.filter(entry=>
          Array.isArray(entry.target_ids)&&entry.target_ids.length>0);
        if(targeted.length>0&&!targeted.some(entry=>
          (entry.target_ids as unknown[]).some(id=>id===chosenPage)))
          throw Error("Meta Page permission does not cover selected Page");
      }
    }
    await this.verifyPage(selectedToken,chosenPage);
    // Page token can be long-lived, but the original User/data grant is
    // explicitly bounded for this private onboarding; require reauthorization
    // rather than accepting stale proof as a permanent send entitlement.
    const expiry=Math.min(userExpires*1000,
      dataExpires&&dataExpires>0?dataExpires*1000:now+60*86400000);
    if(expiry<=now+120000)throw Error("Meta owner grant expired");
    return {pageId:chosenPage,accessToken:selectedToken,
      scopes,accessExpiresAt:new Date(expiry)};
  }
}

export class WorkspaceMessengerPageConnections {
  readonly #appId:string;
  readonly #redirectUri:string;
  constructor(private readonly deps:{
    appId:string;redirectUri:string;
    intents:Pick<AuthenticatedWorkspaceConnectionIntents,"begin"|"consume">;
    client:MessengerPageClient;
    registry:Pick<PostgresWorkspaceConnectionRegistry,
      "linkVerified"|"activateVerified"|"findForAdministrator">;
    vault:Pick<PostgresOAuthCredentialStore,"putInTransaction"|"get">;
    now?:()=>Date;
  }){
    this.#appId=appIdSchema.parse(deps.appId);
    const uri=new URL(deps.redirectUri);
    if(uri.protocol!=="https:"||uri.port||uri.username||uri.password||
      uri.search||uri.hash||uri.toString()!==deps.redirectUri)
      throw Error("Messenger registered callback invalid");
    this.#redirectUri=deps.redirectUri;
  }
  async begin(accessToken:string,workspaceId:string){
    bearerSchema.parse(accessToken);uuid.parse(workspaceId);
    const intent=await this.deps.intents.begin({
      accessToken,workspaceId,provider:"messenger",
      providerApplicationKey:"meta-messenger-"+this.#appId,
      redirectUri:this.#redirectUri
    });
    return {authorizationUrl:this.deps.client.authorizationUrl(
      intent.state,this.#redirectUri
    ),expiresAt:intent.expiresAt,browserNonce:intent.browserNonce};
  }
  async complete(input:{
    accessToken:string;workspaceId:string;state:string;
    browserNonce:string;authorizationCode:string;pageId:string
  }):Promise<{
    connectionId:string;workspaceId:string;accountId:string;status:"verifying"
  }>{
    const p=z.object({
      accessToken:bearerSchema,workspaceId:uuid,state:stateSchema,
      browserNonce:stateSchema,authorizationCode:oauthCodeSchema,pageId:pageIdSchema
    }).strict().parse(input);
    const intent=await this.deps.intents.consume({
      accessToken:p.accessToken,workspaceId:p.workspaceId,
      provider:"messenger",providerApplicationKey:"meta-messenger-"+this.#appId,
      redirectUri:this.#redirectUri,state:p.state,browserNonce:p.browserNonce
    });
    if(!intent||intent.workspaceId!==p.workspaceId||intent.provider!=="messenger")
      throw Error("Messenger owner authorization expired, replayed or invalid");
    // Page ID is only an untrusted selection; the provider's User grant,
    // Page tasks, Page access token, issuing app and direct Page identity must
    // independently prove access. No browser-supplied Page token is accepted.
    const grant=await this.deps.client.exchangeAndProve(
      p.authorizationCode,this.#redirectUri,p.pageId
    );
    if(grant.pageId!==p.pageId)
      throw Error("Provider did not authorize the selected Messenger Page");
    const connectionId=randomUUID();
    const now=this.deps.now?.()??new Date();
    if(grant.accessExpiresAt.getTime()<=now.getTime()+120000||
      !MESSENGER_REQUIRED_SCOPES.every(scope=>grant.scopes.includes(scope)))
      throw Error("Messenger Page proof expired or missing permissions");
    const linked=await this.deps.registry.linkVerified({
      connectionId,intentId:intent.intentId,sessionId:intent.sessionId,
      workspaceId:intent.workspaceId,actor:intent.actor,
      providerApplicationKey:"meta-messenger-"+this.#appId,
      credentialAccountId:connectionId,
      proof:{provider:"messenger",accountId:p.pageId,
        source:"oauth_grant",sourceReference:"meta-messenger-"+this.#appId,
        verifiedAt:now.toISOString()}
    },tx=>this.deps.vault.putInTransaction(tx,{
      provider:"workspace-messenger",accountId:connectionId,
      accessToken:grant.accessToken,scopes:grant.scopes,
      accessExpiresAt:grant.accessExpiresAt
    }));
    return {connectionId:linked.connectionId,workspaceId:linked.workspaceId,
      accountId:linked.accountId,status:"verifying"};
  }
  async confirm(input:{
    workspaceId:string;connectionId:string;actor:WorkspacePrincipal
  }):Promise<{connectionId:string;status:"connected";generation:number}>{
    const p=z.object({
      workspaceId:uuid,connectionId:uuid,
      actor:z.object({issuer:z.string().min(1),subject:z.string().min(1)}).strict()
    }).strict().parse(input);
    const current=await this.deps.registry.findForAdministrator(p);
    if(!current||current.provider!=="messenger"||
      current.status!=="verifying")throw Error("Messenger activation not permitted");
    const stored=await this.deps.vault.get("workspace-messenger",p.connectionId);
    if(!stored||!stored.accessExpiresAt||
      stored.accessExpiresAt.getTime()-(this.deps.now?.()??new Date()).getTime()<120000||
      !MESSENGER_REQUIRED_SCOPES.every(s=>stored.scopes.includes(s)))
      throw Error("Messenger account grant expired or incomplete");
    await this.deps.client.verifyPage(stored.accessToken,current.accountId);
    const linked=await this.deps.registry.activateVerified({
      workspaceId:p.workspaceId,connectionId:p.connectionId,actor:p.actor,
      providerApplicationKey:"meta-messenger-"+this.#appId,
      credentialAccountId:p.connectionId,
      proof:{provider:"messenger",accountId:current.accountId,
        source:"provider_api",sourceReference:"meta-messenger-page-readback",
        verifiedAt:new Date().toISOString()}
    });
    return {connectionId:linked.connectionId,status:"connected",
      generation:linked.generation};
  }
}
