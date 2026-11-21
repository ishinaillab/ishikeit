import {createHash} from "node:crypto";
import type pg from "pg";
import {z} from "zod";
import {actionEnvelopeSchema,messageSendBodySchema,type ActionEnvelope} from "../domain/actions.js";
import type {PostgresDatabase} from "./postgres.js";

/**
 * DORMANT native tenant provider-send admission.
 *
 * This is not a new worker or provider call. Existing customer messaging
 * continues through the legacy path; legacy outbox.claimNext explicitly
 * excludes tenant-stamped jobs. When tenant outbound processing is someday
 * activated, every worker must authenticate its provider source, fetch current
 * provider rights/consent, lease its own job and call this method before any
 * HTTP POST, in addition to its recipient-specific policy checks.
 *
 * It requires fresh server-owned provider account/recipient authorization,
 * then atomically rechecks the action, lease and ownership under database
 * row locks, and arms the job for uncertain-send reconciliation.
 *
 * After it returns, provider network I/O may race with a disconnect request.
 * The disconnect must count this row as uncertain and NEVER mark the account
 * fully disconnected until real provider outcome reconciliation completes.
 * No timestamp alone is a provider send receipt or permission to retry.
 */
const id=z.string().uuid();
const ref=z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const inputSchema=z.object({
  workspaceId:id,
  connectionId:id,
  connectionGeneration:z.number().int().safe().positive(),
  provider:ref,
  providerApplicationKey:ref,
  outboxId:id,
  leaseToken:id
}).strict();

interface CandidateRow extends pg.QueryResultRow {
  id:string;payload:unknown;partition_key:string;
  provider_account_id:string;provider_connection_id:string|null;
}
const channels:Readonly<Record<string,{actionProvider:string;channel:string}>>={
  instagram:{actionProvider:"meta",channel:"instagram"},
  messenger:{actionProvider:"meta",channel:"messenger"},
  whatsapp:{actionProvider:"meta",channel:"whatsapp"},
  tiktok:{actionProvider:"tiktok",channel:"tiktok"},
  telegram:{actionProvider:"telegram",channel:"bot"}
};
interface ArmedRow extends pg.QueryResultRow {
  id:string;tenant_send_started_at:Date;
}
export interface TenantSendAdmission {
  outboxId:string;
  connectionId:string;
  workspaceId:string;
  connectionGeneration:number;
  armedAt:string;
  authorizedAction:ActionEnvelope;
  authorizationDigest:string;
}


/** A fresh, server-owned per-account and recipient rights decision. Never
 * accept proofs from HTTP clients or from old/workspace-unbound app grants. */
const rightsIdentity=z.object({
  workspaceId:id,connectionId:id,connectionGeneration:z.number().int().safe().positive(),
  provider:ref,providerApplicationKey:ref,
  providerAccountId:z.string().min(1).max(256),
  providerConnectionId:z.string().min(1).max(256).nullable(),
  channel:ref,recipientId:z.string().min(1).max(2048),
  actionDigest:z.string().regex(/^[a-f0-9]{64}$/u)
}).strict();
export type NativeTenantSendAuthorizationRequest=z.infer<typeof rightsIdentity>;
const rightsProof=rightsIdentity.extend({
  allowed:z.literal(true),observedAt:z.iso.datetime({offset:true}),
  expiresAt:z.iso.datetime({offset:true})
}).strict();
export interface NativeTenantSendPolicy {
  authorize(request:Readonly<NativeTenantSendAuthorizationRequest>):
    Promise<z.infer<typeof rightsProof>>;
}
function validated(row:CandidateRow,p:z.infer<typeof inputSchema>){
  const result=actionEnvelopeSchema.safeParse(row.payload);
  const expected=channels[p.provider];
  if(!result.success||!expected)
    throw Error("Native tenant send payload provenance mismatch");
  const a=result.data,t=a.target;
  const keys=p.provider==="telegram"
    ?["accountId","businessConnectionId","channel","recipientId"]
    :["accountId","channel","recipientId"];
  if(a.provider!==expected.actionProvider||a.capability!=="messaging"||
     a.operation!=="message.send"||a.orderingKey!==row.partition_key||
     t["accountId"]!==row.provider_account_id||t["channel"]!==expected.channel||
     typeof t["recipientId"]!=="string"||t["recipientId"].length<1||
     t["recipientId"].length>2048||
     Object.keys(t).sort().join("|")!==keys.join("|")||
     !messageSendBodySchema.safeParse(a.body).success)
    throw Error("Native tenant send payload provenance mismatch");
  if(p.provider==="telegram"&&
     (typeof row.provider_connection_id!=="string"||
      row.provider_connection_id.length<5||
      t["businessConnectionId"]!==row.provider_connection_id))
    throw Error("Native Telegram business connection identity mismatch");
  const identity:NativeTenantSendAuthorizationRequest={
    workspaceId:p.workspaceId,connectionId:p.connectionId,
    connectionGeneration:p.connectionGeneration,provider:p.provider,
    providerApplicationKey:p.providerApplicationKey,
    providerAccountId:row.provider_account_id,
    providerConnectionId:row.provider_connection_id,
    channel:expected.channel,recipientId:t["recipientId"],
    actionDigest:createHash("sha256").update(JSON.stringify(a)).digest("hex")
  };
  return {action:a,identity};
}
function verifyProof(raw:unknown,identity:NativeTenantSendAuthorizationRequest):void{
  const p=rightsProof.parse(raw);
  for(const key of Object.keys(identity) as (keyof NativeTenantSendAuthorizationRequest)[])
    if(p[key]!==identity[key])throw Error("Native provider authorization identity mismatch");
  const now=Date.now(),observed=Date.parse(p.observedAt),expires=Date.parse(p.expiresAt);
  if(!Number.isFinite(observed)||!Number.isFinite(expires)||
     now-observed>15000||observed-now>2000||expires-now<1000||
     expires-observed>30000)
    throw Error("Native provider authorization is stale or not time bounded");
}
const SELECT_CANDIDATE=`SELECT o.id,o.payload,o.partition_key,c.provider_account_id,
         c.provider_connection_id FROM public.ishikeit_account_connections c
         JOIN public.ishikeit_workspaces w ON w.workspace_id=c.workspace_id
         JOIN public.outbox o ON o.connection_id=c.connection_id
           AND o.workspace_id=c.workspace_id
        WHERE c.workspace_id=$1 AND c.connection_id=$2
          AND c.generation=$3::bigint AND c.status='connected'
          AND c.provider=$4 AND c.provider_application_key=$5
          AND w.state='active' AND o.id=$6::uuid
          AND o.connection_generation=$3::bigint AND o.topic='action.dispatch'
          AND o.lease_token=$7::uuid AND o.lease_expires_at>clock_timestamp()
          AND o.published_at IS NULL AND o.dead_lettered_at IS NULL
          AND o.tenant_send_started_at IS NULL`;

export class PostgresTenantSendAdmission {
  constructor(private readonly db:Pick<PostgresDatabase,"transaction"|"query">,
    private readonly policy?:NativeTenantSendPolicy){}
  async armLeasedSend(input:z.infer<typeof inputSchema>):
    Promise<TenantSendAdmission>{
    const p=inputSchema.parse(input);
    if(!this.policy)throw Error("Native provider authorization verifier is not configured");
    const args=[p.workspaceId,p.connectionId,p.connectionGeneration,p.provider,
      p.providerApplicationKey,p.outboxId,p.leaseToken];
    const initial=await this.db.query<CandidateRow>(SELECT_CANDIDATE,args);
    if(initial.rowCount!==1||!initial.rows[0])
      throw Error("Native tenant send connection, generation or lease unavailable");
    const first=validated(initial.rows[0],p);
    // The network/readback step must NOT hold a database transaction open.
    const proof=await this.policy.authorize(Object.freeze({...first.identity}));
    verifyProof(proof,first.identity);
    return this.db.transaction(async tx=>{
      const eligible=await tx.query<CandidateRow>(
        SELECT_CANDIDATE+" FOR SHARE OF c,w FOR UPDATE OF o",args);
      if(eligible.rowCount!==1 || !eligible.rows[0])
        throw Error("Native tenant send connection, generation or lease unavailable");
      // The work claim cannot invent a provider/account/recipient just by
      // possessing a leased UUID. Parse the persisted canonical action under
      // the same connection/outbox row locks BEFORE permanently arming the
      // possibly non-idempotent provider request. No DB payload, no send.
      const locked=validated(eligible.rows[0],p);
      if(locked.identity.actionDigest!==first.identity.actionDigest)
        throw Error("Native tenant send action changed during provider authorization");
      verifyProof(proof,locked.identity);
      const armed=await tx.query<ArmedRow>(
        `UPDATE public.outbox
            SET tenant_send_started_at=clock_timestamp()
          WHERE id=$1::uuid AND workspace_id=$2 AND connection_id=$3
            AND connection_generation=$4::bigint AND lease_token=$5::uuid
            AND lease_expires_at>clock_timestamp()
            AND published_at IS NULL AND dead_lettered_at IS NULL
            AND tenant_send_started_at IS NULL
          RETURNING id,tenant_send_started_at`,
        [p.outboxId,p.workspaceId,p.connectionId,p.connectionGeneration,
          p.leaseToken]);
      const row=armed.rows[0];
      if(armed.rowCount!==1||!row||!(row.tenant_send_started_at instanceof Date))
        throw Error("Native tenant send admission raced and was denied");
      return {
        outboxId:row.id,workspaceId:p.workspaceId,connectionId:p.connectionId,
        connectionGeneration:p.connectionGeneration,
        armedAt:row.tenant_send_started_at.toISOString(),
        authorizedAction:locked.action,
        authorizationDigest:locked.identity.actionDigest
      };
    });
  }
}
