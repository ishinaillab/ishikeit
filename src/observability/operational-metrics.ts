import type pg from "pg";
import type { PostgresDatabase } from "../persistence/postgres.js";

interface InboundSummaryRow extends pg.QueryResultRow {
  received_count: string;
  processed_count: string;
  failed_current: string;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
}

interface QueueRow extends pg.QueryResultRow {
  topic: string;
  pending: string;
  oldest_pending_ms: number | null;
}

interface AttemptRow extends pg.QueryResultRow {
  topic: string;
  provider: string | null;
  capability: string | null;
  operation: string | null;
  outcome: "published" | "retry" | "dead_letter";
  error_class: string | null;
  http_status: number | null;
  provider_code: string | null;
  count: string;
}
export interface OperationalMetricsSnapshot {
  generatedAt: string;
  windowMinutes: number;
  inbound: {
    received: number;
    processed: number;
    failedCurrent: number;
    processingLatencyMs: {
      p50: number | null;
      p95: number | null;
      max: number | null;
    };
  };
  queue: Array<{
    topic: string;
    pending: number;
    oldestPendingMs: number | null;
  }>;
  attempts: {
    published: number;
    retries: number;
    deadLetters: number;
    byRoute: Array<{
      topic: string;
      provider: string | null;
      capability: string | null;
      operation: string | null;
      outcome: "published" | "retry" | "dead_letter";
      errorClass: string | null;
      httpStatus: number | null;
      providerCode: string | null;
      count: number;
    }>;
  };
}
function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

export interface OperationalMetricsReader {
  snapshot(windowMinutes: number): Promise<OperationalMetricsSnapshot>;
}

export class PostgresOperationalMetrics implements OperationalMetricsReader {
  constructor(private readonly db: PostgresDatabase) {}

  async snapshot(windowMinutes: number): Promise<OperationalMetricsSnapshot> {
    const [inbound, queue, attempts] = await Promise.all([
      this.db.query<InboundSummaryRow>(
        `SELECT
           count(*)::bigint AS received_count,
           count(*) FILTER (WHERE processed_at IS NOT NULL)::bigint AS processed_count,
           count(*) FILTER (WHERE status = 'failed' AND processed_at IS NULL)::bigint AS failed_current,
           percentile_cont(0.50) WITHIN GROUP (
             ORDER BY extract(epoch FROM (processed_at - received_at)) * 1000
           ) FILTER (WHERE processed_at IS NOT NULL) AS p50_ms,
           percentile_cont(0.95) WITHIN GROUP (
             ORDER BY extract(epoch FROM (processed_at - received_at)) * 1000
           ) FILTER (WHERE processed_at IS NOT NULL) AS p95_ms,
           max(extract(epoch FROM (processed_at - received_at)) * 1000)
             FILTER (WHERE processed_at IS NOT NULL) AS max_ms
         FROM inbound_events
         WHERE received_at >= now() - make_interval(mins => $1)`,
        [windowMinutes]
      ),
      this.db.query<QueueRow>(
        `SELECT
           topic,
           count(*) FILTER (
             WHERE published_at IS NULL AND dead_lettered_at IS NULL
           )::bigint AS pending,
           max(extract(epoch FROM (now() - created_at)) * 1000)
             FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL)
             AS oldest_pending_ms
         FROM outbox
         GROUP BY topic
         ORDER BY topic`
      ),
      this.db.query<AttemptRow>(
        `SELECT
           topic, provider, capability, operation, outcome,
           error_class, http_status, provider_code,
           count(*)::bigint AS count
         FROM outbox_attempts
         WHERE occurred_at >= now() - make_interval(mins => $1)
         GROUP BY topic, provider, capability, operation, outcome,
                  error_class, http_status, provider_code
         ORDER BY topic, provider NULLS LAST, capability NULLS LAST,
                  operation NULLS LAST, outcome, error_class NULLS LAST`,
        [windowMinutes]
      )
    ]);

    const summary = inbound.rows[0];
    if (summary === undefined) throw new Error("operational metrics query returned no inbound summary");
    const byRoute = attempts.rows.map((row) => ({
      topic: row.topic,
      provider: row.provider,
      capability: row.capability,
      operation: row.operation,
      outcome: row.outcome,
      errorClass: row.error_class,
      httpStatus: row.http_status,
      providerCode: row.provider_code,
      count: Number(row.count)
    }));

    const outcomeCount = (outcome: AttemptRow["outcome"]) =>
      byRoute
        .filter((row) => row.outcome === outcome)
        .reduce((sum, row) => sum + row.count, 0);

    return {
      generatedAt: new Date().toISOString(),
      windowMinutes,
      inbound: {
        received: Number(summary.received_count),
        processed: Number(summary.processed_count),
        failedCurrent: Number(summary.failed_current),
        processingLatencyMs: {
          p50: nullableNumber(summary.p50_ms),
          p95: nullableNumber(summary.p95_ms),
          max: nullableNumber(summary.max_ms)
        }
      },
      queue: queue.rows.map((row) => ({
        topic: row.topic,
        pending: Number(row.pending),
        oldestPendingMs: nullableNumber(row.oldest_pending_ms)
      })),
      attempts: {
        published: outcomeCount("published"),
        retries: outcomeCount("retry"),
        deadLetters: outcomeCount("dead_letter"),
        byRoute
      }
    };
  }
}
