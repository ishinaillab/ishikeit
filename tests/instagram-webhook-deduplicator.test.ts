import { describe, expect, it, vi } from "vitest";
import { InstagramWebhookSubscriptionDeduplicator } from "../src/auth/instagram-webhook-deduplicator.js";

describe("Instagram account-scoped subscription reconciliation", () => {
  it("reuses successful account-specific OAuth reconciliation for the same managed account", async () => {
    const gate = new InstagramWebhookSubscriptionDeduplicator();
    const oauthReadback = vi.fn().mockResolvedValue(undefined);
    const managedReadback = vi.fn().mockResolvedValue(undefined);
    expect(await gate.ensure("professional-account-1", oauthReadback)).toBe("reconciled");
    expect(await gate.ensure("professional-account-1", managedReadback)).toBe("reused");
    expect(oauthReadback).toHaveBeenCalledOnce();
    expect(managedReadback).not.toHaveBeenCalled();
  });

  it("never reuses subscription evidence from a different Professional account", async () => {
    const gate = new InstagramWebhookSubscriptionDeduplicator();
    const oauthReadback = vi.fn().mockResolvedValue(undefined);
    const managedReadback = vi.fn().mockResolvedValue(undefined);
    expect(await gate.ensure("professional-account-1", oauthReadback)).toBe("reconciled");
    expect(await gate.ensure("professional-account-2", managedReadback)).toBe("reconciled");
    expect(managedReadback).toHaveBeenCalledOnce();
  });

  it("does not treat failed or rate-limited Graph readbacks as successful", async () => {
    const gate = new InstagramWebhookSubscriptionDeduplicator();
    const throttled = vi.fn().mockRejectedValue(new Error("rate limit"));
    await expect(gate.ensure("professional-account-1", throttled)).rejects.toThrow("rate limit");
    const retry = vi.fn().mockResolvedValue(undefined);
    expect(await gate.ensure("professional-account-1", retry)).toBe("reconciled");
    expect(retry).toHaveBeenCalledOnce();
  });

  it("joins simultaneous startup checks on the same account without duplicate Graph calls", async () => {
    const gate = new InstagramWebhookSubscriptionDeduplicator();
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    const first = vi.fn().mockReturnValue(pending);
    const duplicate = vi.fn().mockResolvedValue(undefined);
    const original = gate.ensure("professional-account-1", first);
    const second = gate.ensure("professional-account-1", duplicate);
    resolve();
    expect(await original).toBe("reconciled");
    expect(await second).toBe("reused");
    expect(first).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
  });

  it("rejects missing account identity without contacting Meta", async () => {
    const gate = new InstagramWebhookSubscriptionDeduplicator();
    const readback = vi.fn().mockResolvedValue(undefined);
    await expect(gate.ensure("", readback)).rejects.toThrow("Missing Instagram Professional account ID");
    expect(readback).not.toHaveBeenCalled();
  });
});
