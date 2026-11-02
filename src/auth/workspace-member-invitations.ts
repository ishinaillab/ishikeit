import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { PostgresDatabase, SqlExecutor } from "../persistence/postgres.js";
import type { SupabaseAuthPrincipalVerifier } from "./supabase-workspace-principal.js";
import type { SupabaseAdminInviteClient } from "./supabase-admin-invite.js";

/**
 * Tenant-scoped member invitations. The verified actor MUST be the currently
 * active owner of the exact tenant. Never derive tenancy or role from email.
 * Existing confirmed accounts need a separate consent-bearing invitation
 * acceptance flow; they are not silently added to another workspace.
 */
const inviteSchema=z.object({
  workspaceId:z.string().uuid(),
  email:z.email().max(320).transform(s=>s.trim().toLowerCase()),
  role:z.enum(["admin","agent","viewer"])
}).strict();
type Input=z.input<typeof inviteSchema>;
type InviteState="invite_requested"|"invited"|"activated"|"cancelled";
interface InvitationRow extends pg.QueryResultRow{
  invitation_id:string;workspace_id:string;auth_issuer:string;
  invitee_email:string;requested_role:"admin"|"agent"|"viewer";
  inviter_subject:string;auth_user_id:string|null;state:InviteState;
}
interface BooleanRow extends pg.QueryResultRow{allowed:boolean}
interface CountRow extends pg.QueryResultRow{count:number}
export interface InviteSummary{invitationId:string;status:"invited"|"pending_review"}
export class PostgresWorkspaceInvitations {
  constructor(private readonly deps:{
    db:Pick<PostgresDatabase,"transaction"|"query">;
    principal:Pick<SupabaseAuthPrincipalVerifier,"verifyPrivilegedAccessToken">;
    provider:Pick<SupabaseAdminInviteClient,"inviteUserByEmail">;
    /** Application-owned throttling; separate from provider quotas/policies. */
    maxPerWorkspacePerDay?:number;
  }){}
  async #requireOwner(tx:SqlExecutor,workspaceId:string,issuer:string,subject:string):Promise<void>{
    const q=await tx.query<BooleanRow>(
      `SELECT EXISTS(
        SELECT 1 FROM public.ishikeit_workspace_memberships m
          JOIN public.ishikeit_workspaces w ON w.workspace_id=m.workspace_id
        WHERE w.workspace_id=$1 AND w.state='active'
          AND m.auth_issuer=$2 AND m.auth_subject=$3
          AND m.role='owner' AND m.state='active'
      ) AS allowed`,[workspaceId,issuer,subject]
    );
    if(q.rows[0]?.allowed!==true)throw new Error("Workspace owner authorization required");
  }
  async invite(access:string,input:Input):Promise<InviteSummary>{
    const x=inviteSchema.parse(input);
    const actor=await this.deps.principal.verifyPrivilegedAccessToken(access);
    const id=randomUUID();
    const max=z.number().int().min(1).max(100).parse(this.deps.maxPerWorkspacePerDay??10);
    await this.deps.db.transaction(async tx=>{
      // Serializes competing reservations in the same workspace, including
      // across processes, before checking the 24-hour application quota.
      await tx.query("SELECT workspace_id FROM public.ishikeit_workspaces WHERE workspace_id=$1 FOR UPDATE",[x.workspaceId]);
      await this.#requireOwner(tx,x.workspaceId,actor.principal.issuer,actor.principal.subject);
      const quota=await tx.query<CountRow>(
        `SELECT count(*)::int AS count FROM public.ishikeit_workspace_invitations
          WHERE workspace_id=$1 AND requested_at>now()-interval '1 day'`,
        [x.workspaceId]
      );
      if((quota.rows[0]?.count??max)>=max)throw new Error("Workspace invitation limit reached");
      const existing=await tx.query<BooleanRow>(
        `SELECT EXISTS(SELECT 1 FROM auth.users
           WHERE lower(email)=$1 AND deleted_at IS NULL)
         OR EXISTS(SELECT 1 FROM public.ishikeit_workspace_memberships m
           WHERE m.workspace_id=$2 AND m.auth_issuer=$3
             AND m.auth_subject IN (
               SELECT id::text FROM auth.users WHERE lower(email)=$1
             )) AS allowed`,
        [x.email,x.workspaceId,actor.principal.issuer]
      );
      if(existing.rows[0]?.allowed!==false)
        throw new Error("Existing Auth account requires separate consent flow");
      await tx.query(
        `INSERT INTO public.ishikeit_workspace_invitations
          (invitation_id,workspace_id,auth_issuer,invitee_email,requested_role,inviter_subject)
         VALUES($1,$2,$3,$4,$5,$6::uuid)`,
        [id,x.workspaceId,actor.principal.issuer,x.email,x.role,actor.principal.subject]
      );
    });
    // Never hold a DB lock while making a potentially ambiguous external call.
    // Never blindly retry this operation after a response/transport failure.
    try{
      const result=await this.deps.provider.inviteUserByEmail(x.email);
      if(result.email!==x.email)throw new Error("Invitation identity mismatch");
      const update=await this.deps.db.query(
        `UPDATE public.ishikeit_workspace_invitations
          SET state='invited',auth_user_id=$2::uuid,invited_at=now()
          WHERE invitation_id=$1 AND state='invite_requested'
          RETURNING invitation_id`,
        [id,result.userId]
      );
      if(update.rowCount!==1)throw new Error("Invitation state changed during delivery");
      return {invitationId:id,status:"invited"};
    }catch{
      // Pending row remains as a durable reconciliation fence, never a
      // reason to resend automatically. Requires operator review.
      return {invitationId:id,status:"pending_review"};
    }
  }

  /**
   * Non-network reconciliation only: new Auth users must ACCEPT the provider
   * invitation and become email-confirmed before membership is granted.
   * Actor ownership and workspace state are rechecked at grant time. Never
   * upgrades an existing membership's role, grants owner or super_admin,
   * or reads any provider customer messages.
   */
  async activateConfirmedBatch(limit=25):Promise<number>{
    const page=z.number().int().min(1).max(100).parse(limit);
    return this.deps.db.transaction(async tx=>{
      // Filter eligible rows BEFORE the page limit: large backlogs of
      // unconfirmed invitations must not starve later confirmed recipients.
      // Explicit OF i prevents row locks on provider Auth user records.
      const pending=await tx.query<InvitationRow>(
        `SELECT i.invitation_id,i.workspace_id,i.auth_issuer,i.invitee_email,
            i.requested_role,i.inviter_subject,i.auth_user_id,i.state
           FROM public.ishikeit_workspace_invitations i
           JOIN auth.users u ON u.id=i.auth_user_id
             AND lower(u.email)=i.invitee_email
             AND u.email_confirmed_at IS NOT NULL
             AND u.is_anonymous=false AND u.deleted_at IS NULL
             AND (u.banned_until IS NULL OR u.banned_until<=now())
           JOIN public.ishikeit_workspaces w
             ON w.workspace_id=i.workspace_id AND w.state='active'
           JOIN public.ishikeit_workspace_memberships owner
             ON owner.workspace_id=i.workspace_id
               AND owner.auth_issuer=i.auth_issuer
               AND owner.auth_subject=i.inviter_subject::text
               AND owner.role='owner' AND owner.state='active'
          WHERE i.state='invited' AND i.auth_user_id IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM public.ishikeit_workspace_memberships current
              WHERE current.workspace_id=i.workspace_id
                AND current.auth_issuer=i.auth_issuer
                AND current.auth_subject=u.id::text)
          ORDER BY i.invited_at ASC,i.invitation_id ASC
          LIMIT $1 FOR UPDATE OF i SKIP LOCKED`,[page]
      );
      let activated=0;
      for(const row of pending.rows){
        const eligible=await tx.query<BooleanRow>(
          `SELECT EXISTS(SELECT 1 FROM auth.users u
            JOIN public.ishikeit_workspace_memberships m
              ON m.workspace_id=$2 AND m.auth_issuer=$3
                AND m.auth_subject=$4 AND m.role='owner' AND m.state='active'
            JOIN public.ishikeit_workspaces w
              ON w.workspace_id=m.workspace_id AND w.state='active'
            WHERE u.id=$1::uuid AND lower(u.email)=$5
              AND u.email_confirmed_at IS NOT NULL
              AND u.is_anonymous=false AND u.deleted_at IS NULL
              AND (u.banned_until IS NULL OR u.banned_until<=now())
              AND NOT EXISTS(SELECT 1 FROM public.ishikeit_workspace_memberships current
                WHERE current.workspace_id=$2 AND current.auth_issuer=$3
                  AND current.auth_subject=u.id::text)
           ) AS allowed`,
          [row.auth_user_id,row.workspace_id,row.auth_issuer,row.inviter_subject,row.invitee_email]
        );
        if(eligible.rows[0]?.allowed!==true)continue;
        await tx.query(
          `INSERT INTO public.ishikeit_workspace_memberships
            (workspace_id,auth_issuer,auth_subject,role,state)
           VALUES($1,$2,$3,$4,'active')`,
          [row.workspace_id,row.auth_issuer,row.auth_user_id!,row.requested_role]
        );
        const update=await tx.query(
          `UPDATE public.ishikeit_workspace_invitations
           SET state='activated',activated_at=now()
           WHERE invitation_id=$1 AND state='invited'
           RETURNING invitation_id`,[row.invitation_id]
        );
        if(update.rowCount!==1)throw new Error("Invitation activation state changed");
        activated++;
      }
      return activated;
    });
  }
}
