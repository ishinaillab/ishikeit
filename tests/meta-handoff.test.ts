import { describe, expect, it, vi } from "vitest";
import type { PostgresDatabase } from "../src/persistence/postgres.js";
import { metaConversationPartitionKey } from "../src/channels/meta-normalizer.js";
import { PostgresMetaHandoffStore } from "../src/persistence/meta-handoff.js";

describe("Meta durable handoff store", () => {
  it("tests active blocks without storing a raw conversation ID", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ active: true }] });
    const store = new PostgresMetaHandoffStore({ query } as unknown as PostgresDatabase);
    const key = metaConversationPartitionKey("instagram", "ig-account", "customer-1");
    await expect(store.isActive(key)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("released_at IS NULL"), [key]);
    expect(String(query.mock.calls[0]?.[0])).not.toContain("customer-1");
  });
  it("derives the exact account/channel/customer partition when releasing", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const store = new PostgresMetaHandoffStore({ query } as unknown as PostgresDatabase);
    await expect(store.release("whatsapp", "phone-1", "639100000000")).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE public.meta_handoff_blocks"),
      [metaConversationPartitionKey("whatsapp", "phone-1", "639100000000")]
    );
  });
  it("writes native ownership into a separate table without overwriting an active human handoff", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const store = new PostgresMetaHandoffStore({ query } as unknown as PostgresDatabase);
    const key = "a".repeat(64);
    const occurredAt = "2026-10-28T11:00:00.000Z";
    await store.blockNativeRouting(key, occurredAt);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("meta_native_routing_ownership");
    expect(sql).not.toContain("INSERT INTO public.meta_handoff_blocks");
    expect(sql).toContain("provider_event_at < EXCLUDED.provider_event_at");
    expect(sql).toContain("EXCLUDED.owner_state='other_app'");
    expect(query).toHaveBeenCalledWith(expect.any(String), [key, "other_app", new Date(occurredAt)]);
  });

  it("updates native ownership to this app only when a newer event allows it", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const store = new PostgresMetaHandoffStore({ query } as unknown as PostgresDatabase);
    const key = "b".repeat(64);
    const occurredAt = "2026-10-28T11:02:00.000Z";
    await store.releaseNativeRouting(key, occurredAt);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("provider_event_at < EXCLUDED.provider_event_at");
    expect(sql).toContain("EXCLUDED.owner_state='other_app'");
    expect(query).toHaveBeenCalledWith(expect.any(String), [key, "this_app", new Date(occurredAt)]);
  });

  it("checks BOTH human handoff and independent native owner state", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ active: false }] });
    const store = new PostgresMetaHandoffStore({ query } as unknown as PostgresDatabase);
    await expect(store.isActive("c".repeat(64))).resolves.toBe(false);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("public.meta_handoff_blocks");
    expect(sql).toContain("public.meta_native_routing_ownership");
    expect(sql).toContain("owner_state='other_app'");
  });

  it("prevents operator human-release from releasing native Meta ownership blocks", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });
    const store = new PostgresMetaHandoffStore({ query } as unknown as PostgresDatabase);
    await expect(store.release("messenger", "page-1", "person-1")).resolves.toBe(false);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("reason <> 'native_thread_control_other_app'");
    expect(sql).toContain("released_at IS NULL");
    expect(query.mock.calls[0]?.[1]).toEqual([
      metaConversationPartitionKey("messenger", "page-1", "person-1")
    ]);
  });

  it("reports a non-active handoff without reopening it", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });
    const store = new PostgresMetaHandoffStore({ query } as unknown as PostgresDatabase);
    await expect(store.release("messenger", "page-1", "person-1")).resolves.toBe(false);
  });
});
