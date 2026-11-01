import {
  evaluateAccountFeature, providerContracts,
  type ObservedAccountFact, type AccountFeatureDecision
} from "../policy/provider-contract.js";

/**
 * Provider-neutral account capability registry projection. No fixed list of
 * accounts, plans, feature names, or hardcoded entitlement booleans.
 *
 * Server-side provider connectors must supply validated, expiring facts and
 * confirmed integration registrations. Never accept this snapshot directly
 * from a public client as an authorization claim.
 */
export interface AccountEvidence {
  provider: string;
  accountId: string;
  accountKind?: string;
  facts: readonly ObservedAccountFact[];
  /** Only IDs of integrations actually installed and authorized in this process. */
  installedFeatures: readonly string[];
}
export type CapabilityReport = Record<string, AccountFeatureDecision>;

export function accountCapabilities(evidence: AccountEvidence, now = new Date()): CapabilityReport {
  return Object.fromEntries(
    providerContracts.features
      .filter((feature) => feature.provider === evidence.provider)
      .map((feature) => [
        feature.id,
        evaluateAccountFeature({
          provider: evidence.provider,
          accountId: evidence.accountId,
          featureId: feature.id,
          ...(evidence.accountKind === undefined ? {} : { accountKind: evidence.accountKind }),
          facts: evidence.facts,
          integrationReady: evidence.installedFeatures.includes(feature.id),
          now
        })
      ])
  );
}
