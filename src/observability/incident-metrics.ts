import type pg from "pg";
import type { PostgresDatabase } from "../persistence/postgres.js";
import type { OperationalAlertInput } from "./operational-alerts.js";
import type { OperationalMetricsSnapshot } from "./operational-metrics.js";

/**
 * Only data required for the periodic operator incident scanner. Never call the
 * more expensive full metrics snapshot here: that endpoint also calculates
 * receipt correlation, percentiles and unrelated dashboard breakdowns.
 */
export interface IncidentMetricsSnapshot extends OperationalAlertInput {
  attempts: {
    byRoute: Array<Pick<OperationalMetricsSnapshot["attempts"]["byRoute"][number], "provider" | "httpStatus" | "count"> & Partial<OperationalMetricsSnapshot["attempts"]["byRoute"][number]>>;
  };
}

interface InboundRow extends pg.QueryResultRow {
  failed_current: string;
}
interface QueueRow extends pg.QueryResultRow {
  topic: string;
  pending: string;
  oldest_pending_ms: number | string | null;
  dead_letter_total: string;
  dead_letter_window: string;
}
interface ThrottleRow extends pg.QueryResultRow {
  throttle_count: string;
}

export class PostgresIncidentMetricsReader {
  constructor(private readonly db: PostgresDatabase) {}

  async snapshot(windowMinutes: number): Promise<IncidentMetricsSnapshot> {
    if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 1440) {
      throw new Error("incident snapshot requires a bounded window");
    }
    const [inbound, queue, throttle] = await Promise.all([
      this.db.query<InboundRow>(
        `SELECT count(*)::bigint AS failed_current
         FROM public.inbound_events
         WHERE received_at >= now() - make_interval(mins => $1)
           AND status = 'failed' AND processed_at IS NULL`,
        [windowMinutes]
      ),
      this.db.query<QueueRow>(
        `SELECT topic,
           count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL)::bigint AS pending,
           max(extract(epoch FROM (now() - created_at)) * 1000)
             FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL) AS oldest_pending_ms,
           count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::bigint AS dead_letter_total,
           count(*) FILTER (WHERE dead_lettered_at >= now() - make_interval(mins => $1))::bigint AS dead_letter_window
         FROM public.outbox
         WHERE topic IN ('inbound.event.accepted', 'action.dispatch')
         GROUP BY topic
         ORDER BY topic`,
        [windowMinutes]
      ),
      this.db.query<ThrottleRow>(
        `SELECT count(*)::bigint AS throttle_count
         FROM public.outbox_attempts
         WHERE occurred_at >= now() - make_interval(mins => $1)
           AND provider = 'meta' AND http_status = 429`,
        [windowMinutes]
      )
    ]);
    return {
      generatedAt: new Date().toISOString(),
      windowMinutes,
      inbound: { failedCurrent: Number(inbound.rows[0]?.failed_current ?? 0) },
      queue: queue.rows.map(row => ({
        topic: row.topic,
        pending: Number(row.pending),
        oldestPendingMs: row.oldest_pending_ms === null ? null : Number(row.oldest_pending_ms),
        deadLetterTotal: Number(row.dead_letter_total),
        deadLettersInWindow: Number(row.dead_letter_window)
      })),
      attempts: {
        byRoute: Number(throttle.rows[0]?.throttle_count ?? 0) > 0
          ? [{ provider: "meta", httpStatus: 429, count: Number(throttle.rows[0]?.throttle_count) }]
          : []
      }
    };
  }
}
