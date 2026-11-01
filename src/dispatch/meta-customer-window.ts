import { customerReplyWindowEligibility } from "../policy/provider-contract.js";

/**
 * Automated standard customer replies only, never HUMAN_AGENT, marketing
 * tags or template exceptions. Rules are reviewed provider-contract data.
 * Unknown/missing rules deny outbound sends instead of permitting them.
 */
export type MetaReplyEligibility = "eligible" | "missing_timestamp" | "invalid_timestamp" | "outside_window" | "policy_unverified";

export function standardMetaReplyEligibility(
  customerMessageAt: string | undefined,
  now: Date = new Date(),
  channel: "messenger" | "instagram" | "whatsapp" = "messenger"
): MetaReplyEligibility {
  return customerReplyWindowEligibility("meta", channel, "message.send", customerMessageAt, now);
}
