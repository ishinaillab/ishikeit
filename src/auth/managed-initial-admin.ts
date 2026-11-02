import { z } from "zod";
import type pg from "pg";
import type { PostgresDatabase } from "../persistence/postgres.js";
import type { SupabaseAdminInviteClient } from "./supabase-admin-invite.js";
import { PostgresFirstOwnerBootstrap } from "./postgres-first-owner-bootstrap.js";

/**
 * Private, deployment-authorized initial admin state machine.
 * No routes, signed user inputs or platform roles are accepted from clients.
 * Once an external invite is attempted, it is NEVER blindly retried:
 * ambiguous provider outcomes require readback/reconciliation.
 */
const inputSchema=z.object({
  projectUrl:z.url(),email:z.email().max(320).transform(s=>s.trim().toLowerCase()),
  workspaceName:z.string().trim().min(1).max(160),
  approvedBy:z.string().trim().min(3).max(120),
  approvalReference:z.string().trim().min(8).max(160)
}).strict();
export type InitialAdminApproval=z.infer<typeof inputSchema>;
type State="reserved"|"invite_requested"|"invited"|"activated";
interface ProvisioningRow extends pg.QueryResultRow {
  email_address:string;state:State;auth_user_id:string|null;
  approved_by:string;approval_reference:string;
}
interface AuthUserRow extends pg.QueryResultRow {
  id:string;email_confirmed_at:Date|null;
}
interface CheckRow extends pg.QueryResultRow { established:boolean }
export type InitialAdminProgress =
  |{status:"invitation_requested"|"pending_email_confirmation"|"ambiguous_invitation"}
  |{status:"activated";workspaceId?:string}
  |{status:"already_activated"};

export class PostgresInitialAdminProvisioning {
  readonly #approval:InitialAdminApproval;
  constructor(private readonly deps:{
    db:Pick<PostgresDatabase,"query"|"transaction">;
    invitation:Pick<SupabaseAdminInviteClient,"inviteUserByEmail">;
    approval:InitialAdminApproval;
  }){
    this.#approval=inputSchema.parse(deps.approval);
  }
  async #record():Promise<ProvisioningRow|undefined>{
    const r=await this.deps.db.query<ProvisioningRow>(
      `SELECT email_address,state,auth_user_id,approved_by,approval_reference
       FROM public.ishikeit_initial_admin_provisioning WHERE singleton=true`
    );
    return r.rows[0];
  }
  #assertApproval(row:ProvisioningRow):void{
    if(row.email_address!==this.#approval.email
      || row.approved_by!==this.#approval.approvedBy
      || row.approval_reference!==this.#approval.approvalReference)
      throw new Error("Initial administrator approval does not match deployment authorization");
  }

  async #reserve():Promise<boolean>{
    return this.deps.db.transaction(async tx=>{
      await tx.query(
        `LOCK TABLE public.ishikeit_initial_admin_provisioning,
          public.ishikeit_workspaces,public.ishikeit_workspace_memberships
         IN SHARE ROW EXCLUSIVE MODE`
      );
      const row=await tx.query<ProvisioningRow>(
        `SELECT email_address,state,auth_user_id,approved_by,approval_reference
         FROM public.ishikeit_initial_admin_provisioning WHERE singleton=true FOR UPDATE`
      );
      if(row.rows[0]){
        this.#assertApproval(row.rows[0]);
        return false;
      }
      const existing=await tx.query<CheckRow>(
        `SELECT (EXISTS(SELECT 1 FROM public.ishikeit_workspaces)
           OR EXISTS(SELECT 1 FROM public.ishikeit_workspace_memberships)
           OR EXISTS(SELECT 1 FROM public.ishikeit_initial_owner_bootstrap))
         AS established`
      );
      if(existing.rows[0]?.established!==false)
        throw new Error("Initial admin provisioning forbidden on existing tenant data");
      const users=await tx.query<{id:string}>(
        `SELECT id FROM auth.users WHERE lower(email)=$1 LIMIT 1`,
        [this.#approval.email]
      );
      if(users.rows.length>0)throw new Error("Preexisting Auth user requires separate identity review");
      await tx.query(
        `INSERT INTO public.ishikeit_initial_admin_provisioning
           (singleton,email_address,approval_reference,approved_by,state,requested_at)
         VALUES(true,$1,$2,$3,'invite_requested',now())`,
        [this.#approval.email,this.#approval.approvalReference,this.#approval.approvedBy]
      );
      return true;
    });
  }
  async #reconcile():Promise<ProvisioningRow>{
    const row=await this.#record();
    if(row===undefined)throw new Error("Initial admin provisioning state missing");
    this.#assertApproval(row);
    if(row.state==="invite_requested"){
      // The Auth Admin invitation may have succeeded even when HTTP failed.
      // Read the exact user from Supabase Auth before considering any retry.
      const users=await this.deps.db.query<AuthUserRow>(
        `SELECT id,email_confirmed_at FROM auth.users
          WHERE lower(email)=$1 AND invited_at IS NOT NULL AND is_anonymous=false
            AND deleted_at IS NULL
          LIMIT 2`,[this.#approval.email]
      );
      if(users.rows.length===1){
        await this.#markInvited(users.rows[0]!.id);
        return (await this.#record())!;
      }
    }
    return row;
  }
  async #markInvited(userId:string):Promise<void>{
    const id=z.string().uuid().parse(userId);
    const result=await this.deps.db.query(
      `UPDATE public.ishikeit_initial_admin_provisioning
         SET state='invited',auth_user_id=$1,invited_at=now()
       WHERE singleton=true AND state='invite_requested'
         AND email_address=$2 AND approved_by=$3 AND approval_reference=$4
       RETURNING singleton`,
      [id,this.#approval.email,this.#approval.approvedBy,this.#approval.approvalReference]
    );
    if(result.rowCount!==1){
      const now=await this.#record();
      if(now?.state!=="invited" || now.auth_user_id!==id)
        throw new Error("Initial admin invitation reconciliation conflict");
    }
  }
  async reconcile():Promise<InitialAdminProgress>{
    const row=await this.#reconcile();
    if(row.state==="activated"){
      // A historical activation record is not proof of current authorization.
      // Fail closed if the account was revoked, deleted or its grants drifted.
      const issuer=new URL(this.#approval.projectUrl).origin+"/auth/v1";
      const integrity=await this.deps.db.query<CheckRow>(
        `SELECT EXISTS(
          SELECT 1 FROM public.ishikeit_initial_owner_bootstrap b
          JOIN auth.users u ON u.id=b.owner_user_id
          JOIN public.ishikeit_platform_administrators a
            ON a.user_id=u.id AND a.auth_issuer=b.auth_issuer
          JOIN public.ishikeit_workspaces w ON w.workspace_id=b.workspace_id
          JOIN public.ishikeit_workspace_memberships m
            ON m.workspace_id=w.workspace_id AND m.auth_issuer=b.auth_issuer
              AND m.auth_subject=u.id::text
          WHERE b.singleton=true AND b.owner_user_id=$1::uuid
            AND b.auth_issuer=$2 AND b.approved_by=$3
            AND b.approval_reference=$4 AND w.state='active'
            AND m.role='owner' AND m.state='active'
            AND a.role='super_admin' AND a.state='active'
            AND a.approval_reference=$4
            AND lower(u.email)=$5 AND u.email_confirmed_at IS NOT NULL
            AND u.invited_at IS NOT NULL AND u.is_anonymous=false
            AND u.deleted_at IS NULL
            AND (u.banned_until IS NULL OR u.banned_until<=now())
        ) AS established`,
        [row.auth_user_id,issuer,this.#approval.approvedBy,
          this.#approval.approvalReference,this.#approval.email]
      );
      if(integrity.rows[0]?.established!==true)
        throw new Error("Activated administrator authorization integrity failed");
      return {status:"already_activated"};
    }
    if(row.state==="invite_requested")return {status:"ambiguous_invitation"};
    if(row.state!=="invited" || row.auth_user_id===null)
      return {status:"invitation_requested"};
    const eligible=await this.deps.db.query<AuthUserRow>(
      `SELECT id,email_confirmed_at FROM auth.users
         WHERE id=$1::uuid AND lower(email)=$2
           AND invited_at IS NOT NULL AND is_anonymous=false AND deleted_at IS NULL
           AND (banned_until IS NULL OR banned_until<=now())`,
      [row.auth_user_id,this.#approval.email]
    );
    if(eligible.rows[0]?.id!==row.auth_user_id)
      throw new Error("Initial admin identity is no longer eligible");
    if(!eligible.rows[0].email_confirmed_at)
      return {status:"pending_email_confirmation"};
    const registry=new PostgresFirstOwnerBootstrap(this.deps.db);
    const done=await registry.execute({
      projectUrl:this.#approval.projectUrl,
      approvedUserId:row.auth_user_id,
      expectedEmail:this.#approval.email,
      workspaceName:this.#approval.workspaceName,
      approvedBy:this.#approval.approvedBy,
      approvalReference:this.#approval.approvalReference
    });
    return {status:"activated",workspaceId:done.workspaceId};
  }
  async run():Promise<InitialAdminProgress>{
    if(await this.#reserve()){
      // One first invitation only. Never retry a failed or ambiguous HTTP
      // POST without exact Auth user readback and operator investigation.
      try {
        const user=await this.deps.invitation.inviteUserByEmail(this.#approval.email);
        if(user.email!==this.#approval.email)
          throw new Error("Auth Admin returned different identity");
        await this.#markInvited(user.userId);
      } catch {
        return {status:"ambiguous_invitation"};
      }
    }
    return this.reconcile();
  }
}
