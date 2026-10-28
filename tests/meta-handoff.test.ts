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
  it("reports a non-active handoff without reopening it", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });
    const store = new PostgresMetaHandoffStore({ query } as unknown as PostgresDatabase);
    await expect(store.release("messenger", "page-1", "person-1")).resolves.toBe(false);
  });
});
