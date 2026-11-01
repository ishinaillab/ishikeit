import { describe, expect, it, vi } from "vitest";
import { PostgresIncidentMetricsReader } from "../src/observability/incident-metrics.js";
import { evaluateIncidents } from "../src/observability/operational-incident-monitor.js";
import type { PostgresDatabase } from "../src/persistence/postgres.js";

describe("bounded incident-only SQL aggregates", () => {
  it("does not invoke costly dashboard receipt joins, percentiles, or customer payloads", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows:[{failed_current:"2"}] })
      .mockResolvedValueOnce({ rows:[{
        topic:"action.dispatch", pending:"3", oldest_pending_ms:400000,
        dead_letter_total:"4", dead_letter_window:"1"
      }] })
      .mockResolvedValueOnce({ rows:[{throttle_count:"2"}] });
    const reader = new PostgresIncidentMetricsReader({query} as unknown as PostgresDatabase);
    const snapshot = await reader.snapshot(60);
    expect(query).toHaveBeenCalledTimes(3);
    const statements = query.mock.calls.map(call => String(call[0])).join("\n");
    expect(statements).not.toMatch(/lateral|percentile_cont|provider_resource_id|payload->|join/iu);
    expect(statements).toMatch(/outbox_attempts/iu);
    expect(snapshot.inbound.failedCurrent).toBe(2);
    expect(snapshot.queue[0]).toMatchObject({
      topic:"action.dispatch",pending:3,oldestPendingMs:400000,deadLettersInWindow:1
    });
    expect(snapshot.attempts.byRoute).toEqual([{provider:"meta",httpStatus:429,count:2}]);
    const incident = evaluateIncidents(snapshot,{
      scope:"observed_instances",generatedAt:new Date().toISOString(),staleAfterMs:45000,
      observationWindowMinutes:15,workers:[],warnings:[]
    });
    expect(incident).toContainEqual({code:"graph_rate_limited",severity:"warning",count:2});
    expect(incident).toContainEqual({code:"queue_lag",severity:"warning",count:3});
  });
  it("rejects unbounded query windows before hitting the database", async () => {
    const query=vi.fn();
    const reader=new PostgresIncidentMetricsReader({query} as unknown as PostgresDatabase);
    await expect(reader.snapshot(0)).rejects.toThrow("bounded window");
    await expect(reader.snapshot(100000)).rejects.toThrow("bounded window");
    await expect(reader.snapshot(NaN)).rejects.toThrow("bounded window");
    expect(query).not.toHaveBeenCalled();
  });
});
