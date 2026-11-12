import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import type { BrowserAuthController } from "../src/http/private-browser-auth-routes.js";
import {
  BrowserLoginSessionSetupError, BrowserMfaEnrollmentRateLimited,
  BrowserMfaPendingEnrollment, BrowserMfaLastAuthenticatorError,
  BrowserMfaPartialDeletionError
} from "../src/auth/private-browser-auth.js";
import type { InboundStore } from "../src/persistence/inbound.js";

const origin="https://apps.ishinaillab.com";
const host="apps.ishinaillab.com";
const token="A".repeat(43);
const login="B".repeat(43);
const csrf="C".repeat(43);
function testServer(enabled=true,invitesEnabled=false){
  const controller={
    begin:vi.fn((_email:string,_ip:string)=>{void _email;void _ip;return Promise.resolve(login);}),
    hasPendingEmailOtp:vi.fn((_cookie:string)=>{void _cookie;return Promise.resolve(true);}),
    resumeEmailOtp:vi.fn((_email:string,_ip:string)=>{
      void _email;void _ip;return Promise.resolve(login);
    }),
    verify:vi.fn((_nonce:string,_code:string,_ip:string)=>{void _nonce;void _code;void _ip;return Promise.resolve({
      cookieValue:token,csrfToken:csrf
    });}),
    get:vi.fn((_cookie:string)=>{void _cookie;return Promise.resolve({
      sessionId:"session",expiresAt:"2027-01-01T00:00:00Z",
      csrfToken:csrf,memberInvitationsEnabled:true,workspaces:{items:[{
        workspaceId:"123e4567-e89b-42d3-a456-426614174000",
        displayName:"Workspace",role:"owner" as const,connectedAccounts:0
      }]}
    });}),
    sessionStatus:vi.fn<BrowserAuthController["sessionStatus"]>((_cookie:string)=>{void _cookie;return Promise.resolve({
      status:"authenticated" as const,
      sessionId:"session",expiresAt:"2027-01-01T00:00:00Z",
      csrfToken:csrf,memberInvitationsEnabled:true,workspaces:{items:[{
        workspaceId:"123e4567-e89b-42d3-a456-426614174000",
        displayName:"Workspace",role:"owner" as const,connectedAccounts:0
      }]}
    });}),
    listWorkspaces:vi.fn((_cookie:string,_after?:string)=>{void _cookie;void _after;return Promise.resolve({items:[]});}),
    refresh:vi.fn<BrowserAuthController["refresh"]>((_cookie:string)=>{void _cookie;return Promise.resolve({
      status:"authenticated" as const,
      sessionId:"session",expiresAt:"2027-01-01T00:00:00Z",
      csrfToken:csrf,memberInvitationsEnabled:true,workspaces:{items:[]}
    });}),
    csrf:vi.fn((_cookie:string)=>{void _cookie;return Promise.resolve(csrf);}),
    listTotpFactors:vi.fn((_cookie:string)=>{
      void _cookie;return Promise.resolve({factors:["123e4567-e89b-42d3-a456-426614174000"],
        devices:[{factorId:"123e4567-e89b-42d3-a456-426614174000",
          label:"Primary authenticator",enrolledAt:"2026-11-11T17:53:00.000Z",enabled:true}],
        pendingCount:0,canEnroll:false,signIn2faEnabled:true});
    }),
    changeMfaSettings:vi.fn<BrowserAuthController["changeMfaSettings"]>((_cookie,_mutation)=>{
      void _cookie;void _mutation;
      return Promise.resolve({signedOut:false,cookieValue:"F".repeat(43),csrfToken:"G".repeat(43)});
    }),
    clearIncompleteTotp:vi.fn((_cookie:string)=>{
      void _cookie;return Promise.resolve({cleared:1});
    }),
    enrollTotp:vi.fn((_cookie:string,_name:string)=>{
      void _cookie;void _name;return Promise.resolve({
        factorId:"123e4567-e89b-42d3-a456-426614174000",
        secret:"JBSWY3DPEHPK3PXP",
        qrCodeDataUrl:"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="
      });
    }),
    verifyTotp:vi.fn((_cookie:string,_factorId:string,_code:string)=>{
      void _cookie;void _factorId;void _code;
      return Promise.resolve({
        cookieValue:"D".repeat(43),
        sessionId:"session",expiresAt:"2027-01-01T00:00:00Z",
        csrfToken:"E".repeat(43),memberInvitationsEnabled:true,workspaces:{items:[]}
      });
    }),
    inviteWorkspaceMember:vi.fn((_cookie:string,_input:{workspaceId:string;email:string;role:"admin"|"agent"|"viewer"})=>{
      void _cookie;void _input;
      return Promise.resolve({invitationId:"123e4567-e89b-42d3-a456-426614174000",status:"invited" as const});
    }),
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
    ...(enabled?{browserAuth:{origin,controller,allowWorkspaceInvitations:invitesEnabled}}:{})
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
  it("does not expose invitations without the separate explicit feature enable",async()=>{
    const {server}=testServer();
    const r=await server.inject({
      method:"POST",
      url:"/app/auth/workspaces/123e4567-e89b-42d3-a456-426614174000/invitations",
      headers:{...headers,"x-ishikeit-csrf":csrf,cookie:authCookie()},
      payload:{email:"member@example.com",role:"agent"}
    });
    expect(r.statusCode).toBe(404);
    await server.close();
  });
  it("requires exact host/origin, BFF cookie, CSRF and non-owner role for invite",async()=>{
    const {server,controller}=testServer(true,true);
    const path="/app/auth/workspaces/123e4567-e89b-42d3-a456-426614174000/invitations";
    const body={email:"member@example.com",role:"viewer"};
    const base={...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf};
    for(const header of [
      {...base,origin:"https://attacker.example"},
      {...base,host:"evil.example"},
      {...base,"x-ishikeit-csrf":"wrong"},
      {...base,cookie:""}
    ]){
      const response=await server.inject({method:"POST",url:path,headers:header,payload:body});
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
    for(const role of ["owner","super_admin"]){
      const response=await server.inject({
        method:"POST",url:path,headers:base,payload:{...body,role}
      });
      expect(response.statusCode).toBe(400);
    }
    expect(controller.inviteWorkspaceMember).not.toHaveBeenCalled();
    const valid=await server.inject({method:"POST",url:path,headers:base,payload:body});
    expect(valid.statusCode).toBe(202);
    expect(valid.json()).toEqual({
      status:"invited",invitationId:"123e4567-e89b-42d3-a456-426614174000"
    });
    expect(valid.headers["cache-control"]).toContain("no-store");
    expect(controller.inviteWorkspaceMember).toHaveBeenCalledWith(token,{
      workspaceId:"123e4567-e89b-42d3-a456-426614174000",
      email:"member@example.com",role:"viewer"
    });
    await server.close();
  });

  it("advertises workspace invitations only when the independent HTTP gate permits it across session, refresh, and MFA",async()=>{
    for(const invitesEnabled of [false,true]){
      const {server}=testServer(true,invitesEnabled);
      const session=await server.inject({
        method:"GET",url:"/app/auth/session",headers:{host,cookie:authCookie()}
      });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toMatchObject({memberInvitationsEnabled:invitesEnabled});

      const base={...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf};
      const refreshed=await server.inject({
        method:"POST",url:"/app/auth/refresh",headers:base,payload:{}
      });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json()).toMatchObject({memberInvitationsEnabled:invitesEnabled});

      const verified=await server.inject({
        method:"POST",url:"/app/auth/mfa/totp/verify",headers:base,
        payload:{factorId:"123e4567-e89b-42d3-a456-426614174000",code:"123456"}
      });
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toMatchObject({memberInvitationsEnabled:invitesEnabled});
      expect(verified.body).not.toContain("access_token");
      expect(verified.body).not.toContain("refresh_token");
      await server.close();
    }
  });

  it("exposes no password login or recovery routes even when BFF is enabled",async()=>{
    const {server,controller}=testServer(true);
    const passwordPayload={email:"person@example.com",password:"sensitive_not_for_the_browser"};
    for(const url of [
      "/app/auth/password",
      "/app/auth/login",
      "/app/auth/recover",
      "/app/auth/reset-password"
    ]){
      const response=await server.inject({
        method:"POST",url,headers,payload:passwordPayload
      });
      expect(response.statusCode).toBe(404);
    }
    const rejected=await server.inject({
      method:"POST",url:"/app/auth/request-otp",
      headers,payload:passwordPayload
    });
    expect(rejected.statusCode).toBe(400);
    expect(controller.begin).not.toHaveBeenCalled();
    await server.close();
  });

  it("registers no login/session endpoints when production gate is absent",async()=>{
    const {server}=testServer(false);
    const r=await server.inject({method:"GET",url:"/app/auth/session",headers:{host}});
    expect(r.statusCode).toBe(404);
    await server.close();
  });
  it("serves a CSP-restricted, accessible, same-origin login and workspace shell only when enabled",async()=>{
    const disabled=testServer(false);
    expect((await disabled.server.inject({method:"GET",url:"/app",headers:{host}}))
      .statusCode).toBe(404);
    await disabled.server.close();

    const {server}=testServer();
    const html=await server.inject({method:"GET",url:"/app/login",headers:{host}});
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(html.headers["content-security-policy"]).toContain("form-action 'none'");
    expect(html.headers["content-security-policy"]).toContain("img-src 'self' data:");
    expect(html.headers["content-security-policy"]).toContain("object-src 'none'");
    expect(html.body).toContain('id="dashboard-shell" class="dashboard-shell" hidden');
    expect(html.body).toContain('id="auth-shell" class="auth-shell" hidden');
    expect(html.body).toContain('id="boot-panel"');
    expect(html.body).toContain("Protected access to your Ishikeit workspace");
    expect(html.body).not.toContain("Technique-first. Style-forward. Always clean.");
    expect(html.body).toContain('autocomplete="one-time-code"');
    expect(html.body).toContain('minlength="6" maxlength="10" pattern="[0-9]{6,10}"');
    expect(html.body).not.toContain("access_token");
    expect(html.body).not.toContain("localStorage");
    const js=await server.inject({method:"GET",url:"/app/auth/ui.js",headers:{host}});
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toContain("javascript");
    expect(js.body).toContain('document.createElement("option")');
    expect(js.body).not.toContain("innerHTML");
    expect(js.body).toContain('window.history.replaceState(null,"","/app/login")');
    expect(js.body).toContain('document.title="ISHIKEIT · "+workspaceRows[0].displayName');
    expect(js.body).toContain('Number.isInteger(data.pendingCount)');
    expect(js.body).toContain('const canEnroll=data.canEnroll===true;');
    expect(html.body).toContain('id="mfa-cancel"');
    expect(html.body).not.toContain("Discard unfinished setup");
    expect(html.body).not.toContain("An earlier authenticator setup was not finished.");
    expect(html.body).toContain('id="mfa-qr"');
    expect(html.body).not.toContain('id="mfa-reload"');
    expect(html.body).not.toContain('id="refresh-session"');
    expect(html.body).toContain('id="account-menu"');
    expect(html.body).toContain('id="security-view"');
    expect(html.body).toContain('id="nav-overview"');
    expect(html.body).toContain('id="mfa-devices"');
    expect(html.body).toContain('id="mfa-add"');
    expect(html.body).toContain('id="mfa-account-toggle"');
    expect(html.body).toContain('id="mfa-change-form"');
    expect(html.body).toContain('id="skip-link"');
    // Prior regression: the setup key lived INSIDE hidden #mfa-setup;
    // hiding that parent made the key invisible while the dropdown showed.
    const setupStart=html.body.indexOf('id="mfa-setup"');
    const setupClosingDiv=html.body.indexOf('</div>',setupStart);
    const keySection=html.body.indexOf('id="mfa-enrollment"');
    expect(setupClosingDiv).toBeGreaterThan(setupStart);
    expect(keySection).toBeGreaterThan(setupClosingDiv);
    expect(html.body).toContain('id="mfa-secret"');
    expect(js.body).toContain('mfaQr.src=qr');
    expect(js.body).toContain('mfaEnrollment.hidden=false');
    expect(js.body).toContain('response.status===429');
    expect(js.body).toContain('response.status===409');
    expect(js.body).toContain('mfaSetup.hidden=!(mode==="gate" && canEnroll && !keepPending && pending===0)');
    expect(js.body).toContain('workspaceRows=data.workspaces.items');
    expect(js.body).toContain('authShell.hidden=true');
    expect(js.body).toContain('mfaSettingsSlot.append(mfaPanel)');
    expect(js.body).toContain('setTimeout(()=>{void maintainSession();},delay)');
    expect(js.body).not.toContain("localStorage");
    const css=await server.inject({method:"GET",url:"/app/auth/ui.css",headers:{host}});
    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.body).toContain("min-height:44px");
    expect(css.body).toContain(".mfa-content{display:grid;gap:18px}");
    expect(css.body).toContain("#mfa-enrollment{");
    expect((await server.inject({method:"GET",url:"/app/login",
      headers:{host:"evil.test"}})).statusCode).toBe(403);
    await server.close();
  });
  it("serves /app/workspaces only with a live verified server session and membership",async()=>{
    const {server,controller}=testServer();
    const unauthenticated=await server.inject({
      method:"GET",url:"/app/workspaces",headers:{host}
    });
    expect(unauthenticated.statusCode).toBe(303);
    expect(unauthenticated.headers.location).toBe("/app/login");
    expect(unauthenticated.headers["cache-control"]).toContain("no-store");
    expect(unauthenticated.body).not.toContain("Your workspaces");
    const valid=await server.inject({
      method:"GET",url:"/app/workspaces",headers:{host,cookie:authCookie()}
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.body).toContain('id="overview-view"');
    expect(valid.headers["cache-control"]).toContain("no-store");
    expect(controller.get).toHaveBeenCalledWith(token);
    controller.get.mockRejectedValueOnce(new Error("Expired session"));
    const stale=await server.inject({
      method:"GET",url:"/app/workspaces",headers:{host,cookie:authCookie()}
    });
    expect(stale.statusCode).toBe(303);
    expect(stale.headers.location).toBe("/app/login");
    const hostile=await server.inject({
      method:"GET",url:"/app/workspaces",headers:{host:"wrong.host",cookie:authCookie()}
    });
    expect(hostile.statusCode).toBe(403);
    await server.close();
  });

  it("exposes only an MFA step-up shell after email OTP and denies workspace data at AAL1",async()=>{
    const {server,controller}=testServer();
    controller.sessionStatus.mockResolvedValueOnce({
      status:"mfa_required",expiresAt:"2027-01-01T00:00:00Z",csrfToken:csrf
    });
    controller.get.mockRejectedValueOnce(new Error("Multi-factor authentication required"));
    controller.listWorkspaces.mockRejectedValueOnce(new Error("Multi-factor authentication required"));
    controller.refresh.mockResolvedValueOnce({
      status:"mfa_required",expiresAt:"2027-01-01T00:00:00Z",csrfToken:csrf
    });
    const session=await server.inject({
      method:"GET",url:"/app/auth/session",headers:{host,cookie:authCookie()}
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({
      status:"mfa_required",expiresAt:"2027-01-01T00:00:00Z",csrfToken:csrf
    });
    expect(session.body).not.toContain("Workspace");
    expect(session.body).not.toContain("owner");
    expect(session.body).not.toContain("memberInvitationsEnabled");
    const workspace=await server.inject({
      method:"GET",url:"/app/workspaces",headers:{host,cookie:authCookie()}
    });
    expect(workspace.statusCode).toBe(303);
    expect(workspace.headers.location).toBe("/app/login");
    const items=await server.inject({
      method:"GET",url:"/app/auth/workspaces",headers:{host,cookie:authCookie()}
    });
    expect(items.statusCode).toBe(401);
    const refresh=await server.inject({
      method:"POST",url:"/app/auth/refresh",
      headers:{...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf},payload:{}
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toEqual({
      status:"mfa_required",expiresAt:"2027-01-01T00:00:00Z",csrfToken:csrf
    });
    expect(refresh.body).not.toContain("Workspace");
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

  it("resumes an already requested OTP with the original cookie but never discloses the email",async()=>{
    const {server,controller}=testServer();
    const ok=await server.inject({method:"GET",url:"/app/auth/pending-otp",
      headers:{host,cookie:loginCookie()}});
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({status:"awaiting_code"});
    expect(ok.body).not.toContain("example.com");
    expect(ok.headers["cache-control"]).toContain("no-store");
    expect(controller.hasPendingEmailOtp).toHaveBeenCalledWith(login);
    const missing=await server.inject({method:"GET",url:"/app/auth/pending-otp",
      headers:{host}});
    expect(missing.statusCode).toBe(401);
    controller.hasPendingEmailOtp.mockResolvedValueOnce(false);
    const expired=await server.inject({method:"GET",url:"/app/auth/pending-otp",
      headers:{host,cookie:loginCookie()}});
    expect(expired.statusCode).toBe(401);
    const badHost=await server.inject({method:"GET",url:"/app/auth/pending-otp",
      headers:{host:"evil.test",cookie:loginCookie()}});
    expect(badHost.statusCode).toBe(403);
    await server.close();
  });
  it("rebinds a code-email link in another browser without sending a new code or accepting origin/JSON bypass",async()=>{
    const {server,controller}=testServer();
    const request={email:"invited+test@example.com"};
    const resume=await server.inject({
      method:"POST",url:"/app/auth/resume-otp",headers,payload:request
    });
    expect(resume.statusCode).toBe(202);
    expect(resume.json()).toEqual({status:"if_recent_code_sent"});
    expect(resume.headers["set-cookie"]).toContain("__Host-ishikeit-login="+login);
    expect(resume.headers["set-cookie"]).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(resume.body).not.toContain(request.email);
    expect(controller.resumeEmailOtp).toHaveBeenCalledWith(request.email,expect.any(String));
    expect(controller.begin).not.toHaveBeenCalled();
    for(const h of [
      {...headers,origin:"https://evil.test"},
      {...headers,"content-type":"text/plain"},
      {...headers,"sec-fetch-site":"cross-site"}
    ]){
      const bad=await server.inject({
        method:"POST",url:"/app/auth/resume-otp",headers:h,payload:JSON.stringify(request)
      });
      expect(bad.statusCode).toBe(403);
    }
    const invalid=await server.inject({
      method:"POST",url:"/app/auth/resume-otp",headers,payload:{email:"notanemail"}
    });
    expect(invalid.statusCode).toBe(400);
    expect(controller.resumeEmailOtp).toHaveBeenCalledTimes(1);
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
  it("reports a consumed valid OTP as secure-session setup failure without leaking credentials",async()=>{
    const {server,controller}=testServer();
    controller.verify.mockRejectedValueOnce(new BrowserLoginSessionSetupError());
    const response=await server.inject({
      method:"POST",url:"/app/auth/verify-otp",
      headers:{...headers,cookie:loginCookie()},payload:{code:"123456"}
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({status:"session_setup_unavailable"});
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).not.toContain(login);
    expect(response.body).not.toContain(token);
    await server.close();
  });

  it("accepts six and ten digit email OTPs but rejects out-of-range codes",async()=>{
    const {server,controller}=testServer();
    const base={...headers,cookie:loginCookie()};
    for(const code of ["123456","1234567890"]){
      const response=await server.inject({
        method:"POST",url:"/app/auth/verify-otp",headers:base,payload:{code}
      });
      expect(response.statusCode).toBe(200);
    }
    for(const code of ["12345","12345678901","1234567x90"]){
      const response=await server.inject({
        method:"POST",url:"/app/auth/verify-otp",headers:base,payload:{code}
      });
      expect(response.statusCode).toBe(400);
    }
    expect(controller.verify).toHaveBeenCalledTimes(2);
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
    expect(controller.sessionStatus).toHaveBeenCalledWith(token);
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
  it("protects TOTP setup and verification with host/origin/session/CSRF and never returns tokens",async()=>{
    const {server,controller}=testServer();
    const base={...headers,cookie:authCookie()};
    const factors=await server.inject({method:"GET",url:"/app/auth/mfa/factors",
      headers:{host,cookie:authCookie()}});
    expect(factors.statusCode).toBe(200);
    expect(factors.json()).toEqual({
      factors:["123e4567-e89b-42d3-a456-426614174000"],
      devices:[{factorId:"123e4567-e89b-42d3-a456-426614174000",
        label:"Primary authenticator",enrolledAt:"2026-11-11T17:53:00.000Z",enabled:true}],
      pendingCount:0,canEnroll:false,signIn2faEnabled:true
    });
    for(const path of ["/app/auth/mfa/totp/enroll","/app/auth/mfa/totp/verify"]){
      const missing=await server.inject({method:"POST",url:path,
        headers:base,payload:path.endsWith("verify")?{
          factorId:"123e4567-e89b-42d3-a456-426614174000",code:"123456"
        }:{}});
      expect(missing.statusCode).toBe(403);
    }
    const enrolled=await server.inject({method:"POST",url:"/app/auth/mfa/totp/enroll",
      headers:{...base,"x-ishikeit-csrf":csrf},payload:{name:"My phone"}});
    expect(enrolled.statusCode).toBe(200);
    expect(enrolled.json()).toEqual({
      factorId:"123e4567-e89b-42d3-a456-426614174000",
      secret:"JBSWY3DPEHPK3PXP",
      qrCodeDataUrl:"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="
    });
    expect(enrolled.headers["cache-control"]).toContain("no-store");
    const verified=await server.inject({method:"POST",url:"/app/auth/mfa/totp/verify",
      headers:{...base,"x-ishikeit-csrf":csrf},payload:{
        factorId:"123e4567-e89b-42d3-a456-426614174000",code:"123456"
      }});
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      status:"authenticated",csrfToken:"E".repeat(43)
    });
    expect(verified.headers["set-cookie"]).toContain(
      "__Host-ishikeit-session="+"D".repeat(43));
    expect(verified.body).not.toContain("D".repeat(43));
    expect(verified.body).not.toContain("access_token");
    expect(verified.body).not.toContain("refresh_token");
    const resetWithoutCsrf=await server.inject({
      method:"POST",url:"/app/auth/mfa/totp/reset",
      headers:base,payload:{}
    });
    expect(resetWithoutCsrf.statusCode).toBe(403);
    expect(controller.clearIncompleteTotp).not.toHaveBeenCalled();
    const reset=await server.inject({
      method:"POST",url:"/app/auth/mfa/totp/reset",
      headers:{...base,"x-ishikeit-csrf":csrf},payload:{}
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({status:"incomplete_setup_cleared",cleared:1});
    expect(controller.clearIncompleteTotp).toHaveBeenCalledWith(token);
    const badReset=await server.inject({
      method:"POST",url:"/app/auth/mfa/totp/reset",
      headers:{...base,"x-ishikeit-csrf":csrf,origin:"https://evil.test"},payload:{}
    });
    expect(badReset.statusCode).toBe(403);
    const foreign=await server.inject({method:"POST",url:"/app/auth/mfa/totp/enroll",
      headers:{...base,origin:"https://evil.test","x-ishikeit-csrf":csrf},payload:{}});
    expect(foreign.statusCode).toBe(403);
    expect(controller.enrollTotp).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it("requires fresh-factor security changes and rotates only HttpOnly cookie on success",async()=>{
    const {server,controller}=testServer();
    const body={kind:"remove",factorId:"123e4567-e89b-42d3-a456-426614174000",
      proofFactorId:"223e4567-e89b-42d3-a456-426614174000",
      code:"654321"};
    const noCsrf=await server.inject({
      method:"POST",url:"/app/auth/mfa/preferences",
      headers:{...headers,cookie:authCookie()},payload:body
    });
    expect(noCsrf.statusCode).toBe(403);
    for(const modified of [
      {...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf,origin:"https://evil.test"},
      {...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf,"sec-fetch-site":"cross-site"}
    ]){
      const cross=await server.inject({method:"POST",url:"/app/auth/mfa/preferences",
        headers:modified,payload:body});
      expect(cross.statusCode).toBe(403);
    }
    const invalid=await server.inject({method:"POST",url:"/app/auth/mfa/preferences",
      headers:{...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf},
      payload:{...body,code:"1234",extra:"untrusted"}});
    expect(invalid.statusCode).toBe(400);
    expect(controller.changeMfaSettings).not.toHaveBeenCalled();
    const ok=await server.inject({
      method:"POST",url:"/app/auth/mfa/preferences",
      headers:{...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf},
      payload:body
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({status:"changed",csrfToken:"G".repeat(43)});
    expect(ok.headers["set-cookie"]).toContain("__Host-ishikeit-session="+"F".repeat(43));
    expect(ok.headers["set-cookie"]).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(ok.body).not.toContain("F".repeat(43));
    expect(ok.body).not.toContain(body.code);
    expect(ok.body).not.toContain("access_token");
    expect(controller.changeMfaSettings).toHaveBeenCalledWith(token,body);
    await server.close();
  });

  it("rejects last-factor disable and throttles sensitive account 2FA changes",async()=>{
    const {server,controller}=testServer();
    const h={...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf};
    const body={kind:"disable_app",
      proofFactorId:"123e4567-e89b-42d3-a456-426614174000",code:"654321"};
    controller.changeMfaSettings.mockRejectedValueOnce(new BrowserMfaLastAuthenticatorError());
    const locked=await server.inject({method:"POST",url:"/app/auth/mfa/preferences",
      headers:h,payload:body});
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toEqual({status:"last_authenticator_required"});
    controller.changeMfaSettings.mockRejectedValueOnce(new BrowserMfaEnrollmentRateLimited());
    const limited=await server.inject({method:"POST",url:"/app/auth/mfa/preferences",
      headers:h,payload:body});
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("900");
    expect(limited.json()).toEqual({status:"security_change_rate_limited"});
    expect(limited.body).not.toContain(token);
    await server.close();
  });

  it("rejects deprecated preference to disable sign-in MFA instead of bypassing the factor",async()=>{
    const {server,controller}=testServer();
    const response=await server.inject({
      method:"POST",url:"/app/auth/mfa/preferences",
      headers:{...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf},
      payload:{kind:"sign_in",enabled:false,
        proofFactorId:"123e4567-e89b-42d3-a456-426614174000",code:"123456"}
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({status:"invalid_request"});
    expect(controller.changeMfaSettings).not.toHaveBeenCalled();
    await server.close();
  });

  it("invalidates cookies if provider factor removal partially completes and requires a fresh login",async()=>{
    const {server,controller}=testServer();
    controller.changeMfaSettings.mockRejectedValueOnce(new BrowserMfaPartialDeletionError());
    const response=await server.inject({
      method:"POST",url:"/app/auth/mfa/preferences",
      headers:{...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf},
      payload:{kind:"disable_app",
        proofFactorId:"123e4567-e89b-42d3-a456-426614174000",code:"123456"}
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({status:"authenticator_state_requires_signin"});
    expect(response.headers["set-cookie"]).toEqual([
      expect.stringContaining("__Host-ishikeit-session=; Path=/; Max-Age=0"),
      expect.stringContaining("__Host-ishikeit-login=; Path=/; Max-Age=0")
    ]);
    expect(response.body).not.toContain(token);
    await server.close();
  });

  it("returns actionable 409 and 429 states for pending TOTP setup and enrollment cooldown",async()=>{
    const {server,controller}=testServer();
    const authHeaders={...headers,cookie:authCookie(),"x-ishikeit-csrf":csrf};
    controller.enrollTotp.mockRejectedValueOnce(new BrowserMfaPendingEnrollment());
    const pending=await server.inject({
      method:"POST",url:"/app/auth/mfa/totp/enroll",headers:authHeaders,payload:{name:"Test phone"}
    });
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toEqual({status:"mfa_incomplete_setup"});
    controller.enrollTotp.mockRejectedValueOnce(new BrowserMfaEnrollmentRateLimited());
    const limited=await server.inject({
      method:"POST",url:"/app/auth/mfa/totp/enroll",headers:authHeaders,payload:{name:"Test phone"}
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("900");
    expect(limited.json()).toEqual({status:"mfa_enrollment_rate_limited"});
    expect(limited.body).not.toContain(token);
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
    expect(logged.headers["set-cookie"]).toEqual(expect.arrayContaining([
      expect.stringContaining("__Host-ishikeit-session=; Path=/; Max-Age=0"),
      expect.stringContaining("__Host-ishikeit-login=; Path=/; Max-Age=0")
    ]));
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
