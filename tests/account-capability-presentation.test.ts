import {describe,expect,it} from "vitest";
import {
  presentAccountCapabilityEvidence
} from "../src/policy/account-capability-presentation.js";
import type {ObservedAccountFact} from "../src/policy/provider-contract.js";

const now=new Date("2026-11-14T12:00:00.000Z");
const observedAt="2026-11-14T11:58:00.000Z";
const validUntil="2026-11-14T12:03:00.000Z";
function fact(provider:string,accountId:string,key:string,
  state:"granted"|"denied"="granted"):ObservedAccountFact{
  return {
    provider,accountId,key,state,source:"provider_connection_readback",
    sourceReference:"private-provider-subject-ref-98765",
    observedAt,validUntil
  };
}
describe("read-only account evidence projection never authorizes tenant sends",()=>{
  it("shows current FREE Telegram business reply requirements as observed, not as permission to send",()=>{
    const result=presentAccountCapabilityEvidence({
      provider:"telegram",accountId:"9001",now,
      facts:[
        fact("telegram","9001","telegram.business_connection"),
        fact("telegram","9001","telegram.rights.can_reply")
      ]
    });
    expect(result.tenantSendingEnabled).toBe(false);
    expect(result.features.find(x=>x.id==="official_account_replies")?.evidenceStatus)
      .toBe("available");
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({key:"telegram.rights.can_reply",
        status:"granted",source:"provider_connection_readback"})
    ]));
    expect(JSON.stringify(result)).not.toContain("private-provider-subject-ref");
    expect(JSON.stringify(result)).not.toContain("Premium");
  });
  it("does not infer Meta plans or Instagram account kind from a valid token",()=>{
    const result=presentAccountCapabilityEvidence({
      provider:"instagram",accountId:"17841438662359631",now,
      facts:[
        fact("instagram","17841438662359631","instagram.oauth"),
        fact("instagram","17841438662359631","instagram.app_access"),
        fact("instagram","17841438662359631",
          "instagram.scope.instagram_business_manage_messages")
      ]
    });
    expect(result.features.find(x=>x.id==="direct_messages")?.evidenceStatus)
      .toBe("unverified");
    expect(JSON.stringify(result)).not.toContain("Plus");
    expect(result.tenantSendingEnabled).toBe(false);
  });
  it("shows denied and expired rights separately, never resurrects an earlier grant",()=>{
    const denied={...fact("telegram","9001","telegram.rights.can_reply","denied"),
      observedAt:"2026-11-14T11:59:00Z",validUntil:"2026-11-14T12:01:00Z"};
    const all=[
      fact("telegram","9001","telegram.business_connection"),
      fact("telegram","9001","telegram.rights.can_reply"),
      denied
    ];
    const valid=presentAccountCapabilityEvidence({
      provider:"telegram",accountId:"9001",now,facts:all
    });
    expect(valid.features.find(x=>x.id==="official_account_replies")?.evidenceStatus)
      .toBe("needs_permission");
    const stale=presentAccountCapabilityEvidence({
      provider:"telegram",accountId:"9001",facts:all,
      now:new Date("2026-11-14T12:02:00Z")
    });
    expect(stale.features.find(x=>x.id==="official_account_replies")?.evidenceStatus)
      .toBe("unverified");
    expect(stale.evidence.find(x=>x.key==="telegram.rights.can_reply")?.status)
      .toBe("expired");
  });
  it("never combines facts from different provider/account IDs, unknown keys or unknown providers",()=>{
    const x=presentAccountCapabilityEvidence({
      provider:"telegram",accountId:"9002",now,
      facts:[fact("telegram","9001","telegram.business_connection"),
        fact("instagram","9002","telegram.rights.can_reply"),
        fact("telegram","9002","telegram.secret.internal")]
    });
    expect(x.evidence.some(f=>f.key.includes("secret"))).toBe(false);
    expect(x.features.find(f=>f.id==="official_account_replies")?.evidenceStatus)
      .toBe("unverified");
    const unknown=presentAccountCapabilityEvidence({
      provider:"future_platform",accountId:"9001",now,facts:[]
    });
    expect(unknown.features).toEqual([]);
    expect(unknown.evidence).toEqual([]);
    expect(unknown.tenantSendingEnabled).toBe(false);
  });
});