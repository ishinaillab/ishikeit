import fastify,{type FastifyInstance} from "fastify";
import {describe,expect,it,vi} from "vitest";
import {registerPrivateBrowserAuthRoutes,type BrowserAuthController}
  from "../src/http/private-browser-auth-routes.js";

const origin="https://apps.ishinaillab.com",host="apps.ishinaillab.com";
const workspaceId="123e4567-e89b-42d3-a456-426614174000";
const connectionId="123e4567-e89b-42d3-a456-426614174001";
const session="S".repeat(43),csrf="C".repeat(43);
const prefix="/app/auth/workspaces/"+workspaceId+"/connections/"+connectionId;
const path=prefix+"/disconnect-active",statusPath=prefix+"/disconnect-status";
const headers={host,origin,"sec-fetch-site":"same-origin",
  "content-type":"application/json","x-ishikeit-csrf":csrf,
  cookie:"__Host-ishikeit-session="+session};
const hold={connectionId,workspaceId,frozenGeneration:3,state:"pending" as const,
  quarantinedJobs:4,uncertainInflightJobs:1,cleanupAttempts:0};

function setup(enabled:boolean,missingInspector=false){
  const app=fastify({logger:false});
  const controller={
    assertCsrf:vi.fn((_cookie:string,proof:string|undefined)=>{
      if(proof!==csrf)throw Error("Invalid browser CSRF token");
    }),
    requestActiveWorkspaceDisconnect:vi.fn(()=>Promise.resolve(hold)),
    inspectActiveWorkspaceDisconnect:vi.fn(()=>Promise.resolve(hold))
  };
  registerPrivateBrowserAuthRoutes(app,{
    origin,controller:{
      ...controller,
      ...(missingInspector?{inspectActiveWorkspaceDisconnect:undefined}:{})
    } as unknown as BrowserAuthController,
    allowWorkspaceConnections:true,
    allowActiveWorkspaceDisconnect:enabled
  });
  return {app,controller};
}
function post(app:FastifyInstance,opts:{
  headers?:Record<string,string>;url?:string;body?:unknown
}={}){
  return app.inject({method:"POST",url:opts.url??path,headers:opts.headers??headers,
    payload:opts.body??{}});
}
function get(app:FastifyInstance,opts:{
  headers?:Record<string,string>;url?:string
}={}){
  return app.inject({method:"GET",url:opts.url??statusPath,
    headers:opts.headers??headers});
}

describe("staged, authenticated ACTIVE connection disconnect browser boundary",()=>{
  it("does not register either endpoint without an explicit gate and both handlers",async()=>{
    for(const [enabled,missingInspector] of [[false,false],[true,true]] as const){
      const {app,controller}=setup(enabled,missingInspector);
      expect((await post(app)).statusCode).toBe(404);
      expect((await get(app)).statusCode).toBe(404);
      expect(controller.requestActiveWorkspaceDisconnect).not.toHaveBeenCalled();
      await app.close();
    }
  });
  it("refuses cross-origin requests, session omission, invalid CSRF and malformed inputs",async()=>{
    const {app,controller}=setup(true);
    expect((await post(app,{headers:{...headers,host:"foreign.example"}}))
      .statusCode).toBe(403);
    expect((await post(app,{headers:{...headers,origin:"https://foreign.example"}}))
      .statusCode).toBe(403);
    expect((await post(app,{headers:{...headers,"sec-fetch-site":"cross-site"}}))
      .statusCode).toBe(403);
    expect((await post(app,{headers:{...headers,"content-type":"text/plain"},body:"{}"}))
      .statusCode).toBe(403);
    expect((await post(app,{headers:{...headers,cookie:""}})).statusCode).toBe(401);
    expect((await post(app,{headers:{...headers,"x-ishikeit-csrf":""}}))
      .statusCode).toBe(403);
    expect((await post(app,{url:path.replace(connectionId,"not-a-uuid")}))
      .statusCode).toBe(400);
    expect((await post(app,{body:{force:true}})).statusCode).toBe(400);
    expect(controller.requestActiveWorkspaceDisconnect).not.toHaveBeenCalled();
    expect((await get(app,{headers:{...headers,host:"foreign.example"}}))
      .statusCode).toBe(403);
    expect((await get(app,{headers:{...headers,cookie:""}}))
      .statusCode).toBe(401);
    expect((await get(app,{url:statusPath.replace(connectionId,"not-a-uuid")}))
      .statusCode).toBe(400);
    expect(controller.inspectActiveWorkspaceDisconnect).not.toHaveBeenCalled();
    await app.close();
  });
  it("accepts only a verified hold as 202 and never asserts provider revocation",async()=>{
    const {app,controller}=setup(true);
    const response=await post(app);
    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(controller.requestActiveWorkspaceDisconnect).toHaveBeenCalledExactlyOnceWith(
      session,workspaceId,connectionId);
    expect(response.json()).toEqual({status:"disconnecting",...hold});
    expect(response.body).not.toContain('"status":"disconnected"');
    expect(response.body).not.toContain("providerAccountId");
    await app.close();
  });
  it("provides scoped sanitized read-only status, not arbitrary provider state",async()=>{
    const {app,controller}=setup(true);
    const response=await get(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({status:"disconnecting",...hold});
    expect(controller.inspectActiveWorkspaceDisconnect)
      .toHaveBeenCalledExactlyOnceWith(session,workspaceId,connectionId);
    controller.inspectActiveWorkspaceDisconnect.mockResolvedValueOnce(undefined as never);
    expect((await get(app)).statusCode).toBe(404);
    await app.close();
  });
  it("fails closed on denied or unavailable owner/AAL2/store checks without leaking exceptions",async()=>{
    const {app,controller}=setup(true);
    controller.requestActiveWorkspaceDisconnect.mockRejectedValueOnce(
      new Error("foreign account 10001 has live provider token"));
    controller.inspectActiveWorkspaceDisconnect.mockRejectedValueOnce(
      new Error("sensitive db error"));
    const failedPost=await post(app);
    const failedGet=await get(app);
    expect(failedPost.statusCode).toBe(403);
    expect(failedGet.statusCode).toBe(403);
    expect(failedPost.body).toContain("active_disconnect_unavailable");
    expect(failedPost.body).not.toContain("10001");
    expect(failedGet.body).not.toContain("sensitive db error");
    await app.close();
  });
});
