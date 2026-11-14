import { randomUUID } from "node:crypto";
import { z } from "zod";
import { INSTAGRAM_REVIEW_SCOPES, type InstagramOAuthClientLike } from "./instagram-oauth.js";
import { ProviderNativeInstagramConsent } from "./workspace-provider-consent.js";
import { PostgresOAuthCredentialStore } from "./oauth-store.js";
import { PostgresWorkspaceConnectionRegistry, type WorkspacePrincipal } from "../persistence/workspace-connections.js";

/**
 * Native Instagram Login -> tenant-scoped, encrypted dormant grant.
 * No browser tokens, no legacy OAuth overwrite, no webhook subscribe, send,
 * global credential sharing, routing switch or historical account inference.
 */
export class WorkspaceInstagramConnectionCoordinator {
  constructor(private readonly deps:{
    consent:ProviderNativeInstagramConsent;
    registry:Pick<PostgresWorkspaceConnectionRegistry,"linkVerified"|"activateVerified"|"findForAdministrator">;
    oauth:Pick<PostgresOAuthCredentialStore,"putInTransaction"|"get">;
    client:Pick<InstagramOAuthClientLike,"resolveProfessionalAccountId">;
    appId:string;
    now?:()=>Date;
  }){}

  async begin(accessToken:string,workspaceId:string) {
    return this.deps.consent.begin(accessToken,workspaceId);
  }

  async complete(input:{
    accessToken:string;workspaceId:string;state:string;
    browserNonce:string;authorizationCode:string
  }):Promise<{connectionId:string;workspaceId:string;accountId:string;status:"verifying"}>{
    const grant=await this.deps.consent.complete(input);
    if(grant.intent.workspaceId!==input.workspaceId || grant.intent.provider!=="instagram")
      throw new Error("Workspace/provider grant binding mismatch");
    const connectionId=randomUUID();
    const connection=await this.deps.registry.linkVerified({
      connectionId,intentId:grant.intent.intentId,
      sessionId:grant.sessionId,workspaceId:grant.intent.workspaceId,
      actor:grant.intent.actor,providerApplicationKey:grant.intent.providerApplicationKey,
      credentialAccountId:connectionId,
      proof:{
        provider:"instagram",accountId:grant.accountId,
        source:"oauth_grant",sourceReference:grant.intent.providerApplicationKey,
        verifiedAt:new Date().toISOString()
      }
    },async tx=>{
      await this.deps.oauth.putInTransaction(tx,{
        provider:"workspace-instagram",accountId:connectionId,
        accessToken:grant.accessToken,
        scopes:grant.scopes,accessExpiresAt:grant.accessExpiresAt
      });
    });
    return {
      connectionId:connection.connectionId,workspaceId:connection.workspaceId,
      accountId:connection.accountId,status:"verifying"
    };
  }

  /** Requires independently revalidated live AAL2 caller/owner role before
   * reading a token. Fresh provider identity proof is mandatory at activation.
   * No action/worker is enabled: tenant cutover remains separate Priority 4.
   */
  async confirm(input:{
    workspaceId:string;connectionId:string;
    actor:WorkspacePrincipal
  }):Promise<{connectionId:string;status:"connected";generation:number}>{
    const p=z.object({
      workspaceId:z.string().uuid(),connectionId:z.string().uuid(),
      actor:z.object({
        issuer:z.string().min(1),subject:z.string().min(1)
      }).strict()
    }).strict().parse(input);
    const existing=await this.deps.registry.findForAdministrator(p);
    if(existing===undefined || existing.status!=="verifying" ||
      existing.provider!=="instagram")
      throw new Error("Connection activation not permitted");
    const credential=await this.deps.oauth.get("workspace-instagram",p.connectionId);
    const now=this.deps.now?.()??new Date();
    if(credential===undefined || credential.accessExpiresAt===undefined ||
      credential.accessExpiresAt.getTime()-now.getTime()<120000 ||
      !INSTAGRAM_REVIEW_SCOPES.every(scope=>credential.scopes.includes(scope)))
      throw new Error("Instagram credential expired or its original grant lacks rights");
    const providerAccountId=await this.deps.client.resolveProfessionalAccountId(credential.accessToken);
    if(providerAccountId!==existing.accountId)
      throw new Error("Fresh Instagram identity no longer matches tenant link");
    // The registry itself atomically re-verifies workspace role, status and
    // exact provider app/subject while updating generation and audit.
    const active=await this.deps.registry.activateVerified({
      workspaceId:p.workspaceId,connectionId:p.connectionId,actor:p.actor,
      providerApplicationKey:"instagram-login-"+z.string().regex(/^\d{5,30}$/u).parse(this.deps.appId),
      credentialAccountId:p.connectionId,
      proof:{
        provider:"instagram",accountId:existing.accountId,
        source:"provider_api",sourceReference:"instagram-provider-readback",
        verifiedAt:new Date().toISOString()
      }
    });
    return {connectionId:active.connectionId,status:"connected",generation:active.generation};
  }
}
