import type { OperationalMetricsSnapshot } from "./operational-metrics.js";

export type OperationalAlertCode =
  | "inbound_processing_failed"
  | "queue_lag"
  | "recent_dead_letter";

export interface OperationalAlert {
  code: OperationalAlertCode;
  severity: "warning" | "critical";
  count: number;
  /** Only known queue topics; never identifiers or content from messages. */
  topic?: "inbound.event.accepted" | "action.dispatch";
  oldestPendingMs?: number;
}

export interface OperationalAlertSummary {
  generatedAt: string;
  windowMinutes: number;
  status: "healthy" | "warning" | "critical";
  alerts: OperationalAlert[];
}

/**
 * Operator-only, non-sending alert classification based on durable aggregates.
 * It does NOT infer worker liveness from a ready HTTP endpoint or from an empty
 * queue. Liveness/heartbeats require independent process instrumentation.
 *
 * Thresholds are conservative initial operating defaults, not provider SLAs.
 */
export type OperationalAlertInput =
  Pick<OperationalMetricsSnapshot, "generatedAt" | "windowMinutes" | "queue"> & {
    inbound: Pick<OperationalMetricsSnapshot["inbound"], "failedCurrent">;
  };

export function evaluateOperationalAlerts(
  metrics: OperationalAlertInput,
  runtime?: { processorEnabled: boolean; actionDispatchEnabled: boolean }
): OperationalAlertSummary {
  const alerts: OperationalAlert[] = [];

  if (metrics.inbound.failedCurrent > 0) {
    alerts.push({
      code: "inbound_processing_failed",
      severity: metrics.inbound.failedCurrent >= 5 ? "critical" : "warning",
      count: metrics.inbound.failedCurrent
    });
  }

  for (const queue of metrics.queue) {
    if (queue.topic !== "inbound.event.accepted" && queue.topic !== "action.dispatch") {
      continue; // Refuse unknown/untrusted queue names in the alert surface.
    }
    if ((queue.topic === "inbound.event.accepted" && runtime?.processorEnabled === false)
      || (queue.topic === "action.dispatch" && runtime?.actionDispatchEnabled === false)) {
      continue; // A deliberately paused worker does not indicate a stalled worker.
    }
    if (queue.pending > 0 && queue.oldestPendingMs !== null
      && queue.oldestPendingMs >= 5 * 60_000) {
      alerts.push({
        code: "queue_lag",
        severity: queue.oldestPendingMs >= 15 * 60_000 ? "critical" : "warning",
        count: queue.pending,
        topic: queue.topic,
        oldestPendingMs: Math.max(0, Math.round(queue.oldestPendingMs))
      });
    }
  }

  const recentDeadLetters = metrics.queue
    .filter((queue) => queue.topic === "inbound.event.accepted"
      || queue.topic === "action.dispatch")
    .reduce((sum, queue) => sum + queue.deadLettersInWindow, 0);
  if (recentDeadLetters > 0) {
    alerts.push({
      code: "recent_dead_letter",
      severity: recentDeadLetters >= 5 ? "critical" : "warning",
      count: recentDeadLetters
    });
  }

  return {
    generatedAt: metrics.generatedAt,
    windowMinutes: metrics.windowMinutes,
    status: alerts.some((alert) => alert.severity === "critical")
      ? "critical"
      : alerts.length > 0 ? "warning" : "healthy",
    alerts
  };
}
