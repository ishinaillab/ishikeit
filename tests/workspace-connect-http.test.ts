import fastify, {type FastifyInstance} from "fastify";
import {describe,expect,it,vi} from "vitest";
import {
  registerPrivateBrowserAuthRoutes,type BrowserAuthController
} from "../src/http/private-browser-auth-routes.js";

const origin="https://apps.ishinaillab.com",host="apps.ishinaillab.com";
const cookie="A".repeat(43),csrf="C".repeat(43);
const nonce="N".repeat(43),state="S".repeat(43);
const workspaceId="123e4567-e89b-42d3-a456-426614174000";
const connectionId="123e4567-e89b-42d3-a456-426614174001";
const target="/app/auth/workspaces/"+workspaceId+"/connections/instagram/start";
const url="https://www.instagram.com/oauth/authorize?client_id=123456789&state="+state;
const headers={host,origin,"sec-fetch-site":"same-origin",
  "content-type":"application/json","x-ishikeit-csrf":csrf};
const cookies="__Host-ishikeit-session="+cookie+"; __Host-ishikeit-ig-connect="+workspaceId+"."+nonce;
function setup(enabled:boolean){
  const server=fastify({logger:false});
  const mock={
    beginInstagramConnection:vi.fn(()=>Promise.resolve({
      authorizationUrl:url,expiresAt:"2027-11-14T12:00:00.000Z",browserNonce:nonce
    })),
    completeInstagramConnection:vi.fn(()=>Promise.resolve({
      status:"verifying" as const,connectionId,workspaceId,accountId:"17841438662359631"
    })),
    confirmInstagramConnection:vi.fn(()=>Promise.resolve({
      connectionId,status:"connected" as const,generation:2
    })),
    assertCsrf:vi.fn((_cookie:string,supplied:string|undefined)=>{
      if(supplied!==csrf)throw Error("forbidden");
    }),
    csrf:vi.fn(()=>Promise.resolve(csrf))
  };
  registerPrivateBrowserAuthRoutes(server,{
    origin,controller:mock as unknown as BrowserAuthController,
    allowInstagramConnect:enabled,allowWorkspaceConnections:true
  });
  return {server,mock};
}
async function post(server:FastifyInstance,path:string,payload:Record<string,unknown>,
  cookieHeader="__Host-ishikeit-session="+cookie,
  extra:Record<string,string>={}){
  return await server.inject({
    method:"POST",url:path,
    headers:{...headers,cookie:cookieHeader,...extra},
    payload
  });
}

describe("native Instagram private BFF transport (no live provider calls)",()=>{
  it("has zero connect routes or callback when explicitly disabled",async()=>{
    const {server}=setup(false);
    expect((await post(server,target,{})).statusCode).toBe(404);
    expect((await server.inject({method:"GET",
      url:"/app/auth/connect/instagram/callback?state="+state+"&code=code-12345678",
      headers:{host}})).statusCode).toBe(404);
    await server.close();
  });
  it("requires exact origin, host, CSRF and session to initiate",async()=>{
    const {server,mock}=setup(true);
    for(const extra of [
      {host:"foreign.example"},
      {origin:"https://foreign.example"},
      {"sec-fetch-site":"cross-site"},
      {"x-ishikeit-csrf":"bad"},
      {cookie:""}
    ]){
      const r=await post(server,target,{},"__Host-ishikeit-session="+cookie,extra);
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(mock.beginInstagramConnection).not.toHaveBeenCalled();
    const good=await post(server,target,{});
    expect(good.statusCode).toBe(200);
    expect(good.headers["set-cookie"]).toContain("__Host-ishikeit-ig-connect=");
    expect(good.headers["set-cookie"]).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(good.body).not.toContain(nonce);
    expect(good.body).not.toContain(cookie);
    expect(mock.beginInstagramConnection).toHaveBeenCalledWith(cookie,workspaceId);
    await server.close();
  });
  it("GET callback never exchanges credentials and uses strict no-referrer CSP",async()=>{
    const {server,mock}=setup(true);
    const response=await server.inject({
      method:"GET",url:"/app/auth/connect/instagram/callback?state="+state+
        "&code=code-12345678",
      headers:{host,"sec-fetch-site":"cross-site"}
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(mock.completeInstagramConnection).not.toHaveBeenCalled();
    const js=await server.inject({method:"GET",url:"/app/auth/instagram-return.js",headers:{host}});
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain("history.replaceState");
    expect(js.body).toContain("x-ishikeit-csrf");
    expect(js.body).not.toContain(nonce);
    await server.close();
  });
  it("POST callback requires one HttpOnly browser nonce and verified BFF cookie",async()=>{
    const {server,mock}=setup(true);
    const path="/app/auth/connect/instagram/complete";
    const payload={state,authorizationCode:"code-12345678"};
    for(const c of [
      "", "__Host-ishikeit-session="+cookie,
      cookies+"; __Host-ishikeit-ig-connect="+workspaceId+"."+nonce,
      cookies.replace(nonce,"invalid_nonce")
    ]){
      const r=await post(server,path,payload,c);
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(mock.completeInstagramConnection).not.toHaveBeenCalled();
    const valid=await post(server,path,payload,cookies);
    expect(valid.statusCode).toBe(200);
    const responseBody:unknown=JSON.parse(valid.body);
    expect(responseBody).toMatchObject({status:"verifying",connectionId});
    expect(valid.body).not.toContain(nonce);
    expect(valid.body).not.toContain(cookie);
    expect(valid.headers["set-cookie"]).toContain("Max-Age=0");
    expect(mock.completeInstagramConnection).toHaveBeenCalledWith(
      cookie,{workspaceId,browserNonce:nonce,
        state,authorizationCode:"code-12345678"}
    );
    await server.close();
  });
  it("requires fresh same-origin CSRF for explicit owner activation",async()=>{
    const {server,mock}=setup(true);
    const path="/app/auth/workspaces/"+workspaceId+"/connections/"+connectionId+"/activate";
    expect((await post(server,path,{},cookies,{"x-ishikeit-csrf":"bad"})).statusCode).toBe(403);
    expect(mock.confirmInstagramConnection).not.toHaveBeenCalled();
    const ok=await post(server,path,{},cookies);
    expect(ok.statusCode).toBe(200);
    const activationBody:unknown=JSON.parse(ok.body);
    expect(activationBody).toEqual({connectionId,status:"connected",generation:2});
    expect(mock.confirmInstagramConnection).toHaveBeenCalledWith(
      cookie,workspaceId,connectionId
    );
    await server.close();
  });
});
