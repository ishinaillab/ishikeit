import type pg from "pg";
import type { PostgresDatabase } from "../persistence/postgres.js";
import type { SupabaseAuthPrincipalVerifier, VerifiedIshikeitSession } from "./supabase-workspace-principal.js";

interface RoleRow extends pg.QueryResultRow { authorized:boolean }
/**
 * Explicit platform-wide authorization boundary.
 *
 * The separate super_admin record NEVER implies ownership of another
 * workspace, provider OAuth grant or recipient consent. Each sensitive
 * operation must check its own capability, role and policy after this.
 *
 * This verifier never accepts user metadata, request-selected actor ID,
 * an unsigned client role, an arbitrary session or a bare email address.
 */
export class PostgresPlatformAdministratorVerifier {
  constructor(private readonly deps:{
    identity:Pick<SupabaseAuthPrincipalVerifier,"verifyPrivilegedAccessToken">;
    db:Pick<PostgresDatabase,"query">;
  }){}
  async verifySuperAdmin(accessToken:string):Promise<VerifiedIshikeitSession>{
    const verified=await this.deps.identity.verifyPrivilegedAccessToken(accessToken);
    const r=await this.deps.db.query<RoleRow>(
      `SELECT EXISTS(
         SELECT 1 FROM public.ishikeit_platform_administrators p
         JOIN auth.users u ON u.id=p.user_id
         WHERE p.user_id=$1::uuid AND p.auth_issuer=$2
           AND p.role='super_admin' AND p.state='active'
           AND u.is_anonymous=false AND u.email_confirmed_at IS NOT NULL
           AND u.deleted_at IS NULL
           AND (u.banned_until IS NULL OR u.banned_until<=now())
       ) AS authorized`,
      [verified.principal.subject,verified.principal.issuer]
    );
    if(r.rows[0]?.authorized!==true)
      throw new Error("Platform administrator access denied");
    return verified;
  }
}
