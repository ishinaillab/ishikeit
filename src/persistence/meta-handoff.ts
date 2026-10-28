import type pg from "pg";
import { metaConversationPartitionKey } from "../channels/meta-normalizer.js";
import type { PostgresDatabase } from "./postgres.js";

export interface MetaHandoffReader {
  isActive(partitionKey: string): Promise<boolean>;
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
