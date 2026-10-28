import { describe, expect, it, vi } from "vitest";
import type { PostgresDatabase } from "../src/persistence/postgres.js";
import {
  instagramManagedAccountMatchesInbound,
  messengerManagedPageMatchesInbound,
  messengerRecentSignedPageId
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


describe("Recent signed Messenger Page selection", () => {
  it("chooses only a unique recent numeric Page from the verified inbound log", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ account_id: "123456789012" }] })
      .mockResolvedValueOnce({ rows: [
        { account_id: "123456789012" }, { account_id: "123456789013" }
      ] });
    const db = { query } as unknown as PostgresDatabase;
    await expect(messengerRecentSignedPageId(db)).resolves.toBe("123456789012");
    await expect(messengerRecentSignedPageId(db)).resolves.toBeUndefined();
    expect(String(query.mock.calls[0]?.[0])).toContain("account_id ~ '^[0-9]{5,32}$'");
    expect(String(query.mock.calls[0]?.[0])).toContain("received_at >= now() - interval '30 days'");
    expect(query).toHaveBeenCalledTimes(2);
  });
});
