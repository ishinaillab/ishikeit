import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import type { BrowserAuthController } from "../src/http/private-browser-auth-routes.js";
import type { InboundStore } from "../src/persistence/inbound.js";

const origin="https://apps.ishinaillab.com";
const host="apps.ishinaillab.com";
const token="A".repeat(43);
const login="B".repeat(43);
const csrf="C".repeat(43);
function testServer(enabled=true){
  const controller={
    begin:vi.fn((_email:string,_ip:string)=>{void _email;void _ip;return Promise.resolve(login);}),
    verify:vi.fn((_nonce:string,_code:string,_ip:string)=>{void _nonce;void _code;void _ip;return Promise.resolve({
      cookieValue:token,csrfToken:csrf
    });}),
    get:vi.fn((_cookie:string)=>{void _cookie;return Promise.resolve({
      sessionId:"session",expiresAt:"2027-01-01T00:00:00Z",
      csrfToken:csrf,workspaces:{items:[{
        workspaceId:"123e4567-e89b-42d3-a456-426614174000",
        displayName:"Workspace",role:"owner" as const,connectedAccounts:0
      }]}
    });}),
    listWorkspaces:vi.fn((_cookie:string,_after?:string)=>{void _cookie;void _after;return Promise.resolve({items:[]});}),
    refresh:vi.fn((_cookie:string)=>{void _cookie;return Promise.resolve({
      sessionId:"session",expiresAt:"2027-01-01T00:00:00Z",
      csrfToken:csrf,workspaces:{items:[]}
    });}),
    csrf:vi.fn((_cookie:string)=>{void _cookie;return Promise.resolve(csrf);}),
    logout:vi.fn((_cookie:string)=>{void _cookie;return Promise.resolve();}),
    assertCsrf:vi.fn((_cookie:string,header:string|undefined)=>{
      void _cookie;
      if(header!==csrf)throw new Error("Invalid CSRF");
    })
  } satisfies BrowserAuthController;
  const server=buildServer({
    logger:pino({level:"silent"}),
    inbound:{ingest:vi.fn<InboundStore["ingest"]>()},
    ready:()=>Promise.resolve(true),appSecret:"secret",verifyToken:"test-verify",
    ...(enabled?{browserAuth:{origin,controller}}:{})
  });
  return {server,controller};
}
const headers={
  host,origin,"content-type":"application/json",
  "sec-fetch-site":"same-origin"
};
function authCookie(){return "__Host-ishikeit-session="+token;}
function loginCookie(){return "__Host-ishikeit-login="+login;}

describe("private cookie-only browser auth routes",()=>{
  it("registers no login/session endpoints when production gate is absent",async()=>{
    const {server}=testServer(false);
    const r=await server.inject({method:"GET",url:"/app/auth/session",headers:{host}});
    expect(r.statusCode).toBe(404);
    await server.close();
  });
  it("checks exact Host and Origin for every authentication mutation",async()=>{
    const {server,controller}=testServer();
    for(const h of [
      {...headers,origin:"https://evil.test"},
      {...headers,host:"evil.test"},
      {...headers,"sec-fetch-site":"cross-site"},
      {...headers,"content-type":"text/plain"}
    ]){
      const r=await server.inject({
        method:"POST",url:"/app/auth/request-otp",headers:h,payload:JSON.stringify({email:"person@example.com"})
      });
      expect(r.statusCode).toBe(403);
    }
    expect(controller.begin).not.toHaveBeenCalled();
    await server.close();
  });
  it("issues a host-only HttpOnly secure login cookie without leaking tokens",async()=>{
    const {server,controller}=testServer();
    const r=await server.inject({
      method:"POST",url:"/app/auth/request-otp",headers,payload:{email:"person@example.com"}
    });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({status:"if_invited_code_sent"});
    expect(r.headers["set-cookie"]).toContain("__Host-ishikeit-login="+login);
    expect(r.headers["set-cookie"]).toContain("Secure; SameSite=Strict");
    expect(r.headers["set-cookie"]).toContain("HttpOnly");
    expect(r.headers["set-cookie"]).not.toContain("Domain=");
    expect(r.headers["cache-control"]).toContain("no-store");
    expect(controller.begin).toHaveBeenCalledTimes(1);
    await server.close();
  });
  it("verifies code only with bound pending cookie and rotates into fresh opaque session",async()=>{
    const {server,controller}=testServer();
    const missing=await server.inject({
      method:"POST",url:"/app/auth/verify-otp",headers,payload:{code:"123456"}
    });
    expect(missing.statusCode).toBe(400);
    const valid=await server.inject({
      method:"POST",url:"/app/auth/verify-otp",
      headers:{...headers,cookie:loginCookie()},payload:{code:"123456"}
    });
    expect(valid.statusCode).toBe(200);
    const cookies=valid.headers["set-cookie"];
    expect(cookies).toEqual(expect.arrayContaining([
      expect.stringContaining("__Host-ishikeit-session="+token),
      expect.stringContaining("__Host-ishikeit-login=; Path=/; Max-Age=0")
    ]));
    expect(valid.body).not.toContain(token);
    expect(valid.body).not.toContain(csrf);
    expect(controller.verify).toHaveBeenCalledTimes(1);
    await server.close();
  });
  it("enforces session-cookie plus server authentication for workspace visibility",async()=>{
    const {server,controller}=testServer();
    const missing=await server.inject({method:"GET",url:"/app/auth/session",headers:{host}});
    expect(missing.statusCode).toBe(401);
    const valid=await server.inject({
      method:"GET",url:"/app/auth/session",headers:{host,cookie:authCookie()}
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toMatchObject({
      status:"authenticated",csrfToken:csrf,workspaces:{items:[{role:"owner"}]}
    });
    expect(valid.body).not.toContain(token);
    expect(controller.get).toHaveBeenCalledWith(token);
    const recovered=await server.inject({
      method:"GET",url:"/app/auth/csrf",headers:{host,cookie:authCookie()}
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toEqual({csrfToken:csrf});
    expect(controller.csrf).toHaveBeenCalledWith(token);
    const cross=await server.inject({
      method:"GET",url:"/app/auth/workspaces",headers:{host:"evil.test",cookie:authCookie()}
    });
    expect(cross.statusCode).toBe(403);
    await server.close();
  });
  it("requires same-site exact CSRF for refresh and logout, and clears session on logout",async()=>{
    const {server,controller}=testServer();
    const base={...headers,cookie:authCookie()};
    const noCsrf=await server.inject({
      method:"POST",url:"/app/auth/refresh",headers:base,payload:{}
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(controller.refresh).not.toHaveBeenCalled();
    const refreshed=await server.inject({
      method:"POST",url:"/app/auth/refresh",
      headers:{...base,"x-ishikeit-csrf":csrf},payload:{}
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.body).not.toContain(token);
    const logged=await server.inject({
      method:"POST",url:"/app/auth/logout",
      headers:{...base,"x-ishikeit-csrf":csrf},payload:{}
    });
    expect(logged.statusCode).toBe(200);
    expect(logged.headers["set-cookie"]).toContain("Max-Age=0");
    expect(controller.logout).toHaveBeenCalledWith(token);
    await server.close();
  });
  it("rejects cookie shadowing, invalid JSON and untrusted after cursors",async()=>{
    const {server,controller}=testServer();
    const duplicates=await server.inject({
      method:"GET",url:"/app/auth/session",
      headers:{host,cookie:authCookie()+"; "+authCookie()}
    });
    expect(duplicates.statusCode).toBe(401);
    const bad=await server.inject({
      method:"POST",url:"/app/auth/request-otp",
      headers,payload:{email:"invalid"}
    });
    expect(bad.statusCode).toBe(400);
    const foreign=await server.inject({
      method:"GET",url:"/app/auth/workspaces?after=foreign",
      headers:{host,cookie:authCookie()}
    });
    expect(foreign.statusCode).toBe(400);
    expect(controller.listWorkspaces).not.toHaveBeenCalled();
    await server.close();
  });
});
