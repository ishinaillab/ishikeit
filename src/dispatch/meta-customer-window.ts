/**
 * Standard automated customer-service replies only. This intentionally does not
 * implement HUMAN_AGENT, marketing tags, WhatsApp templates, or extended windows.
 * Reject missing/invalid provider timestamps and near-boundary sends.
 */
export const META_STANDARD_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_MARGIN_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type MetaReplyEligibility = "eligible" | "missing_timestamp" | "invalid_timestamp" | "outside_window";

export function standardMetaReplyEligibility(customerMessageAt: string | undefined, now: Date = new Date()): MetaReplyEligibility {
  if (customerMessageAt === undefined) return "missing_timestamp";
  const timestamp = Date.parse(customerMessageAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now.getTime())) return "invalid_timestamp";
  const ageMs = now.getTime() - timestamp;
  if (ageMs < -MAX_FUTURE_SKEW_MS) return "invalid_timestamp";
  if (ageMs >= META_STANDARD_REPLY_WINDOW_MS - SAFETY_MARGIN_MS) return "outside_window";
  return "eligible";
}
