import { randomUUID } from "node:crypto";
import { describe,expect,it,vi } from "vitest";
import { PostgresPlatformAdministratorVerifier } from "../src/auth/platform-administrator.js";
import type { PostgresDatabase } from "../src/persistence/postgres.js";

const userId=randomUUID();
const issuer="https://abcdefghijklmnopqrst.supabase.co/auth/v1";
function make(authorized:boolean,privileged=true){
  const proof={
    principal:{issuer,subject:userId},
    sessionId:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString()
  };
  const identity={
    verifyPrivilegedAccessToken:vi.fn((_token:string)=>{
      void _token;
      return privileged?Promise.resolve(proof)
        :Promise.reject(new Error("Multi-factor authentication required"));
    })
  };
  const query=vi.fn((_sql:string,_args?:readonly unknown[])=>{
    void _sql;void _args;
    return Promise.resolve({rows:[{authorized}],rowCount:1});
  });
  return {
    service:new PostgresPlatformAdministratorVerifier({
      identity,db:{query} as unknown as Pick<PostgresDatabase,"query">
    }),
    query,identity,proof
  };
}
describe("platform super-administrator authorization boundary",()=>{
  it("requires valid AAL2 live verifier and a matching active platform role",async()=>{
    const s=make(true);
    expect(await s.service.verifySuperAdmin("private-access-token")).toEqual(s.proof);
    expect(s.query).toHaveBeenCalledTimes(1);
    const [sql,args]=s.query.mock.calls[0]!;
    expect(sql).toContain("ishikeit_platform_administrators");
    expect(sql).toContain("u.email_confirmed_at IS NOT NULL");
    expect(sql).toContain("p.state='active'");
    expect(args).toEqual([userId,issuer]);
  });
  it("denies valid tenant owner without global platform role",async()=>{
    const s=make(false);
    await expect(s.service.verifySuperAdmin("valid-tenant-owner"))
      .rejects.toThrow(/access denied/i);
  });
  it("refuses AAL1 before querying the platform table",async()=>{
    const s=make(true,false);
    await expect(s.service.verifySuperAdmin("no-second-factor"))
      .rejects.toThrow(/multi-factor/i);
    expect(s.query).not.toHaveBeenCalled();
  });
});
