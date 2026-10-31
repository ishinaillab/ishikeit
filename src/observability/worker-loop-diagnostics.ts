import { randomUUID } from "node:crypto";

export type WorkerLoopName = "inbound_processor" | "outbound_dispatcher";
export type WorkerLoopEvent =
  | "started" | "iteration_started" | "iteration_succeeded"
  | "iteration_failed" | "stopped";

interface WorkerRecord {
  enabled: boolean;
  startedAt: number | null;
  stoppedAt: number | null;
  currentIterationAt: number | null;
  lastCompletedAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  totalIterations: number;
  failedIterations: number;
}

export interface LocalWorkerSnapshot {
  scope: "local_process";
  instanceId: string;
  generatedAt: string;
  workers: Array<{
    name: WorkerLoopName;
    status: "disabled" | "not_started" | "stopped" | "idle" | "working" | "long_running" | "stalled";
    lastCompletedAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    currentIterationMs: number | null;
    totalIterations: number;
    failedIterations: number;
  }>;
}

function iso(timestamp: number | null): string | null {
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

/**
 * Local-process observation ONLY: a load balancer can send this request to
 * another instance. This cannot prove distributed worker availability.
 * It must not be exposed through unauthenticated health routes.
 */
export class LocalWorkerDiagnostics {
  readonly #instanceId = randomUUID();
  readonly #now: () => number;
  readonly #records: Record<WorkerLoopName, WorkerRecord>;

  constructor(
    enabled: { inboundProcessor: boolean; outboundDispatcher: boolean },
    now: () => number = Date.now
  ) {
    this.#now = now;
    const initial = (value: boolean): WorkerRecord => ({
      enabled: value,
      startedAt: null,
      stoppedAt: null,
      currentIterationAt: null,
      lastCompletedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      totalIterations: 0,
      failedIterations: 0
    });
    this.#records = {
      inbound_processor: initial(enabled.inboundProcessor),
      outbound_dispatcher: initial(enabled.outboundDispatcher)
    };
  }

  record(name: WorkerLoopName, event: WorkerLoopEvent): void {
    const state = this.#records[name];
    if (!state.enabled) return;
    const now = this.#now();
    if (event === "started") {
      state.startedAt = now;
      state.stoppedAt = null;
      state.currentIterationAt = null;
      return;
    }
    if (event === "stopped") {
      state.stoppedAt = now;
      state.currentIterationAt = null;
      return;
    }
    if (state.startedAt === null || state.stoppedAt !== null) return;
    if (event === "iteration_started") {
      state.currentIterationAt = now;
      return;
    }
    // Do not accept a completion event without an active iteration.
    if (state.currentIterationAt === null) return;
    state.currentIterationAt = null;
    state.lastCompletedAt = now;
    state.totalIterations += 1;
    if (event === "iteration_failed") {
      state.failedIterations += 1;
      state.lastFailureAt = now;
    } else {
      state.lastSuccessAt = now;
    }
  }

  snapshot(): LocalWorkerSnapshot {
    const now = this.#now();
    const workers = (["inbound_processor", "outbound_dispatcher"] as const).map((name) => {
      const w = this.#records[name];
      const currentIterationMs = w.currentIterationAt === null
        ? null : Math.max(0, now - w.currentIterationAt);
      const latest = w.startedAt === null ? null
        : Math.max(w.startedAt, w.lastCompletedAt ?? w.startedAt);
      const status: LocalWorkerSnapshot["workers"][number]["status"] = !w.enabled ? "disabled"
        : w.startedAt === null ? "not_started"
          : w.stoppedAt !== null ? "stopped"
            : currentIterationMs !== null
              ? currentIterationMs >= 120_000 ? "long_running" : "working"
              : latest !== null && now - latest >= 30_000 ? "stalled" : "idle";
      return {
        name,
        status,
        lastCompletedAt: iso(w.lastCompletedAt),
        lastSuccessAt: iso(w.lastSuccessAt),
        lastFailureAt: iso(w.lastFailureAt),
        currentIterationMs,
        totalIterations: w.totalIterations,
        failedIterations: w.failedIterations
      };
    });
    return {
      scope: "local_process",
      instanceId: this.#instanceId,
      generatedAt: new Date(now).toISOString(),
      workers
    };
  }
}
