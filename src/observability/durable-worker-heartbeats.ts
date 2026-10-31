import type pg from "pg";
import type { Logger } from "pino";
import type { PostgresDatabase } from "../persistence/postgres.js";
import type { LocalWorkerDiagnostics, LocalWorkerSnapshot, WorkerLoopName } from "./worker-loop-diagnostics.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 45_000;
const LOOKBACK_MINUTES = 15;
type WorkerStatus = LocalWorkerSnapshot["workers"][number]["status"];
export type FleetStatus = WorkerStatus | "stale";

interface HeartbeatRow extends pg.QueryResultRow {
  instance_id: string;
  worker_name: WorkerLoopName;
  worker_status: WorkerStatus;
  observed_at: Date;
  last_completed_at: Date | null;
  total_iterations: string;
  failed_iterations: string;
}
export interface FleetWorker {
  instanceId: string;
  name: WorkerLoopName;
  status: FleetStatus;
  observedAt: string;
  lastCompletedAt: string | null;
  totalIterations: number;
  failedIterations: number;
}
export interface WorkerFleetSnapshot {
  scope: "observed_instances";
  generatedAt: string;
  staleAfterMs: number;
  observationWindowMinutes: number;
  workers: FleetWorker[];
  warnings: Array<{ code: "stale_worker"; count: number; worker: WorkerLoopName }>;
}
/** Only processes observed in the lookback are visible; this is not an expected-replica roster. */
export class PostgresWorkerHeartbeatStore {
  constructor(private readonly db: PostgresDatabase) {}
  async report(snapshot: LocalWorkerSnapshot): Promise<void> {
    for (const worker of snapshot.workers) {
      await this.db.query(
        `INSERT INTO public.ishikeit_worker_heartbeats
           (instance_id, worker_name, worker_status, last_completed_at, total_iterations, failed_iterations, observed_at)
         VALUES ($1::uuid, $2, $3, $4::timestamptz, $5, $6, now())
         ON CONFLICT (instance_id, worker_name) DO UPDATE SET
           worker_status = EXCLUDED.worker_status,
           last_completed_at = EXCLUDED.last_completed_at,
           total_iterations = EXCLUDED.total_iterations,
           failed_iterations = EXCLUDED.failed_iterations,
           observed_at = now()`,
        [snapshot.instanceId, worker.name, worker.status, worker.lastCompletedAt,
          worker.totalIterations, worker.failedIterations]
      );
    }
  }
  /** Limit retained per-instance rows; no customer or message data is stored. */
  async pruneExpired(): Promise<void> {
    await this.db.query(
      "DELETE FROM public.ishikeit_worker_heartbeats WHERE observed_at < now() - interval '7 days'"
    );
  }

  async stop(instanceId: string): Promise<void> {
    await this.db.query(
      `UPDATE public.ishikeit_worker_heartbeats
         SET worker_status = 'stopped', observed_at = now()
         WHERE instance_id = $1::uuid AND worker_status NOT IN ('disabled','stopped')`,
      [instanceId]
    );
  }
  async snapshot(): Promise<WorkerFleetSnapshot> {
    const result = await this.db.query<HeartbeatRow>(
      `SELECT instance_id::text, worker_name, worker_status, observed_at, last_completed_at,
              total_iterations::text, failed_iterations::text
         FROM public.ishikeit_worker_heartbeats
        WHERE observed_at >= now() - make_interval(mins => $1)
        ORDER BY observed_at DESC, worker_name ASC
        LIMIT 100`, [LOOKBACK_MINUTES]
    );
    return classifyFleetHeartbeats(result.rows, new Date());
  }
}
export function classifyFleetHeartbeats(rows: readonly HeartbeatRow[], now: Date): WorkerFleetSnapshot {
  const workers = rows.map((row) => {
    const stale = now.getTime() - row.observed_at.getTime() > STALE_AFTER_MS;
    const status: FleetStatus = stale && !["disabled", "stopped"].includes(row.worker_status)
      ? "stale" : row.worker_status;
    return {
      instanceId: row.instance_id,
      name: row.worker_name,
      status,
      observedAt: row.observed_at.toISOString(),
      lastCompletedAt: row.last_completed_at?.toISOString() ?? null,
      totalIterations: Number(row.total_iterations),
      failedIterations: Number(row.failed_iterations)
    };
  });
  const warnings: WorkerFleetSnapshot["warnings"] = [];
  for (const name of ["inbound_processor","outbound_dispatcher"] as const) {
    const stale = workers.filter((w) => w.name === name && w.status === "stale").length;
    if (stale > 0) warnings.push({ code: "stale_worker", count: stale, worker: name });
  }
  return {
    scope: "observed_instances",
    generatedAt: now.toISOString(),
    staleAfterMs: STALE_AFTER_MS,
    observationWindowMinutes: LOOKBACK_MINUTES,
    workers,
    warnings
  };
}
/** Best effort, never interrupt inbound or outbound processing. */
export class DurableWorkerHeartbeatMonitor {
  readonly #store: PostgresWorkerHeartbeatStore;
  readonly #local: LocalWorkerDiagnostics;
  readonly #logger: Logger;
  #timer: ReturnType<typeof setInterval> | undefined;
  #cleanupTimer: ReturnType<typeof setInterval> | undefined;
  #pending: Promise<void> | undefined;
  #closed = false;
  constructor(store: PostgresWorkerHeartbeatStore, local: LocalWorkerDiagnostics, logger: Logger) {
    this.#store = store;
    this.#local = local;
    this.#logger = logger;
  }
  start(): void {
    if (this.#timer !== undefined || this.#closed) return;
    void this.tick();
    this.#timer = setInterval(() => { void this.tick(); }, HEARTBEAT_INTERVAL_MS);
    this.#timer.unref();
    this.#cleanupTimer = setInterval(() => {
      void this.#store.pruneExpired().catch(() => {
        this.#logger.warn("worker heartbeat retention cleanup unavailable");
      });
    }, 24 * 60 * 60 * 1000);
    this.#cleanupTimer.unref();
  }
  tick(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#pending !== undefined) return this.#pending;
    const write = this.#store.report(this.#local.snapshot()).catch(() => {
      this.#logger.warn("worker heartbeat persistence unavailable");
    });
    this.#pending = write.finally(() => { this.#pending = undefined; });
    return this.#pending;
  }
  async stop(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    if (this.#cleanupTimer !== undefined) clearInterval(this.#cleanupTimer);
    await this.#pending;
    try {
      await this.#store.stop(this.#local.snapshot().instanceId);
    } catch {
      this.#logger.warn("worker heartbeat shutdown write unavailable");
    }
  }
}
