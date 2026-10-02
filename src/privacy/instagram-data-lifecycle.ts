import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { OAuthCredentialStore } from "../auth/oauth-store.js";
import type { PostgresDatabase } from "../persistence/postgres.js";

export type DataDeletionStatus = "processing" | "completed" | "failed";

export interface InstagramDataLifecycle {
  ready(): Promise<boolean>;
  deauthorize(accountId: string): Promise<void>;
  requestDeletion(
    accountId: string,
    statusBaseUrl: string
  ): Promise<{ confirmationCode: string; statusUrl: string }>;
  deletionStatus(confirmationCode: string): Promise<{
    status: DataDeletionStatus;
    requestedAt: string;
    completedAt?: string;
  } | undefined>;
}

interface DeletionRow extends pg.QueryResultRow {
  status: DataDeletionStatus;
  requested_at: Date;
  completed_at: Date | null;
}
export class PostgresInstagramDataLifecycle implements InstagramDataLifecycle {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly oauthStore: OAuthCredentialStore
  ) {}

  async ready(): Promise<boolean> {
    try {
      const result = await this.db.query<{ ready: boolean } & pg.QueryResultRow>(
        `SELECT to_regclass('public.oauth_data_deletion_requests') IS NOT NULL AS ready`
      );
      return result.rows[0]?.ready === true;
    } catch {
      return false;
    }
  }

  deauthorize(accountId: string): Promise<void> {
    return this.oauthStore.revoke("instagram", accountId, "deauthorized");
  }

  async requestDeletion(
    accountId: string,
    statusBaseUrl: string
  ): Promise<{ confirmationCode: string; statusUrl: string }> {
    const confirmationCode = randomBytes(18).toString("hex");
    const statusUrl = new URL(
      `/ishikeit/privacy/data-deletion/status/${confirmationCode}`,
      statusBaseUrl
    ).toString();

    await this.db.query(
      `INSERT INTO oauth_data_deletion_requests
       (confirmation_code,provider,account_id,status)
       VALUES ($1,'instagram',$2,'processing')`,
      [confirmationCode, accountId]
    );
    try {
      await this.oauthStore.revoke("instagram", accountId, "data_deletion");
      const details = await this.db.transaction(async (tx) => {
        const attempts = await tx.query(
          `DELETE FROM outbox_attempts
           WHERE outbox_id IN (
             SELECT o.id
             FROM outbox o
             WHERE (o.payload->'target'->>'channel'='instagram'
                    AND o.payload->'target'->>'accountId'=$1)
                OR EXISTS (
                  SELECT 1 FROM inbound_events i
                  WHERE i.id::text=o.payload->>'eventId'
                    AND i.provider='meta'
                    AND i.channel='instagram'
                    AND i.account_id=$1
                )
           )`,
          [accountId]
        );

        const outbox = await tx.query(
          `DELETE FROM outbox o
           WHERE (o.payload->'target'->>'channel'='instagram'
                  AND o.payload->'target'->>'accountId'=$1)
              OR EXISTS (
                SELECT 1 FROM inbound_events i
                WHERE i.id::text=o.payload->>'eventId'
                  AND i.provider='meta'
                  AND i.channel='instagram'
                  AND i.account_id=$1
              )`,
          [accountId]
        );

        const inbound = await tx.query(
          `DELETE FROM inbound_events
           WHERE provider='meta'
             AND channel='instagram'
             AND account_id=$1`,
          [accountId]
        );

        return {
          inboundEvents: inbound.rowCount ?? 0,
          outboxRows: outbox.rowCount ?? 0,
          outboxAttempts: attempts.rowCount ?? 0
        };
      });

      await this.db.query(
        `UPDATE oauth_data_deletion_requests
         SET status='completed', completed_at=now(), details=$2::jsonb
         WHERE confirmation_code=$1`,
        [confirmationCode, JSON.stringify(details)]
      );
      return { confirmationCode, statusUrl };
    } catch (error) {
      await this.db.query(
        `UPDATE oauth_data_deletion_requests
         SET status='failed',
             details=jsonb_build_object('reason','internal_error')
         WHERE confirmation_code=$1`,
        [confirmationCode]
      ).catch(() => undefined);
      throw error;
    }
  }

  async deletionStatus(confirmationCode: string) {
    const result = await this.db.query<DeletionRow>(
      `SELECT status,requested_at,completed_at
       FROM oauth_data_deletion_requests
       WHERE confirmation_code=$1`,
      [confirmationCode]
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      status: row.status,
      requestedAt: row.requested_at.toISOString(),
      ...(row.completed_at === null
        ? {}
        : { completedAt: row.completed_at.toISOString() })
    };
  }
}
