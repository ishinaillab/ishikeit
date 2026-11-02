import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { PostgresDatabase, SqlExecutor } from "../persistence/postgres.js";

/**
 * Trusted *operator-only* initial-owner assignment.
 *
 * IMPORTANT: Email confirmation proves control of an email address, NOT that
 * the person is entitled to own Ishi Nail Lab or any future tenant. The
 * operator MUST independently validate ownership and record the explicit
 * approval outside Ishikeit before invoking this service. Never expose it
 * over HTTP, an LLM endpoint or a client-side Supabase key.
 */
const fields=z.object({
  projectUrl:z.url(),
  approvedUserId:z.uuid(),
  expectedEmail:z.email().max(320).transform(x=>x.trim().toLowerCase()),
  workspaceName:z.string().trim().min(1).max(160),
  approvedBy:z.string().trim().min(3).max(120)
    .regex(/^[A-Za-z0-9 ._@:/-]+$/u),
  approvalReference:z.string().trim().min(8).max(160)
    .regex(/^[A-Za-z0-9._:/-]+$/u)
}).strict();

export interface FirstOwnerBootstrapRequest {
  projectUrl:string;
  approvedUserId:string;
  expectedEmail:string;
  workspaceName:string;
  approvedBy:string;
  approvalReference:string;
}
export interface FirstOwnerBootstrapResult {
  workspaceId:string;
  ownerUserId:string;
  authIssuer:string;
}
interface ExistsRow extends pg.QueryResultRow {
  preexisting:boolean;
}
interface VerifiedUserRow extends pg.QueryResultRow {
  id:string;
}
function verifiedIssuer(projectUrl:string):string {
  const parsed=new URL(projectUrl);
  if(parsed.protocol!=="https:"
    || !/^[a-z0-9]{20}\.supabase\.co$/u.test(parsed.hostname)
    || parsed.pathname!=="/" || parsed.search!=="" || parsed.hash!==""
    || parsed.port!=="" || parsed.username!=="" || parsed.password!=="")
    throw new Error("Initial owner requires an exact Supabase HTTPS project origin");
  return parsed.origin+"/auth/v1";
}
async function assertUnbootstrapped(tx:SqlExecutor):Promise<void> {
  const row=await tx.query<ExistsRow>(
    `SELECT (
       EXISTS(SELECT 1 FROM public.ishikeit_workspaces)
       OR EXISTS(SELECT 1 FROM public.ishikeit_workspace_memberships)
       OR EXISTS(SELECT 1 FROM public.ishikeit_initial_owner_bootstrap)
     ) AS preexisting`
  );
  if(row.rows[0]?.preexisting!==false)
    throw new Error("Initial owner bootstrap is not available on an established instance");
}

/**
 * Creates only a workspace, its exact pre-approved owner membership, and a
 * singleton non-public approval audit. Does NOT create or invite Auth users.
 *
 * Transaction/table locks prevent races with other workspace writers;
 * singleton audit prevents ever treating this bootstrap as a user-facing
 * multi-workspace creation mechanism. If ANY write fails, all writes roll
 * back, and the existing messaging/provider state remains untouched.
 */
export class PostgresFirstOwnerBootstrap {
  constructor(private readonly db:Pick<PostgresDatabase,"transaction">){}

  async execute(raw:FirstOwnerBootstrapRequest):Promise<FirstOwnerBootstrapResult>{
    const input=fields.parse(raw);
    const authIssuer=verifiedIssuer(input.projectUrl);
    const workspaceId=randomUUID();
    return this.db.transaction(async tx=>{
      // Blocks unrelated concurrent workspace writers until COMMIT/ROLLBACK.
      // Use deterministic lock ordering. No DDL or historical backfill.
      await tx.query(
        `LOCK TABLE public.ishikeit_workspaces,
            public.ishikeit_workspace_memberships,
            public.ishikeit_initial_owner_bootstrap
          IN SHARE ROW EXCLUSIVE MODE`
      );
      await assertUnbootstrapped(tx);

      // Trust immutable Auth user id + exact normalized confirmed email.
      // Never trust raw_user_meta_data, invented external account ownership,
      // an invitation being SENT (rather than accepted), or a signup request.
      const eligible=await tx.query<VerifiedUserRow>(
        `SELECT id FROM auth.users
         WHERE id=$1::uuid AND lower(email)=$2
           AND email_confirmed_at IS NOT NULL
           AND is_anonymous=false AND deleted_at IS NULL
           AND (banned_until IS NULL OR banned_until<=now())
         FOR SHARE`,
        [input.approvedUserId,input.expectedEmail]
      );
      if(eligible.rows.length!==1 || eligible.rows[0]?.id!==input.approvedUserId)
        throw new Error("Owner is not a verified and explicitly approved Auth user");

      await tx.query(
        `INSERT INTO public.ishikeit_workspaces(workspace_id,display_name)
         VALUES($1,$2)`,
        [workspaceId,input.workspaceName]
      );
      await tx.query(
        `INSERT INTO public.ishikeit_workspace_memberships
         (workspace_id,auth_issuer,auth_subject,role,state)
         VALUES($1,$2,$3,'owner','active')`,
        [workspaceId,authIssuer,input.approvedUserId]
      );
      await tx.query(
        `INSERT INTO public.ishikeit_initial_owner_bootstrap
         (singleton,workspace_id,owner_user_id,auth_issuer,approved_by,approval_reference)
         VALUES(true,$1,$2,$3,$4,$5)`,
        [workspaceId,input.approvedUserId,authIssuer,
          input.approvedBy,input.approvalReference]
      );
      return {workspaceId,ownerUserId:input.approvedUserId,authIssuer};
    });
  }
}
