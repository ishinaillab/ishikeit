import { z } from "zod";
import { INSTAGRAM_REVIEW_SCOPES, type InstagramOAuthClientLike } from "./instagram-oauth.js";
import { AuthenticatedWorkspaceConnectionIntents } from "./authenticated-workspace-connection.js";
import type { ConnectionIntentCompletion } from "../persistence/workspace-connection-intents.js";

/**
 * Instagram-specific, provider-native OAuth authorization. The server alone
 * selects app ID, exact registered redirect URI and fixed provider endpoint.
 * This intentionally does not subscribe a webhook or activate tenant routing.
 * No user-controlled account ID, handle, redirect or arbitrary provider URL.
 *
 * Meta's Instagram Login flow is confidential-client authorization code with
 * state and app secret. Never assume Meta accepts RFC7636 code_challenge
 * parameters unless its official provider contract confirms support.
 */
const uuid=z.string().uuid();
const bearer=z.string().min(50).max(8192);
const state=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const authorizationCode=z.string().min(8).max(4096).regex(/^[A-Za-z0-9._~%-]+$/u);

interface InstagramConsentOptions {
  appId:string;
  redirectUri:string;
  intents:Pick<AuthenticatedWorkspaceConnectionIntents,"begin"|"consume">;
  client:Pick<InstagramOAuthClientLike,
    "exchangeAuthorizationCode"|"exchangeLongLived"|"resolveProfessionalAccountId">;
  now?:()=>Date;
}
export interface ProviderNativeInstagramGrant {
  readonly intent:ConnectionIntentCompletion;
  readonly sessionId:string;
  readonly accountId:string;
  readonly credentialSubjectId:string;
  readonly accessToken:string;
  readonly scopes:readonly string[];
  readonly accessExpiresAt:Date;
}
export class ProviderNativeInstagramConsent {
  readonly #appId:string;
  readonly #redirectUri:string;
  readonly #intents:InstagramConsentOptions["intents"];
  readonly #client:InstagramConsentOptions["client"];
  readonly #now:()=>Date;
  constructor(options:InstagramConsentOptions){
    this.#appId=z.string().regex(/^\d{5,30}$/u).parse(options.appId);
    const url=new URL(options.redirectUri);
    if(url.protocol!=="https:" || url.port || url.username || url.password ||
      url.hash || url.search || url.toString()!==options.redirectUri)
      throw new Error("Instagram connection redirect must match registered HTTPS URI");
    this.#redirectUri=options.redirectUri;
    this.#intents=options.intents;
    this.#client=options.client;
    this.#now=options.now??(()=>new Date());
  }

  async begin(accessToken:string,workspaceId:string):Promise<{
    authorizationUrl:string;expiresAt:string;browserNonce:string
  }>{
    bearer.parse(accessToken);
    uuid.parse(workspaceId);
    const started=await this.#intents.begin({
      accessToken,workspaceId,provider:"instagram",
      providerApplicationKey:"instagram-login-"+this.#appId,
      redirectUri:this.#redirectUri
    });
    // Do NOT add code_challenge to Instagram Login without verified support.
    // State and separate HttpOnly browser nonce are required on callback.
    const url=new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id",this.#appId);
    url.searchParams.set("redirect_uri",this.#redirectUri);
    url.searchParams.set("response_type","code");
    url.searchParams.set("scope",INSTAGRAM_REVIEW_SCOPES.join(","));
    url.searchParams.set("state",started.state);
    url.searchParams.set("force_reauth","true");
    return {
      authorizationUrl:url.toString(),
      expiresAt:started.expiresAt,
      browserNonce:started.browserNonce
    };
  }

  async complete(input:{
    accessToken:string;workspaceId:string;
    state:string;browserNonce:string;authorizationCode:string
  }):Promise<ProviderNativeInstagramGrant>{
    const p=z.object({
      accessToken:bearer,workspaceId:uuid,state,
      browserNonce:state,authorizationCode
    }).strict().parse(input);
    // Intent consumption verifies exact live Supabase Auth AAL2, session,
    // active owner/admin, state, nonce, registered app and redirect together.
    const intent=await this.#intents.consume({
      accessToken:p.accessToken,workspaceId:p.workspaceId,
      provider:"instagram",providerApplicationKey:"instagram-login-"+this.#appId,
      redirectUri:this.#redirectUri,state:p.state,browserNonce:p.browserNonce
    });
    if(intent===undefined)
      throw new Error("Instagram connection intent expired, replayed or unauthorized");
    const short=await this.#client.exchangeAuthorizationCode(
      p.authorizationCode.replace(/#_$/u,""),this.#redirectUri
    );
    // Grant subsets (including missing scope data) are not messaging rights.
    if(!INSTAGRAM_REVIEW_SCOPES.every(scope=>short.scopes.includes(scope)))
      throw new Error("Instagram provider did not grant the required messaging scopes");
    const long=await this.#client.exchangeLongLived(short.accessToken);
    const accountId=await this.#client.resolveProfessionalAccountId(long.accessToken);
    const account=z.string().regex(/^\d{1,30}$/u);
    account.parse(accountId);
    account.parse(short.userId);
    if(!Number.isSafeInteger(long.accessExpiresInSeconds) ||
      long.accessExpiresInSeconds<3600 || long.accessExpiresInSeconds>90*86400)
      throw new Error("Instagram grant expiration invalid");
    const accessExpiresAt=new Date(this.#now().getTime()+long.accessExpiresInSeconds*1000);
    // The token remains server only. Never expose it to the browser route,
    // frontend, logs, query parameters, audit records or issue checkpoints.
    return {
      intent,sessionId:intent.sessionId,accountId,
      credentialSubjectId:short.userId,accessToken:long.accessToken,
      scopes:short.scopes,accessExpiresAt
    };
  }
}
