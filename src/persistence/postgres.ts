import pg from "pg";
const { Pool } = pg;

export type SqlValue = string | number | boolean | Date | Buffer | readonly string[] | null;

export interface SqlExecutor {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly SqlValue[]
  ): Promise<pg.QueryResult<T>>;
}

interface ReadinessRow extends pg.QueryResultRow {
  inbound_events: boolean;
  outbox: boolean;
  outbox_attempts: boolean;
  meta_send_fence: boolean;
  provider: boolean;
  capability: boolean;
  last_error: boolean;
  partition_key: boolean;
  processing_outcome: boolean;
  handoff_reason: boolean;
  meta_handoff_blocks: boolean;
  meta_native_routing_ownership: boolean;
  meta_whatsapp_opt_ins: boolean;
  meta_whatsapp_opt_outs: boolean;
  latepoint_booking_states: boolean;
  latepoint_reminder_slots: boolean;
}

export class PostgresDatabase {
  readonly #pool: pg.Pool;

  constructor(connectionString: string) {
    this.#pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }

  async ready(): Promise<boolean> {
    try {
      const result = await this.#pool.query<ReadinessRow>(
        `SELECT
           to_regclass('public.inbound_events') IS NOT NULL AS inbound_events,
           to_regclass('public.outbox') IS NOT NULL AS outbox,
           to_regclass('public.outbox_attempts') IS NOT NULL AS outbox_attempts,
           EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema='public'
               AND table_name='outbox'
               AND column_name='meta_send_started_at'
           ) AS meta_send_fence,
           to_regclass('public.meta_handoff_blocks') IS NOT NULL AS meta_handoff_blocks,
           to_regclass('public.meta_native_routing_ownership') IS NOT NULL AS meta_native_routing_ownership,
           to_regclass('public.meta_whatsapp_template_opt_ins') IS NOT NULL AS meta_whatsapp_opt_ins,
           to_regclass('public.meta_whatsapp_template_opt_outs') IS NOT NULL AS meta_whatsapp_opt_outs,
           to_regclass('public.latepoint_booking_states') IS NOT NULL AS latepoint_booking_states,
           to_regclass('public.latepoint_reminder_slots') IS NOT NULL AS latepoint_reminder_slots,
           EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema='public'
               AND table_name='inbound_events'
               AND column_name='provider'
           ) AS provider,
           EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema='public'
               AND table_name='inbound_events'
               AND column_name='capability'
           ) AS capability,
           EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema='public'
               AND table_name='inbound_events'
               AND column_name='last_error'
           ) AS last_error,
           EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema='public'
               AND table_name='inbound_events'
               AND column_name='partition_key'
           ) AS partition_key,
           EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema='public'
               AND table_name='inbound_events'
               AND column_name='processing_outcome'
           ) AS processing_outcome,
           EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema='public'
               AND table_name='inbound_events'
               AND column_name='handoff_reason'
           ) AS handoff_reason`
      );

      const row = result.rows[0];
      return row?.inbound_events === true
        && row.outbox === true
        && row.outbox_attempts === true
        && row.meta_send_fence === true
        && row.provider === true
        && row.capability === true
        && row.last_error === true
        && row.partition_key === true
        && row.processing_outcome === true
        && row.handoff_reason === true
        && row.meta_handoff_blocks === true
        && row.meta_native_routing_ownership === true
        && row.meta_whatsapp_opt_ins === true
        && row.meta_whatsapp_opt_outs === true
        && row.latepoint_booking_states === true
        && row.latepoint_reminder_slots === true;
    } catch {
      return false;
    }
  }

  async assertReady(): Promise<void> {
    if (!await this.ready()) {
      throw new Error("database schema is not ready for this Ishikeit version");
    }
  }

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly SqlValue[]
  ) {
    return this.#pool.query<T>(text, values === undefined ? undefined : [...values]);
  }

  async transaction<T>(work: (executor: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async withAdvisoryLock<T>(lockName: string, work: () => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    let locked = false;
    try {
      await client.query(
        "SELECT pg_advisory_lock(hashtextextended($1::text, 0))",
        [lockName]
      );
      locked = true;
      return await work();
    } finally {
      try {
        if (locked) {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1::text, 0))",
            [lockName]
          );
        }
      } finally {
        client.release();
      }
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
