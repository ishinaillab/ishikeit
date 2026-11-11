import { z } from "zod";
import { PostgresDatabase } from "../persistence/postgres.js";
import { SupabaseAdminInviteClient } from "../auth/supabase-admin-invite.js";
import { PostgresInitialAdminProvisioning } from "../auth/managed-initial-admin.js";
import { isApprovedFirstOwnerActionContext } from "../auth/provisioning-action-context.js";

/**
 * Trusted protected-deployment job; NEVER callable from an HTTP route.
 * The first invitation is a single recorded operation. Later invocations
 * only reconcile the trusted Supabase Auth user, never resend blindly.
 */
const mode=process.argv[2];
const schema=z.object({
  DATABASE_URL:z.string().min(10),
  SUPABASE_AUTH_PROJECT_URL:z.url(),
  SUPABASE_AUTH_SECRET_KEY:z.string().regex(/^sb_secret_[A-Za-z0-9_-]{8,200}$/u).optional(),
  ISHIKEIT_INITIAL_ADMIN_EMAIL:z.email(),
  ISHIKEIT_INITIAL_ADMIN_WORKSPACE:z.string().min(1).max(160),
  ISHIKEIT_INITIAL_ADMIN_APPROVED_BY:z.string().min(3).max(120),
  ISHIKEIT_INITIAL_ADMIN_APPROVAL_REFERENCE:z.string().min(8).max(160),
  ISHIKEIT_INITIAL_ADMIN_CONFIRMATION:z.string()
}).safeParse(process.env);
if(!isApprovedFirstOwnerActionContext(process.env)
  || !["--invite","--reconcile"].includes(mode??"") || !schema.success
  || schema.data.ISHIKEIT_INITIAL_ADMIN_CONFIRMATION
    !=="APPROVE_ISHIKEIT_ADMIN:"+schema.data.ISHIKEIT_INITIAL_ADMIN_EMAIL){
  process.stderr.write("Managed administrator provisioning not authorized or configured.\n");
  process.exitCode=1;
}else{
  const config=schema.data;
  if(mode==="--invite" && config.SUPABASE_AUTH_SECRET_KEY===undefined){
    process.stderr.write("A trusted Supabase Auth Admin secret is required for invitations.\n");
    process.exitCode=1;
  }else{
    const db=new PostgresDatabase(config.DATABASE_URL);
    try{
      const service=new PostgresInitialAdminProvisioning({
        db,
        invitation: config.SUPABASE_AUTH_SECRET_KEY===undefined
          ? {inviteUserByEmail:()=>Promise.reject(new Error("Invitations disabled for reconciliation"))}
          : new SupabaseAdminInviteClient({
            projectUrl:config.SUPABASE_AUTH_PROJECT_URL,
            secretKey:config.SUPABASE_AUTH_SECRET_KEY
          }),
        approval:{
          projectUrl:config.SUPABASE_AUTH_PROJECT_URL,
          email:config.ISHIKEIT_INITIAL_ADMIN_EMAIL,
          workspaceName:config.ISHIKEIT_INITIAL_ADMIN_WORKSPACE,
          approvedBy:config.ISHIKEIT_INITIAL_ADMIN_APPROVED_BY,
          approvalReference:config.ISHIKEIT_INITIAL_ADMIN_APPROVAL_REFERENCE
        }
      });
      // Reconciliation cannot create a new invitation or reserve identity.
      const status=mode==="--invite"?await service.run():await service.reconcile();
      process.stdout.write("Initial administrator provisioning: "+status.status+"\n");
      if(status.status==="ambiguous_invitation")process.exitCode=2;
    }catch{
      process.stderr.write(
        "Initial administrator provisioning blocked; verify schema and administrator approval.\n"
      );
      process.exitCode=1;
    }finally{await db.close();}
  }
}
