import type pg from "pg";
import { metaConversationPartitionKey } from "../channels/meta-normalizer.js";
import type { PostgresDatabase } from "./postgres.js";

export interface MetaHandoffReader {
  isActive(partitionKey: string): Promise<boolean>;
}

export interface MetaRoutingControl {
  blockNativeRouting(partitionKey: string, occurredAt: string): Promise<void>;
  releaseNativeRouting(partitionKey: string, occurredAt: string): Promise<void>;
}

export interface MetaHandoffControl extends MetaHandoffReader {
  release(channel: "messenger" | "instagram" | "whatsapp", accountId: string, identityId: string): Promise<boolean>;
}

interface ActiveRow extends pg.QueryResultRow {
  active: boolean;
}

/**
 * Explicit human handoff blocks AI replies until an authenticated operator
 * releases the exact conversation. Only hashed partition keys are stored.
 */
export class PostgresMetaHandoffStore implements MetaHandoffControl, MetaRoutingControl {
  constructor(private readonly db: PostgresDatabase) {}

  async isActive(partitionKey: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/u.test(partitionKey)) throw new Error("Invalid conversation partition");
    const result = await this.db.query<ActiveRow>(
      `SELECT
        (EXISTS (SELECT 1 FROM public.meta_handoff_blocks
          WHERE partition_key=$1 AND released_at IS NULL
            AND reason<>'native_thread_control_other_app')
        OR EXISTS (SELECT 1 FROM public.meta_native_routing_ownership
          WHERE partition_key=$1 AND owner_state='other_app')) AS active`,
      [partitionKey]
    );
    return result.rows[0]?.active === true;
  }

  /**
   * Apply signed native ownership changes monotonically by provider event time.
   * Equal-timestamp conflict favors "other_app", never an unsafe release.
   * A callback with an unavailable provider time uses its signed ingress time.
   */
  async #applyNativeRouting(
    partitionKey: string,
    occurredAt: string,
    ownerState: "other_app" | "this_app"
  ): Promise<void> {
    if (!/^[a-f0-9]{64}$/u.test(partitionKey)) throw new Error("Invalid conversation partition");
    const eventTime = Date.parse(occurredAt);
    if (!Number.isFinite(eventTime)) {
      throw new Error("Invalid Meta ownership event time");
    }
    await this.db.query(
      `INSERT INTO public.meta_native_routing_ownership
          (partition_key,owner_state,provider_event_at)
       VALUES ($1,$2,$3::timestamptz)
       ON CONFLICT (partition_key) DO UPDATE SET
         owner_state=EXCLUDED.owner_state,
         provider_event_at=EXCLUDED.provider_event_at,
         recorded_at=now()
       WHERE meta_native_routing_ownership.provider_event_at < EXCLUDED.provider_event_at
          OR (meta_native_routing_ownership.provider_event_at = EXCLUDED.provider_event_at
            AND EXCLUDED.owner_state='other_app')`,
      [partitionKey, ownerState, new Date(eventTime)]
    );
  }

  blockNativeRouting(partitionKey: string, occurredAt: string): Promise<void> {
    return this.#applyNativeRouting(partitionKey, occurredAt, "other_app");
  }

  releaseNativeRouting(partitionKey: string, occurredAt: string): Promise<void> {
    return this.#applyNativeRouting(partitionKey, occurredAt, "this_app");
  }

  async release(
    channel: "messenger" | "instagram" | "whatsapp",
    accountId: string,
    identityId: string
  ): Promise<boolean> {
    const key = metaConversationPartitionKey(channel, accountId, identityId);
    const result = await this.db.query(
      "UPDATE public.meta_handoff_blocks SET released_at=now() WHERE partition_key=$1 AND released_at IS NULL AND reason <> 'native_thread_control_other_app' RETURNING partition_key",
      [key]
    );
    return result.rowCount === 1;
  }
}
