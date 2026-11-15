import fastify,{type FastifyInstance} from "fastify";
import {describe,expect,it,vi} from "vitest";
import {registerPrivateBrowserAuthRoutes,type BrowserAuthController}
  from "../src/http/private-browser-auth-routes.js";

const origin="https://apps.ishinaillab.com";
const host="apps.ishinaillab.com";
const workspaceId="123e4567-e89b-42d3-a456-426614174000";
const connectionId="123e4567-e89b-42d3-a456-426614174001";
const session="S".repeat(43),csrf="C".repeat(43);
const url="/app/auth/workspaces/"+workspaceId+"/connections/"+
  connectionId+"/cancel-pending";
const headers={host,origin,"sec-fetch-site":"same-origin",
  "content-type":"application/json","x-ishikeit-csrf":csrf,
  cookie:"__Host-ishikeit-session="+session};

function setup(enabled:boolean){
  const app=fastify({logger:false});
  const controller={
    assertCsrf:vi.fn((_cookie:string,token:string|undefined)=>{
      if(token!==csrf)throw Error("CSRF proof missing");
    }),
    requestPendingWorkspaceDisconnect:vi.fn(()=>Promise.resolve({
      connectionId,workspaceId,provider:"instagram",accountId:"10001",
      status:"disconnecting",generation:2
    }))
  };
  registerPrivateBrowserAuthRoutes(app,{
    origin,controller:controller as unknown as BrowserAuthController,
    allowWorkspaceConnections:true,
    allowWorkspaceDisconnectRequests:enabled
  });
  return {app,controller};
}
function post(app:FastifyInstance,options:{
  path?:string,headers?:Record<string,string>,body?:unknown
}={}){
  return app.inject({method:"POST",url:options.path??url,
    headers:options.headers??headers,payload:options.body??{}});
}
describe("staged owner-only cancellation of unactivated provider link",()=>{
  it("does not register the mutation unless the independent safety gate is enabled",async()=>{
    const {app,controller}=setup(false);
    expect((await post(app)).statusCode).toBe(404);
    expect(controller.requestPendingWorkspaceDisconnect).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires original same-origin BFF session, correct CSRF and strict JSON",async()=>{
    const {app,controller}=setup(true);
    expect((await post(app,{headers:{...headers,host:"forged.example"}}))
      .statusCode).toBe(403);
    expect((await post(app,{headers:{...headers,"sec-fetch-site":"cross-site"}}))
      .statusCode).toBe(403);
    expect((await post(app,{headers:{...headers,origin:"https://foreign.example"}}))
      .statusCode).toBe(403);
    expect((await post(app,{headers:{...headers,cookie:""}})).statusCode).toBe(401);
    expect((await post(app,{headers:{...headers,"x-ishikeit-csrf":""}}))
      .statusCode).toBe(403);
    expect((await post(app,{headers:{...headers,"content-type":"text/plain"},body:"{}"}))
      .statusCode).toBe(403);
    expect((await post(app,{path:url.replace(connectionId,"not-a-uuid")}))
      .statusCode).toBe(400);
    expect((await post(app,{body:{workspaceId,force:true}})).statusCode).toBe(400);
    expect(controller.requestPendingWorkspaceDisconnect).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns only the registered pending-cleanup status, never a completed disconnect",async()=>{
    const {app,controller}=setup(true);
    const response=await post(app);
    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(controller.requestPendingWorkspaceDisconnect)
      .toHaveBeenCalledWith(session,workspaceId,connectionId);
    expect(response.json()).toMatchObject({
      status:"disconnecting",workspaceId,connectionId,generation:2
    });
    expect(response.body).not.toContain('"status":"disconnected"');
    await app.close();
  });

  it("returns 200 only for an independently finalized tokenless pending claim",async()=>{
    const {app,controller}=setup(true);
    controller.requestPendingWorkspaceDisconnect.mockResolvedValueOnce({
      connectionId,workspaceId,provider:"telegram",accountId:"10001",
      status:"disconnected",generation:3
    });
    const response=await post(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      connectionId,workspaceId,status:"disconnected",generation:3
    });
    expect(response.headers["cache-control"]).toContain("no-store");
    await app.close();
  });

  it("fails closed on foreign/active connections without leaking provider identifiers",async()=>{
    const {app,controller}=setup(true);
    controller.requestPendingWorkspaceDisconnect.mockRejectedValueOnce(
      new Error("foreign tenant account ID 10001 is actively dispatching"));
    const response=await post(app);
    expect(response.statusCode).toBe(403);
    expect(response.body).toContain("cancellation_unavailable");
    expect(response.body).not.toContain("10001");
    expect(response.body).not.toContain("dispatching");
    await app.close();
  });
});
