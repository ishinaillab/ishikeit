import { describe, expect, it, vi } from "vitest";
import { proveOneTimeInstagramRefresh, type OneTimeProofDependencies } from "../src/observability/instagram-once-proof.js";

function fixture() {
  let current = {
    provider:"instagram",
    accountId:"28436714725987041",
    tokenVersion:1,
    accessExpiresAt:new Date("2026-12-28T23:52:32.169Z"),
    accessToken:"fixture-legacy-opaque-value-long",
    scopes:["instagram_business_basic"]
  };
  let attempted=false;
  const query=vi.fn((sql:string)=>{
    if(sql.includes("SELECT token_version")) return Promise.resolve({
      rowCount:1,rows:[{token_version:current.tokenVersion,access_expires_at:current.accessExpiresAt,
        updated_at:new Date("2026-10-29T23:52:32.592Z")}]
    });
    if(sql.includes("INSERT INTO public.ishikeit_instagram_renewal_once")) {
      const accepted=!attempted;
      attempted=true;
      return Promise.resolve({rowCount:accepted?1:0,rows:accepted?[{run_id:"once"}]:[]});
    }
    return Promise.resolve({rowCount:1,rows:[]});
  });
  const store={
    get:vi.fn(()=>Promise.resolve(current)),
    aliasesForCredential:vi.fn(()=>Promise.resolve(["17841438662359631"])),
    isRevoked:vi.fn(()=>Promise.resolve(false)),
    put:vi.fn((next:{accessToken:string;accessExpiresAt:Date})=>{
      current={...current,accessToken:next.accessToken,accessExpiresAt:next.accessExpiresAt,tokenVersion:2};
      return Promise.resolve();
    })
  };
  const client={
    refresh:vi.fn(()=>Promise.resolve({
      accessToken:"fixture-renewed-opaque-value-long",accessExpiresInSeconds:5184000
    })),
    resolveProfessionalAccountId:vi.fn(()=>Promise.resolve("17841438662359631"))
  };
  const opts={
    db:{query,withAdvisoryLock:(_name:string,work:()=>Promise<unknown>)=>work()},
    store,client,now:()=>new Date("2026-11-01T02:00:00.000Z")
  } as unknown as OneTimeProofDependencies;
  return {opts,query,store,client};
}
describe("single-use Instagram refresh proof",()=>{
  it("checks identity and persists the new version once",async()=>{
    const f=fixture();
    expect(await proveOneTimeInstagramRefresh(f.opts)).toBe("succeeded");
    expect(f.client.refresh).toHaveBeenCalledTimes(1);
    expect(f.store.put).toHaveBeenCalledTimes(1);
    expect(await proveOneTimeInstagramRefresh(f.opts)).toBe("skipped");
    expect(f.client.refresh).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched account mapping before any provider activity",async()=>{
    const f=fixture();
    f.store.aliasesForCredential.mockResolvedValueOnce(["wrong"]);
    expect(await proveOneTimeInstagramRefresh(f.opts)).toBe("skipped");
    expect(f.client.refresh).not.toHaveBeenCalled();
  });
  it("refuses to persist a refresh for an unexpected Professional account",async()=>{
    const f=fixture();
    f.client.resolveProfessionalAccountId.mockResolvedValueOnce("wrong");
    expect(await proveOneTimeInstagramRefresh(f.opts)).toBe("failed");
    expect(f.store.put).not.toHaveBeenCalled();
    expect(await proveOneTimeInstagramRefresh(f.opts)).toBe("already_attempted");
    expect(f.client.refresh).toHaveBeenCalledTimes(1);
  });
  it("keeps the durable claim after provider failure so a new process cannot retry",async()=>{
    const f=fixture();
    f.client.refresh.mockRejectedValueOnce(new Error("simulated rejection"));
    expect(await proveOneTimeInstagramRefresh(f.opts)).toBe("failed");
    expect(await proveOneTimeInstagramRefresh(f.opts)).toBe("already_attempted");
    expect(f.client.refresh).toHaveBeenCalledTimes(1);
  });
});
