import fastify from "fastify";
import {loadEnvironment} from "../src/config/env.js";
import {describe,expect,it,vi} from "vitest";
import {registerPrivateBrowserAuthRoutes,type BrowserAuthController}
  from "../src/http/private-browser-auth-routes.js";

const origin="https://apps.ishinaillab.com",host="apps.ishinaillab.com";
const workspaceId="123e4567-e89b-42d3-a456-426614174000";
const session="A".repeat(43),csrf="C".repeat(43);
const state="S".repeat(43);
const path="/app/auth/workspaces/"+workspaceId;
const headers={host,origin,"sec-fetch-site":"same-origin",
  "x-ishikeit-csrf":csrf,"content-type":"application/json",
  cookie:"__Host-ishikeit-session="+session};
const webMessenger="https://www.facebook.com/v26.0/dialog/oauth?state="+state;
const webTikTok="https://ads.tiktok.com/marketing_api/auth?state="+state;
function create(enabled:boolean){
  const server=fastify({logger:false});
  const controller={
    get:vi.fn(()=>Promise.resolve({status:"authenticated"})),
    listWorkspaceConnections:vi.fn(()=>Promise.resolve({items:[]})),
    assertCsrf:vi.fn((_cookie:string,provided:string|undefined)=>{
      if(provided!==csrf)throw Error("Invalid CSRF");
    }),
    csrf:vi.fn(()=>Promise.resolve(csrf)),
    beginMessengerConnection:vi.fn(()=>Promise.resolve({
      authorizationUrl:webMessenger,browserNonce:"M".repeat(43),
      expiresAt:"2027-01-01T00:00:00Z"
    })),
    completeMessengerConnection:vi.fn(()=>Promise.resolve({
      status:"verifying",connectionId:workspaceId
    })),
    confirmMessengerConnection:vi.fn(()=>Promise.resolve({
      status:"connected",connectionId:workspaceId,generation:2
    })),
    beginTikTokConnection:vi.fn(()=>Promise.resolve({
      authorizationUrl:webTikTok,browserNonce:"T".repeat(43),
      expiresAt:"2027-01-01T00:00:00Z"
    })),
    completeTikTokConnection:vi.fn(()=>Promise.resolve({
      status:"verifying",connectionId:workspaceId
    })),
    confirmTikTokConnection:vi.fn(()=>Promise.resolve({
      status:"connected",connectionId:workspaceId,generation:2
    })),
    beginWhatsAppEmbeddedV4:vi.fn(()=>Promise.resolve({
      state,browserNonce:"W".repeat(43),
      appId:"1042452472116584",configId:"123456789012345",
      graphVersion:"v26.0",expiresAt:"2027-01-01T00:00:00Z"
    })),
    completeWhatsAppEmbeddedV4:vi.fn(()=>Promise.resolve({
      status:"verifying",connectionId:workspaceId
    })),
    confirmWhatsAppEmbeddedV4:vi.fn(()=>Promise.resolve({
      status:"connected",connectionId:workspaceId,generation:2
    }))
  };
  registerPrivateBrowserAuthRoutes(server,{
    origin,controller:controller as unknown as BrowserAuthController,
    allowWorkspaceConnections:true,
    allowMessengerConnect:enabled,allowTikTokHolder:enabled,
    allowWhatsAppEmbeddedV4:enabled
  });
  return {server,controller};
}
describe("combined native-provider BFF routes stay isolated and default OFF",()=>{
  it("accepts three independently approved native configurations together without enabling sends",()=>{
    const sessionKey=Buffer.alloc(32,7).toString("base64");
    const csrfKey=Buffer.alloc(32,8).toString("base64");
    const providerKey=Buffer.alloc(32,9).toString("base64");
    const env=loadEnvironment({
      NODE_ENV:"production",DATABASE_URL:"postgresql://example",
      META_APP_SECRET:"a".repeat(32),META_WEBHOOK_VERIFY_TOKEN:"verify-token-1234",
      BROWSER_AUTH_ENABLED:"true",
      BROWSER_AUTH_ORIGIN:"https://apps.ishinaillab.com/",
      SUPABASE_AUTH_PROJECT_URL:"https://example.supabase.co",
      SUPABASE_AUTH_PUBLISHABLE_KEY:"sb_publishable_"+"x".repeat(32),
      BROWSER_AUTH_ENCRYPTION_KEY_B64:sessionKey,
      BROWSER_AUTH_CSRF_KEY_B64:csrfKey,
      OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64:providerKey,
      BROWSER_MESSENGER_CONNECT_ENABLED:"true",
      META_FACEBOOK_LOGIN_CONFIG_ID:"987654321098765",
      BROWSER_WHATSAPP_EMBEDDED_V4_ENABLED:"true",
      META_WHATSAPP_EMBEDDED_V4_CONFIG_ID:"123456789012345",
      BROWSER_TIKTOK_ACCOUNT_CONNECT_ENABLED:"true",
      TIKTOK_BUSINESS_APP_ID:"456789012345",
      TIKTOK_BUSINESS_APP_SECRET:"t".repeat(32),
      TIKTOK_ACCOUNT_HOLDER_AUTHORIZATION_URL:"https://ads.tiktok.com/marketing_api/auth"
    });
    expect(env.BROWSER_MESSENGER_CONNECT_ENABLED).toBe(true);
    expect(env.BROWSER_WHATSAPP_EMBEDDED_V4_ENABLED).toBe(true);
    expect(env.BROWSER_TIKTOK_ACCOUNT_CONNECT_ENABLED).toBe(true);
    expect(env.ACTION_DISPATCH_ENABLED_EFFECTIVE).toBe(false);
    expect(env.PROCESSOR_ENABLED).toBe(false);
  });
  it("disables all three routes without any owner-approved feature flag",async()=>{
    const {server}=create(false);
    for(const provider of ["messenger","tiktok","whatsapp"]){
      const r=await server.inject({method:"POST",url:path+
        "/connections/"+provider+"/start",headers,payload:{}});
      expect(r.statusCode).toBe(404);
    }
    const sdk=await server.inject({method:"GET",url:path+"/whatsapp/signup",
      headers});
    expect(sdk.statusCode).toBe(404);
    await server.close();
  });
  it("allows all three explicitly enabled BFFs concurrently without sharing nonce cookies",async()=>{
    const {server,controller}=create(true);
    const names=new Set<string>();
    for(const provider of ["messenger","tiktok","whatsapp"]){
      const r=await server.inject({method:"POST",url:path+
        "/connections/"+provider+"/start",headers,payload:{}});
      expect(r.statusCode).toBe(200);
      const cookie=String(r.headers["set-cookie"]);
      const name=cookie.split("=")[0]??"";
      expect(name).toMatch(/^__Host-ishikeit-(fb-page|tiktok|wa-v4)-connect$/u);
      expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
      names.add(name);
      expect(r.body).not.toContain("browserNonce");
      expect(r.body).not.toContain(session);
      expect(r.body).not.toContain("businessToken");
    }
    expect(names.size).toBe(3);
    expect(controller.beginMessengerConnection).toHaveBeenCalledWith(session,workspaceId);
    expect(controller.beginTikTokConnection).toHaveBeenCalledWith(session,workspaceId);
    expect(controller.beginWhatsAppEmbeddedV4).toHaveBeenCalledWith(session,workspaceId);
    await server.close();
  });
  it("does not allow one provider nonce cookie to complete a different provider grant",async()=>{
    const {server,controller}=create(true);
    const messengerCookie="__Host-ishikeit-fb-page-connect="+workspaceId+"."+"M".repeat(43);
    const wrong={...headers,cookie:headers.cookie+"; "+messengerCookie};
    const tiktok=await server.inject({method:"POST",
      url:"/app/auth/connect/tiktok/complete",headers:wrong,
      payload:{state,authorizationCode:"code-12345678"}});
    const whatsapp=await server.inject({method:"POST",
      url:path+"/connections/whatsapp/complete",headers:wrong,
      payload:{state,authorizationCode:"code-12345678",
        messagingAccountId:"987654321098765",phoneNumberId:"123456789012345"}});
    expect(tiktok.statusCode).toBeGreaterThanOrEqual(400);
    expect(whatsapp.statusCode).toBeGreaterThanOrEqual(400);
    expect(controller.completeTikTokConnection).not.toHaveBeenCalled();
    expect(controller.completeWhatsAppEmbeddedV4).not.toHaveBeenCalled();
    await server.close();
  });
  it("keeps Meta SDK isolated to WhatsApp while Messenger and TikTok have distinct return routes",async()=>{
    const {server}=create(true);
    const sdk=await server.inject({method:"GET",url:path+"/whatsapp/signup",
      headers});
    expect(sdk.statusCode).toBe(200);
    expect(String(sdk.headers["content-security-policy"])).toContain(
      "script-src 'self' https://connect.facebook.net");
    const messenger=await server.inject({method:"GET",
      url:"/app/auth/connect/messenger/callback?state="+state+
        "&code=code-12345678",headers:{host}});
    expect(messenger.statusCode).toBe(200);
    const tiktok=await server.inject({method:"GET",
      url:"/app/auth/connect/tiktok/callback/?state="+state+
        "&auth_code=code-12345678",headers:{host}});
    expect(tiktok.statusCode).toBe(200);
    expect(String(messenger.headers["content-security-policy"])).not.toContain(
      "https://connect.facebook.net");
    expect(String(tiktok.headers["content-security-policy"])).not.toContain(
      "https://connect.facebook.net");
    await server.close();
  });
});
