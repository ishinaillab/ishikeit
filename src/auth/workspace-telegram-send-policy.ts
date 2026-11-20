import type pg from "pg";
import {customerReplyWindowEligibility} from "../policy/provider-contract.js";
import type {PostgresDatabase} from "../persistence/postgres.js";
import type {
  NativeTenantSendAuthorizationRequest,NativeTenantSendPolicy
} from "../persistence/tenant-send-admission.js";
import type {TelegramNativeBusinessLike} from "./workspace-telegram-oidc.js";

/**
 * DORMANT, SERVER-ONLY Telegram Business send policy.
 * A native sender must use the same bot token/client ID as the verified link.
 * Requires exact current getBusinessConnection rights and an authenticated
 * inbound customer message for the same workspace, connection UUID, generation,
 * owner, business ID, bot ID and chat under Telegram's 24-hour reply window.
 * Neither owner-entered timestamps nor other tenants' events grant sends.
 * This module does not POST messages or activate native tenant workers.
 * See https://core.telegram.org/bots/api#businessbotrights.
 */
const telegramId=/^[1-9][0-9]{4,15}$/u;
const chatId=/^[1-9][0-9]{0,15}$/u;
interface CustomerRow extends pg.QueryResultRow { occurred_at:Date|null }
export class TelegramNativeTenantSendPolicy implements NativeTenantSendPolicy {
  readonly #applicationKey:string;
  readonly #botId:string;
  readonly #now:()=>Date;
  constructor(private readonly deps:{
    trustedBotClientId:string;
    reader:TelegramNativeBusinessLike;
    db:Pick<PostgresDatabase,"query">;
    now?:()=>Date;
  }){
    if(!telegramId.test(deps.trustedBotClientId))
      throw Error("Telegram native send policy needs a trusted numeric bot ID");
    this.#botId=deps.trustedBotClientId;
    this.#applicationKey="telegram-oidc-"+this.#botId;
    this.#now=deps.now??(()=>new Date());
  }
  async authorize(request:Readonly<NativeTenantSendAuthorizationRequest>){
    const r=request;
    if(r.provider!=="telegram" || r.channel!=="bot" ||
       r.providerApplicationKey!==this.#applicationKey ||
       typeof r.providerConnectionId!=="string" ||
       r.providerConnectionId.length<5 || r.providerConnectionId.length>256 ||
       !chatId.test(r.providerAccountId) ||
       !chatId.test(r.recipientId) || r.recipientId===r.providerAccountId)
      throw Error("Telegram native send identity or recipient ineligible");
    const source="urn:ishikeit:source:telegram:bot:"+this.#botId;
    const latest=await this.deps.db.query<CustomerRow>(
      `SELECT occurred_at FROM public.inbound_events
        WHERE workspace_id=$1::uuid AND connection_id=$2::uuid
          AND connection_generation=$3::bigint
          AND provider='telegram' AND channel='bot'
          AND capability='messaging' AND event_type='message.received'
          AND account_id=$4
          AND normalized_payload->>'source'=$5
          AND normalized_payload->>'accountId'=$4
          AND normalized_payload->>'identityId'=$6
          AND normalized_payload->>'eventType'='message.received'
          AND normalized_payload->'data'->>'businessConnectionId'=$7
          AND occurred_at IS NOT NULL
        ORDER BY occurred_at DESC LIMIT 1`,
      [r.workspaceId,r.connectionId,r.connectionGeneration,r.providerAccountId,
        source,r.recipientId,r.providerConnectionId]);
    const occurred=latest.rows[0]?.occurred_at;
    if(!(occurred instanceof Date) ||
       customerReplyWindowEligibility(
         "telegram","business","message.send",occurred.toISOString(),this.#now()
       )!=="eligible")
      throw Error("Telegram native send has no verified recent customer-initiated reply window");
    const provider=await this.deps.reader.inspect(r.providerConnectionId);
    if(provider.connectionId!==r.providerConnectionId ||
       provider.ownerId!==r.providerAccountId ||
       provider.enabled!==true || provider.canReply!==true)
      throw Error("Telegram Business account or can_reply permission not current");
    const now=this.#now();
    if(customerReplyWindowEligibility(
      "telegram","business","message.send",occurred.toISOString(),now
    )!=="eligible")
      throw Error("Telegram native customer reply window expired during readback");
    return {...r,allowed:true as const,
      observedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+15000).toISOString()};
  }
}
