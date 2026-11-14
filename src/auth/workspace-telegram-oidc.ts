import {randomUUID} from "node:crypto";
import {createRemoteJWKSet,jwtVerify} from "jose";
import {z} from "zod";
import type {AuthenticatedWorkspaceConnectionIntents} from "./authenticated-workspace-connection.js";
import type {
  PostgresWorkspaceConnectionRegistry,WorkspacePrincipal
} from "../persistence/workspace-connections.js";

const uuid=z.string().uuid();
const code=z.string().min(8).max(4096).regex(/^[A-Za-z0-9._~%-]+$/u);
const opaque=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const telegramUser=z.string().regex(/^[1-9][0-9]{0,15}$/u);
const expectedIssuer="https://oauth.telegram.org";
const jwks=createRemoteJWKSet(new URL(
  "https://oauth.telegram.org/.well-known/jwks.json"
),{timeoutDuration:8000,cooldownDuration:30000,cacheMaxAge:300000});
function hasControlCharacter(input:string):boolean{
  return [...input].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127);
}
function asRecord(value:unknown):Record<string,unknown>|undefined{
  return typeof value==="object" && value!==null && !Array.isArray(value)
    ? value as Record<string,unknown>:undefined;
}
async function smallJson(response:Response,maxBytes=32768):Promise<Record<string,unknown>>{
  const reader=response.body?.getReader();
  if(reader===undefined)throw new Error("Telegram OIDC response unavailable");
  const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      if(chunk.value===undefined)continue;
      size+=chunk.value.byteLength;
      if(size>maxBytes)throw new Error("Telegram OIDC response too large");
      chunks.push(chunk.value);
    }
  }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  const data:unknown=JSON.parse(Buffer.concat(chunks,size).toString("utf8"));
  return asRecord(data)??{};
}
export interface TelegramOIDCClientLike{
  exchange(code:string,verifier:string):Promise<string>;
  verify(idToken:string,nonce:string):Promise<string>;
}
export class TelegramOIDCClient implements TelegramOIDCClientLike{
  readonly #clientId:string;
  readonly #secret:string;
  readonly #redirectUri:string;
  readonly #fetch:typeof fetch;
  constructor(options:{
    clientId:string;clientSecret:string;redirectUri:string;fetchImpl?:typeof fetch
  }){
    this.#clientId=telegramUser.parse(options.clientId);
    this.#secret=z.string().min(16).max(1024).parse(options.clientSecret);
    const url=new URL(options.redirectUri);
    if(url.protocol!=="https:"||url.port||url.username||url.password||
      url.hash||url.search||url.toString()!==options.redirectUri)
      throw new Error("Telegram OIDC redirect requires exact registered HTTPS URI");
    this.#redirectUri=options.redirectUri;
    this.#fetch=options.fetchImpl??fetch;
  }
  async exchange(authorizationCode:string,codeVerifier:string):Promise<string>{
    code.parse(authorizationCode);
    opaque.parse(codeVerifier);
    let response:Response;
    try{
      response=await this.#fetch("https://oauth.telegram.org/token",{
        method:"POST",redirect:"error",cache:"no-store",
        headers:{
          authorization:"Basic "+Buffer.from(
            this.#clientId+":"+this.#secret,"utf8"
          ).toString("base64"),
          "content-type":"application/x-www-form-urlencoded",accept:"application/json"
        },
        body:new URLSearchParams({
          grant_type:"authorization_code",
          client_id:this.#clientId,code:authorizationCode,
          redirect_uri:this.#redirectUri,code_verifier:codeVerifier
        }).toString(),
        signal:AbortSignal.timeout(8000)
      });
    }catch{throw new Error("Telegram OIDC exchange unavailable");}
    if(!response.ok)throw new Error("Telegram OIDC provider rejected code exchange");
    let data:Record<string,unknown>;
    try{data=await smallJson(response);}catch{
      throw new Error("Telegram OIDC token response invalid");
    }
    if(data.token_type!=="Bearer"||
      typeof data.id_token!=="string"||data.id_token.length>8192||
      typeof data.expires_in!=="number"||data.expires_in<60||
      data.expires_in>86400)
      throw new Error("Telegram OIDC token response invalid");
    return data.id_token;
  }

  async verify(idToken:string,nonce:string):Promise<string>{
    return verifyTelegramOIDCIdToken(idToken,nonce,this.#clientId);
  }
}

/** The exact Telegram JWKS URL, issuer, audience, expiry and RS256 signature
 * are mandatory. A test-only local resolver permits cryptographic negative
 * tests without calling Telegram or exposing a production credential.
 */
export async function verifyTelegramOIDCIdToken(
  idToken:string,nonce:string,clientId:string,
  resolver:Parameters<typeof jwtVerify>[1]=jwks
):Promise<string>{
  opaque.parse(nonce);
  telegramUser.parse(clientId);
  if(typeof idToken!=="string"||idToken.length<80||idToken.length>8192)
    throw new Error("Telegram OIDC ID token invalid");
  let payload:Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try{
    const result=await jwtVerify(idToken,resolver,{
      issuer:expectedIssuer,audience:clientId,
      algorithms:["RS256"],clockTolerance:"30s",maxTokenAge:"10m",
      requiredClaims:["sub","iat","exp","nonce"]
    });
    payload=result.payload;
  }catch{throw new Error("Telegram OIDC signature/claims unverified");}
  // Telegram's signed OIDC "sub" is an opaque user subject and is not
  // documented as interchangeable with the numeric Bot API User.id. The
  // official profile scope supplies a separately signed numeric "id".
  // Demand that claim and compare it to getBusinessConnection.user.id.
  if(payload.nonce!==nonce||
    typeof payload.sub!=="string"||
    payload.sub.length<1||payload.sub.length>256||
    typeof payload.iat!=="number"||
    typeof payload.exp!=="number"||
    payload.exp-payload.iat>3600||
    typeof payload.id!=="number"||
    !Number.isSafeInteger(payload.id)||
    !telegramUser.safeParse(String(payload.id)).success)
    throw new Error("Telegram OIDC identity/nonce mismatch");
  return String(payload.id);
}

export interface TelegramBusinessReadback {
  readonly connectionId:string;
  readonly ownerId:string;
  readonly enabled:boolean;
  readonly canReply:boolean;
}
export interface TelegramNativeBusinessLike {
  inspect(connectionId:string):Promise<TelegramBusinessReadback>;
}
/** Bot API is the authoritative, tenant-independent readback; no username
 * inference, no Telegram user-password or OTP custody, no send action.
 */
export class TelegramNativeBusinessReader implements TelegramNativeBusinessLike{
  readonly #token:string;
  readonly #fetch:typeof fetch;
  constructor(options:{botToken:string;fetchImpl?:typeof fetch}){
    this.#token=z.string().regex(/^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{20,}$/u).parse(options.botToken);
    this.#fetch=options.fetchImpl??fetch;
  }
  async inspect(connectionId:string):Promise<TelegramBusinessReadback>{
    if(typeof connectionId!=="string"||connectionId.length<5||
      connectionId.length>256||hasControlCharacter(connectionId))
      throw new Error("Telegram Business connection invalid");
    let response:Response;
    try{
      response=await this.#fetch(
        "https://api.telegram.org/bot"+this.#token+"/getBusinessConnection",{
          method:"POST",redirect:"error",cache:"no-store",
          headers:{"content-type":"application/json",accept:"application/json"},
          body:JSON.stringify({business_connection_id:connectionId}),
          signal:AbortSignal.timeout(8000)
        });
    }catch{throw new Error("Telegram Business readback unavailable");}
    if(!response.ok)throw new Error("Telegram Business connection not verified");
    let record:Record<string,unknown>;
    try{record=await smallJson(response,16384);}catch{
      throw new Error("Telegram Business response invalid");
    }
    const result=asRecord(record.result);
    const owner=asRecord(result?.user);
    const rights=asRecord(result?.rights);
    if(record.ok!==true||result?.id!==connectionId||
      typeof result?.is_enabled!=="boolean"||
      typeof owner?.id!=="number"||
      !Number.isSafeInteger(owner.id)||
      !telegramUser.safeParse(String(owner.id)).success)
      throw new Error("Telegram Business owner unverified");
    return {connectionId,ownerId:String(owner.id),
      enabled:result.is_enabled,canReply:rights?.can_reply===true};
  }
}

export class WorkspaceTelegramOIDCConnections{
  readonly #clientId:string;
  readonly #redirectUri:string;
  constructor(private readonly deps:{
    clientId:string;redirectUri:string;
    intents:Pick<AuthenticatedWorkspaceConnectionIntents,"begin"|"consume">;
    oidc:TelegramOIDCClientLike;
    business:TelegramNativeBusinessLike;
    registry:Pick<PostgresWorkspaceConnectionRegistry,
      "linkVerified"|"findForAdministrator"|"activateTelegramBusiness">;
  }){
    this.#clientId=telegramUser.parse(deps.clientId);
    const url=new URL(deps.redirectUri);
    if(url.protocol!=="https:"||url.port||url.username||url.password||
      url.hash||url.search||url.toString()!==deps.redirectUri)
      throw Error("Telegram workspace OIDC redirect invalid");
    this.#redirectUri=deps.redirectUri;
  }
  async begin(accessToken:string,workspaceId:string){
    uuid.parse(workspaceId);
    const started=await this.deps.intents.begin({
      accessToken,workspaceId,provider:"telegram",
      providerApplicationKey:"telegram-oidc-"+this.#clientId,
      redirectUri:this.#redirectUri
    });
    const url=new URL("https://oauth.telegram.org/auth");
    url.searchParams.set("client_id",this.#clientId);
    url.searchParams.set("redirect_uri",this.#redirectUri);
    url.searchParams.set("response_type","code");
    url.searchParams.set("scope","openid profile");
    url.searchParams.set("state",started.state);
    url.searchParams.set("nonce",started.state);
    url.searchParams.set("code_challenge",started.codeChallenge);
    url.searchParams.set("code_challenge_method","S256");
    return {authorizationUrl:url.toString(),
      expiresAt:started.expiresAt,browserNonce:started.browserNonce};
  }
  async complete(input:{
    accessToken:string;workspaceId:string;state:string;
    browserNonce:string;authorizationCode:string
  }):Promise<{connectionId:string;workspaceId:string;accountId:string;status:"verifying"}>{
    const parsed=z.object({
      accessToken:z.string().min(50).max(8192),workspaceId:uuid,
      state:opaque,browserNonce:opaque,authorizationCode:code
    }).strict().parse(input);
    const intent=await this.deps.intents.consume({
      accessToken:parsed.accessToken,workspaceId:parsed.workspaceId,
      provider:"telegram",
      providerApplicationKey:"telegram-oidc-"+this.#clientId,
      redirectUri:this.#redirectUri,
      state:parsed.state,browserNonce:parsed.browserNonce
    });
    if(intent===undefined||intent.provider!=="telegram"||
      intent.workspaceId!==parsed.workspaceId)
      throw new Error("Telegram owner connection intent denied/replayed");
    const idToken=await this.deps.oidc.exchange(
      parsed.authorizationCode,intent.codeVerifier
    );
    // The verified ID is the signed numeric "id" claim supplied with the
    // owner's explicitly consented "profile" scope, NEVER OIDC sub.
    const accountId=telegramUser.parse(
      await this.deps.oidc.verify(idToken,parsed.state)
    );
    const linked=await this.deps.registry.linkVerified({
      connectionId:randomUUID(),workspaceId:intent.workspaceId,
      sessionId:intent.sessionId,intentId:intent.intentId,
      actor:intent.actor,providerApplicationKey:"telegram-oidc-"+this.#clientId,
      proof:{provider:"telegram",accountId,source:"oauth_grant",
        sourceReference:"telegram-oidc-"+this.#clientId,
        verifiedAt:new Date().toISOString()}
    });
    return {connectionId:linked.connectionId,workspaceId:linked.workspaceId,
      accountId:linked.accountId,status:"verifying"};
  }

  /** A Telegram OIDC identity is NOT a Bot API business connection. The
   * owner supplies a candidate connection ID, but it is NEVER accepted as
   * proof: authoritative getBusinessConnection must match signed OIDC sub,
   * live can_reply, fixed bot app and the exact workspace membership.
   */
  async confirm(input:{
    workspaceId:string;connectionId:string;
    actor:WorkspacePrincipal;businessConnectionId:string
  }):Promise<{connectionId:string;status:"connected";generation:number}>{
    const p=z.object({
      workspaceId:uuid,connectionId:uuid,
      actor:z.object({issuer:z.string().min(1),subject:z.string().min(1)}).strict(),
      businessConnectionId:z.string().min(5).max(256)
    }).strict().parse(input);
    const pending=await this.deps.registry.findForAdministrator(p);
    if(pending===undefined||pending.status!=="verifying"||
      pending.provider!=="telegram")
      throw new Error("Telegram owner binding unavailable");
    const provider=await this.deps.business.inspect(p.businessConnectionId);
    if(provider.ownerId!==pending.accountId||
      provider.enabled!==true||provider.canReply!==true)
      throw new Error("Telegram Business user/rights do not match verified OIDC owner");
    const activated=await this.deps.registry.activateTelegramBusiness({
      workspaceId:p.workspaceId,connectionId:p.connectionId,actor:p.actor,
      providerApplicationKey:"telegram-oidc-"+this.#clientId,
      ownerId:provider.ownerId,businessConnectionId:provider.connectionId,
      verifiedAt:new Date().toISOString()
    });
    return {connectionId:activated.connectionId,status:"connected",
      generation:activated.generation};
  }
}
