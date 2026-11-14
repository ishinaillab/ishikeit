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
  // Exactly-once proof that this owner/admin completed the correct browser
  // session-bound authorization intent. Does NOT by itself attest provider API.
  intentId: uuid,
  sessionId: uuid,
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
/** Activation must attest the exact provider app/connection/credential binding
 * already recorded at link time, not merely the provider user/account ID.
 * These values MUST originate from server-trusted provider readback. */
const activationSchema = z.object({
  ...idAction.shape,
  proof: proofSchema,
  providerApplicationKey: shortRef,
  providerConnectionId: accountId.optional(),
  credentialAccountId: accountId.optional()
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
/** Browser-facing account inventory: no token, app secret, credential reference,
 * provider proof internals or tenant-unrelated rows ever leave the BFF. */
export interface WorkspaceConnectionPage {
  items: readonly WorkspaceConnection[];
  nextCursor?: string;
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
interface ClaimIntentRow extends pg.QueryResultRow { intent_id: string }
interface BindingRow extends pg.QueryResultRow {
  provider_application_key: string;
  provider_connection_id: string | null;
  credential_account_id: string | null;
}
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

  /** Optional server-only writer runs in the SAME registry/intent claim
   * transaction. If encrypted grant persistence fails, neither ownership
   * nor its consumed-intent claim can commit. Never call provider HTTP here.
   */
  async linkVerified(
    input: z.infer<typeof linkSchema>,
    persistEncryptedGrant?: (tx:SqlExecutor)=>Promise<void>
  ): Promise<WorkspaceConnection> {
    const p = linkSchema.parse(input);
    const proof = validatedProof(p.proof);
    return this.db.transaction(async (tx) => {
      await authorize(tx, { workspaceId: p.workspaceId, ...p.actor }, "admin");
      // PostgreSQL locks this private intent row for the entire transaction.
      // A consumed state is necessary, not sufficient: exact app, tenant,
      // principal, session and unexpired unclaimed state must all match.
      const eligible = await tx.query<ClaimIntentRow>(
        `SELECT intent_id FROM public.ishikeit_connection_intents
          WHERE intent_id=$1 AND workspace_id=$2
            AND actor_issuer=$3 AND actor_subject=$4
            AND auth_session_id=$5 AND provider=$6 AND provider_application_key=$7
            AND consumed_at IS NOT NULL AND consumed_at <= now()
            AND expires_at > now() AND claimed_connection_id IS NULL
          FOR UPDATE`,
        [p.intentId,p.workspaceId,p.actor.issuer,p.actor.subject,p.sessionId,
          proof.provider,p.providerApplicationKey]
      );
      if (eligible.rowCount !== 1) {
        throw new Error("Connection claim requires an unused session-bound authorization intent");
      }
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
      if(persistEncryptedGrant!==undefined) await persistEncryptedGrant(tx);
      const claimed = await tx.query(
        `UPDATE public.ishikeit_connection_intents
            SET claimed_connection_id=$2,claimed_at=now()
          WHERE intent_id=$1 AND claimed_connection_id IS NULL
          RETURNING intent_id`,
        [p.intentId,p.connectionId]
      );
      if (claimed.rowCount !== 1) {
        throw new Error("Connection authorization intent was already claimed");
      }
      await audit(tx, connection, "link_verified", p.actor);
      return connection;
    });
  }

  async activateVerified(input: z.infer<typeof activationSchema>): Promise<WorkspaceConnection> {
    const p = activationSchema.parse(input);
    const proof = validatedProof(p.proof);
    return this.db.transaction(async (tx) => {
      await authorize(tx, { workspaceId: p.workspaceId, ...p.actor }, "admin");
      const previous = await readLocked(tx, p.workspaceId, p.connectionId);
      if (previous.status !== "verifying" || previous.provider !== proof.provider
        || previous.accountId !== proof.accountId) {
        throw new Error("Connection activation requires exact fresh provider identity proof");
      }
      // readLocked() holds a row FOR UPDATE for this entire transaction.
      // Require the fresh provider readback to match the original application,
      // provider connection and credential subject, not just a shared user ID.
      // Exact nullable matching prevents silently stripping a binding.
      const binding = await tx.query<BindingRow>(
        `SELECT provider_application_key,provider_connection_id,credential_account_id
           FROM public.ishikeit_account_connections
          WHERE workspace_id=$1 AND connection_id=$2`,
        [p.workspaceId,p.connectionId]
      );
      const original = binding.rows[0];
      if (original === undefined
        || original.provider_application_key !== p.providerApplicationKey
        || original.provider_connection_id !== (p.providerConnectionId ?? null)
        || original.credential_account_id !== (p.credentialAccountId ?? null)) {
        throw new Error("Connection activation requires exact fresh provider binding proof");
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

  /**
   * Telegram OIDC ownership and its Bot API Business permission are separate
   * provider proofs. Only the trusted server coordinator may call this after
   * Telegram getBusinessConnection returns the EXACT OIDC subject.
   * The caller rechecks fresh AAL2 and membership; the SQL transaction
   * independently fences account ownership, original app and current role.
   */
  async activateTelegramBusiness(input:{
    workspaceId:string;connectionId:string;actor:WorkspacePrincipal;
    providerApplicationKey:string;ownerId:string;
    businessConnectionId:string;verifiedAt:string
  }):Promise<WorkspaceConnection>{
    const p=z.object({
      workspaceId:uuid,connectionId:uuid,actor:principalSchema,
      providerApplicationKey:shortRef,ownerId:accountId,
      businessConnectionId:accountId,
      verifiedAt:z.iso.datetime({offset:true})
    }).strict().parse(input);
    const at=Date.parse(p.verifiedAt);
    if(!Number.isFinite(at)||at>Date.now()+120000||at<Date.now()-900000)
      throw new Error("Fresh Telegram Business provider readback required");
    return this.db.transaction(async tx=>{
      await authorize(tx,{workspaceId:p.workspaceId,...p.actor},"admin");
      const previous=await readLocked(tx,p.workspaceId,p.connectionId);
      if(previous.status!=="verifying"||previous.provider!=="telegram"||
        previous.accountId!==p.ownerId)
        throw new Error("Telegram OIDC owner verification mismatch");
      const binding=await tx.query<BindingRow>(
        `SELECT provider_application_key,provider_connection_id,credential_account_id
           FROM public.ishikeit_account_connections
          WHERE workspace_id=$1 AND connection_id=$2`,
        [p.workspaceId,p.connectionId]
      );
      const orig=binding.rows[0];
      if(orig===undefined||
        orig.provider_application_key!==p.providerApplicationKey||
        orig.provider_connection_id!==null||
        orig.credential_account_id!==null)
        throw new Error("Telegram business binding has changed");
      // Uniqueness of (provider,provider_connection_id) and of immutable
      // account owner is enforced by PostgreSQL (including paused links).
      const result=await tx.query<ConnectionRow>(
        `UPDATE public.ishikeit_account_connections
           SET provider_connection_id=$3,status='connected',
               generation=generation+1,activated_at=now(),updated_at=now()
          WHERE connection_id=$1 AND workspace_id=$2
            AND provider='telegram' AND provider_account_id=$4
            AND provider_connection_id IS NULL AND credential_account_id IS NULL
            AND status='verifying'
          RETURNING connection_id,workspace_id,provider,provider_account_id,status,generation`,
        [p.connectionId,p.workspaceId,p.businessConnectionId,p.ownerId]
      );
      const row=result.rows[0];
      if(row===undefined)throw new Error("Telegram business activation not permitted");
      const activated=present(row);
      await audit(tx,activated,"activated",p.actor);
      return activated;
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

  /** Read-only Channels inventory for an authenticated workspace owner/admin.
   * Revalidates the ACTIVE membership and workspace in the SAME transaction
   * as its bounded tenant-scoped query. No trust in a caller-supplied role.
   * This is an inventory only, never a proof of account/grant rights or
   * authorization to dispatch a message.
   */
  async listForAdministrator(input: {
    workspaceId: string;
    actor: WorkspacePrincipal;
    after?: string;
    pageSize?: number;
  }): Promise<WorkspaceConnectionPage> {
    const p = z.object({
      workspaceId: uuid, actor: principalSchema,
      after: uuid.optional(),
      pageSize: z.number().int().min(1).max(50).default(20)
    }).strict().parse(input);
    return this.db.transaction(async (tx) => {
      await authorize(tx, { workspaceId: p.workspaceId, ...p.actor }, "admin");
      const result = await tx.query<ConnectionRow>(
        `SELECT connection_id,workspace_id,provider,provider_account_id,status,generation
           FROM public.ishikeit_account_connections
          WHERE workspace_id=$1
            AND ($2::uuid IS NULL OR connection_id > $2::uuid)
          ORDER BY connection_id ASC
          LIMIT $3`,
        [p.workspaceId, p.after ?? null, p.pageSize + 1]
      );
      const items = result.rows.slice(0, p.pageSize).map(present);
      return result.rows.length > p.pageSize
        ? { items, nextCursor: items[items.length - 1]!.connectionId }
        : { items };
    });
  }

  /** Server-only private exact connection lookup. Revalidates owner/admin
   * membership in the same PostgreSQL transaction; never leaks token refs.
   */
  async findForAdministrator(input:z.infer<typeof idAction>):
    Promise<WorkspaceConnection|undefined>{
    const p=idAction.parse(input);
    return this.db.transaction(async tx=>{
      await authorize(tx,{workspaceId:p.workspaceId,...p.actor},"admin");
      const result=await tx.query<ConnectionRow>(
        `SELECT connection_id,workspace_id,provider,provider_account_id,status,generation
           FROM public.ishikeit_account_connections
          WHERE connection_id=$1 AND workspace_id=$2`,
        [p.connectionId,p.workspaceId]
      );
      return result.rows[0]===undefined?undefined:present(result.rows[0]);
    });
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
