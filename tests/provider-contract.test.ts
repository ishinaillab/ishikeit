import { describe, expect, it } from "vitest";
import {
  customerReplyWindowEligibility, evaluateAccountFeature, providerContractSchema,
  providerContracts, type ObservedAccountFact
} from "../src/policy/provider-contract.js";

const now = new Date("2026-11-02T04:00:00.000Z");
const observedAt = "2026-11-02T03:00:00.000Z";
const validUntil = "2026-11-02T05:00:00.000Z";
const verified = (key: string, state: "granted" | "denied" = "granted"): ObservedAccountFact => ({
  provider: key.split(".")[0]!, accountId: "acct-a", key, state, source: "provider_api", sourceReference: "authorized-readback",
  observedAt, validUntil
});
const catalog = providerContracts;

describe("data-driven provider policies", () => {
  it("keeps the four current windows in reviewed, versioned data", () => {
    expect(catalog.revision).toBe("2026-11-02.1");
    expect(catalog.policies.map((p) => p.provider + "/" + p.channel)).toEqual([
      "meta/messenger", "meta/instagram", "meta/whatsapp", "telegram/business"
    ]);
    for (const policy of catalog.policies) {
      expect(policy.source).toMatch(/^https:/u);
      expect(policy.reviewedOn).toBe("2026-11-02");
    }
  });
  it("fails closed if provider, channel, operation or policy is not defined", () => {
    expect(customerReplyWindowEligibility("meta", "unknown", "message.send", observedAt, now)).toBe("policy_unverified");
    expect(customerReplyWindowEligibility("meta", "messenger", "message.delete", observedAt, now)).toBe("policy_unverified");
  });
  it("preserves strict 24h Meta and Telegram enforcement including safety margins", () => {
    expect(customerReplyWindowEligibility("meta", "messenger", "message.send", "2026-11-01T04:04:59Z", now)).toBe("outside_window");
    expect(customerReplyWindowEligibility("meta", "messenger", "message.send", "2026-11-01T04:05:01Z", now)).toBe("eligible");
    expect(customerReplyWindowEligibility("telegram", "business", "message.send", "2026-11-01T04:00:00Z", now)).toBe("outside_window");
    expect(customerReplyWindowEligibility("meta", "whatsapp", "message.send", undefined, now)).toBe("missing_timestamp");
  });
  it("supports reviewed policy modifications as data, with no code changes", () => {
    const copy = structuredClone(providerContracts);
    const rule = copy.policies.find((p) => p.channel === "messenger");
    expect(rule).toBeDefined();
    if (rule === undefined) return;
    rule.maxAgeMs = 2 * 60 * 60 * 1000;
    const updated = providerContractSchema.parse(copy);
    expect(customerReplyWindowEligibility("meta", "messenger", "message.send", "2026-11-02T01:00:00Z", now, updated)).toBe("outside_window");
    expect(customerReplyWindowEligibility("meta", "instagram", "message.send", "2026-11-02T01:00:00Z", now, updated)).toBe("eligible");
  });
  it("rejects invalid or duplicate provider contracts", () => {
    const duplicate = structuredClone(providerContracts);
    duplicate.policies.push(duplicate.policies[0]!);
    expect(providerContractSchema.safeParse(duplicate).success).toBe(false);
    const invalid = structuredClone(providerContracts);
    invalid.policies[0]!.marginMs = invalid.policies[0]!.maxAgeMs;
    expect(providerContractSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("extensible per-account capability decisions", () => {
  it("allows free Telegram business replies only with current provider rights", () => {
    const facts = [verified("telegram.business_connection"), verified("telegram.rights.can_reply")];
    expect(evaluateAccountFeature({ accountId: "acct-a", provider: "telegram", featureId: "official_account_replies", facts, integrationReady: true, now }).status).toBe("available");
    const denied = [verified("telegram.business_connection"), verified("telegram.rights.can_reply", "denied")];
    expect(evaluateAccountFeature({ accountId: "acct-a", provider: "telegram", featureId: "official_account_replies", facts: denied, integrationReady: true, now }).status).toBe("needs_permission");
  });
  it("does not use account plan, label, or unsupported kind to invent permissions", () => {
    const facts = [
      verified("instagram.oauth"), verified("instagram.app_access"),
      verified("instagram.scope.instagram_business_manage_messages")
    ];
    expect(evaluateAccountFeature({ accountId: "acct-a",
      provider: "instagram", featureId: "direct_messages", accountKind: "personal", facts, integrationReady: true, now
    }).status).toBe("unsupported");
    expect(evaluateAccountFeature({ accountId: "acct-a",
      provider: "instagram", featureId: "direct_messages", accountKind: "business", facts, integrationReady: true, now
    }).status).toBe("available");
    expect(evaluateAccountFeature({ accountId: "acct-a",
      provider: "instagram", featureId: "direct_messages", accountKind: "unknown", facts, integrationReady: true, now
    }).status).toBe("unverified");
  });
  it("treats expired proof, invalid time and missing provenance as unverified", () => {
    const facts = [verified("telegram.business_connection"), verified("telegram.rights.can_reply")];
    expect(evaluateAccountFeature({ accountId: "acct-a",
      provider: "telegram", featureId: "official_account_replies", facts,
      now: new Date("2026-11-03")
    }).status).toBe("unverified");
    const missingSource = facts.map((p) => ({ ...p, sourceReference: "" }));
    expect(evaluateAccountFeature({ accountId: "acct-a",
      provider: "telegram", featureId: "official_account_replies", facts: missingSource, integrationReady: true, now
    }).status).toBe("unverified");
  });
  it("latest verified revocation overrides historical grant", () => {
    const facts = [
      verified("telegram.business_connection"),
      verified("telegram.rights.can_reply"),
      { ...verified("telegram.rights.can_reply", "denied"), observedAt: "2026-11-02T03:30:00Z" }
    ];
    expect(evaluateAccountFeature({ accountId: "acct-a", provider: "telegram", featureId: "official_account_replies", facts, integrationReady: true, now }).status).toBe("needs_permission");
  });
  it("does not leak permissions across connected provider accounts", () => {
    const facts = [verified("telegram.business_connection"), verified("telegram.rights.can_reply")];
    expect(evaluateAccountFeature({
      accountId: "acct-b", provider: "telegram", featureId: "official_account_replies",
      facts, integrationReady: true, now
    }).status).toBe("unverified");
    const forged = facts.map((fact) => ({ ...fact, provider: "instagram" }));
    expect(evaluateAccountFeature({
      accountId: "acct-a", provider: "telegram", featureId: "official_account_replies",
      facts: forged, integrationReady: true, now
    }).status).toBe("unverified");
  });
  it("does not reactivate a previous grant when a newer denial has expired", () => {
    const facts = [
      { ...verified("telegram.business_connection"), validUntil: "2026-11-05T00:00:00Z" },
      { ...verified("telegram.rights.can_reply"), validUntil: "2026-11-05T00:00:00Z" },
      { ...verified("telegram.rights.can_reply", "denied"),
        observedAt: "2026-11-02T03:30:00Z", validUntil: "2026-11-02T03:45:00Z" }
    ];
    expect(evaluateAccountFeature({
      accountId: "acct-a", provider: "telegram", featureId: "official_account_replies",
      facts, integrationReady: true, now
    }).status).toBe("unverified");
  });
  it("accepts future features from a manifest but not until there is a supported adapter and current grants", () => {
    const extended = structuredClone(providerContracts);
    extended.features.push({
      provider: "telegram", id: "future_capability", status: "requires_adapter",
      requiredEvidence: ["telegram.future_scope"], source: "https://core.telegram.org/bots/api"
    });
    const pending = providerContractSchema.parse(extended);
    expect(evaluateAccountFeature({ accountId: "acct-a",
      provider: "telegram", featureId: "future_capability", facts: [verified("telegram.future_scope")],
      integrationReady: true, now, catalog: pending
    }).status).toBe("unverified");
    extended.features[extended.features.length - 1]!.status = "implemented";
    const supported = providerContractSchema.parse(extended);
    expect(evaluateAccountFeature({ accountId: "acct-a",
      provider: "telegram", featureId: "future_capability", facts: [verified("telegram.future_scope")],
      integrationReady: true, now, catalog: supported
    }).status).toBe("available");
    expect(evaluateAccountFeature({ accountId: "acct-a",
      provider: "telegram", featureId: "unannounced_capability", facts: [], now, catalog: supported
    }).status).toBe("unverified");
  });
});
