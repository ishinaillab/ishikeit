import {
  evaluateAccountFeature,providerContracts,
  type ObservedAccountFact, type AccountFeatureStatus
} from "./provider-contract.js";

export type CapabilityEvidenceState="granted"|"denied"|"expired"|"unknown";
export interface CapabilityEvidenceView {
  key:string;
  status:CapabilityEvidenceState;
  /** Source kind only, never sourceReference or raw provider OAuth data. */
  source?:ObservedAccountFact["source"];
  observedAt?:string;
  validUntil?:string;
}
export interface AccountCapabilityFeatureView{
  id:string;
  evidenceStatus:AccountFeatureStatus;
  reason:string;
  requiredEvidence:readonly string[];
}
export interface AccountCapabilityPresentation{
  provider:string;
  accountId:string;
  contractRevision:string;
  /** This preview is NOT an authorization or dynamic live-send entitlement. */
  tenantSendingEnabled:false;
  evidence:readonly CapabilityEvidenceView[];
  features:readonly AccountCapabilityFeatureView[];
}

/** Source-bounded, provider-specific, safe-to-show preview.
 * Never infer paid subscriptions, badges, account kind or app review from
 * account display names or provider labels. The reviewed feature catalog is
 * an evidence contract, not proof that a tenant-aware dispatcher is live.
 */
export function presentAccountCapabilityEvidence(input:{
  provider:string;accountId:string;
  facts:readonly ObservedAccountFact[];now?:Date
}):AccountCapabilityPresentation{
  const now=input.now??new Date();
  const seen=now.getTime();
  const features=providerContracts.features.filter(
    rule=>rule.provider===input.provider);
  const allKeys=[...new Set(features.flatMap(x=>x.requiredEvidence))].sort();
  const evidence=allKeys.map(key=>{
    // Persistence stores latest only. If fed multiple rows, deny ties and
    // never resurrect a grant that was later revoked or expired.
    const matches=input.facts.filter(f=>f.provider===input.provider
      && f.accountId===input.accountId&&f.key===key)
      .sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)
        ||(a.state==="denied"?-1:1));
    const latest=matches[0];
    if(latest===undefined)return {key,status:"unknown" as const};
    const obs=Date.parse(latest.observedAt);
    const until=Date.parse(latest.validUntil);
    const valid=Number.isFinite(seen)&&Number.isFinite(obs)
      &&Number.isFinite(until)&&obs<=seen&&until>seen&&until>obs
      &&latest.sourceReference.length>0;
    return {
      key,status:valid?latest.state:"expired" as const,
      source:latest.source,
      observedAt:latest.observedAt,validUntil:latest.validUntil
    };
  });
  return {
    provider:input.provider,accountId:input.accountId,
    contractRevision:providerContracts.revision,
    tenantSendingEnabled:false,
    evidence,
    features:features.map(rule=>{
      const decision=evaluateAccountFeature({
        provider:input.provider,accountId:input.accountId,
        featureId:rule.id,facts:input.facts,now,
        // Evaluate reviewed provider evidence separately from the entirely
        // dormant per-tenant send adapter. Never display "send enabled".
        integrationReady:rule.status==="implemented"
      });
      return {
        id:rule.id,evidenceStatus:decision.status,
        reason:decision.reason,requiredEvidence:decision.requiredEvidence
      };
    })
  };
}
