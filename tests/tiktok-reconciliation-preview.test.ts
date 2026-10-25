import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { previewTikTokHistoryReconciliation } from "../src/messaging/tiktok-reconciliation-preview.js";
import type { TikTokBusinessMessageSummary } from "../src/messaging/tiktok-business-read.js";

const digest = (id: string) => createHash("sha256").update(id).digest("hex");
const row = (messageId: string, extras: Partial<TikTokBusinessMessageSummary> = {}):
TikTokBusinessMessageSummary => ({
  messageId,
  conversationId: "conversation-owned",
  messageType: "text",
  ...extras
});

const base = {
  expectedBusinessId: "business-owned",
  authorizedBusinessId: "business-owned",
  conversationId: "conversation-owned"
};

describe("TikTok history reconciliation preview (offline, no sends)", () => {
  it("identifies missing provider messages without exposing text or IDs", () => {
    const actual = previewTikTokHistoryReconciliation({
      ...base,
      providerMessages: [
        row("message-1", { text: "CONFIDENTIAL_CUSTOMER_MESSAGE", timestampMs: 100 }),
        row("message-2", { text: "NEVER_LOG_THIS", timestampMs: 200 }),
        row("message-2", { text: "SHOULD_NOT_OUTPUT", timestampMs: 200 }),
        row("message-3", { text: "PRIVATE", timestampMs: 300 })
      ],
      persistedProviderMessageIds: ["message-1", "message-3"]
    });

    expect(actual).toEqual({
      mode: "dry_run",
      coverage: "provided_batch_only",
      conversationIdSha256: digest("conversation-owned"),
      providerRows: 4,
      uniqueProviderMessages: 3,
      duplicateProviderRows: 1,
      alreadyPersisted: 2,
      missingCount: 1,
      missingMessageIdSha256: [digest("message-2")]
    });
    const json = JSON.stringify(actual);
    for (const privateValue of [
      "CONFIDENTIAL_CUSTOMER_MESSAGE", "NEVER_LOG_THIS",
      "SHOULD_NOT_OUTPUT", "PRIVATE", "conversation-owned", "message-2",
      "business-owned"
    ]) {
      expect(json).not.toContain(privateValue);
    }
  });

  it("returns an empty, bounded preview rather than claiming global completeness", () => {
    expect(previewTikTokHistoryReconciliation({
      ...base, providerMessages: [], persistedProviderMessageIds: []
    })).toMatchObject({
      coverage: "provided_batch_only", providerRows: 0, missingCount: 0
    });
  });

  it("does not mutate source messages or stored IDs", () => {
    const messages = Object.freeze([Object.freeze(row("m2")), Object.freeze(row("m1"))]);
    const ids = Object.freeze(["m1"]);
    expect(previewTikTokHistoryReconciliation({
      ...base, providerMessages: messages, persistedProviderMessageIds: ids
    }).missingMessageIdSha256).toEqual([digest("m2")]);
    expect(messages.map(x => x.messageId)).toEqual(["m2", "m1"]);
    expect(ids).toEqual(["m1"]);
  });

  it("is deterministic for reordered duplicate provider batches", () => {
    const a = [row("m2"), row("m1"), row("m2"), row("m3")];
    const b = [row("m3"), row("m2"), row("m1"), row("m2")];
    const first = previewTikTokHistoryReconciliation({
      ...base, providerMessages: a, persistedProviderMessageIds: []
    });
    const second = previewTikTokHistoryReconciliation({
      ...base, providerMessages: b, persistedProviderMessageIds: []
    });
    expect(first).toEqual(second);
    expect(first.missingCount).toBe(3);
    expect(first.duplicateProviderRows).toBe(1);
  });

  it("fails closed on any authorized Business Account mismatch", () => {
    expect(() => previewTikTokHistoryReconciliation({
      ...base, authorizedBusinessId: "another-account",
      providerMessages: [], persistedProviderMessageIds: []
    })).toThrow(/authorized Business Account/);
  });

  it("rejects invalid conversation and out-of-scope provider rows", () => {
    expect(() => previewTikTokHistoryReconciliation({
      ...base, conversationId: " ", providerMessages: [], persistedProviderMessageIds: []
    })).toThrow(/valid conversation/);
    expect(() => previewTikTokHistoryReconciliation({
      ...base, providerMessages: [row("m1", { conversationId: "other" })],
      persistedProviderMessageIds: []
    })).toThrow(/wrong conversation/);
  });

  it("rejects invalid provider and locally recorded message IDs", () => {
    expect(() => previewTikTokHistoryReconciliation({
      ...base, providerMessages: [row("\n")], persistedProviderMessageIds: []
    })).toThrow(/invalid/);
    expect(() => previewTikTokHistoryReconciliation({
      ...base, providerMessages: [], persistedProviderMessageIds: [""]
    })).toThrow(/invalid/);
  });

  it("rejects malformed provider timestamps and oversized batches", () => {
    expect(() => previewTikTokHistoryReconciliation({
      ...base, providerMessages: [row("m1", { timestampMs: Number.NaN })],
      persistedProviderMessageIds: []
    })).toThrow(/timestamp/);
    expect(() => previewTikTokHistoryReconciliation({
      ...base, providerMessages: Array.from({ length: 501 }, (_, i) => row(String(i))),
      persistedProviderMessageIds: []
    })).toThrow(/bounded/);
    expect(() => previewTikTokHistoryReconciliation({
      ...base, providerMessages: [],
      persistedProviderMessageIds: Array.from({ length: 10_001 }, (_, i) => String(i))
    })).toThrow(/bounded/);
  });
});
