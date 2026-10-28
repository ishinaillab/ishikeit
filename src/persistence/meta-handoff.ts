import type pg from "pg";
import { metaConversationPartitionKey } from "../channels/meta-normalizer.js";
import type { PostgresDatabase } from "./postgres.js";

export interface MetaHandoffReader {
  isActive(partitionKey: string): Promise<boolean>;
}

export interface MetaRoutingControl {
  blockNativeRouting(partitionKey: string): Promise<void>;
  releaseNativeRouting(partitionKey: string): Promise<void>;
}

export interface MetaHandoffControl extends MetaHandoffReader, MetaRoutingControl {
  release(channel: "messenger" | "instagram" | "whatsapp", accountId: string, identityId: string): Promise<boolean>;
}

interface ActiveRow extends pg.QueryResultRow {
  active: boolean;
}

/**
 * Explicit human handoff blocks AI replies until an authenticated operator
 * releases the exact conversation. Only hashed partition keys are stored.
 */
export class PostgresMetaHandoffStore implements MetaHandoffControl {
  constructor(private readonly db: PostgresDatabase) {}

  async isActive(partitionKey: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/u.test(partitionKey)) throw new Error("Invalid conversation partition");
    const result = await this.db.query<ActiveRow>(
      "SELECT EXISTS (SELECT 1 FROM public.meta_handoff_blocks WHERE partition_key=$1 AND released_at IS NULL) AS active",
      [partitionKey]
    );
    return result.rows[0]?.active === true;
  }

  async blockNativeRouting(partitionKey: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/u.test(partitionKey)) throw new Error("Invalid conversation partition");
    // Never overwrite an active AI-requested human handoff.
    await this.db.query(
      `INSERT INTO public.meta_handoff_blocks(partition_key,reason,opened_at,released_at)
       VALUES ($1,'native_thread_control_other_app',now(),NULL)
       ON CONFLICT(partition_key) DO UPDATE SET
         reason='native_thread_control_other_app',
         opened_at=now(),released_at=NULL
       WHERE meta_handoff_blocks.released_at IS NOT NULL
          OR meta_handoff_blocks.reason='native_thread_control_other_app'`,
      [partitionKey]
    );
  }

  async releaseNativeRouting(partitionKey: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/u.test(partitionKey)) throw new Error("Invalid conversation partition");
    // Releasing native ownership must NEVER release an AI-to-human handoff.
    await this.db.query(
      `UPDATE public.meta_handoff_blocks
       SET released_at=now()
       WHERE partition_key=$1
         AND reason='native_thread_control_other_app'
         AND released_at IS NULL`,
      [partitionKey]
    );
  }

  async release(
    channel: "messenger" | "instagram" | "whatsapp",
    accountId: string,
    identityId: string
  ): Promise<boolean> {
    const key = metaConversationPartitionKey(channel, accountId, identityId);
    const result = await this.db.query(
      "UPDATE public.meta_handoff_blocks SET released_at=now() WHERE partition_key=$1 AND released_at IS NULL RETURNING partition_key",
      [key]
    );
    return result.rowCount === 1;
  }
}
