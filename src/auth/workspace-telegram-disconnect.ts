import {z} from "zod";
import type {TelegramNativeBusinessLike} from "./workspace-telegram-oidc.js";
import type {
  ProviderDisconnectBinding,ProviderDisconnectVerification,ProviderDisconnectVerifier
} from "../persistence/active-disconnect-finalizer.js";

/**
 * Read-only authoritative Telegram Business disconnect proof.
 *
 * Construct only with a trusted bot-token-bound TelegramNativeBusinessReader
 * and the exact server-configured Telegram OIDC client ID used for connection
 * activation. This module cannot remove or change the actual Business bot
 * connection: the account owner must disconnect it through Telegram.
 *
 * Real Bot API getBusinessConnection returns the exact owner, connection ID
 * and is_enabled flag. An unavailable/deleted/forbidden response is NOT proof
 * that the bot has safely disconnected; fail closed and retain account claim.
 * This verifier does not grant live tenant sending or bypass caller AAL2.
 */
const botId=z.string().regex(/^[1-9][0-9]{4,15}$/u);
export class TelegramBusinessDisconnectVerifier implements ProviderDisconnectVerifier{
  readonly #applicationKey:string;
  constructor(
    private readonly reader:TelegramNativeBusinessLike,
    trustedBotClientId:string
  ){
    this.#applicationKey="telegram-oidc-"+botId.parse(trustedBotClientId);
  }
  async verifyDisconnected(binding:ProviderDisconnectBinding):
    Promise<ProviderDisconnectVerification>{
    if(binding.provider!=="telegram" ||
       binding.providerApplicationKey!==this.#applicationKey ||
       typeof binding.providerConnectionId!=="string" ||
       binding.providerConnectionId.length<5 ||
       binding.providerConnectionId.length>256)
      throw Error("Telegram disconnect is not bound to this verified bot");
    // The provider operation is GET/readback only, scoped to the exact
    // configured bot token; it cannot revoke, unsubscribe or send anything.
    const state=await this.reader.inspect(binding.providerConnectionId);
    if(state.connectionId!==binding.providerConnectionId ||
       state.ownerId!==binding.providerAccountId ||
       state.enabled!==false)
      throw Error("Telegram Business account still enabled or identity mismatch");
    return {
      disconnected:true,provider:binding.provider,
      providerAccountId:binding.providerAccountId,
      providerApplicationKey:binding.providerApplicationKey,
      providerConnectionId:binding.providerConnectionId,
      method:"telegram_business_disabled",
      observedAt:new Date().toISOString()
    };
  }
}
