import type pg from "pg";
import { z } from "zod";
import type { PostgresDatabase } from "../persistence/postgres.js";
import type { WorkspacePrincipal } from "../persistence/workspace-connections.js";

/**
 * Trusted Ishikeit identity boundary for a Supabase Auth user.
 *
 * Verify a caller's access JWT by retrieving the current user from the
 * issuer's authenticated /auth/v1/user endpoint (official GoTrue API), AND
 * confirm the exact signed token's session_id still exists in auth.sessions.
 * This rejects stale signed-out sessions on sensitive connection operations.
 *
 * Do not use service_role keys, raw unverified JWT claims, user_metadata,
 * email, account handles or an operator bearer token to authorize workspaces.
 * The frontend/login/cookie/BFF transport is intentionally NOT wired here.
 */
const id = z.string().uuid();
const jwtPart = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/u);
const jwtShape = z.string().min(50).max(8192)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
const providerResponse = z.object({
  id,
  role: z.literal("authenticated"),
  is_anonymous: z.boolean().optional(),
  banned_until: z.string().nullable().optional()
}).passthrough();
const claimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.literal("authenticated"),z.array(z.string())]),
  sub: id,
  session_id: id,
  role: z.literal("authenticated"),
  exp: z.number().int().positive()
}).passthrough();

interface SessionRow extends pg.QueryResultRow { active: boolean }
export interface VerifiedIshikeitSession {
  principal: WorkspacePrincipal;
  sessionId: string;
  expiresAt: string;
}
export interface SupabaseAuthVerifierOptions {
  /** Example: https://<project-ref>.supabase.co. Only exact Supabase hosts. */
  projectUrl: string;
  /** Public PROJECT key ONLY, never service-role or sb_secret_ key. */
  publishableKey: string;
  db: Pick<PostgresDatabase, "query">;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function parseJwtClaims(rawJwt: string): z.infer<typeof claimsSchema> {
  const valid = jwtShape.parse(rawJwt);
  const parts = valid.split(".");
  if (parts.length !== 3) throw new Error("User authentication invalid");
  const encoded = jwtPart.parse(parts[1]);
  let claims: unknown;
  try {
    const payload = Buffer.from(encoded, "base64url");
    if (payload.length > 4096) throw new Error("oversized");
    claims = JSON.parse(payload.toString("utf8")) as unknown;
  } catch {
    throw new Error("User authentication invalid");
  }
  // Parsing is NOT validation. Claims MUST NOT confer access until verified
  // by the trusted Supabase Auth server for this same bearer token.
  return claimsSchema.parse(claims);
}

function projectOrigin(projectUrl: string): string {
  const url = new URL(projectUrl);
  if (url.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/u.test(url.hostname)
    || url.port !== "" || url.username !== "" || url.password !== ""
    || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("Supabase Auth must use the exact project HTTPS host");
  }
  return url.origin;
}

async function smallJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("User authentication unavailable");
  const buffers: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value === undefined) continue;
      total += chunk.value.byteLength;
      if (total > 16384) {
        await reader.cancel().catch(() => undefined);
        throw new Error("User authentication response oversized");
      }
      buffers.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(buffers, total).toString("utf8")) as unknown;
  } catch {
    throw new Error("User authentication response invalid");
  }
}

/** SERVER-ONLY: verified Supabase user and live session, not UI-issued role. */
export class SupabaseAuthPrincipalVerifier {
  readonly #origin: string;
  readonly #issuer: string;
  readonly #publishableKey: string;
  readonly #db: Pick<PostgresDatabase, "query">;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #timeoutMs: number;

  constructor(options: SupabaseAuthVerifierOptions) {
    this.#origin = projectOrigin(options.projectUrl);
    this.#issuer = this.#origin + "/auth/v1";
    if (!/^sb_publishable_[A-Za-z0-9_-]{8,200}$/u.test(options.publishableKey)) {
      throw new Error("Supabase Auth requires a project publishable key");
    }
    this.#publishableKey = options.publishableKey;
    this.#db = options.db;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = z.number().int().min(1000).max(15000)
      .parse(options.requestTimeoutMs ?? 7000);
  }

  async verifyAccessToken(token: string): Promise<VerifiedIshikeitSession> {
    // Local decoding is bounded and checked for project binding, but not
    // considered trustworthy until the exact JWT passes a live Auth readback.
    let claims: z.infer<typeof claimsSchema>;
    try { claims = parseJwtClaims(token); }
    catch { throw new Error("User authentication invalid"); }
    const now = this.#now();
    if (claims.iss !== this.#issuer
      || (claims.aud !== "authenticated"
        && (!Array.isArray(claims.aud) || !claims.aud.includes("authenticated")))
      || claims.exp * 1000 <= now
      || claims.exp * 1000 > now + 86400_000) {
      throw new Error("User authentication invalid");
    }

    let response: Response;
    try {
      response = await this.#fetch(this.#issuer + "/user", {
        method: "GET", redirect: "error", cache: "no-store",
        headers: {
          Authorization: "Bearer " + token,
          apikey: this.#publishableKey,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch {
      throw new Error("User authentication unavailable");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("User authentication invalid");
    }
    if (!response.ok) throw new Error("User authentication unavailable");

    let user: z.infer<typeof providerResponse>;
    try { user = providerResponse.parse(await smallJson(response)); }
    catch { throw new Error("User authentication invalid"); }
    if (user.id !== claims.sub || user.is_anonymous === true
      || (user.banned_until !== undefined && user.banned_until !== null
        && (Number.isNaN(Date.parse(user.banned_until))
          || Date.parse(user.banned_until) > now))) {
      throw new Error("User authentication invalid");
    }

    // Auth JWTs survive sign-out until expiry. For security-sensitive
    // account linking/disconnect, also require this exact session to exist.
    // Never use the JWT session_id alone to assign a workspace role.
    let rows: pg.QueryResult<SessionRow>;
    try {
      rows = await this.#db.query<SessionRow>(
        `SELECT EXISTS (
          SELECT 1 FROM auth.sessions
          WHERE id=$1::uuid AND user_id=$2::uuid
        ) AS active`,
        [claims.session_id, claims.sub]
      );
    } catch {
      throw new Error("User session verification unavailable");
    }
    if (rows.rows[0]?.active !== true) {
      throw new Error("User authentication invalid");
    }
    return {
      principal: { issuer: this.#issuer, subject: user.id },
      sessionId: claims.session_id,
      expiresAt: new Date(claims.exp * 1000).toISOString()
    };
  }
}
