import { describe, expect, it, vi } from "vitest";
import { ISHIKEIT_DB_SESSION_POOL_MAX, PostgresDatabase } from "../src/persistence/postgres.js";

/**
 * Admin backends are terminated ONLY in the disposable localhost PostgreSQL
 * service used by integration CI and the Phase 1 Docker lab. No production
 * database, customer record or non-test connection is ever accessed.
 */
const connectionString = process.env.PG_OUTBOX_TEST_DATABASE_URL;
if (connectionString !== undefined) {
  const target = new URL(connectionString);
  if ((target.protocol !== "postgres:" && target.protocol !== "postgresql:")
    || !["127.0.0.1", "localhost", "::1"].includes(target.hostname)
    || target.pathname !== "/ishikeit_outbox_test") {
    throw new Error("Refusing PostgreSQL disconnect tests outside the local disposable test DB");
  }
}

describe.skipIf(connectionString === undefined)("PostgreSQL idle connection recovery", () => {
  it("limits overlapping requests to three backend sessions per Node process", async () => {
    // Supabase session-pool cap in the live project was 15, while rolling
    // Hostinger deploys overlap multiple Node processes.
    expect(ISHIKEIT_DB_SESSION_POOL_MAX).toBe(3);
    const app = new PostgresDatabase(connectionString!);
    try {
      const samples = await Promise.all(Array.from({ length: 9 }, async () => {
        const result = await app.query<{ pid: number }>(
          "SELECT pg_backend_pid()::integer AS pid FROM pg_sleep(0.08)"
        );
        return result.rows[0]!.pid;
      }));
      expect(new Set(samples).size).toBeLessThanOrEqual(ISHIKEIT_DB_SESSION_POOL_MAX);
    } finally {
      await app.close();
    }
  });


  it("survives an idle backend termination, records a safe warning, and reconnects", async () => {
    const sqlStates: Array<string | null> = [];
    const app = new PostgresDatabase(connectionString!, (sqlState) => {
      sqlStates.push(sqlState);
      // A monitoring callback must never cause a crash during an outage.
      throw new Error("synthetic broken metrics callback");
    });
    const admin = new PostgresDatabase(connectionString!);
    try {
      const first = await app.query<{ pid: number }>(
        "SELECT pg_backend_pid()::integer AS pid"
      );
      const pid = first.rows[0]!.pid;

      const terminated = await admin.query<{ terminated: boolean }>(
        "SELECT pg_terminate_backend($1::integer) AS terminated", [pid]
      );
      expect(terminated.rows[0]?.terminated).toBe(true);

      await vi.waitFor(() => expect(sqlStates).toHaveLength(1), {
        timeout: 5000,
        interval: 50
      });
      // Only a sanitized SQLSTATE is given to the callback; no raw PG error.
      expect(sqlStates[0] === null || /^[A-Z0-9]{5}$/u.test(sqlStates[0]!)).toBe(true);
      const reconnected = await app.query<{ pid: number; answer: number }>(
        "SELECT pg_backend_pid()::integer AS pid,42::integer AS answer"
      );
      expect(reconnected.rows[0]?.answer).toBe(42);
      expect(reconnected.rows[0]?.pid).not.toBe(pid);
    } finally {
      await app.close();
      await admin.close();
    }
  });

  it("continues without a diagnostic sink after an idle client is removed", async () => {
    const app = new PostgresDatabase(connectionString!);
    const admin = new PostgresDatabase(connectionString!);
    try {
      const first = await app.query<{ pid: number }>(
        "SELECT pg_backend_pid()::integer AS pid"
      );
      const pid = first.rows[0]!.pid;
      const terminated = await admin.query<{ terminated: boolean }>(
        "SELECT pg_terminate_backend($1::integer) AS terminated", [pid]
      );
      expect(terminated.rows[0]?.terminated).toBe(true);
      await vi.waitFor(async () => {
        const next = await app.query<{ pid: number }>(
          "SELECT pg_backend_pid()::integer AS pid"
        );
        expect(next.rows[0]?.pid).not.toBe(pid);
      }, { timeout: 5000, interval: 50 });
    } finally {
      await app.close();
      await admin.close();
    }
  });
});
