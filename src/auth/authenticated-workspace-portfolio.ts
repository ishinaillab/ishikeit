import type pg from "pg";
import { z } from "zod";
import type { PostgresDatabase } from "../persistence/postgres.js";
import type { SupabaseAuthPrincipalVerifier } from "./supabase-workspace-principal.js";

/** Read-only, server-private workspace switcher data model for Phase 3.
 * Authentication is checked on EACH request using official Supabase Auth
 * and its live session; the SQL does not accept user/tenant IDs from UI.
 * This is NOT an HTTP endpoint or general-public account registration.
 */
interface WorkspaceRow extends pg.QueryResultRow {
  workspace_id: string;
  display_name: string;
  role: "owner" | "admin" | "agent" | "viewer";
  connected_accounts: number;
}
export interface WorkspacePage {
  items: readonly AccessibleWorkspace[];
  nextCursor?: string;
}
export interface AccessibleWorkspace {
  workspaceId: string;
  displayName: string;
  role: "owner" | "admin" | "agent" | "viewer";
  connectedAccounts: number;
}
const resultSchema = z.object({
  workspace_id: z.string().uuid(),
  display_name: z.string().min(1).max(160),
  role: z.enum(["owner","admin","agent","viewer"]),
  connected_accounts: z.number().int().min(0)
}).strict();

export class AuthenticatedWorkspacePortfolio {
  constructor(
    private readonly auth: Pick<SupabaseAuthPrincipalVerifier,"verifyAccessToken">,
    private readonly db: Pick<PostgresDatabase,"query">
  ) {}

  async list(accessToken: string, options: { after?: string; pageSize?: number } = {}): Promise<WorkspacePage> {
    const cursor = options.after === undefined ? null : z.string().uuid().parse(options.after);
    const pageSize = z.number().int().min(1).max(50).parse(options.pageSize ?? 20);
    const verified = await this.auth.verifyAccessToken(accessToken);
    const rows = await this.db.query<WorkspaceRow>(
      `SELECT w.workspace_id,w.display_name,m.role,
         (SELECT count(*)::integer
          FROM public.ishikeit_account_connections c
          WHERE c.workspace_id=w.workspace_id AND c.status='connected'
         ) AS connected_accounts
       FROM public.ishikeit_workspace_memberships m
       JOIN public.ishikeit_workspaces w ON w.workspace_id=m.workspace_id
       WHERE m.auth_issuer=$1 AND m.auth_subject=$2
         AND m.state='active' AND w.state='active'
         AND ($3::uuid IS NULL OR w.workspace_id > $3::uuid)
       ORDER BY w.workspace_id ASC
       LIMIT $4`,
      [verified.principal.issuer,verified.principal.subject,cursor,pageSize+1]
    );
    const hasMore = rows.rows.length > pageSize;
    const items=rows.rows.slice(0,pageSize).map(row=>{
      const r = resultSchema.parse(row);
      return {
        workspaceId:r.workspace_id,
        displayName:r.display_name,
        role:r.role,
        connectedAccounts:r.connected_accounts
      };
    });
    return {
      items,
      ...(hasMore && items.length > 0
        ? { nextCursor: items[items.length-1]!.workspaceId } : {})
    };
  }
}
