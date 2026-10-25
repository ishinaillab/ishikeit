import { createHash } from "node:crypto";
import type { TikTokBusinessMessageSummary } from "./tiktok-business-read.js";

/**
 * A bounded, offline dry run over an already-authorized provider message batch.
 *
 * Never reads provider credentials, stores events, queues work, generates AI
 * replies, or sends messages. This is NOT proof that provider history is complete.
 */
export interface TikTokReconciliationPreviewInput {
  expectedBusinessId: string;
  authorizedBusinessId: string;
  conversationId: string;
  providerMessages: readonly TikTokBusinessMessageSummary[];
  persistedProviderMessageIds: readonly string[];
}

export interface TikTokReconciliationPreview {
  mode: "dry_run";
  coverage: "provided_batch_only";
  conversationIdSha256: string;
  providerRows: number;
  uniqueProviderMessages: number;
  duplicateProviderRows: number;
  alreadyPersisted: number;
  missingCount: number;
  /** Digests are for correlation, not backfill requests or customer messaging. */
  missingMessageIdSha256: readonly string[];
}

const MAX_PROVIDER_ROWS = 500;
const MAX_PERSISTED_IDS = 10_000;

function boundedArray(value: unknown, limit: number): boolean {
  return Array.isArray(value) && value.length <= limit;
}

function containsControlCodePoint(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && (code < 32 || code === 127)) return true;
  }
  return false;
}

function opaqueId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string"
    && value.length >= 1
    && value.length <= maxLength
    && value.trim() === value
    && !containsControlCodePoint(value)
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function previewTikTokHistoryReconciliation(
  input: TikTokReconciliationPreviewInput
): TikTokReconciliationPreview {
  if (
    !opaqueId(input.expectedBusinessId, 256)
    || !opaqueId(input.authorizedBusinessId, 256)
    || input.expectedBusinessId !== input.authorizedBusinessId
  ) {
    throw new Error("TikTok reconciliation requires exact authorized Business Account");
  }

  if (!opaqueId(input.conversationId, 2048)) {
    throw new Error("TikTok reconciliation requires a valid conversation ID");
  }

  if (
    !boundedArray(input.providerMessages, MAX_PROVIDER_ROWS)
    || !boundedArray(input.persistedProviderMessageIds, MAX_PERSISTED_IDS)
  ) {
    throw new Error("TikTok reconciliation batch exceeds bounded input limits");
  }

  const persisted = new Set<string>();
  for (const id of input.persistedProviderMessageIds) {
    if (!opaqueId(id, 2048)) {
      throw new Error("TikTok reconciliation persisted message ID is invalid");
    }
    persisted.add(id);
  }

  const encountered = new Set<string>();
  const missing = new Set<string>();
  let duplicates = 0;
  let alreadyPersisted = 0;

  for (const row of input.providerMessages) {
    if (
      row === null
      || typeof row !== "object"
      || !opaqueId(row.messageId, 2048)
      || row.conversationId !== input.conversationId
    ) {
      throw new Error("TikTok reconciliation provider message is invalid or wrong conversation");
    }

    if (
      row.timestampMs !== undefined
      && (!Number.isSafeInteger(row.timestampMs) || row.timestampMs < 0)
    ) {
      throw new Error("TikTok reconciliation message timestamp is invalid");
    }

    if (encountered.has(row.messageId)) {
      duplicates += 1;
      continue;
    }
    encountered.add(row.messageId);

    if (persisted.has(row.messageId)) {
      alreadyPersisted += 1;
    } else {
      missing.add(sha256(row.messageId));
    }
  }

  return {
    mode: "dry_run",
    coverage: "provided_batch_only",
    conversationIdSha256: sha256(input.conversationId),
    providerRows: input.providerMessages.length,
    uniqueProviderMessages: encountered.size,
    duplicateProviderRows: duplicates,
    alreadyPersisted,
    missingCount: missing.size,
    missingMessageIdSha256: [...missing].sort()
  };
}
