import fastify,{type FastifyInstance} from "fastify";
import {describe,expect,it,vi} from "vitest";
import {registerPrivateBrowserAuthRoutes,
  type BrowserAuthController} from "../src/http/private-browser-auth-routes.js";

const origin="https://apps.ishinaillab.com",host="apps.ishinaillab.com";
const workspaceId="123e4567-e89b-42d3-a456-426614174000";
const connectionId="123e4567-e89b-42d3-a456-426614174001";
const cookie="A".repeat(43);
const target="/app/auth/workspaces/"+workspaceId+
  "/connections/"+connectionId+"/capabilities";
const status={
  connection:{workspaceId,connectionId,provider:"telegram",accountId:"9001",
    status:"connected",generation:2},
  capability:{provider:"telegram",accountId:"9001",
    contractRevision:"2026-11-02.1",tenantSendingEnabled:false,
    evidence:[{key:"telegram.rights.can_reply",status:"denied",
      source:"provider_connection_readback",validUntil:"2026-11-14T12:05:00Z"}],
    features:[{id:"official_account_replies",evidenceStatus:"needs_permission",
      reason:"Provider authorization denied/revoked: telegram.rights.can_reply",
      requiredEvidence:["telegram.business_connection","telegram.rights.can_reply"]}]
  }
};
function setup(enabled:boolean){
  const app=fastify({logger:false});
  const mock={
    workspaceAccountCapabilities:vi.fn(()=>Promise.resolve(status))
  };
  registerPrivateBrowserAuthRoutes(app,{
    origin,controller:mock as unknown as BrowserAuthController,
    allowWorkspaceConnections:enabled
  });
  return {app,mock};
}
async function get(app:FastifyInstance,path=target,cookieValue=cookie,
  extra:Record<string,string>={}){
  return app.inject({
    method:"GET",url:path,headers:{host,
      "sec-fetch-site":"same-origin",
      ...(cookieValue?{cookie:"__Host-ishikeit-session="+cookieValue}:{}),
      ...extra}
  });
}
describe("private read-only owner account capability evidence transport",()=>{
  it("has no capability route without explicitly enabled owner inventory",async()=>{
    const {app,mock}=setup(false);
    expect((await get(app)).statusCode).toBe(404);
    expect(mock.workspaceAccountCapabilities).not.toHaveBeenCalled();
    await app.close();
  });
  it("requires exact same-origin host, browser session and bounded UUIDs",async()=>{
    const {app,mock}=setup(true);
    expect((await get(app,target,"",{cookie:""})).statusCode).toBe(401);
    expect((await get(app,target,cookie,{host:"foreign.example"})).statusCode).toBe(403);
    expect((await get(app,target,cookie,{"sec-fetch-site":"cross-site"})).statusCode).toBe(403);
    expect((await get(app,target.replace(connectionId,"not-a-uuid"))).statusCode)
      .toBe(400);
    expect(mock.workspaceAccountCapabilities).not.toHaveBeenCalled();
    await app.close();
  });
  it("returns only the exact owner-readback projection, never source refs or authorization",async()=>{
    const {app,mock}=setup(true);
    const res=await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["vary"]).toContain("Cookie, Origin");
    expect(mock.workspaceAccountCapabilities).toHaveBeenCalledWith(
      cookie,workspaceId,connectionId);
    expect(JSON.parse(res.body)).toMatchObject(status);
    expect(res.body).not.toContain("accessToken");
    expect(res.body).not.toContain("sourceReference");
    expect(res.body).not.toContain("refreshToken");
    expect(res.body).toContain('"tenantSendingEnabled":false');
    await app.close();
  });
  it("fails closed without disclosing foreign-tenant account data",async()=>{
    const {app,mock}=setup(true);
    mock.workspaceAccountCapabilities.mockRejectedValueOnce(new Error("foreign-tenant authorization denied"));
    const r=await get(app);
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain("foreign-tenant");
    expect(r.body).toContain("capability_evidence_unavailable");
    await app.close();
  });
});