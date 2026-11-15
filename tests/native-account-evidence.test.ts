import {describe,expect,it,vi} from "vitest";
import {recordNativeAccountIdentityEvidence} from
  "../src/auth/native-account-evidence.js";

describe("provider-native rights readback time is never upgraded by a delayed write",()=>{
  it("persists original readback time and matching expiry instead of when a cache write executes",async()=>{
    const verifiedAt=new Date("2026-11-15T00:00:00.000Z");
    const facts={record:vi.fn((records:unknown)=>{void records;return Promise.resolve(1);})};
    await recordNativeAccountIdentityEvidence({
      sink:facts,
      provider:"telegram",accountId:"987654321",
      providerApplicationKey:"telegram-oidc-1122334455",
      sourceConnectionId:"00000000-0000-4000-8000-000000000001",
      observedAt:verifiedAt,
      observations:[{
        key:"telegram.rights.can_reply",
        source:"provider_connection_readback",
        sourceReference:"getBusinessConnection"
      }]
    });
    expect(facts.record).toHaveBeenCalledTimes(1);
    const evidence=facts.record.mock.calls[0]?.[0] as Array<{
      observedAt:string;validUntil:string;providerApplicationKey:string
    }>;
    expect(evidence[0]?.observedAt).toBe(verifiedAt.toISOString());
    expect(evidence[0]?.validUntil).toBe(
      new Date(verifiedAt.getTime()+300000).toISOString()
    );
  });

  it("a failed optional preview write does not turn a completed provider activation into an error",async()=>{
    await expect(recordNativeAccountIdentityEvidence({
      sink:{record:vi.fn(()=>Promise.reject(new Error("preview unavailable")))},
      provider:"telegram",accountId:"987654321",
      providerApplicationKey:"telegram-oidc-1122334455",
      sourceConnectionId:"00000000-0000-4000-8000-000000000001",
      observedAt:new Date(),
      observations:[{key:"telegram.business_connection",
        source:"provider_connection_readback",
        sourceReference:"getBusinessConnection"}]
    })).resolves.toBeUndefined();
  });
});
