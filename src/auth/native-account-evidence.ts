import type {PostgresAccountCapabilityFacts} from "../persistence/account-capability-facts.js";
import type {ObservedAccountFact} from "../policy/provider-contract.js";

export type NativeAccountEvidenceSink=Pick<PostgresAccountCapabilityFacts,"record">;

type NativeObservedRight={
  key:string;
  source:ObservedAccountFact["source"];
  sourceReference:string;
};

/**
 * Keep evidence projection separate from connection activation. The exact
 * provider/account/app identity and list of individually proven facts MUST
 * come from a fresh, server-side, authenticated provider readback. This
 * method does not decide an app-review privilege, account tier, or send
 * eligibility, and must never turn a failed optional cache write into an
 * OAuth confirmation retry after the registry has committed.
 */
export async function recordNativeAccountIdentityEvidence(input:{
  sink:NativeAccountEvidenceSink|undefined;
  provider:string;
  accountId:string;
  providerApplicationKey:string;
  sourceConnectionId:string;
  observedAt:Date;
  observations:readonly NativeObservedRight[];
}):Promise<void>{
  if(input.sink===undefined||input.observations.length===0)return;
  const observedAt=input.observedAt;
  const validUntil=new Date(observedAt.getTime()+300000);
  const facts=input.observations.map(({key,source,sourceReference})=>({
    provider:input.provider,
    accountId:input.accountId,
    providerApplicationKey:input.providerApplicationKey,
    sourceConnectionId:input.sourceConnectionId,
    key,state:"granted" as const,source,sourceReference,
    observedAt:observedAt.toISOString(),validUntil:validUntil.toISOString()
  }));
  try{
    await input.sink.record(facts);
  }catch{
    // The private owner preview will show unverified until fresh readback.
    // Activation already succeeded and must never be retried as a side effect.
  }
}
