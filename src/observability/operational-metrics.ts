import type pg from "pg";
import type { PostgresDatabase } from "../persistence/postgres.js";

interface InboundSummaryRow extends pg.QueryResultRow {
  received_count: string;
  processed_count: string;
  failed_current: string;
  handled_count: string;
  handoff_count: string;
  ignored_count: string;
  rollout_skipped_count: string;
  unknown_outcome_count: string;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
}

interface QueueRow extends pg.QueryResultRow {
  topic: string;
  pending: string;
  oldest_pending_ms: number | null;
  dead_letter_total: string;
  dead_letter_window: string;
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

interface DeliveryRow extends pg.QueryResultRow {
  channel: string;
  event_type: string;
  count: string;
}

interface OutboundLifecycleRow extends pg.QueryResultRow {
  channel: string;
  status: string;
  count: string;
}

interface HandoffRow extends pg.QueryResultRow {
  reason: string;
  count: string;
}

export interface OperationalMetricsSnapshot {
  generatedAt: string;
  windowMinutes: number;
  inbound: {
    received: number;
    processed: number;
    failedCurrent: number;
    outcomes: {
      handled: number;
      handoff: number;
      ignored: number;
      rolloutSkipped: number;
      unknown: number;
    };
    processingLatencyMs: {
      p50: number | null;
      p95: number | null;
      max: number | null;
    };
  };
  delivery: {
    byChannel: Array<{ channel: string; status: string; count: number }>;
    outboundLifecycle: Array<{ channel: string; status: string; count: number }>;
  };
  handoffs: {
    total: number;
    byReason: Array<{
      reason: string;
      count: number;
    }>;
  };
  queue: Array<{
    topic: string;
    pending: number;
    oldestPendingMs: number | null;
    deadLetterTotal: number;
    deadLettersInWindow: number;
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
    const [inbound, queue, attempts, handoffs, delivery, outboundLifecycle] = await Promise.all([
      this.db.query<InboundSummaryRow>(
        `SELECT
           count(*)::bigint AS received_count,
           count(*) FILTER (WHERE processed_at IS NOT NULL)::bigint AS processed_count,
           count(*) FILTER (WHERE status = 'failed' AND processed_at IS NULL)::bigint AS failed_current,
           count(*) FILTER (WHERE processing_outcome = 'handled')::bigint AS handled_count,
           count(*) FILTER (WHERE processing_outcome = 'handoff')::bigint AS handoff_count,
           count(*) FILTER (WHERE processing_outcome = 'ignored')::bigint AS ignored_count,
           count(*) FILTER (WHERE processing_outcome = 'rollout_skipped')::bigint AS rollout_skipped_count,
           count(*) FILTER (WHERE processed_at IS NOT NULL AND processing_outcome IS NULL)::bigint AS unknown_outcome_count,
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
             AS oldest_pending_ms,
           count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::bigint AS dead_letter_total,
           count(*) FILTER (
             WHERE dead_lettered_at >= now() - make_interval(mins => $1)
           )::bigint AS dead_letter_window
         FROM outbox
         GROUP BY topic
         ORDER BY topic`,
        [windowMinutes]
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
      ),
      this.db.query<HandoffRow>(
        `SELECT
           COALESCE(NULLIF(handoff_reason, ''), 'unspecified') AS reason,
           count(*)::bigint AS count
         FROM inbound_events
         WHERE received_at >= now() - make_interval(mins => $1)
           AND processing_outcome = 'handoff'
         GROUP BY COALESCE(NULLIF(handoff_reason, ''), 'unspecified')
         ORDER BY count(*) DESC, reason`,
        [windowMinutes]
      ),
      this.db.query<DeliveryRow>(
        `SELECT channel, event_type, count(*)::bigint AS count
         FROM inbound_events
         WHERE provider = 'meta'
           AND channel IN ('messenger','instagram','whatsapp')
           AND event_type IN ('delivery.sent','delivery.delivered','delivery.read','delivery.failed')
           AND received_at >= now() - make_interval(mins => $1)
         GROUP BY channel,event_type
         ORDER BY channel,event_type`,
        [windowMinutes]
      ),
      // Correlate provider-accepted outbound actions with receipt message IDs
      // on the exact channel and account. Do not equate Graph HTTP 200
      // with a recipient delivery confirmation.
      this.db.query<OutboundLifecycleRow>(
        `WITH sent AS (
           SELECT o.payload->'target'->>'channel' AS channel,
                  o.payload->'target'->>'accountId' AS account_id,
                  o.payload->'delivery'->>'providerResourceId' AS provider_message_id
           FROM outbox AS o
           WHERE o.topic = 'action.dispatch'
             AND o.published_at >= now() - make_interval(mins => $1)
             AND o.payload->>'provider' = 'meta'
             AND o.payload->>'capability' = 'messaging'
             AND o.payload->>'operation' IN ('message.send','message.template.send')
             AND o.payload->'target'->>'channel' IN ('messenger','instagram','whatsapp')
             AND o.payload->'delivery'->>'providerResourceId' IS NOT NULL
         )
         SELECT sent.channel,
                COALESCE(receipt.event_type, 'delivery.unconfirmed') AS status,
                count(*)::bigint AS count
         FROM sent
         LEFT JOIN LATERAL (
           SELECT ie.event_type
           FROM inbound_events AS ie
           WHERE ie.provider = 'meta'
             AND ie.channel = sent.channel
             AND ie.account_id = sent.account_id
             AND ie.provider_message_id = sent.provider_message_id
             AND ie.event_type IN ('delivery.sent','delivery.delivered','delivery.read','delivery.failed')
           -- Provider callbacks may arrive out of order. A later-arriving
           -- 'sent' or 'delivered' receipt must not overwrite proof of 'read'.
           -- A failure supersedes 'sent' when no success receipt exists.
           -- Never infer recipient delivery from an accepted send API response.
           ORDER BY CASE ie.event_type
                      WHEN 'delivery.read' THEN 4
                      WHEN 'delivery.delivered' THEN 3
                      WHEN 'delivery.failed' THEN 2
                      WHEN 'delivery.sent' THEN 1
                      ELSE 0 END DESC,
                    COALESCE(ie.occurred_at,ie.received_at) DESC,
                    ie.received_at DESC
           LIMIT 1
         ) AS receipt ON true
         GROUP BY sent.channel,COALESCE(receipt.event_type, 'delivery.unconfirmed')
         ORDER BY sent.channel,status`,
        [windowMinutes]
      )
    ]);

    const summary = inbound.rows[0];
    if (summary === undefined) {
      throw new Error("operational metrics query returned no inbound summary");
    }

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

    const handoffsByReason = handoffs.rows.map((row) => ({
      reason: row.reason,
      count: Number(row.count)
    }));
    return {
      generatedAt: new Date().toISOString(),
      windowMinutes,
      inbound: {
        received: Number(summary.received_count),
        processed: Number(summary.processed_count),
        failedCurrent: Number(summary.failed_current),
        outcomes: {
          handled: Number(summary.handled_count),
          handoff: Number(summary.handoff_count),
          ignored: Number(summary.ignored_count),
          rolloutSkipped: Number(summary.rollout_skipped_count),
          unknown: Number(summary.unknown_outcome_count)
        },
        processingLatencyMs: {
          p50: nullableNumber(summary.p50_ms),
          p95: nullableNumber(summary.p95_ms),
          max: nullableNumber(summary.max_ms)
        }
      },
      delivery: {
        byChannel: delivery.rows.map((row) => ({
          channel: row.channel,
          status: row.event_type.slice("delivery.".length),
          count: Number(row.count)
        })),
        outboundLifecycle: outboundLifecycle.rows.map((row) => ({
          channel: row.channel,
          status: row.status.startsWith("delivery.") ? row.status.slice(9) : row.status,
          count: Number(row.count)
        }))
      },
      handoffs: {
        total: handoffsByReason.reduce((sum, row) => sum + row.count, 0),
        byReason: handoffsByReason
      },
      queue: queue.rows.map((row) => ({
        topic: row.topic,
        pending: Number(row.pending),
        oldestPendingMs: nullableNumber(row.oldest_pending_ms),
        deadLetterTotal: Number(row.dead_letter_total),
        deadLettersInWindow: Number(row.dead_letter_window)
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
