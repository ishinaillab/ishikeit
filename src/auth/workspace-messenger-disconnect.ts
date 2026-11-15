import {z} from "zod";
import type {OAuthCredentialStore} from "./oauth-store.js";
import type {MetaMessengerPageClient} from "./workspace-messenger-connect.js";
import type {
  ProviderDisconnectBinding,ProviderDisconnectVerification,ProviderDisconnectVerifier
} from "../persistence/active-disconnect-finalizer.js";

/**
 * READ-ONLY, dormant Messenger Page unsubscription readback. Do not wire it
 * to a live cleanup worker without an owner-authorized, provider-specific
 * revocation flow. Meta's Page subscription is APP-WIDE for this Page and
 * may be shared by legacy Ishi Nail Lab: never remove it on behalf of a
 * single workspace without proving legacy and other-tenant isolation first.
 *
 * All access tokens are loaded through the exact private connection UUID,
 * never supplied by a browser or a user-supplied account mapping. The
 * underlying MetaMessengerPageClient independently proves the issuing app
 * and Page identity before reading /{page_id}/subscribed_apps via GET.
 */
const pageId=z.string().regex(/^[1-9][0-9]{4,31}$/u);
const appId=z.string().regex(/^[1-9][0-9]{4,31}$/u);
const uid=z.string().uuid();

export interface MessengerPageSharingGuard {
  /** Server-owned check; MUST fail if Page app use is shared/unknown. */
  assertNotSharedWithLegacyOrOtherTenants(binding:ProviderDisconnectBinding):
    Promise<void>;
}
export class MessengerPageDisconnectVerifier implements ProviderDisconnectVerifier {
  readonly #applicationKey:string;
  readonly #now:()=>Date;
  constructor(private readonly deps:{
    appId:string;
    client:Pick<MetaMessengerPageClient,"isAppUnsubscribed">;
    vault:Pick<OAuthCredentialStore,"get">;
    sharingGuard:MessengerPageSharingGuard;
    now?:()=>Date;
  }){
    this.#applicationKey="meta-messenger-"+appId.parse(deps.appId);
    this.#now=deps.now??(()=>new Date());
  }
  async verifyDisconnected(binding:ProviderDisconnectBinding):
    Promise<ProviderDisconnectVerification>{
    const p=binding;
    if(p.provider!=="messenger" ||
       p.providerApplicationKey!==this.#applicationKey ||
       p.providerConnectionId!==null ||
       !uid.safeParse(p.workspaceId).success ||
       !uid.safeParse(p.connectionId).success ||
       !pageId.safeParse(p.providerAccountId).success ||
       !Number.isSafeInteger(p.frozenGeneration)||p.frozenGeneration<2)
      throw Error("Messenger disconnect is not bound to this exact Page and app");
    await this.deps.sharingGuard.assertNotSharedWithLegacyOrOtherTenants(p);
    const stored=await this.deps.vault.get("workspace-messenger",p.connectionId);
    const now=this.#now();
    if(stored?.provider!=="workspace-messenger" ||
       stored.accountId!==p.connectionId ||
       stored.accessExpiresAt===undefined ||
       stored.accessExpiresAt.getTime()<=now.getTime()+120000 ||
       !["pages_manage_metadata","pages_show_list","pages_messaging"].every(
         permission=>stored.scopes.includes(permission)))
      throw Error("Messenger Page credential scope or expiry unavailable");
    if(await this.deps.client.isAppUnsubscribed(
      stored.accessToken,p.providerAccountId)!==true)
      throw Error("Messenger Page app is still subscribed");
    return {
      disconnected:true,provider:p.provider,
      providerAccountId:p.providerAccountId,
      providerApplicationKey:p.providerApplicationKey,
      providerConnectionId:p.providerConnectionId,
      method:"meta_page_app_unsubscribed",
      observedAt:this.#now().toISOString()
    };
  }
}
