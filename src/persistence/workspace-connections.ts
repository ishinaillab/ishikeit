import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { PostgresDatabase, SqlExecutor } from "./postgres.js";

/**
 * Server-only Phase 2 workspace registry. The caller MUST supply a principal
 * established by its trusted authentication verifier and a provider identity
 * verified through the official provider's API or authenticated OAuth flow.
 * Do not expose these methods directly as HTTP operations.
 *
 * Nothing in this module modifies the existing webhook/dispatch path yet.
 */
const uuid = z.string().uuid();
const principalSchema = z.object({
  issuer: z.string().min(1).max(200),
  subject: z.string().min(1).max(256)
}).strict();
const providerId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const accountId = z.string().min(1).max(256);
const shortRef = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const proofSchema = z.object({
  provider: providerId,
  accountId,
  source: z.enum(["provider_api", "oauth_grant", "provider_connection_readback"]),
  sourceReference: shortRef,
  verifiedAt: z.iso.datetime({ offset: true })
}).strict();
const workspaceSchema = z.object({
  workspaceId: uuid,
  name: z.string().trim().min(1).max(160),
  owner: principalSchema
}).strict();
const linkSchema = z.object({
  connectionId: uuid,
  workspaceId: uuid,
  actor: principalSchema,
  providerApplicationKey: shortRef,
  providerConnectionId: accountId.optional(),
  credentialAccountId: accountId.optional(),
  proof: proofSchema
}).strict();
const idAction = z.object({
  workspaceId: uuid,
  connectionId: uuid,
  actor: principalSchema
}).strict();

export type WorkspacePrincipal = z.infer<typeof principalSchema>;
export type VerifiedAccountProof = z.infer<typeof proofSchema>;
export type WorkspaceConnectionStatus =
  | "verifying" | "connected" | "attention_required" | "paused"
  | "disconnecting" | "disconnected" | "revoked";
export interface WorkspaceConnection {
  connectionId: string;
  workspaceId: string;
  provider: string;
  accountId: string;
  status: WorkspaceConnectionStatus;
  generation: number;
}
interface ConnectionRow extends pg.QueryResultRow {
  connection_id: string;
  workspace_id: string;
  provider: string;
  provider_account_id: string;
  status: WorkspaceConnectionStatus;
  generation: string | number;
}
interface MemberRow extends pg.QueryResultRow { role: "owner" | "admin" | "agent" | "viewer" }
interface WorkspaceAccess extends WorkspacePrincipal { workspaceId: string }

function validatedProof(input: VerifiedAccountProof): z.infer<typeof proofSchema> {
  const proof = proofSchema.parse(input);
  const observed = Date.parse(proof.verifiedAt);
  const elapsed = Date.now() - observed;
  if (!Number.isFinite(observed) || elapsed < -120000 || elapsed > 900000) {
    throw new Error("Recent provider identity verification required");
  }
  return proof;
}
function present(row: ConnectionRow): WorkspaceConnection {
  return {
    connectionId: row.connection_id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    accountId: row.provider_account_id,
    status: row.status,
    generation: Number(row.generation)
  };
}
async function authorize(
  tx: SqlExecutor, input: WorkspaceAccess, level: "member" | "admin" | "owner"
): Promise<void> {
  const result = await tx.query<MemberRow>(
    `SELECT m.role FROM public.ishikeit_workspace_memberships m
     JOIN public.ishikeit_workspaces w ON w.workspace_id=m.workspace_id
     WHERE m.workspace_id=$1 AND m.auth_issuer=$2 AND m.auth_subject=$3
       AND m.state='active' AND w.state='active'
     FOR SHARE OF m,w`,
    [input.workspaceId, input.issuer, input.subject]
  );
  const role = result.rows[0]?.role;
  if (role === undefined || (level === "owner" && role !== "owner")
    || (level === "admin" && role !== "owner" && role !== "admin")) {
    throw new Error("Workspace authorization denied");
  }
}
async function audit(
  tx: SqlExecutor, connection: WorkspaceConnection, eventType: string,
  actor: WorkspacePrincipal
): Promise<void> {
  await tx.query(
    `INSERT INTO public.ishikeit_connection_audit
       (event_id,workspace_id,connection_id,event_type,actor_issuer,actor_subject)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), connection.workspaceId, connection.connectionId, eventType, actor.issuer, actor.subject]
  );
}
async function readLocked(
  tx: SqlExecutor, workspaceId: string, connectionId: string
): Promise<WorkspaceConnection> {
  const row = await tx.query<ConnectionRow>(
    `SELECT connection_id,workspace_id,provider,provider_account_id,status,generation
       FROM public.ishikeit_account_connections
       WHERE workspace_id=$1 AND connection_id=$2 FOR UPDATE`,
    [workspaceId, connectionId]
  );
  if (row.rows[0] === undefined) throw new Error("Connection is not available in this workspace");
  return present(row.rows[0]);
}

/** Never treat a connection record as a send permit; dynamic provider rights,
 * app approval, recipient consent and provider-specific policy still apply. */
export class PostgresWorkspaceConnectionRegistry {
  constructor(private readonly db: Pick<PostgresDatabase, "query" | "transaction">) {}

  async createWorkspace(input: z.infer<typeof workspaceSchema>): Promise<void> {
    const parsed = workspaceSchema.parse(input);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO public.ishikeit_workspaces(workspace_id,display_name) VALUES($1,$2)`,
        [parsed.workspaceId, parsed.name]
      );
      await tx.query(
        `INSERT INTO public.ishikeit_workspace_memberships
           (workspace_id,auth_issuer,auth_subject,role) VALUES($1,$2,$3,'owner')`,
        [parsed.workspaceId, parsed.owner.issuer, parsed.owner.subject]
      );
    });
  }

  async addMember(
    input: {
      workspaceId: string;
      actor: WorkspacePrincipal;
      member: WorkspacePrincipal;
      role: "owner" | "admin" | "agent" | "viewer";
    }
  ): Promise<void> {
    const p = z.object({
      workspaceId: uuid, actor: principalSchema, member: principalSchema,
      role: z.enum(["owner", "admin", "agent", "viewer"])
    }).strict().parse(input);
    await this.db.transaction(async (tx) => {
      await authorize(tx, { workspaceId: p.workspaceId, ...p.actor }, "owner");
      await tx.query(
        `INSERT INTO public.ishikeit_workspace_memberships
          (workspace_id,auth_issuer,auth_subject,role) VALUES ($1,$2,$3,$4)`,
        [p.workspaceId, p.member.issuer, p.member.subject, p.role]
      );
    });
  }

  async linkVerified(input: z.infer<typeof linkSchema>): Promise<WorkspaceConnection> {
    const p = linkSchema.parse(input);
    const proof = validatedProof(p.proof);
    return this.db.transaction(async (tx) => {
      await authorize(tx, { workspaceId: p.workspaceId, ...p.actor }, "admin");
      await tx.query(
        `INSERT INTO public.ishikeit_provider_accounts
           (provider,provider_account_id,verification_source,verification_reference,verified_at)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (provider,provider_account_id) DO NOTHING`,
        [proof.provider, proof.accountId, proof.source, proof.sourceReference,
          new Date(proof.verifiedAt)]
      );
      const result = await tx.query<ConnectionRow>(
        `INSERT INTO public.ishikeit_account_connections
           (connection_id,workspace_id,provider,provider_account_id,
            provider_application_key,provider_connection_id,credential_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING connection_id,workspace_id,provider,provider_account_id,status,generation`,
        [p.connectionId,p.workspaceId,proof.provider,proof.accountId,p.providerApplicationKey,
          p.providerConnectionId ?? null,p.credentialAccountId ?? null]
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("Connection registry rejected verified link");
      const connection = present(row);
      await audit(tx, connection, "link_verified", p.actor);
      return connection;
    });
  }

  async activateVerified(input: {
    workspaceId: string; connectionId: string; actor: WorkspacePrincipal;
    proof: VerifiedAccountProof;
  }): Promise<WorkspaceConnection> {
    const p = z.object({ ...idAction.shape, proof: proofSchema }).strict().parse(input);
    const proof = validatedProof(p.proof);
    return this.db.transaction(async (tx) => {
      await authorize(tx, { workspaceId: p.workspaceId, ...p.actor }, "admin");
      const previous = await readLocked(tx, p.workspaceId, p.connectionId);
      if (previous.status !== "verifying" || previous.provider !== proof.provider
        || previous.accountId !== proof.accountId) {
        throw new Error("Connection activation requires exact fresh provider identity proof");
      }
      const result = await tx.query<ConnectionRow>(
        `UPDATE public.ishikeit_account_connections
         SET status='connected',generation=generation+1,activated_at=now(),updated_at=now()
         WHERE connection_id=$1 AND workspace_id=$2 AND status='verifying'
         RETURNING connection_id,workspace_id,provider,provider_account_id,status,generation`,
        [p.connectionId,p.workspaceId]
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("Connection activation was not permitted");
      const connected = present(row);
      await audit(tx, connected, "activated", p.actor);
      return connected;
    });
  }

  async pause(input: z.infer<typeof idAction>): Promise<WorkspaceConnection> {
    const p = idAction.parse(input);
    return this.db.transaction(async (tx) => {
      await authorize(tx, { workspaceId: p.workspaceId, ...p.actor }, "admin");
      const previous = await readLocked(tx, p.workspaceId, p.connectionId);
      if (previous.status !== "connected") throw new Error("Connection is not active");
      const result = await tx.query<ConnectionRow>(
        `UPDATE public.ishikeit_account_connections
           SET status='paused',generation=generation+1,updated_at=now()
         WHERE connection_id=$1 AND workspace_id=$2 AND status='connected'
         RETURNING connection_id,workspace_id,provider,provider_account_id,status,generation`,
        [p.connectionId,p.workspaceId]
      );
      const paused = present(result.rows[0]!);
      await audit(tx, paused, "paused", p.actor);
      return paused;
    });
  }

  /** This ONLY fences the new registry. Existing live dispatch still needs a
   * staged, tested registry integration before disconnect is operational.
   * Keep the account claim until audited provider credential cleanup finishes. */
  async requestDisconnect(input: z.infer<typeof idAction>): Promise<WorkspaceConnection> {
    const p = idAction.parse(input);
    return this.db.transaction(async (tx) => {
      await authorize(tx, { workspaceId: p.workspaceId, ...p.actor }, "admin");
      const previous = await readLocked(tx, p.workspaceId, p.connectionId);
      if (previous.status === "disconnecting") return previous;
      if (previous.status === "disconnected") throw new Error("Connection already disconnected");
      const result = await tx.query<ConnectionRow>(
        `UPDATE public.ishikeit_account_connections
         SET status='disconnecting',generation=generation+1,updated_at=now()
         WHERE connection_id=$1 AND workspace_id=$2 AND status<>'disconnected'
         RETURNING connection_id,workspace_id,provider,provider_account_id,status,generation`,
        [p.connectionId,p.workspaceId]
      );
      const disconnected = present(result.rows[0]!);
      await audit(tx, disconnected, "disconnect_requested", p.actor);
      return disconnected;
    });
  }

  /** Internal verified-provider routing lookup only AFTER authenticating the
   * webhook/app source. This function does not authorize sending. */
  async activeProviderAccount(provider: string, providerAccountId: string):
    Promise<WorkspaceConnection | undefined> {
    providerId.parse(provider);
    accountId.parse(providerAccountId);
    const found = await this.db.query<ConnectionRow>(
      `SELECT c.connection_id,c.workspace_id,c.provider,c.provider_account_id,
              c.status,c.generation
         FROM public.ishikeit_account_connections c
         JOIN public.ishikeit_workspaces w ON w.workspace_id=c.workspace_id
        WHERE c.provider=$1 AND c.provider_account_id=$2
          AND c.status='connected' AND w.state='active'`,
      [provider,providerAccountId]
    );
    return found.rows[0] === undefined ? undefined : present(found.rows[0]);
  }

  async readForMember(input: z.infer<typeof idAction>): Promise<WorkspaceConnection | undefined> {
    const p = idAction.parse(input);
    return this.db.transaction(async (tx) => {
      await authorize(tx, { workspaceId: p.workspaceId, ...p.actor }, "member");
      const result = await tx.query<ConnectionRow>(
        `SELECT connection_id,workspace_id,provider,provider_account_id,status,generation
           FROM public.ishikeit_account_connections
          WHERE connection_id=$1 AND workspace_id=$2`,
        [p.connectionId,p.workspaceId]
      );
      return result.rows[0] === undefined ? undefined : present(result.rows[0]);
    });
  }
}
