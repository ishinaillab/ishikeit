import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {AuthenticatedWorkspaceConnectionIntents} from "./authenticated-workspace-connection.js";
import type {PostgresOAuthCredentialStore} from "./oauth-store.js";
import type {
  PostgresWorkspaceConnectionRegistry,WorkspacePrincipal
} from "../persistence/workspace-connections.js";
import {
  WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES,
  type VerifiedWhatsAppEmbeddedV4Grant
} from "./whatsapp-embedded-v4-proof.js";

const uuid=z.string().uuid();
const number=z.string().regex(/^[1-9][0-9]{4,31}$/u);
const state=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const code=z.string().min(8).max(4096).regex(/^[A-Za-z0-9._~%-]+$/u);
const bearer=z.string().min(50).max(8192);
const principal=z.object({
  issuer:z.string().min(1).max(200),subject:z.string().min(1).max(256)
}).strict();

export interface WhatsAppOwnerGrantReader{
  exchangeAndVerify(input:{
    authorizationCode:string;messagingAccountId:string;phoneNumberId:string
  }):Promise<VerifiedWhatsAppEmbeddedV4Grant>;
  verifyExisting(input:{
    businessToken:string;messagingAccountId:string;phoneNumberId:string
  }):Promise<{scopes:readonly string[];accessExpiresAt:Date}>;
}

/** Layered on exact owner-authenticated browser session + 1-use private intent.
 * The vendor's JS SDK does NOT echo our state: only the first-party BFF sends
 * that opaque state on the same-origin CSRF-bound completion request.
 *
 * Fail closed until partner qualification/Meta permissions and real owner
 * consent are independently demonstrated. Neither this coordinator nor its
 * registry "connected" state enable sends or webhook subscriptions.
 */
export class WorkspaceWhatsAppEmbeddedV4Connections{
  readonly #appId:string;
  readonly #configId:string;
  readonly #graphVersion:string;
  readonly #intentUri:string;
  readonly #applicationKey:string;
  readonly #now:()=>Date;
  constructor(private readonly deps:{
    appId:string;configId:string;graphVersion:string;
    origin:string;
    intents:Pick<AuthenticatedWorkspaceConnectionIntents,"begin"|"consume">;
    reader:WhatsAppOwnerGrantReader;
    registry:Pick<PostgresWorkspaceConnectionRegistry,
      "linkVerified"|"activateVerified"|"findBindingForAdministrator">;
    vault:Pick<PostgresOAuthCredentialStore,"putInTransaction"|"get">;
    now?:()=>Date;
  }){
    this.#appId=number.parse(deps.appId);
    this.#configId=number.parse(deps.configId);
    this.#graphVersion=z.string().regex(/^v[0-9]{1,2}\.[0-9]{1,2}$/u)
      .parse(deps.graphVersion);
    const origin=new URL(deps.origin);
    if(origin.protocol!=="https:"||origin.port||origin.username||
      origin.password||origin.pathname!=="/"||origin.search||origin.hash||
      origin.origin+"/"!==deps.origin)
      throw Error("Invalid WhatsApp Embedded Signup first-party origin");
    this.#intentUri=new URL("/app/auth/connect/whatsapp/embedded-v4",
      deps.origin).toString();
    this.#applicationKey="meta-wa-v4-"+this.#appId+"-"+this.#configId;
    this.#now=deps.now??(()=>new Date());
  }

  /** The state belongs only to first-party JS in volatile memory, not a
   * provider URL or localStorage. The distinct browser nonce is HTTP-only.
   * SDK configuration is a public Meta app/config ID, not an access token.
   */
  async begin(accessToken:string,workspaceId:string):Promise<{
    state:string;browserNonce:string;expiresAt:string;
    appId:string;configId:string;graphVersion:string
  }>{
    bearer.parse(accessToken);uuid.parse(workspaceId);
    const x=await this.deps.intents.begin({
      accessToken,workspaceId,provider:"whatsapp",
      providerApplicationKey:this.#applicationKey,
      redirectUri:this.#intentUri
    });
    return {
      state:x.state,browserNonce:x.browserNonce,expiresAt:x.expiresAt,
      appId:this.#appId,configId:this.#configId,graphVersion:this.#graphVersion
    };
  }

  async complete(input:{
    accessToken:string;workspaceId:string;state:string;
    browserNonce:string;authorizationCode:string;
    messagingAccountId:string;phoneNumberId:string
  }):Promise<{
    connectionId:string;workspaceId:string;accountId:string;status:"verifying"
  }>{
    const p=z.object({
      accessToken:bearer,workspaceId:uuid,state,
      browserNonce:state,authorizationCode:code,
      messagingAccountId:number,phoneNumberId:number
    }).strict().parse(input);
    const intent=await this.deps.intents.consume({
      accessToken:p.accessToken,workspaceId:p.workspaceId,
      state:p.state,browserNonce:p.browserNonce,
      provider:"whatsapp",providerApplicationKey:this.#applicationKey,
      redirectUri:this.#intentUri
    });
    if(!intent||intent.workspaceId!==p.workspaceId||
      intent.provider!=="whatsapp"||
      intent.providerApplicationKey!==this.#applicationKey)
      throw Error("WhatsApp owner authorization replayed or invalid");
    // Exchange the provider's 30-second code IMMEDIATELY. The provider
    // enforces its TTL. Never rely on a browser-created timestamp.
    const grant=await this.deps.reader.exchangeAndVerify({
      authorizationCode:p.authorizationCode,
      messagingAccountId:p.messagingAccountId,
      phoneNumberId:p.phoneNumberId
    });
    if(grant.messagingAccountId!==p.messagingAccountId||
      grant.phoneNumberId!==p.phoneNumberId||
      !WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES.every(s=>grant.scopes.includes(s))||
      grant.accessExpiresAt.getTime()<=this.#now().getTime()+120000)
      throw Error("WhatsApp owner grant failed exact asset/scope validation");
    const connectionId=randomUUID();
    const linked=await this.deps.registry.linkVerified({
      connectionId,intentId:intent.intentId,sessionId:intent.sessionId,
      workspaceId:intent.workspaceId,actor:intent.actor,
      providerApplicationKey:this.#applicationKey,
      providerConnectionId:grant.messagingAccountId,
      credentialAccountId:connectionId,
      proof:{
        provider:"whatsapp",accountId:grant.phoneNumberId,
        source:"oauth_grant",sourceReference:this.#applicationKey,
        verifiedAt:this.#now().toISOString()
      }
    },tx=>this.deps.vault.putInTransaction(tx,{
      provider:"workspace-whatsapp",accountId:connectionId,
      accessToken:grant.businessToken,scopes:grant.scopes,
      accessExpiresAt:grant.accessExpiresAt
    }));
    return {
      connectionId:linked.connectionId,workspaceId:linked.workspaceId,
      accountId:linked.accountId,status:"verifying"
    };
  }

  async confirm(input:{
    workspaceId:string;connectionId:string;actor:WorkspacePrincipal
  }):Promise<{connectionId:string;status:"connected";generation:number}>{
    const p=z.object({workspaceId:uuid,connectionId:uuid,
      actor:principal}).strict().parse(input);
    const row=await this.deps.registry.findBindingForAdministrator(p);
    if(!row||row.provider!=="whatsapp"||row.status!=="verifying"||
      row.providerApplicationKey!==this.#applicationKey||
      row.credentialAccountId!==p.connectionId||
      row.providerConnectionId===null)
      throw Error("WhatsApp activation is not authorized");
    const stored=await this.deps.vault.get("workspace-whatsapp",p.connectionId);
    if(!stored||!stored.accessExpiresAt||
      stored.accessExpiresAt.getTime()<=this.#now().getTime()+120000||
      !WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES.every(s=>stored.scopes.includes(s)))
      throw Error("WhatsApp credential missing or expired");
    const fresh=await this.deps.reader.verifyExisting({
      businessToken:stored.accessToken,
      messagingAccountId:row.providerConnectionId,
      phoneNumberId:row.accountId
    });
    if(fresh.accessExpiresAt.getTime()<=this.#now().getTime()+120000||
      !WHATSAPP_EMBEDDED_V4_REQUIRED_SCOPES.every(s=>fresh.scopes.includes(s)))
      throw Error("WhatsApp provider rights no longer valid");
    const active=await this.deps.registry.activateVerified({
      workspaceId:p.workspaceId,connectionId:p.connectionId,actor:p.actor,
      providerApplicationKey:this.#applicationKey,
      providerConnectionId:row.providerConnectionId,
      credentialAccountId:p.connectionId,
      proof:{
        provider:"whatsapp",accountId:row.accountId,
        source:"provider_api",sourceReference:"meta-wa-v4-asset-readback",
        verifiedAt:this.#now().toISOString()
      }
    });
    return {connectionId:active.connectionId,status:"connected",
      generation:active.generation};
  }
}
