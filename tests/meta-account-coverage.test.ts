import { describe, expect, it, vi } from "vitest";
import type { PostgresDatabase } from "../src/persistence/postgres.js";
import { instagramManagedAccountMatchesInbound } from "../src/observability/meta-account-coverage.js";

describe("Instagram verified managed owner routing coverage", () => {
  it("checks exactly the independently resolved owner against signed inbound events", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ matches: true }] });
    const db = { query } as unknown as PostgresDatabase;
    await expect(instagramManagedAccountMatchesInbound(db, "verified-owner")).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("account_id=$1"),
      ["verified-owner"]
    );
    expect(String(query.mock.calls[0]?.[0])).not.toContain("verified-owner");
  });

  it("distinguishes mismatched business accounts without treating absence as proof", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ matches: false }] });
    const db = { query } as unknown as PostgresDatabase;
    await expect(instagramManagedAccountMatchesInbound(db, "other-account")).resolves.toBe(false);
    await expect(instagramManagedAccountMatchesInbound(db, "")).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
