import type {
  TikTokAutoMessageSnapshot,
  TikTokAutoMessageSummary,
  TikTokAutoMessageType
} from "./tiktok-automatic-message-read.js";

export type TikTokAutoMessageSnapshotSet = Readonly<
  Record<TikTokAutoMessageType, TikTokAutoMessageSnapshot>
>;

export interface TikTokAutoMessageTypeChange {
  type: TikTokAutoMessageType;
  previousEnabled: boolean;
  currentEnabled: boolean;
  addedCount: number;
  removedCount: number;
  moderationChangedCount: number;
}

export interface TikTokAutoMessageSnapshotDiff {
  businessId: string;
  changed: boolean;
  changes: readonly TikTokAutoMessageTypeChange[];
}

export class TikTokAutoMessageSnapshotDiffError extends Error {
  constructor() {
    super("Invalid or mismatched TikTok automatic-message snapshots");
    this.name = "TikTokAutoMessageSnapshotDiffError";
  }
}

const types: readonly TikTokAutoMessageType[] = [
  "WELCOME_MESSAGE",
  "SUGGESTED_QUESTION",
  "CHAT_PROMPT",
  "FOLLOW_WELCOME"
];
const statuses = new Set(["REVIEWING", "APPROVED", "REJECTED"]);
const maxMessagesPerType = 1000;

function validate(
  snapshots: TikTokAutoMessageSnapshotSet
): {
  businessId: string;
  messages: Readonly<Record<TikTokAutoMessageType, ReadonlyMap<string, TikTokAutoMessageSummary>>>;
} {
  if (
    snapshots === null || typeof snapshots !== "object"
    || Object.keys(snapshots).length !== types.length
    || Object.keys(snapshots).some((type) => !types.includes(type as TikTokAutoMessageType))
  ) {
    throw new TikTokAutoMessageSnapshotDiffError();
  }

  let businessId: string | undefined;
  const messages = {} as Record<TikTokAutoMessageType, ReadonlyMap<string, TikTokAutoMessageSummary>>;
  for (const type of types) {
    const snapshot = snapshots[type];
    if (
      snapshot === null || typeof snapshot !== "object"
      || snapshot.type !== type
      || typeof snapshot.businessId !== "string"
      || snapshot.businessId.trim().length === 0
      || snapshot.businessId.length > 256
      || typeof snapshot.enabled !== "boolean"
      || !Array.isArray(snapshot.messages)
      || snapshot.messages.length > maxMessagesPerType
    ) {
      throw new TikTokAutoMessageSnapshotDiffError();
    }
    if (businessId !== undefined && businessId !== snapshot.businessId) {
      throw new TikTokAutoMessageSnapshotDiffError();
    }
    businessId = snapshot.businessId;

    const byId = new Map<string, TikTokAutoMessageSummary>();
    for (const message of snapshot.messages as readonly TikTokAutoMessageSummary[]) {
      if (
        message === null || typeof message !== "object"
        || typeof message.id !== "string" || message.id.length === 0
        || message.id.length > 2048 || message.type !== type
        || (message.auditStatus !== undefined && !statuses.has(message.auditStatus))
        || byId.has(message.id)
      ) {
        throw new TikTokAutoMessageSnapshotDiffError();
      }
      byId.set(message.id, message);
    }
    messages[type] = byId;
  }
  return { businessId: businessId!, messages };
}

/**
 * Compare two complete, sanitized four-type snapshots from the same account.
 * No provider request, write, message text, or provider message ID is emitted.
 * This detects only enabled, membership and moderation-status differences;
 * configured message content cannot be compared because the reader omits it.
 */
export function diffTikTokAutoMessageSnapshots(
  previous: TikTokAutoMessageSnapshotSet,
  current: TikTokAutoMessageSnapshotSet
): TikTokAutoMessageSnapshotDiff {
  const before = validate(previous);
  const after = validate(current);
  if (before.businessId !== after.businessId) {
    throw new TikTokAutoMessageSnapshotDiffError();
  }

  const changes: TikTokAutoMessageTypeChange[] = [];
  for (const type of types) {
    const older = before.messages[type];
    const newer = after.messages[type];
    let addedCount = 0;
    let removedCount = 0;
    let moderationChangedCount = 0;
    for (const [id, item] of older) {
      const next = newer.get(id);
      if (next === undefined) removedCount += 1;
      else if (item.auditStatus !== next.auditStatus) moderationChangedCount += 1;
    }
    for (const id of newer.keys()) {
      if (!older.has(id)) addedCount += 1;
    }
    const previousEnabled = previous[type].enabled;
    const currentEnabled = current[type].enabled;
    if (previousEnabled !== currentEnabled || addedCount || removedCount || moderationChangedCount) {
      changes.push({
        type,
        previousEnabled,
        currentEnabled,
        addedCount,
        removedCount,
        moderationChangedCount
      });
    }
  }
  return {
    businessId: before.businessId,
    changed: changes.length > 0,
    changes
  };
}
