import { describe, expect, it, vi } from "vitest";
import type { PostgresDatabase } from "../src/persistence/postgres.js";
import {
  instagramManagedAccountMatchesInbound,
  messengerManagedPageMatchesInbound
} from "../src/observability/meta-account-coverage.js";

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

describe("Messenger signed Page identity evidence", () => {
  it("permits only the exact Page ID previously observed through signed inbound messaging", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ matches: true }] })
      .mockResolvedValueOnce({ rows: [{ matches: false }] });
    const db = { query } as unknown as PostgresDatabase;
    await expect(messengerManagedPageMatchesInbound(db, "123456789012")).resolves.toBe(true);
    await expect(messengerManagedPageMatchesInbound(db, "123456789013")).resolves.toBe(false);
    await expect(messengerManagedPageMatchesInbound(db, "a-page-alias")).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0]?.[0])).toContain("channel='messenger'");
    expect(query.mock.calls[0]?.[1]).toEqual(["123456789012"]);
  });
});
