import type pg from "pg";
import type { CanonicalEvent, IngressIdentity } from "../domain/events.js";
import type { InboundStore } from "./inbound.js";
import type { PostgresDatabase } from "./postgres.js";

/**
 * Issue #230: observational ONLY. This result is never an authorization,
 * credential-selection, webhook-acceptance, AI-routing or send decision.
 * A signed inbound event identifies its provider source, but does not prove
 * which Ishikeit workspace requested or owns the provider connection.
 */
export type ShadowRoutingDecision =
  | "candidate_active"
  | "inactive"
  | "unclaimed"
  | "ambiguous"
  | "identity_unresolved"
  | "lookup_unavailable";

export interface ShadowRoutingObservation {
  provider: string;
  channel: string;
  decision: ShadowRoutingDecision;
}

type ShadowEvent = Pick<CanonicalEvent, "provider" | "channel" | "accountId">;
interface Candidate { provider: string; accountId: string }
interface ShadowRow extends pg.QueryResultRow {
  status: string;
  workspace_state: string;
}

/**
 * Meta's canonical provider is "meta", whereas verified registry ownership
 * is scoped to each actual product/account namespace. No handle/username
 * normalization, recipient inference or cross-provider fallback is allowed.
 *
 * Telegram's normalizer intentionally uses the BOT id even for Business
 * messages. Only an authenticated getBusinessConnection readback supplies
 * the Business owner's immutable user id; mapping the bot id here would
 * wrongly attribute multiple Business accounts to one workspace.
 */
export function shadowAccountCandidate(event: ShadowEvent): Candidate | undefined {
  const accountId = event.accountId;
  if (accountId.length < 1 || accountId.length > 256) return undefined;
  if (event.provider === "meta"
    && (event.channel === "instagram" || event.channel === "messenger"
      || event.channel === "whatsapp")) {
    return { provider: event.channel, accountId };
  }
  if (event.provider === "tiktok" && event.channel === "business") {
    return { provider: "tiktok", accountId };
  }
  return undefined;
}

export class PostgresWorkspaceShadowInspector {
  constructor(private readonly db: Pick<PostgresDatabase, "query">) {}

  async inspect(event: ShadowEvent): Promise<ShadowRoutingDecision> {
    const candidate = shadowAccountCandidate(event);
    if (candidate === undefined) return "identity_unresolved";

    // Read-only comparison against the private registry, not a routing lookup.
    // The partial unique index permits at most one non-disconnected claim;
    // refuse a confident match if the invariant is ever violated.
    const result = await this.db.query<ShadowRow>(
      `SELECT c.status,w.state AS workspace_state
       FROM public.ishikeit_account_connections c
       JOIN public.ishikeit_workspaces w ON w.workspace_id=c.workspace_id
       WHERE c.provider=$1 AND c.provider_account_id=$2
         AND c.status <> 'disconnected'
       LIMIT 2`,
      [candidate.provider, candidate.accountId]
    );
    if (result.rows.length > 1) return "ambiguous";
    const claim = result.rows[0];
    if (claim === undefined) return "unclaimed";
    return claim.status === "connected" && claim.workspace_state === "active"
      ? "candidate_active"
      : "inactive";
  }
}

/**
 * Optional telemetry decorator. The established signed-webhook ingestion
 * commits first; only newly-created events are observed. Shadow work runs
 * separately and cannot delay or reject the webhook, modify event records,
 * call the AI, choose a workspace, or affect the outbound queue.
 *
 * Callbacks receive ONLY bounded status and provider/channel categories,
 * never an account ID, message, customer, raw payload, or tenant identifier.
 */
export class ShadowWorkspaceInboundStore implements InboundStore {
  constructor(
    private readonly live: InboundStore,
    private readonly inspector: Pick<PostgresWorkspaceShadowInspector, "inspect">,
    private readonly record: (observation: ShadowRoutingObservation) => void
  ) {}

  async ingest(
    event: CanonicalEvent, identity: IngressIdentity, rawBodyHash: string
  ): Promise<"created" | "duplicate"> {
    const outcome = await this.live.ingest(event, identity, rawBodyHash);
    if (outcome === "created") {
      const emit = (decision: ShadowRoutingDecision) => {
        try {
          this.record({ provider: event.provider, channel: event.channel, decision });
        } catch {
          // Observability must never change existing messaging delivery.
        }
      };
      void this.inspector.inspect({
        provider: event.provider, channel: event.channel, accountId: event.accountId
      }).then(
        (decision) => emit(decision),
        () => emit("lookup_unavailable")
      );
    }
    return outcome;
  }
}
