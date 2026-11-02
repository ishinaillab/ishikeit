import { z } from "zod";
import { PostgresDatabase } from "../persistence/postgres.js";
import { PostgresFirstOwnerBootstrap } from "../auth/postgres-first-owner-bootstrap.js";

/** Explicitly invoked operator process ONLY, never imported by the HTTP
 * server. It requires database credentials already present in a trusted
 * operating environment. No owner or email is baked into this executable.
 */
const mode=process.argv[2];
const args=z.object({
  DATABASE_URL:z.string().min(10),
  SUPABASE_AUTH_PROJECT_URL:z.url(),
  ISHIKEIT_BOOTSTRAP_USER_ID:z.uuid(),
  ISHIKEIT_BOOTSTRAP_EMAIL:z.email(),
  ISHIKEIT_BOOTSTRAP_WORKSPACE_NAME:z.string().min(1).max(160),
  ISHIKEIT_BOOTSTRAP_APPROVED_BY:z.string().min(3).max(120),
  ISHIKEIT_BOOTSTRAP_APPROVAL_REFERENCE:z.string().min(8).max(160),
  ISHIKEIT_BOOTSTRAP_OPERATOR_CONFIRMATION:z.string()
}).safeParse(process.env);

if(mode!=="--execute" || !args.success
  || args.data.ISHIKEIT_BOOTSTRAP_OPERATOR_CONFIRMATION
    !=="APPROVE_INITIAL_OWNER:"+args.data.ISHIKEIT_BOOTSTRAP_USER_ID){
  process.stderr.write(
    "Initial owner bootstrap not executed. Requires --execute and exact " +
    "explicit owner UUID confirmation, verified approved identity and all " +
    "private operator configuration.\n"
  );
  process.exitCode=1;
} else {
  const db=new PostgresDatabase(args.data.DATABASE_URL);
  try {
    const service=new PostgresFirstOwnerBootstrap(db);
    const result=await service.execute({
      projectUrl:args.data.SUPABASE_AUTH_PROJECT_URL,
      approvedUserId:args.data.ISHIKEIT_BOOTSTRAP_USER_ID,
      expectedEmail:args.data.ISHIKEIT_BOOTSTRAP_EMAIL,
      workspaceName:args.data.ISHIKEIT_BOOTSTRAP_WORKSPACE_NAME,
      approvedBy:args.data.ISHIKEIT_BOOTSTRAP_APPROVED_BY,
      approvalReference:args.data.ISHIKEIT_BOOTSTRAP_APPROVAL_REFERENCE
    });
    process.stdout.write(
      "Initial owner bootstrap committed. Workspace ID: "+result.workspaceId+"\n"
    );
  } catch {
    // Never print DB credentials, email, raw SQL or secret provider errors.
    process.stderr.write(
      "Initial owner bootstrap rejected; database transaction rolled back.\n"
    );
    process.exitCode=1;
  } finally {
    await db.close();
  }
}
