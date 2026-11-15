import {randomUUID} from "node:crypto";
import type pg from "pg";
import {z} from "zod";
import type {PostgresDatabase,SqlExecutor} from "./postgres.js";

/**
 * Internal, OFFLINE-REVIEW-ONLY completion gate for a previously frozen
 * native workspace connection. This module performs no provider network call
 * or provider-side removal. A trusted, account-specific provider verifier
 * MUST produce a fresh readback of a genuinely disconnected grant. Never
 * replace that verifier with a client-supplied flag, 401 inference, generic
 * token expiry, or a legacy app-wide authorization check.
 *
 * Currently recognized verified readbacks:
 *  - Telegram: exact Business connection is_enabled=false
 *  - TikTok for Business: exact user-owned app access grant revoked
 *  - Messenger: exact app is absent from this Page's subscribed_apps
 * Instagram and WhatsApp remain unfinalizable here until their separate
 * provider-specific readback and shared-business-asset safety is established.
 * Existing Ishi Nail Lab legacy messaging must not be unsubscribed to satisfy
 * a native tenant disconnect.
 */
const uid=z.string().uuid();
const action=z.object({
  workspaceId:uid,connectionId:uid,
  frozenGeneration:z.number().int().safe().min(2)
}).strict();
const verified=z.object({
  disconnected:z.literal(true),
  provider:z.string().min(1).max(128),
  providerAccountId:z.string().min(1).max(256),
  providerApplicationKey:z.string().min(1).max(128),
  providerConnectionId:z.string().min(1).max(256).nullable(),
  method:z.enum([
    "telegram_business_disabled",
    "tiktok_business_holder_revoked",
    "meta_page_app_unsubscribed"
  ]),
  observedAt:z.iso.datetime({offset:true})
}).strict();
export type ProviderDisconnectVerification=z.infer<typeof verified>;
const METHODS:Readonly<Record<string,string>>={
  telegram:"telegram_business_disabled",
  tiktok:"tiktok_business_holder_revoked",
  messenger:"meta_page_app_unsubscribed"
};
const NAMESPACES:Readonly<Record<string,string>>={
  instagram:"workspace-instagram",
  messenger:"workspace-messenger",
  whatsapp:"workspace-whatsapp",
  tiktok:"workspace-tiktok"
};
export interface ProviderDisconnectBinding {
  readonly workspaceId:string;
  readonly connectionId:string;
  readonly frozenGeneration:number;
  readonly provider:string;
  readonly providerAccountId:string;
  readonly providerApplicationKey:string;
  readonly providerConnectionId:string|null;
}
/** Implementations MUST use current, authoritative, provider-owner-scoped API
 * readback for precisely this account and app. No inferred grants, no app-
 * wide subscription mutation, no access to any other workspace's token.
 */
export interface ProviderDisconnectVerifier {
  verifyDisconnected(binding:ProviderDisconnectBinding):Promise<ProviderDisconnectVerification>;
}
interface Row extends pg.QueryResultRow {
  connection_id:string;workspace_id:string;
  generation:string|number;status:string;
  provider:string;provider_account_id:string;
  provider_application_key:string;
  provider_connection_id:string|null;
  credential_account_id:string|null;
  frozen_generation:string|number;
  cleanup_state:string;
  provider_cleanup_method:string|null;
  uncertain_inflight_jobs:string|number;
  completed_at:Date|null;
}
interface CountRow extends pg.QueryResultRow { n:string }
export interface CompletedDisconnect {
  workspaceId:string;connectionId:string;
  frozenGeneration:number;disconnectedGeneration:number;
  method:string;
}
function completed(row:Row):CompletedDisconnect {
  const frozen=Number(row.frozen_generation),generation=Number(row.generation);
  if(row.status!=="disconnected"||row.cleanup_state!=="complete"||
     generation!==frozen+1||!row.provider_cleanup_method||!row.completed_at)
    throw Error("Disconnect completion record inconsistent");
  return {
    workspaceId:row.workspace_id,connectionId:row.connection_id,
    frozenGeneration:frozen,disconnectedGeneration:generation,
    method:row.provider_cleanup_method
  };
}
function binding(row:Row):ProviderDisconnectBinding {
  const gen=Number(row.frozen_generation);
  if(!Number.isSafeInteger(gen)||gen<2||gen!==Number(row.generation)||
     row.status!=="disconnecting"||
     !["pending","retry_required"].includes(row.cleanup_state))
    throw Error("Disconnect claim is stale or not pending verified cleanup");
  if(Number(row.uncertain_inflight_jobs)!==0)
    throw Error("Unreconciled in-flight provider work blocks disconnect completion");
  if(METHODS[row.provider]===undefined)
    throw Error("No verified safe provider-specific disconnect readback available");
  if(row.provider==="telegram" && !row.provider_connection_id)
    throw Error("Telegram Business disconnect needs the exact provider connection ID");
  return {
    workspaceId:row.workspace_id,connectionId:row.connection_id,
    frozenGeneration:gen,provider:row.provider,
    providerAccountId:row.provider_account_id,
    providerApplicationKey:row.provider_application_key,
    providerConnectionId:row.provider_connection_id
  };
}
function checkProof(proof:ProviderDisconnectVerification,p:ProviderDisconnectBinding):void{
  if(proof.provider!==p.provider||
     proof.providerAccountId!==p.providerAccountId||
     proof.providerApplicationKey!==p.providerApplicationKey||
     proof.providerConnectionId!==p.providerConnectionId||
     proof.method!==METHODS[p.provider])
    throw Error("Provider cleanup readback identity or method mismatch");
  const observed=Date.parse(proof.observedAt),age=Date.now()-observed;
  if(!Number.isFinite(observed)||age>60000||age< -120000)
    throw Error("Provider cleanup readback is not sufficiently fresh");
}
async function readRow(tx:SqlExecutor,input:z.infer<typeof action>,lock:"SHARE"|"UPDATE"):
  Promise<Row>{
  const r=await tx.query<Row>(
    `SELECT c.connection_id,c.workspace_id,c.generation,c.status,
            c.provider,c.provider_account_id,c.provider_application_key,
            c.provider_connection_id,c.credential_account_id,
            d.frozen_generation,d.cleanup_state,d.provider_cleanup_method,
            d.uncertain_inflight_jobs,d.completed_at
       FROM public.ishikeit_active_disconnect_cleanup d
       JOIN public.ishikeit_account_connections c
         ON c.connection_id=d.connection_id AND c.workspace_id=d.workspace_id
      WHERE d.workspace_id=$1 AND d.connection_id=$2
        AND d.frozen_generation=$3::bigint
      FOR ${lock} OF c,d`,
    [input.workspaceId,input.connectionId,input.frozenGeneration]);
  if(!r.rows[0])throw Error("Disconnect cleanup claim not found");
  return r.rows[0];
}

export class PostgresActiveDisconnectFinalizer {
  constructor(
    private readonly db:Pick<PostgresDatabase,"transaction">,
    private readonly provider:ProviderDisconnectVerifier
  ){}

  /** Two-phase readback/commit. No database transaction spans provider HTTP.
   * On any failed check, retain all credentials, provider ownership and retry
   * state unchanged. Only a fresh, exact provider readback permits the
   * transaction to delete the native per-connection encrypted credential and
   * mark this account disconnected. Never touch shared legacy credentials.
   */
  async finalize(input:z.infer<typeof action>):Promise<CompletedDisconnect>{
    const p=action.parse(input);
    const preliminary=await this.db.transaction(tx=>readRow(tx,p,"SHARE"));
    if(preliminary.cleanup_state==="complete")return completed(preliminary);
    const expected=binding(preliminary);
    const proof=verified.parse(await this.provider.verifyDisconnected(expected));
    checkProof(proof,expected);
    return this.db.transaction(async tx=>{
      // Prevent concurrent cleanup or ownership-generation switch during the
      // final credential deletion, status update and ledger completion.
      const current=await readRow(tx,p,"UPDATE");
      if(current.cleanup_state==="complete")return completed(current);
      const still=binding(current);
      checkProof(proof,still);
      const outstanding=await tx.query<CountRow>(
        `SELECT count(*)::text AS n FROM public.outbox
          WHERE workspace_id=$1 AND connection_id=$2
            AND published_at IS NULL AND dead_lettered_at IS NULL`,
        [p.workspaceId,p.connectionId]);
      if(Number(outstanding.rows[0]?.n)!==0)
        throw Error("Unquarantined tenant work blocks disconnect completion");
      const credentialNamespace=NAMESPACES[still.provider];
      if(still.provider==="telegram"){
        if(current.credential_account_id!==null)
          throw Error("Telegram connection unexpectedly references private OAuth credential");
      }else{
        if(!credentialNamespace||current.credential_account_id!==p.connectionId)
          throw Error("Refusing shared or foreign provider credential cleanup");
        await tx.query(
          `DELETE FROM public.oauth_credentials
            WHERE provider=$1 AND account_id=$2`,
          [credentialNamespace,p.connectionId]);
        await tx.query(
          `INSERT INTO public.oauth_revocations(provider,account_id,reason)
           VALUES($1,$2,'workspace_verified_disconnect')
           ON CONFLICT(provider,account_id) DO UPDATE
             SET reason=EXCLUDED.reason,revoked_at=now()`,
          [credentialNamespace,p.connectionId]);
      }
      const changed=await tx.query(
        `UPDATE public.ishikeit_account_connections
            SET status='disconnected',disconnected_at=now(),
                generation=generation+1,updated_at=now()
          WHERE connection_id=$1 AND workspace_id=$2
            AND generation=$3::bigint AND status='disconnecting'
          RETURNING generation`,
        [p.connectionId,p.workspaceId,p.frozenGeneration]);
      if(changed.rowCount!==1)
        throw Error("Active connection changed during provider cleanup");
      const finished=await tx.query(
        `UPDATE public.ishikeit_active_disconnect_cleanup
            SET cleanup_state='complete',provider_cleanup_method=$4,
                provider_verified_at=$5::timestamptz,
                completed_at=now(),updated_at=now()
          WHERE connection_id=$1 AND workspace_id=$2
            AND frozen_generation=$3::bigint
            AND cleanup_state IN ('pending','retry_required')
          RETURNING completed_at`,
        [p.connectionId,p.workspaceId,p.frozenGeneration,proof.method,
          new Date(proof.observedAt)]);
      if(finished.rowCount!==1)
        throw Error("Active cleanup ledger changed during completion");
      await tx.query(
        `INSERT INTO public.ishikeit_connection_audit
          (event_id,workspace_id,connection_id,event_type)
         VALUES($1,$2,$3,'disconnected')`,
        [randomUUID(),p.workspaceId,p.connectionId]);
      return {
        workspaceId:p.workspaceId,connectionId:p.connectionId,
        frozenGeneration:p.frozenGeneration,
        disconnectedGeneration:p.frozenGeneration+1,method:proof.method
      };
    });
  }
}
