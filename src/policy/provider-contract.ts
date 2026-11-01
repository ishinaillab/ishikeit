import { z } from "zod";
import contractData from "./provider-contracts.json" with { type: "json" };

/**
 * Reviewed, versioned official-provider contracts. Values live in JSON data
 * rather than in account-specific switches or scattered enforcement constants.
 * A catalog change needs source review, tests and normal release controls.
 * Never accept provider policy changes from customer data or untrusted webhooks.
 */
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const sourceUrl = z.string().url().refine((url) => url.startsWith("https://"));
const windowSchema = z.object({
  id: identifier,
  provider: identifier,
  channel: identifier,
  operation: identifier,
  kind: z.literal("customer_reply_window"),
  maxAgeMs: z.number().int().positive(),
  marginMs: z.number().int().nonnegative(),
  maxFutureSkewMs: z.number().int().nonnegative(),
  source: sourceUrl,
  reviewedOn: z.iso.date()
}).strict().refine((rule) => rule.marginMs < rule.maxAgeMs, "Margin must be smaller than window");
const featureSchema = z.object({
  provider: identifier,
  id: identifier,
  status: z.enum(["implemented", "requires_adapter"]),
  requiredEvidence: z.array(identifier).min(1),
  accountKinds: z.array(identifier).optional(),
  unsupportedKinds: z.array(identifier).optional(),
  source: sourceUrl
}).strict();
export const providerContractSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().min(1),
  policies: z.array(windowSchema),
  features: z.array(featureSchema)
}).strict().superRefine((catalog, ctx) => {
  for (const [items, key] of [
    [catalog.policies, (item: { id: string }) => item.id],
    [catalog.features, (item: { provider: string; id: string }) => item.provider + "/" + item.id]
  ] as const) {
    const seen = new Set<string>();
    for (const item of items) {
      const id = key(item);
      if (seen.has(id)) ctx.addIssue({ code: "custom", message: "Duplicate provider contract: " + id });
      seen.add(id);
    }
  }
  const windows = new Set<string>();
  for (const policy of catalog.policies) {
    const key = [policy.provider, policy.channel, policy.operation].join("/");
    if (windows.has(key)) ctx.addIssue({ code: "custom", message: "Duplicate outbound policy scope: " + key });
    windows.add(key);
  }
});

export type ProviderContracts = z.infer<typeof providerContractSchema>;
export const providerContracts: ProviderContracts = providerContractSchema.parse(contractData);

export type WindowEligibility = "eligible" | "missing_timestamp" | "invalid_timestamp" | "outside_window" | "policy_unverified";

export function customerReplyWindowEligibility(
  provider: string,
  channel: string,
  operation: string,
  customerMessageAt: string | undefined,
  now: Date = new Date(),
  catalog: ProviderContracts = providerContracts
): WindowEligibility {
  const rule = catalog.policies.find((policy) =>
    policy.provider === provider && policy.channel === channel && policy.operation === operation
  );
  // Missing/unknown policy never makes an outbound operation unrestricted.
  if (rule === undefined) return "policy_unverified";
  if (customerMessageAt === undefined) return "missing_timestamp";
  const timestamp = Date.parse(customerMessageAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now.getTime())) return "invalid_timestamp";
  const elapsed = now.getTime() - timestamp;
  if (elapsed < -rule.maxFutureSkewMs) return "invalid_timestamp";
  return elapsed >= rule.maxAgeMs - rule.marginMs ? "outside_window" : "eligible";
}

export type EvidenceSource = "provider_api" | "oauth_grant" | "signed_webhook" | "provider_connection_readback";
export interface ObservedAccountFact {
  provider: string;
  accountId: string;
  key: string;
  state: "granted" | "denied";
  source: EvidenceSource;
  sourceReference: string;
  observedAt: string;
  validUntil: string;
}

export type AccountFeatureStatus = "available" | "needs_permission" | "unsupported" | "unverified";
export interface AccountFeatureDecision {
  status: AccountFeatureStatus;
  reason: string;
  revision: string;
  requiredEvidence: readonly string[];
  verifiedEvidence: readonly string[];
  evidenceSources: readonly string[];
}

/**
 * Evaluate one feature for one account based only on *fresh, attributed facts*.
 * OAuth tier, a verified badge, a claimed plan and old cached facts do not
 * grant any feature. The caller must obtain and validate each fact server-side.
 * Unrecognized capabilities stay unverified for future provider additions.
 */
export function evaluateAccountFeature(input: {
  provider: string;
  accountId: string;
  featureId: string;
  accountKind?: string;
  facts: readonly ObservedAccountFact[];
  /** True only when the server has actually installed an official integration for the feature. */
  integrationReady?: boolean;
  now?: Date;
  catalog?: ProviderContracts;
}): AccountFeatureDecision {
  const catalog = input.catalog ?? providerContracts;
  const rule = catalog.features.find((item) =>
    item.provider === input.provider && item.id === input.featureId
  );
  const decision = (
    status: AccountFeatureStatus, reason: string,
    verifiedEvidence: string[] = [], evidenceSources: string[] = []
  ): AccountFeatureDecision => ({
    status, reason, revision: catalog.revision,
    requiredEvidence: rule?.requiredEvidence ?? [],
    verifiedEvidence, evidenceSources
  });
  if (rule === undefined) return decision("unverified", "No reviewed provider integration contract");
  if (input.accountId.trim().length === 0) return decision("unverified", "Account identity is not verified");
  if (rule.status !== "implemented" || input.integrationReady !== true) {
    return decision("unverified", "Feature not enabled in the installed official integration");
  }
  if (input.accountKind !== undefined && rule.unsupportedKinds?.includes(input.accountKind)) {
    return decision("unsupported", "Provider API does not support this verified account type");
  }
  if (rule.accountKinds !== undefined && (
    input.accountKind === undefined || !rule.accountKinds.includes(input.accountKind)
  )) return decision("unverified", "Account type or eligibility is not verified");

  const at = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(at)) return decision("unverified", "Current time not reliable");
  const valid = (item: ObservedAccountFact) => {
    const seen = Date.parse(item.observedAt);
    const until = Date.parse(item.validUntil);
    return Number.isFinite(seen) && Number.isFinite(until)
      && seen <= at && until > at && until > seen
      && item.sourceReference.length > 0;
  };
  const verified: string[] = [];
  const sources: string[] = [];
  for (const required of rule.requiredEvidence) {
    // Never fall back to an older grant after a newer denial expires or becomes
    // invalid. Equal-time contradictions must deny until revalidated.
    const matched = input.facts.filter((item) => item.provider === input.provider && item.accountId === input.accountId && item.key === required)
      .sort((a,b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)
        || (a.state === "denied" ? -1 : 1));
    const newest = matched[0];
    if (newest === undefined || !valid(newest)) return decision("unverified", "Missing or expired authoritative evidence: " + required, verified, sources);
    if (newest.state === "denied") return decision("needs_permission", "Provider authorization denied/revoked: " + required, verified, sources);
    verified.push(required);
    sources.push(newest.source + ":" + newest.sourceReference);
  }
  return decision("available", "All reviewed API requirements verified for this account", verified, sources);
}
