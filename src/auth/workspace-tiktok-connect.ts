import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {
  AuthenticatedWorkspaceConnectionIntents
} from "./authenticated-workspace-connection.js";
import type {
  TikTokOAuthClientLike,TikTokOAuthTokenResult
} from "./tiktok-oauth.js";
import type {PostgresOAuthCredentialStore} from "./oauth-store.js";
import type {
  PostgresWorkspaceConnectionRegistry,WorkspacePrincipal
} from "../persistence/workspace-connections.js";

const uuid=z.string().uuid();
const app=z.string().min(5).max(48).regex(/^[A-Za-z0-9_-]+$/u);
const state=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const code=z.string().min(8).max(2048).regex(/^[A-Za-z0-9._~%-]+$/u);
const openId=z.string().min(5).max(256).regex(/^[A-Za-z0-9._:-]+$/u);
const bearer=z.string().min(50).max(8192);
const hostnames=new Set(["ads.tiktok.com","business-api.tiktok.com","www.tiktok.com"]);
function obj(value:unknown):Record<string,unknown>|undefined{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)
    ?value as Record<string,unknown>:undefined;
}
export interface TikTokAccountPermissionReadback{
  readonly openId:string;
  readonly advancedAccess:boolean;
  readonly messagingPermitted:boolean;
  readonly observedScopes:readonly string[];
}
export interface TikTokAccountPermissionReader {
  read(accessToken:string,expectedOpenId:string):
    Promise<TikTokAccountPermissionReadback>;
}
/** Two separate official read-only endpoints: scope inspection and account
 * status. Never guess a messaging entitlement from a paid subscription or
 * persisted scope; lack of any readback is a DENIAL, not a fallback permit.
 */
export class TikTokAccountPermissionClient implements TikTokAccountPermissionReader{
  readonly #appId:string;
  constructor(private readonly deps:{
    version:"v1.3";appId:string;fetchImpl?:typeof fetch
  }){this.#appId=app.parse(deps.appId);}
  async read(accessToken:string,expectedOpenId:string):
    Promise<TikTokAccountPermissionReadback>{
    const token=bearer.parse(accessToken);
    const account=openId.parse(expectedOpenId);
    const request=async(path:string,options:{
      method:"GET"|"POST";businessId?:string;fields?:readonly string[]
    })=>{
      const url=new URL("https://business-api.tiktok.com/open_api/"+
        this.deps.version+"/"+path);
      if(options.businessId!==undefined)
        url.searchParams.set("business_id",options.businessId);
      if(options.fields!==undefined)
        url.searchParams.set("fields",JSON.stringify(options.fields));
      let response:Response;
      try{
        response=await (this.deps.fetchImpl??fetch)(url.toString(),{
          method:options.method,redirect:"error",cache:"no-store",
          headers:options.method==="POST"
            ?{accept:"application/json","content-type":"application/json"}
            :{accept:"application/json","Access-Token":token},
          ...(options.method==="POST"?{body:JSON.stringify({
            app_id:this.#appId,access_token:token
          })}:{}),
          signal:AbortSignal.timeout(8000)
        });
      }catch{throw new Error("TikTok account readback unavailable");}
      if(!response.ok)throw new Error("TikTok account readback unavailable");
      // Never log or propagate raw provider response, tokens, URL or account.
      let data:unknown;
      try{
        const reader=response.body?.getReader();
        if(reader===undefined)throw new Error("missing body");
        let total=0;const parts:Uint8Array[]=[];
        try{
          for(;;){
            const next=await reader.read();if(next.done)break;
            if(next.value===undefined)continue;
            total+=next.value.byteLength;
            if(total>32768)throw new Error("oversized response");
            parts.push(next.value);
          }
        }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
        data=JSON.parse(Buffer.concat(parts,total).toString("utf8")) as unknown;
      }catch{throw new Error("TikTok account readback invalid");}
      const root=obj(data);
      if(root===undefined||(root.code!==0&&root.code!=="0"))
        throw new Error("TikTok account readback denied");
      return obj(root.data)??{};
    };
    // User-token info must bind the same immutable open_id as the exchanged
    // code and report actual granted scopes, not a configured app permission.
    const tokenInfo=await request("tt_user/token_info/get/",{method:"POST"});
    // Token inspection reports creator_id; authorization-code exchange
    // reports open_id. Both must identify the same app-scoped account.
    const tokenOpenId=tokenInfo.creator_id;
    const rawScopes=tokenInfo.scope;
    const scopes=typeof rawScopes==="string"
      ?rawScopes.split(/[ ,]+/u).filter(Boolean)
      :Array.isArray(rawScopes)
        ?rawScopes.filter((x):x is string=>typeof x==="string"): [];
    if(tokenInfo.app_id!==this.#appId||tokenOpenId!==account||
      scopes.length===0||!scopes.includes("user.account.type"))
      throw new Error("TikTok scope/immutable identity readback missing");
    // has_advanced_access is not included in the default /business/get/
    // fields and requires user.account.type consent.
    const profile=await request("business/get/",{
      method:"GET",businessId:account,fields:["has_advanced_access"]
    });
    if(profile.has_advanced_access!==true)
      throw new Error("TikTok account not eligible for Business Messaging");
    const resultId=profile.open_id??profile.business_id;
    if(resultId!==undefined&&resultId!==account)
      throw new Error("TikTok provider profile identity mismatch");
    // The account's eligibility is not enough to claim app Business
    // Messaging access: that is a distinct TikTok developer due-diligence
    // gate and future dynamic policy.
    return {openId:account,advancedAccess:true,
      messagingPermitted:false,observedScopes:scopes};
  }
}

export class WorkspaceTikTokOwnerConnections{
  readonly #appId:string;
  readonly #redirectUri:string;
  readonly #authorizationUrl:URL;
  constructor(private readonly deps:{
    appId:string;
    redirectUri:string;
    authorizationUrl:string;
    intents:Pick<AuthenticatedWorkspaceConnectionIntents,"begin"|"consume">;
    oauth:Pick<TikTokOAuthClientLike,"exchangeAuthorizationCode">;
    registry:Pick<PostgresWorkspaceConnectionRegistry,
      "linkVerified"|"activateVerified"|"findForAdministrator">;
    vault:Pick<PostgresOAuthCredentialStore,"putInTransaction"|"get">;
    accountReader:TikTokAccountPermissionReader;
    now?:()=>Date;
  }){
    this.#appId=app.parse(deps.appId);
    const redirect=new URL(deps.redirectUri);
    if(redirect.protocol!=="https:"||redirect.port||
      redirect.username||redirect.password||redirect.search||
      redirect.hash||!redirect.pathname.endsWith("/")||
      redirect.toString()!==deps.redirectUri)
      throw Error("TikTok account-holder redirect must be exact HTTPS with trailing slash");
    this.#redirectUri=deps.redirectUri;
    const authorization=new URL(deps.authorizationUrl);
    if(authorization.protocol!=="https:"||authorization.port||
      authorization.username||authorization.password||
      authorization.hash||!hostnames.has(authorization.hostname)||
      authorization.toString()!==deps.authorizationUrl)
      throw Error("TikTok account-holder authorization URL must be vendor registered");
    const providedRedirect=authorization.searchParams.get("redirect_uri");
    if(providedRedirect!==null&&providedRedirect!==this.#redirectUri)
      throw Error("TikTok owner authorize URL has mismatched callback");
    this.#authorizationUrl=authorization;
  }
  async begin(accessToken:string,workspaceId:string){
    bearer.parse(accessToken);uuid.parse(workspaceId);
    const intent=await this.deps.intents.begin({
      accessToken,workspaceId,provider:"tiktok",
      providerApplicationKey:"tiktok-holder-"+this.#appId,
      redirectUri:this.#redirectUri
    });
    // Only a developer-portal-provided owner authorization URL can be used.
    const url=new URL(this.#authorizationUrl);
    url.searchParams.set("state",intent.state);
    return {authorizationUrl:url.toString(),
      expiresAt:intent.expiresAt,browserNonce:intent.browserNonce};
  }
  async complete(input:{
    accessToken:string;workspaceId:string;state:string;
    browserNonce:string;authorizationCode:string
  }):Promise<{connectionId:string;workspaceId:string;accountId:string;status:"verifying"}>{
    const p=z.object({accessToken:bearer,workspaceId:uuid,state,
      browserNonce:state,authorizationCode:code}).strict().parse(input);
    const intent=await this.deps.intents.consume({
      accessToken:p.accessToken,workspaceId:p.workspaceId,
      provider:"tiktok",providerApplicationKey:"tiktok-holder-"+this.#appId,
      redirectUri:this.#redirectUri,state:p.state,browserNonce:p.browserNonce
    });
    if(intent===undefined||intent.workspaceId!==p.workspaceId||
      intent.provider!=="tiktok")
      throw Error("TikTok workspace authorization expired or replayed");
    const exchanged:TikTokOAuthTokenResult=
      await this.deps.oauth.exchangeAuthorizationCode(
        p.authorizationCode,this.#redirectUri
      );
    const account=openId.parse(exchanged.openId);
    if(!exchanged.refreshToken||exchanged.refreshToken.length<8||
      !Number.isSafeInteger(exchanged.accessExpiresInSeconds)||
      exchanged.accessExpiresInSeconds<60||
      exchanged.accessExpiresInSeconds>172800||
      !Number.isSafeInteger(exchanged.refreshExpiresInSeconds)||
      exchanged.refreshExpiresInSeconds===undefined||
      exchanged.refreshExpiresInSeconds<3600||
      exchanged.scopes.length===0)
      throw Error("TikTok provider grant incomplete");
    const connectionId=randomUUID();
    const now=this.deps.now?.()??new Date();
    const connection=await this.deps.registry.linkVerified({
      connectionId,intentId:intent.intentId,
      workspaceId:intent.workspaceId,sessionId:intent.sessionId,
      actor:intent.actor,providerApplicationKey:"tiktok-holder-"+this.#appId,
      credentialAccountId:connectionId,
      proof:{provider:"tiktok",accountId:account,
        source:"oauth_grant",sourceReference:"tiktok-holder-"+this.#appId,
        verifiedAt:now.toISOString()}
    },tx=>this.deps.vault.putInTransaction(tx,{
      provider:"workspace-tiktok",accountId:connectionId,
      accessToken:exchanged.accessToken,refreshToken:exchanged.refreshToken!,
      accessExpiresAt:new Date(now.getTime()+exchanged.accessExpiresInSeconds*1000),
      refreshExpiresAt:new Date(now.getTime()+exchanged.refreshExpiresInSeconds!*1000),
      scopes:exchanged.scopes
    }));
    return {connectionId:connection.connectionId,
      workspaceId:connection.workspaceId,
      accountId:connection.accountId,status:"verifying"};
  }
  async confirm(input:{
    workspaceId:string;connectionId:string;actor:WorkspacePrincipal
  }):Promise<{connectionId:string;status:"connected";generation:number}>{
    const p=z.object({workspaceId:uuid,connectionId:uuid,
      actor:z.object({issuer:z.string().min(1),subject:z.string().min(1)}).strict()
    }).strict().parse(input);
    const pending=await this.deps.registry.findForAdministrator(p);
    if(pending===undefined||pending.provider!=="tiktok"||
      pending.status!=="verifying")
      throw Error("TikTok connection activation not permitted");
    const credential=await this.deps.vault.get("workspace-tiktok",p.connectionId);
    const now=this.deps.now?.()??new Date();
    if(credential===undefined||credential.accessExpiresAt===undefined||
      credential.accessExpiresAt.getTime()-now.getTime()<120000||
      credential.refreshToken===undefined)
      throw Error("TikTok provider access token expired");
    const readback=await this.deps.accountReader.read(
      credential.accessToken,pending.accountId
    );
    if(readback.openId!==pending.accountId||
      readback.advancedAccess!==true)
      throw Error("TikTok provider owner or account eligibility unverified");
    // connected only as a private registry entry. messagingPermitted=false:
    // no tenant route/worker/dispatch until future access/consent evidence.
    const activated=await this.deps.registry.activateVerified({
      workspaceId:p.workspaceId,connectionId:p.connectionId,actor:p.actor,
      providerApplicationKey:"tiktok-holder-"+this.#appId,
      credentialAccountId:p.connectionId,
      proof:{provider:"tiktok",accountId:pending.accountId,
        source:"provider_api",sourceReference:"tiktok-business-get",
        verifiedAt:now.toISOString()}
    });
    return {connectionId:activated.connectionId,
      status:"connected",generation:activated.generation};
  }
}
