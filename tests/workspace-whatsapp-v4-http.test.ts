import fastify,{type FastifyInstance} from "fastify";
import {describe,expect,it,vi} from "vitest";
import {
  registerPrivateBrowserAuthRoutes,type BrowserAuthController
} from "../src/http/private-browser-auth-routes.js";

const host="apps.ishinaillab.com",origin="https://"+host;
const workspaceId="123e4567-e89b-42d3-a456-426614174000";
const otherWorkspace="123e4567-e89b-42d3-a456-426614174002";
const connectionId="123e4567-e89b-42d3-a456-426614174001";
const session="A".repeat(43),csrf="C".repeat(43);
const state="S".repeat(43),nonce="N".repeat(43);
const phoneNumberId="123456789012345",messagingAccountId="987654321098765";
const start="/app/auth/workspaces/"+workspaceId+"/connections/whatsapp/start";
const finish="/app/auth/workspaces/"+workspaceId+"/connections/whatsapp/complete";
const signup="/app/auth/workspaces/"+workspaceId+"/whatsapp/signup";
const cookies="__Host-ishikeit-session="+session+
  "; __Host-ishikeit-wa-v4-connect="+workspaceId+"."+nonce;
const headers={host,origin,"sec-fetch-site":"same-origin",
  "content-type":"application/json","x-ishikeit-csrf":csrf};
function setup(enabled:boolean){
  const server=fastify({logger:false});
  const mock={
    get:vi.fn(()=>Promise.resolve({status:"authenticated"})),
    listWorkspaceConnections:vi.fn(()=>Promise.resolve({items:[]})),
    csrf:vi.fn(()=>Promise.resolve(csrf)),
    assertCsrf:vi.fn((_session:string,supplied:string|undefined)=>{
      if(supplied!==csrf)throw Error("forbidden");
    }),
    beginWhatsAppEmbeddedV4:vi.fn(()=>Promise.resolve({
      state,browserNonce:nonce,appId:"1042452472116584",
      configId:"123456789012345",graphVersion:"v26.0",
      expiresAt:"2026-11-14T21:30:00.000Z"
    })),
    completeWhatsAppEmbeddedV4:vi.fn(()=>Promise.resolve({
      connectionId,workspaceId,accountId:phoneNumberId,status:"verifying" as const
    })),
    confirmWhatsAppEmbeddedV4:vi.fn(()=>Promise.resolve({
      connectionId,status:"connected" as const,generation:2
    }))
  };
  registerPrivateBrowserAuthRoutes(server,{
    origin,controller:mock as unknown as BrowserAuthController,
    allowWorkspaceConnections:true,allowWhatsAppEmbeddedV4:enabled
  });
  return {server,mock};
}
async function post(server:FastifyInstance,path:string,payload:Record<string,unknown>,
  cookieHeader="__Host-ishikeit-session="+session,
  extra:Record<string,string>={}){
  return server.inject({
    method:"POST",url:path,
    headers:{...headers,cookie:cookieHeader,...extra},payload
  });
}
describe("WhatsApp Meta Embedded Signup v4 BFF transport (NO live provider sends)",()=>{
  it("has no browser SDK route, login or callback when explicitly OFF",async()=>{
    const {server}=setup(false);
    expect((await post(server,start,{})).statusCode).toBe(404);
    expect((await server.inject({method:"GET",url:signup,headers:{host}}))
      .statusCode).toBe(404);
    expect((await server.inject({method:"GET",
      url:"/app/auth/whatsapp-v4.js",headers:{host}})).statusCode).toBe(404);
    await server.close();
  });
  it("separates the Meta SDK to an owner-screen-only CSP with no inline script",async()=>{
    const {server,mock}=setup(true);
    for(const h of [undefined,"foreign.example"]){
      const bad=await server.inject({method:"GET",url:signup,
        headers:h===undefined?{host}:{host:h,cookie:"__Host-ishikeit-session="+session}});
      expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    }
    const res=await server.inject({method:"GET",url:signup,
      headers:{host,cookie:"__Host-ishikeit-session="+session}});
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    const csp=String(res.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self' https://connect.facebook.net");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(res.body).toContain("https://connect.facebook.net/en_US/sdk.js");
    expect(res.body).toContain("data-workspace-id=\""+workspaceId+"\"");
    expect(res.body).not.toContain(nonce);
    expect(mock.get).toHaveBeenCalledWith(session);
    expect(mock.listWorkspaceConnections).toHaveBeenCalledWith(
      session,workspaceId);
    const js=await server.inject({method:"GET",url:"/app/auth/whatsapp-v4.js",
      headers:{host,cookie:"__Host-ishikeit-session="+session}});
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain("WA_EMBEDDED_SIGNUP");
    expect(js.body).toContain("override_default_response_type:true");
    expect(js.body).toContain("https://www.facebook.com");
    expect(js.body).toContain("https://web.facebook.com");
    expect(js.body).not.toContain("endsWith('facebook.com')");
    expect(js.body).not.toContain("localStorage");
    expect(js.body).not.toContain("console.log");
    expect(js.body).not.toContain(nonce);
    await server.close();
  });
  it("requires same Origin/Host, CSRF and authenticated session for one-use initiation",async()=>{
    const {server,mock}=setup(true);
    for(const extra of [
      {origin:"https://foreign.example"},
      {host:"foreign.example"},
      {"sec-fetch-site":"cross-site"},
      {"x-ishikeit-csrf":"bad"},
      {cookie:""}
    ]){
      const r=await post(server,start,{},"__Host-ishikeit-session="+session,extra);
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(mock.beginWhatsAppEmbeddedV4).not.toHaveBeenCalled();
    const ok=await post(server,start,{});
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["set-cookie"]).toContain("__Host-ishikeit-wa-v4-connect=");
    expect(ok.headers["set-cookie"]).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(ok.body).toContain(state);
    expect(ok.body).not.toContain(nonce);
    expect(ok.body).not.toContain(session);
    expect(mock.beginWhatsAppEmbeddedV4).toHaveBeenCalledWith(session,workspaceId);
    await server.close();
  });
  it("accepts only exact workspace nonce and validated numeric Meta IDs on POST, never browser tokens",async()=>{
    const {server,mock}=setup(true);
    const body={state,authorizationCode:"meta-exchange-code-123456",
      phoneNumberId,messagingAccountId};
    for(const c of [
      "", "__Host-ishikeit-session="+session,
      cookies+"; __Host-ishikeit-wa-v4-connect="+workspaceId+"."+nonce,
      cookies.replace(nonce,"invalid_nonce"),
      cookies.replace(workspaceId,otherWorkspace)
    ]){
      const r=await post(server,finish,body,c);
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    for(const invalid of [
      {...body,messagingAccountId:"0"},
      {...body,phoneNumberId:"<script>"},
      {...body,authorizationCode:"x"},
      {...body,accessToken:"attacker"}, {...body,state:"wrong"}
    ]){
      const r=await post(server,finish,invalid,cookies);
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(mock.completeWhatsAppEmbeddedV4).not.toHaveBeenCalled();
    const ok=await post(server,finish,body,cookies);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["set-cookie"]).toContain("Max-Age=0");
    expect(ok.body).not.toContain(nonce);
    expect(ok.body).not.toContain("businessToken");
    expect(mock.completeWhatsAppEmbeddedV4).toHaveBeenCalledWith(session,{
      workspaceId,state,browserNonce:nonce,...{
        authorizationCode:body.authorizationCode,phoneNumberId,messagingAccountId
      }
    });
    await server.close();
  });
  it("requires fresh owner CSRF for exact workspace connection activation",async()=>{
    const {server,mock}=setup(true);
    const path="/app/auth/workspaces/"+workspaceId+"/connections/"+
      connectionId+"/whatsapp-activate";
    expect((await post(server,path,{},cookies,{"x-ishikeit-csrf":"bad"}))
      .statusCode).toBe(403);
    expect(mock.confirmWhatsAppEmbeddedV4).not.toHaveBeenCalled();
    const r=await post(server,path,{},cookies);
    expect(r.statusCode).toBe(200);
    expect(mock.confirmWhatsAppEmbeddedV4).toHaveBeenCalledWith(
      session,workspaceId,connectionId);
    await server.close();
  });
});
