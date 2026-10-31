import type pg from "pg";
import type { Logger } from "pino";
import type { PostgresDatabase } from "../persistence/postgres.js";
import type { OperationalMetricsReader, OperationalMetricsSnapshot } from "./operational-metrics.js";
import { evaluateOperationalAlerts } from "./operational-alerts.js";
import type { WorkerFleetSnapshot } from "./durable-worker-heartbeats.js";

export type IncidentCode =
  | "stale_worker" | "queue_lag" | "recent_dead_letter"
  | "inbound_processing_failed" | "graph_rate_limited" | "oauth_renewal_failed";
export type IncidentSeverity = "warning" | "critical";
export interface Incident {
  code: IncidentCode;
  severity: IncidentSeverity;
  count: number;
}
interface IncidentRow extends pg.QueryResultRow {
  code: IncidentCode;
  severity: IncidentSeverity;
  incident_count: number;
  active: boolean;
  last_seen_at: Date;
}
export interface IncidentReadback {
  scope: "durable_incidents";
  incidents: Array<{ code: IncidentCode; severity: IncidentSeverity; count: number; lastSeenAt: string }>;
}

export function evaluateIncidents(
  metrics: OperationalMetricsSnapshot,
  fleet: WorkerFleetSnapshot,
  oauthMaintenanceFailures = 0,
  runtime?: { processorEnabled: boolean; actionDispatchEnabled: boolean }
): Incident[] {
  const grouped = new Map<IncidentCode, Incident>();
  const add = (code: IncidentCode, severity: IncidentSeverity, count: number) => {
    if (count <= 0) return;
    const existing = grouped.get(code);
    grouped.set(code, { code, severity:
      existing?.severity === "critical" || severity === "critical" ? "critical" : "warning",
      count: (existing?.count ?? 0) + count
    });
  };
  for (const alert of evaluateOperationalAlerts(metrics, runtime).alerts) {
    add(alert.code, alert.severity, alert.count);
  }
  for (const issue of fleet.warnings) {
    add("stale_worker", "critical", issue.count);
  }
  const throttles = metrics.attempts.byRoute
    .filter(row => row.provider === "meta" && row.httpStatus === 429)
    .reduce((total, row) => total + row.count, 0);
  add("graph_rate_limited", throttles >= 5 ? "critical" : "warning", throttles);
  add("oauth_renewal_failed", oauthMaintenanceFailures >= 3 ? "critical" : "warning",
    oauthMaintenanceFailures);
  return [...grouped.values()];
}

export class PostgresOperationalIncidentStore {
  constructor(private readonly db: PostgresDatabase) {}

  /** Atomic deduplicated claim; multiple replicas cannot send the same alert in one cooldown. */
  async observe(incidents: readonly Incident[]): Promise<Array<Incident & { recovery: boolean }>> {
    const claimed: Array<Incident & { recovery: boolean }> = [];
    for (const incident of incidents) {
      const result = await this.db.query<{ claimed: boolean }>(
        `INSERT INTO public.ishikeit_operational_incidents
          (code, severity, incident_count, active, last_seen_at, claimed_at)
         VALUES ($1, $2, $3, true, now(), now())
         ON CONFLICT (code) DO UPDATE SET
           severity = EXCLUDED.severity, incident_count = EXCLUDED.incident_count,
           last_seen_at = now(), active = true,
           claimed_at = CASE WHEN NOT ishikeit_operational_incidents.active
             OR ishikeit_operational_incidents.severity <> EXCLUDED.severity
             OR ishikeit_operational_incidents.claimed_at < now() - interval '5 minutes'
             THEN now() ELSE ishikeit_operational_incidents.claimed_at END
         RETURNING (claimed_at = now()) AS claimed`,
        [incident.code, incident.severity, incident.count]
      );
      if (result.rows[0]?.claimed === true) {
        claimed.push({ ...incident, recovery: false });
      }
    }
    // Clear only known codes not present now, once. SQL remains parameterized.
    const ongoing = incidents.map(i => i.code);
    const resolved = await this.db.query<{ code: IncidentCode; severity: IncidentSeverity }>(
      `UPDATE public.ishikeit_operational_incidents
          SET active = false, last_seen_at = now(), claimed_at = now()
        WHERE active = true AND NOT (code = ANY($1::text[]))
        RETURNING code, severity`, [ongoing]
    );
    for (const row of resolved.rows) {
      claimed.push({ code: row.code, severity: row.severity, count: 0, recovery: true });
    }
    return claimed;
  }

  async snapshot(): Promise<IncidentReadback> {
    const results = await this.db.query<IncidentRow>(
      `SELECT code, severity, incident_count, active, last_seen_at
         FROM public.ishikeit_operational_incidents
        WHERE active = true ORDER BY code LIMIT 30`
    );
    return {
      scope: "durable_incidents",
      incidents: results.rows.map(r => ({
        code: r.code, severity: r.severity, count: r.incident_count,
        lastSeenAt: r.last_seen_at.toISOString()
      }))
    };
  }
}

export interface OperatorAlertSender {
  send(incident: Incident & { recovery: boolean }): Promise<void>;
}

/** Configured explicitly by an operator, never uses a customer/provider message adapter. */
export class HttpsOperatorWebhook implements OperatorAlertSender {
  readonly #destination: URL;
  constructor(url: string, private readonly bearer: string, approvedHostname: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== ""
      || parsed.hash !== "" || parsed.hostname !== approvedHostname
      || parsed.port !== "" || bearer.length < 32) {
      throw new Error("operator webhook requires the approved HTTPS host and a dedicated secret");
    }
    this.#destination = parsed;
  }
  async send(incident: Incident & { recovery: boolean }): Promise<void> {
    const response = await fetch(this.#destination, {
      method: "POST",
      headers: {
        "authorization": "Bearer " + this.bearer,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        source: "ishikeit-operational-monitor", code: incident.code,
        severity: incident.severity, count: incident.count,
        status: incident.recovery ? "recovered" : "firing"
      }),
      redirect: "error",
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("operator webhook delivery failed");
  }
}

/** In-process polling is NOT an independent outage watcher. */
export class OperationalIncidentMonitor {
  #pending: Promise<void> | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  constructor(
    private readonly metrics: OperationalMetricsReader,
    private readonly fleet: { snapshot(): Promise<WorkerFleetSnapshot> },
    private readonly incidents: PostgresOperationalIncidentStore,
    private readonly logger: Logger,
    private readonly sender?: OperatorAlertSender,
    private readonly oauthMaintenanceFailures: () => number = () => 0,
    private readonly runtime?: { processorEnabled: boolean; actionDispatchEnabled: boolean }
  ) {}
  start(): void {
    if (this.#timer !== undefined || this.#closed) return;
    void this.tick();
    this.#timer = setInterval(() => { void this.tick(); }, 60_000);
    this.#timer.unref();
  }
  tick(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#pending !== undefined) return this.#pending;
    const work = (async () => {
      try {
        const [metrics, fleet] = await Promise.all([this.metrics.snapshot(60), this.fleet.snapshot()]);
        const notifications = await this.incidents.observe(evaluateIncidents(metrics, fleet, this.oauthMaintenanceFailures(), this.runtime));
        for (const incident of notifications) {
          if (this.sender === undefined) continue;
          try { await this.sender.send(incident); }
          catch { this.logger.warn({ code: incident.code }, "operator alert delivery unavailable"); }
        }
      } catch {
        this.logger.warn("operational incident scan unavailable");
      }
    })();
    this.#pending = work.finally(() => { this.#pending = undefined; });
    return this.#pending;
  }
  async stop(): Promise<void> {
    this.#closed = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    await this.#pending;
  }
}
