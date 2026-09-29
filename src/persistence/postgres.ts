import pg from "pg";
const { Pool } = pg;

export type SqlValue = string | number | boolean | Date | Buffer | null;
export interface SqlExecutor {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: readonly SqlValue[]): Promise<pg.QueryResult<T>>;
}

interface ReadinessRow extends pg.QueryResultRow {
  inbound_events: boolean;
  outbox: boolean;
}

export class PostgresDatabase {
  readonly #pool: pg.Pool;
  constructor(connectionString: string) {
    this.#pool = new Pool({ connectionString, max:10, idleTimeoutMillis:30000, connectionTimeoutMillis:5000 });
  }
  async ready(): Promise<boolean> {
    try {
      const result = await this.#pool.query<ReadinessRow>(
        "SELECT to_regclass('public.inbound_events') IS NOT NULL AS inbound_events, to_regclass('public.outbox') IS NOT NULL AS outbox"
      );
      const row = result.rows[0];
      return row?.inbound_events === true && row.outbox === true;
    } catch {
      return false;
    }
  }
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: readonly SqlValue[]) {
    return this.#pool.query<T>(text, values === undefined ? undefined : [...values]);
  }
  async transaction<T>(work:(executor:SqlExecutor)=>Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try { await client.query("BEGIN"); const result=await work(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async close(): Promise<void> { await this.#pool.end(); }
}
