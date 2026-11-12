import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../src/domain/events.js";
import {
  PostgresWorkspaceShadowInspector,
  ShadowWorkspaceInboundStore,
  shadowAccountCandidate,
  type ShadowRoutingObservation
} from "../src/persistence/workspace-routing-shadow.js";

const meta = { provider: "meta", channel: "instagram", accountId: "178410000" };
function inspector(rows: readonly { status: string; workspace_state: string }[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return {
    probe: new PostgresWorkspaceShadowInspector({ query }),
    query
  };
}
const event = {
  ...meta,
  schemaVersion: 2, specversion: "1.0",
  id: "x", source: "urn:test", type: "test", capability: "messaging",
  eventType: "message.received", receivedAt: new Date().toISOString(),
  content: [{ kind: "text", text: "PRIVATE CUSTOMER CONTENT" }],
  data: { secret: "DO NOT LOG" }
} as CanonicalEvent;
const identity = { deduplicationKey: "dedup", partitionKey: "partition" };

describe("workspace shadow comparison (no tenant cutover)", () => {
  it("maps only signed Meta product namespaces, never the parent meta namespace", () => {
    for (const channel of ["instagram", "messenger", "whatsapp"]) {
      expect(shadowAccountCandidate({ ...meta, channel }))
        .toEqual({ provider: channel, accountId: meta.accountId });
    }
    expect(shadowAccountCandidate({ ...meta, channel: "other" })).toBeUndefined();
    expect(shadowAccountCandidate({ provider:"tiktok", channel:"business", accountId:"bid" }))
      .toEqual({ provider:"tiktok", accountId:"bid" });
    expect(shadowAccountCandidate({ ...meta, accountId: "a".repeat(257) })).toBeUndefined();
  });

  it("never mistakes a Telegram bot id for a Business owner's immutable user id", async () => {
    const { probe, query } = inspector([]);
    expect(await probe.inspect({ provider:"telegram",channel:"bot",accountId:"123" }))
      .toBe("identity_unresolved");
    expect(await probe.inspect({ provider:"latepoint",channel:"bookings",accountId:"1" }))
      .toBe("identity_unresolved");
    expect(query).not.toHaveBeenCalled();
  });

  it("reports candidate_active only for a unique connected account in active workspace", async () => {
    const { probe, query } = inspector([{ status: "connected", workspace_state:"active" }]);
    expect(await probe.inspect(meta)).toBe("candidate_active");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT 2"), [
      "instagram", meta.accountId
    ]);
  });

  it("keeps suspended, paused, verifying or revoked accounts non-routable", async () => {
    for (const [status, workspace_state] of [
      ["paused", "active"], ["verifying", "active"],
      ["revoked", "active"], ["disconnecting", "active"],
      ["connected", "suspended"]
    ] as const) {
      const { probe } = inspector([{ status, workspace_state }]);
      expect(await probe.inspect(meta)).toBe("inactive");
    }
  });

  it("does not fabricate an account claim or select an ambiguous owner", async () => {
    expect(await inspector([]).probe.inspect(meta)).toBe("unclaimed");
    expect(await inspector([
      {status:"connected",workspace_state:"active"},
      {status:"connected",workspace_state:"active"}
    ]).probe.inspect(meta)).toBe("ambiguous");
  });

  it("observes created events without giving the probe messages, identities or hashes", async () => {
    const live = { ingest: vi.fn().mockResolvedValue("created" as const) };
    const probe = { inspect: vi.fn().mockResolvedValue("unclaimed" as const) };
    let complete!: (value: ShadowRoutingObservation) => void;
    const observed = new Promise<ShadowRoutingObservation>((resolve) => { complete=resolve; });
    const store = new ShadowWorkspaceInboundStore(live, probe, complete);
    expect(await store.ingest(event, identity, "raw-body-hash")).toBe("created");
    expect(await observed).toEqual({
      provider:"meta", channel:"instagram", decision:"unclaimed"
    });
    expect(live.ingest).toHaveBeenCalledWith(event, identity, "raw-body-hash");
    expect(probe.inspect).toHaveBeenCalledWith(meta);
  });

  it("never delays the live result when the shadow DB lookup is blocked", async () => {
    const live = { ingest: vi.fn().mockResolvedValue("created" as const) };
    const probe = { inspect: vi.fn().mockReturnValue(new Promise(() => {})) };
    const record = vi.fn();
    const store = new ShadowWorkspaceInboundStore(live, probe, record);
    expect(await store.ingest(event, identity, "hash")).toBe("created");
    expect(record).not.toHaveBeenCalled();
  });

  it("bounds overlapping observational DB reads without blocking real inbound delivery", async () => {
    const release: Array<(value: "unclaimed") => void> = [];
    const probe = { inspect: vi.fn().mockImplementation(() =>
      new Promise<"unclaimed">((resolve) => { release.push(resolve); })) };
    const recorded: ShadowRoutingObservation[] = [];
    const live = { ingest: vi.fn().mockResolvedValue("created" as const) };
    const store = new ShadowWorkspaceInboundStore(live, probe, (item) => { recorded.push(item); });
    for (let i = 0; i < 5; i++) {
      expect(await store.ingest(event, identity, "hash")).toBe("created");
    }
    expect(probe.inspect).toHaveBeenCalledTimes(4);
    expect(release).toHaveLength(4);
    expect(recorded).toContainEqual({
      provider:"meta",channel:"instagram",decision:"capacity_skipped"
    });
    expect(live.ingest).toHaveBeenCalledTimes(5);
    release[0]?.("unclaimed");
    await vi.waitFor(() => expect(recorded).toContainEqual({
      provider:"meta",channel:"instagram",decision:"unclaimed"
    }));
    // Drain the finalizer before allocating another background comparison.
    await Promise.resolve();
    expect(await store.ingest(event, identity, "hash")).toBe("created");
    expect(probe.inspect).toHaveBeenCalledTimes(5);
    for (const resolve of release.slice(1)) resolve("unclaimed");
  });

  it("releases shadow budget after query failure so subsequent events are inspected", async () => {
    const probe = { inspect: vi.fn().mockRejectedValueOnce(new Error("read-only lookup failed"))
      .mockResolvedValue("unclaimed" as const) };
    const recorded: ShadowRoutingObservation[] = [];
    const store = new ShadowWorkspaceInboundStore(
      {ingest: vi.fn().mockResolvedValue("created" as const)},
      probe,
      (item) => { recorded.push(item); }
    );
    expect(await store.ingest(event,identity,"hash")).toBe("created");
    await vi.waitFor(() => expect(recorded).toContainEqual({
      provider:"meta",channel:"instagram",decision:"lookup_unavailable"
    }));
    await Promise.resolve();
    expect(await store.ingest(event,identity,"hash")).toBe("created");
    await vi.waitFor(() => expect(recorded).toContainEqual({
      provider:"meta",channel:"instagram",decision:"unclaimed"
    }));
    expect(probe.inspect).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable without rejecting live webhook delivery", async () => {
    const live = { ingest: vi.fn().mockResolvedValue("created" as const) };
    const probe = { inspect: vi.fn().mockRejectedValue(new Error("sensitive db details")) };
    let complete!: (value: ShadowRoutingObservation) => void;
    const observed = new Promise<ShadowRoutingObservation>((resolve) => { complete=resolve; });
    const store = new ShadowWorkspaceInboundStore(live, probe, complete);
    expect(await store.ingest(event, identity, "hash")).toBe("created");
    expect(await observed).toEqual({
      provider:"meta", channel:"instagram", decision:"lookup_unavailable"
    });
  });

  it("never observes duplicates, and never masks a failed live write", async () => {
    const probe = { inspect: vi.fn().mockResolvedValue("candidate_active" as const) };
    const record = vi.fn();
    const duplicate = new ShadowWorkspaceInboundStore(
      {ingest: vi.fn().mockResolvedValue("duplicate" as const)},probe,record
    );
    expect(await duplicate.ingest(event,identity,"hash")).toBe("duplicate");
    expect(probe.inspect).not.toHaveBeenCalled();
    const rejected = new ShadowWorkspaceInboundStore(
      {ingest: vi.fn().mockRejectedValue(new Error("inbound DB failed"))},probe,record
    );
    await expect(rejected.ingest(event,identity,"hash")).rejects.toThrow("inbound DB failed");
    expect(probe.inspect).not.toHaveBeenCalled();
  });

  it("observability callback failures never affect an accepted inbound event", async () => {
    const store = new ShadowWorkspaceInboundStore(
      {ingest:vi.fn().mockResolvedValue("created" as const)},
      {inspect: vi.fn().mockResolvedValue("unclaimed" as const)},
      () => { throw new Error("logger failed"); }
    );
    await expect(store.ingest(event,identity,"hash")).resolves.toBe("created");
  });
});
