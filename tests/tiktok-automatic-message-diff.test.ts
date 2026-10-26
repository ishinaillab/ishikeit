import { describe, expect, it } from "vitest";
import {
  diffTikTokAutoMessageSnapshots,
  TikTokAutoMessageSnapshotDiffError,
  type TikTokAutoMessageSnapshotSet
} from "../src/messaging/tiktok-automatic-message-diff.js";
import type {
  TikTokAutoMessageSummary,
  TikTokAutoMessageType
} from "../src/messaging/tiktok-automatic-message-read.js";

const types = [
  "WELCOME_MESSAGE", "SUGGESTED_QUESTION", "CHAT_PROMPT", "FOLLOW_WELCOME"
] as const;

function empty(businessId = "business-1"): TikTokAutoMessageSnapshotSet {
  return Object.fromEntries(types.map((type) => [
    type, { businessId, type, enabled: false, messages: [] }
  ])) as unknown as TikTokAutoMessageSnapshotSet;
}

function welcome(
  source: TikTokAutoMessageSnapshotSet,
  messages: readonly TikTokAutoMessageSummary[],
  enabled = false
): TikTokAutoMessageSnapshotSet {
  return {
    ...source,
    WELCOME_MESSAGE: { ...source.WELCOME_MESSAGE, enabled, messages }
  };
}

describe("TikTok automatic-message snapshot comparison (offline, metadata-only)", () => {
  it("returns no changes for the same complete set without any provider calls", () => {
    const original = empty();
    expect(diffTikTokAutoMessageSnapshots(original, original)).toEqual({
      businessId: "business-1",
      changed: false,
      changes: []
    });
  });

  it("detects a per-type enablement change in deterministic order", () => {
    const previous = empty();
    const current = {
      ...previous,
      CHAT_PROMPT: { ...previous.CHAT_PROMPT, enabled: true },
      WELCOME_MESSAGE: { ...previous.WELCOME_MESSAGE, enabled: true }
    };
    expect(diffTikTokAutoMessageSnapshots(previous, current).changes).toEqual([
      {
        type: "WELCOME_MESSAGE",
        previousEnabled: false, currentEnabled: true,
        addedCount: 0, removedCount: 0, moderationChangedCount: 0
      },
      {
        type: "CHAT_PROMPT",
        previousEnabled: false, currentEnabled: true,
        addedCount: 0, removedCount: 0, moderationChangedCount: 0
      }
    ]);
  });

  it("tracks added, removed and changed-moderation counts without IDs", () => {
    const before = welcome(empty(), [
      { id: "old-private-id", type: "WELCOME_MESSAGE", auditStatus: "REVIEWING" },
      { id: "retired-private-id", type: "WELCOME_MESSAGE", auditStatus: "APPROVED" }
    ], true);
    const after = welcome(empty(), [
      { id: "old-private-id", type: "WELCOME_MESSAGE", auditStatus: "APPROVED" },
      { id: "new-private-id", type: "WELCOME_MESSAGE", auditStatus: "APPROVED" }
    ], true);
    const result = diffTikTokAutoMessageSnapshots(before, after);
    expect(result).toEqual({
      businessId: "business-1", changed: true,
      changes: [{
        type: "WELCOME_MESSAGE", previousEnabled: true, currentEnabled: true,
        addedCount: 1, removedCount: 1, moderationChangedCount: 1
      }]
    });
    expect(JSON.stringify(result)).not.toMatch(/old-private-id|new-private-id|retired-private-id/);
  });

  it("recognizes review status appearing or disappearing", () => {
    const a = welcome(empty(), [{ id: "m", type: "WELCOME_MESSAGE" }]);
    const b = welcome(empty(), [{
      id: "m", type: "WELCOME_MESSAGE", auditStatus: "REVIEWING"
    }]);
    expect(diffTikTokAutoMessageSnapshots(a, b).changes[0]?.moderationChangedCount).toBe(1);
    expect(diffTikTokAutoMessageSnapshots(b, a).changes[0]?.moderationChangedCount).toBe(1);
  });

  it("does not mistake reorderings for changes", () => {
    const a = welcome(empty(), [
      { id: "first", type: "WELCOME_MESSAGE", auditStatus: "APPROVED" },
      { id: "second", type: "WELCOME_MESSAGE", auditStatus: "REVIEWING" }
    ]);
    const b = welcome(empty(), [...a.WELCOME_MESSAGE.messages].reverse());
    expect(diffTikTokAutoMessageSnapshots(a, b).changed).toBe(false);
    expect(a.WELCOME_MESSAGE.messages[0]?.id).toBe("first");
  });

  it("does not copy extra private message content into the diff", () => {
    const privateMessage = {
      id: "id-1", type: "WELCOME_MESSAGE", auditStatus: "APPROVED",
      text: "Confidential configured auto-response", username: "private-user"
    } as const;
    const a = empty();
    const b = welcome(a, [privateMessage], true);
    const result = diffTikTokAutoMessageSnapshots(a, b);
    expect(JSON.stringify(result)).not.toContain("Confidential");
    expect(JSON.stringify(result)).not.toContain("private-user");
    expect(result.changes[0]?.addedCount).toBe(1);
  });

  it("rejects a mismatch between distinct TikTok Business Accounts", () => {
    expect(() => diffTikTokAutoMessageSnapshots(empty("account-a"), empty("account-b")))
      .toThrow(TikTokAutoMessageSnapshotDiffError);
  });

  it("rejects inconsistent business identities within one snapshot", () => {
    const a = empty();
    const malformed = {
      ...a,
      SUGGESTED_QUESTION: { ...a.SUGGESTED_QUESTION, businessId: "other" }
    };
    expect(() => diffTikTokAutoMessageSnapshots(a, malformed))
      .toThrow(TikTokAutoMessageSnapshotDiffError);
  });

  it("rejects incomplete or extra automatic-message types", () => {
    const original = empty();
    const incomplete = {
      WELCOME_MESSAGE: original.WELCOME_MESSAGE,
      SUGGESTED_QUESTION: original.SUGGESTED_QUESTION,
      CHAT_PROMPT: original.CHAT_PROMPT
    };
    expect(() => diffTikTokAutoMessageSnapshots(original, incomplete as never))
      .toThrow(TikTokAutoMessageSnapshotDiffError);
    expect(() => diffTikTokAutoMessageSnapshots(original, {
      ...original, CREATIVE_WELCOME: original.WELCOME_MESSAGE
    } as never)).toThrow(TikTokAutoMessageSnapshotDiffError);
  });

  it("fails closed for duplicates, mismatched types and invalid review states", () => {
    const original = empty();
    const valid = { id: "dup", type: "WELCOME_MESSAGE" as TikTokAutoMessageType };
    for (const messages of [
      [valid, valid],
      [{ id: "wrong", type: "CHAT_PROMPT" as TikTokAutoMessageType }],
      [{ id: "bad", type: "WELCOME_MESSAGE" as TikTokAutoMessageType, auditStatus: "UNKNOWN" }]
    ]) {
      expect(() => diffTikTokAutoMessageSnapshots(
        original, welcome(original, messages as readonly TikTokAutoMessageSummary[])
      )).toThrow(TikTokAutoMessageSnapshotDiffError);
    }
  });

  it("rejects malformed enabled status and oversized lists before diffing", () => {
    const original = empty();
    expect(() => diffTikTokAutoMessageSnapshots(original, {
      ...original, WELCOME_MESSAGE: { ...original.WELCOME_MESSAGE, enabled: "ENABLE" }
    } as never)).toThrow(TikTokAutoMessageSnapshotDiffError);
    const messages = Array.from({ length: 1001 }, (_, i) => ({
      id: `message-${i}`, type: "WELCOME_MESSAGE" as const
    }));
    expect(() => diffTikTokAutoMessageSnapshots(original, welcome(original, messages)))
      .toThrow(TikTokAutoMessageSnapshotDiffError);
  });
});
