import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { PostgresDatabase } from "./postgres.js";
import type { WorkspacePrincipal } from "./workspace-connections.js";

/**
 * Private staging boundary for future workspace-aware provider authorization.
 * Caller MUST supply an authenticated, server-verified principal, a server-
 * configured redirect and a provider integration approved for this workspace.
 * Not exposed to HTTP and not wired into any existing OAuth callback.
 *
 * The 32-byte browser nonce belongs ONLY in a short-lived, Secure, HttpOnly,
 * host-only, SameSite=Lax browser cookie. It is never a query parameter,
 * localStorage value, OAuth state, logged value or part of any provider URL.
 * These are server transport requirements for a FUTURE integration.
 */
const uuid = z.string().uuid();
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const provider = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const principal = z.object({
  issuer: z.string().min(1).max(200),
  subject: z.string().min(1).max(256)
}).strict();

function verifiedRedirectUri(input: string): string {
  const uri = z.string().min(12).max(2048).parse(input);
  let parsed: URL;
  try { parsed = new URL(uri); }
  catch { throw new Error("Connection redirect URI invalid"); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== ""
    || parsed.hash !== "" || parsed.port !== "" || parsed.origin + parsed.pathname + parsed.search !== uri) {
    throw new Error("Connection redirect URI must be an exact HTTPS redirect");
  }
  return uri;
}
function digest(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}
function verifier(state: string, browserNonce: string): string {
  // Domain-separated HMAC: one transaction-specific verifier, never persisted.
  // This is for providers that actually support PKCE S256; a provider adapter
  // MUST inspect its official API before sending code_challenge parameters.
  return createHmac("sha256", Buffer.from(browserNonce, "base64url"))
    .update("ishikeit:workspace-connection-pkce:v1\0")
    .update(state)
    .digest("base64url");
}
const beginSchema = z.object({
  workspaceId: uuid,
  actor: principal,
  provider,
  providerApplicationKey: provider,
  redirectUri: z.string().min(12).max(2048),
  // Optional legacy/internal callers; authenticated facade always supplies it.
  sessionId: uuid.optional()
}).strict();
const consumeSchema = beginSchema.extend({
  state: token,
  browserNonce: token
}).strict();

export interface ConnectionIntentStart {
  /** Sensitive: caller must put in provider authorization URL only. */
  state: string;
  /** Sensitive: cookie-only; never serialize to provider or client JS. */
  browserNonce: string;
  /** Optional provider S256 PKCE challenge; never assume provider support. */
  codeChallenge: string;
  expiresAt: string;
}
export interface ConnectionIntentCompletion {
  intentId: string;
  workspaceId: string;
  actor: WorkspacePrincipal;
  provider: string;
  providerApplicationKey: string;
  redirectUri: string;
  /** PKCE code_verifier for server-side exchange, only if provider supports it. */
  codeVerifier: string;
}
interface ExpirationRow extends pg.QueryResultRow { expires_at: Date }
interface IntentRow extends pg.QueryResultRow {
  intent_id: string;
  workspace_id: string;
  actor_issuer: string;
  actor_subject: string;
  provider: string;
  provider_application_key: string;
  redirect_uri: string;
}

export class PostgresWorkspaceConnectionIntents {
  constructor(private readonly db: Pick<PostgresDatabase, "transaction">) {}

  async begin(input: z.infer<typeof beginSchema>): Promise<ConnectionIntentStart> {
    const p = beginSchema.parse(input);
    const redirectUri = verifiedRedirectUri(p.redirectUri);
    const state = randomBytes(32).toString("base64url");
    const browserNonce = randomBytes(32).toString("base64url");
    const expiresAt = await this.db.transaction(async (tx) => {
      // Lock the membership and workspace while the attempt is allocated.
      const permitted = await tx.query(
        `SELECT 1 FROM public.ishikeit_workspace_memberships m
         JOIN public.ishikeit_workspaces w ON w.workspace_id=m.workspace_id
         WHERE m.workspace_id=$1 AND m.auth_issuer=$2 AND m.auth_subject=$3
           AND m.role IN ('owner','admin') AND m.state='active'
           AND w.state='active' FOR SHARE OF m,w`,
        [p.workspaceId, p.actor.issuer, p.actor.subject]
      );
      if (permitted.rowCount !== 1) throw new Error("Workspace authorization denied");
      const inserted = await tx.query<ExpirationRow>(
        `INSERT INTO public.ishikeit_connection_intents
           (intent_id,workspace_id,actor_issuer,actor_subject,provider,
            provider_application_key,redirect_uri,state_hash,browser_nonce_hash,auth_session_id,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+ interval '10 minutes')
         RETURNING expires_at`,
        [randomUUID(),p.workspaceId,p.actor.issuer,p.actor.subject,p.provider,
          p.providerApplicationKey,redirectUri,digest(state),digest(browserNonce),p.sessionId ?? null]
      );
      if (inserted.rows[0] === undefined) throw new Error("Connection intent unavailable");
      return inserted.rows[0].expires_at.toISOString();
    });
    const codeVerifier = verifier(state, browserNonce);
    return {
      state, browserNonce,
      codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
      expiresAt
    };
  }

  /** Exactly-once callback consumption. All expected values must come from
   * authenticated server context / registered app config, not untrusted
   * callback URL parameters. Wrong account, session or provider leaves the
   * legitimate state unconsumed. Concurrent callbacks cannot both succeed.
   */
  async consume(input: z.infer<typeof consumeSchema>): Promise<ConnectionIntentCompletion | undefined> {
    const p = consumeSchema.parse(input);
    const redirectUri = verifiedRedirectUri(p.redirectUri);
    const result = await this.db.transaction(async (tx) => tx.query<IntentRow>(
      `UPDATE public.ishikeit_connection_intents i SET consumed_at=now()
       WHERE i.workspace_id=$1 AND i.actor_issuer=$2 AND i.actor_subject=$3
         AND i.provider=$4 AND i.provider_application_key=$5 AND i.redirect_uri=$6
         AND i.state_hash=$7 AND i.browser_nonce_hash=$8
         AND i.auth_session_id IS NOT DISTINCT FROM $9::uuid
         AND i.consumed_at IS NULL AND i.expires_at > now()
         AND EXISTS (
           SELECT 1 FROM public.ishikeit_workspace_memberships m
           JOIN public.ishikeit_workspaces w ON w.workspace_id=m.workspace_id
           WHERE m.workspace_id=i.workspace_id AND m.auth_issuer=i.actor_issuer
             AND m.auth_subject=i.actor_subject AND m.state='active'
             AND m.role IN ('owner','admin') AND w.state='active'
         )
       RETURNING intent_id,workspace_id,actor_issuer,actor_subject,
                 provider,provider_application_key,redirect_uri`,
      [p.workspaceId,p.actor.issuer,p.actor.subject,p.provider,
        p.providerApplicationKey,redirectUri,digest(p.state),digest(p.browserNonce),p.sessionId ?? null]
    ));
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      intentId: row.intent_id, workspaceId: row.workspace_id,
      actor: { issuer: row.actor_issuer, subject: row.actor_subject },
      provider: row.provider,
      providerApplicationKey: row.provider_application_key,
      redirectUri: row.redirect_uri,
      codeVerifier: verifier(p.state, p.browserNonce)
    };
  }
}
