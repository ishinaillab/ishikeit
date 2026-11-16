import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { PostgresDatabase, SqlExecutor } from "./postgres.js";
import type { WorkspacePrincipal } from "./workspace-connections.js";

/**
 * Internal-only first stage of ACTIVE connection disconnect. Not a browser
 * route, not an OAuth revoke, and not a permit to activate tenant sending.
 * The entrypoint must independently prove the caller's current AAL2 session,
 * CSRF/origin and workspace owner/admin role before invoking this class.
 * This class independently rechecks the live role under PostgreSQL locks.
 *
 * Freezing and quarantining share a transaction. A future tenant sender MUST
 * lock/recheck the same connection row and generation immediately before each
 * provider POST; without that externally enforced path no send-safety or
 * completed-disconnect assertion may be made.
 */
const uuid = z.string().uuid();
const principal = z.object({
  issuer:z.string().min(1).max(200),
  subject:z.string().min(1).max(256)
}).strict();
const action = z.object({
  workspaceId:uuid,connectionId:uuid,actor:principal
}).strict();
const failure = z.object({
  connectionId:uuid,workspaceId:uuid,frozenGeneration:z.number().int().safe().positive(),
  errorCode:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  retryAfterSeconds:z.number().int().min(60).max(86400)
}).strict();
type CleanupState = "pending"|"retry_required"|"provider_verified"|"complete";
interface ActiveRow extends pg.QueryResultRow {
  connection_id:string;
  workspace_id:string;
  provider:string;
  provider_account_id:string;
  provider_application_key:string;
  provider_connection_id:string|null;
  credential_account_id:string|null;
  generation:string|number;
  status:string;
  activated_at:Date|null;
}
interface CleanupRow extends pg.QueryResultRow {
  frozen_generation:number|string;
  cleanup_state:CleanupState;
  quarantined_jobs:string|number;
  uncertain_inflight_jobs:string|number;
  cleanup_attempts:number;
}
interface CountRow extends pg.QueryResultRow { count:string }
export interface ActiveDisconnectHold {
  connectionId:string;
  workspaceId:string;
  frozenGeneration:number;
  state:CleanupState;
  quarantinedJobs:number;
  uncertainInflightJobs:number;
  cleanupAttempts:number;
}
function display(input:{connectionId:string;workspaceId:string},row:CleanupRow):ActiveDisconnectHold{
  const frozenGeneration=Number(row.frozen_generation);
  const quarantinedJobs=Number(row.quarantined_jobs);
  const uncertainInflightJobs=Number(row.uncertain_inflight_jobs);
  if(!Number.isSafeInteger(frozenGeneration)||frozenGeneration<2||
     !Number.isSafeInteger(quarantinedJobs)||quarantinedJobs<0||
     !Number.isSafeInteger(uncertainInflightJobs)||uncertainInflightJobs<0)
    throw Error("Invalid durable active disconnect record");
  return {
    connectionId:input.connectionId,workspaceId:input.workspaceId,
    frozenGeneration,state:row.cleanup_state,
    quarantinedJobs,uncertainInflightJobs,
    cleanupAttempts:row.cleanup_attempts
  };
}
async function authorize(tx:SqlExecutor,actor:WorkspacePrincipal,workspaceId:string):Promise<void>{
  const authorized=await tx.query(
    `SELECT 1
       FROM public.ishikeit_workspace_memberships m
       JOIN public.ishikeit_workspaces w ON w.workspace_id=m.workspace_id
      WHERE m.workspace_id=$1 AND m.auth_issuer=$2 AND m.auth_subject=$3
        AND m.role IN ('owner','admin') AND m.state='active' AND w.state='active'
      FOR SHARE OF m,w`,
    [workspaceId,actor.issuer,actor.subject]
  );
  if(authorized.rowCount!==1)throw Error("Workspace authorization denied");
}
export class PostgresActiveDisconnectHold {
  constructor(private readonly db:Pick<PostgresDatabase,"transaction">){}

  /** Idempotent owner/admin request: freeze verified ACTIVE claim first,
   * quarantine ALL unpublished tenant outbox jobs (including leased jobs),
   * and reserve the global provider account for genuine provider cleanup.
   * This does not delete shared app credentials or claim provider revocation.
   */
  async request(input:z.infer<typeof action>):Promise<ActiveDisconnectHold>{
    const p=action.parse(input);
    return this.db.transaction(async tx=>{
      await authorize(tx,p.actor,p.workspaceId);
      const current=await tx.query<ActiveRow>(
        `SELECT connection_id,workspace_id,provider,provider_account_id,
                provider_application_key,provider_connection_id,credential_account_id,
                generation,status,activated_at
           FROM public.ishikeit_account_connections
          WHERE workspace_id=$1 AND connection_id=$2 FOR UPDATE`,
        [p.workspaceId,p.connectionId]
      );
      const connection=current.rows[0];
      if(!connection)throw Error("Active connection not found in this workspace");
      if(connection.status==="disconnecting"){
        const existing=await tx.query<CleanupRow>(
          `SELECT frozen_generation,cleanup_state,quarantined_jobs,
                  uncertain_inflight_jobs,cleanup_attempts
             FROM public.ishikeit_active_disconnect_cleanup
            WHERE workspace_id=$1 AND connection_id=$2 FOR SHARE`,
          [p.workspaceId,p.connectionId]);
        if(!existing.rows[0] ||
           Number(existing.rows[0].frozen_generation)!==Number(connection.generation))
          throw Error("Existing disconnect requires protected reconciliation");
        return display(p,existing.rows[0]);
      }
      if(connection.status==="disconnected")
        throw Error("Connection already disconnected");
      if(connection.activated_at===null || connection.status==="verifying")
        throw Error("Only an activated connection may use active disconnect");
      if(!["connected","paused","attention_required","revoked"].includes(connection.status))
        throw Error("Connection is not eligible for active disconnect");

      // Capture uncertainty BEFORE invalidating any worker lease. The result
      // is a conservative upper bound, never proof that a send did not occur.
      const inflight=await tx.query<CountRow>(
        `SELECT count(*)::text AS count FROM public.outbox
          WHERE workspace_id=$1 AND connection_id=$2
            AND published_at IS NULL AND dead_lettered_at IS NULL
            AND (lease_token IS NOT NULL OR meta_send_started_at IS NOT NULL
                 OR tenant_send_started_at IS NOT NULL)`,
        [p.workspaceId,p.connectionId]);
      const inflightCount=Number(inflight.rows[0]?.count);
      if(!Number.isSafeInteger(inflightCount)||inflightCount<0)
        throw Error("Cannot determine unfinished tenant sends");

      const frozen=await tx.query<ActiveRow>(
        `UPDATE public.ishikeit_account_connections
            SET status='disconnecting',generation=generation+1,updated_at=now()
          WHERE workspace_id=$1 AND connection_id=$2
            AND generation=$3::bigint AND status=$4
          RETURNING connection_id,workspace_id,provider,provider_account_id,
                    provider_application_key,provider_connection_id,
                    credential_account_id,generation,status,activated_at`,
        [p.workspaceId,p.connectionId,Number(connection.generation),connection.status]);
      const updated=frozen.rows[0];
      if(!updated)throw Error("Active connection state changed during disconnect");
      const quarantined=await tx.query(
        `UPDATE public.outbox
            SET dead_lettered_at=now(),dead_letter_reason='tenant_disconnect_quarantine',
                lease_token=NULL,lease_expires_at=NULL
          WHERE workspace_id=$1 AND connection_id=$2
            AND published_at IS NULL AND dead_lettered_at IS NULL`,
        [p.workspaceId,p.connectionId]
      );
      const quarantinedJobs=quarantined.rowCount??0;
      const ledger=await tx.query<CleanupRow>(
        `INSERT INTO public.ishikeit_active_disconnect_cleanup
          (connection_id,workspace_id,frozen_generation,provider,
           provider_account_id,provider_application_key,
           provider_connection_id,credential_account_id,
           quarantined_jobs,uncertain_inflight_jobs)
         VALUES($1,$2,$3::bigint,$4,$5,$6,$7,$8,$9,$10)
         RETURNING frozen_generation,cleanup_state,quarantined_jobs,
                   uncertain_inflight_jobs,cleanup_attempts`,
        [p.connectionId,p.workspaceId,Number(updated.generation),
          updated.provider,updated.provider_account_id,
          updated.provider_application_key,updated.provider_connection_id,
          updated.credential_account_id,quarantinedJobs,inflightCount]);
      await tx.query(
        `INSERT INTO public.ishikeit_connection_audit
           (event_id,workspace_id,connection_id,event_type,actor_issuer,actor_subject)
         VALUES ($1,$2,$3,'disconnect_requested',$4,$5)`,
        [randomUUID(),p.workspaceId,p.connectionId,p.actor.issuer,p.actor.subject]);
      if(!ledger.rows[0])throw Error("Active disconnect ledger unavailable");
      return display(p,ledger.rows[0]);
    });
  }

  /** Private reconciliation record. A sanitized, bounded failure code is
   * safe to persist. Failed provider cleanup never frees the account claim.
   * No arbitrary caller, owner screen or worker can declare completion here.
   */
  async recordCleanupFailure(input:z.infer<typeof failure>):
    Promise<ActiveDisconnectHold>{
    const p=failure.parse(input);
    return this.db.transaction(async tx=>{
      const current=await tx.query(
        `SELECT 1 FROM public.ishikeit_account_connections
          WHERE connection_id=$1 AND workspace_id=$2
            AND generation=$3::bigint AND status='disconnecting'
          FOR SHARE`,[p.connectionId,p.workspaceId,p.frozenGeneration]);
      if(current.rowCount!==1)throw Error("Disconnect generation stale or unavailable");
      const result=await tx.query<CleanupRow>(
        `UPDATE public.ishikeit_active_disconnect_cleanup
            SET cleanup_state='retry_required',
                cleanup_attempts=cleanup_attempts+1,
                last_error_code=$4,
                next_retry_at=now()+($5::int*interval '1 second'),
                updated_at=now()
          WHERE connection_id=$1 AND workspace_id=$2
            AND frozen_generation=$3::bigint
            AND cleanup_state IN ('pending','retry_required')
          RETURNING frozen_generation,cleanup_state,quarantined_jobs,
                    uncertain_inflight_jobs,cleanup_attempts`,
        [p.connectionId,p.workspaceId,p.frozenGeneration,
          p.errorCode,p.retryAfterSeconds]);
      if(!result.rows[0])throw Error("Cleanup is no longer awaiting provider confirmation");
      return display(p,result.rows[0]);
    });
  }

  /** Read-only owner/admin inspection; never returns credential identifiers,
   * provider tokens, raw errors or other workspace's information. */
  async inspect(input:z.infer<typeof action>):Promise<ActiveDisconnectHold|undefined>{
    const p=action.parse(input);
    return this.db.transaction(async tx=>{
      await authorize(tx,p.actor,p.workspaceId);
      const row=await tx.query<CleanupRow>(
        `SELECT d.frozen_generation,d.cleanup_state,d.quarantined_jobs,
                d.uncertain_inflight_jobs,d.cleanup_attempts
           FROM public.ishikeit_active_disconnect_cleanup d
           JOIN public.ishikeit_account_connections c
             ON c.connection_id=d.connection_id AND c.workspace_id=d.workspace_id
          WHERE d.workspace_id=$1 AND d.connection_id=$2
            AND c.status='disconnecting' AND c.generation=d.frozen_generation
          FOR SHARE OF c,d`,
        [p.workspaceId,p.connectionId]);
      return row.rows[0]===undefined?undefined:display(p,row.rows[0]);
    });
  }
}
