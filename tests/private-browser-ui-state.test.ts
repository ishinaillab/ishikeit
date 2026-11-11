import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { privateLoginHtml, privateLoginCss, privateLoginJs } from "../src/http/private-browser-ui.js";

/** Execute the *shipping script* in a synthetic DOM. No real owner codes,
 * browser cookies, credentials or service requests are ever used.
 */
type EventHandler = (event?:{preventDefault():void;key?:string;target?:FakeElement})=>void|Promise<void>;
class FakeElement {
  hidden=false;
  disabled=false;
  textContent="";
  value="";
  href="";
  src="";
  children:FakeElement[]=[];
  listeners=new Map<string,EventHandler>();
  attributes=new Map<string,string>();
  constructor(readonly tag="div",readonly id=""){}
  get options():FakeElement[]{return this.children;}
  replaceChildren(...items:FakeElement[]):void{
    this.children=[...items];
    if(this.tag==="select")this.value=items[0]?.value??"";
  }
  append(...items:FakeElement[]):void{
    this.children.push(...items);
    if(this.tag==="select" && !this.value)this.value=items[0]?.value??"";
  }
  prepend(...items:FakeElement[]):void{this.children.unshift(...items);}
  removeAttribute(name:string):void{
    this.attributes.delete(name);
    if(name==="src")this.src="";
  }
  setAttribute(name:string,value:string):void{this.attributes.set(name,value);}
  getAttribute(name:string):string|null{return this.attributes.get(name)??null;}
  contains(target:unknown):boolean{return target===this;}
  focus():void{/* DOM focus does not change state in synthetic test */}
  addEventListener(name:string,handler:EventHandler):void{this.listeners.set(name,handler);}
}
interface UiFixtureOptions {
  state?:"authenticated"|"mfa_required"|"unauthenticated";
  pendingEmailCookie?:boolean;
  emailLinkHint?:string;
  restoreSuccess?:boolean;
  factorCount?:number;
  nearExpiry?:boolean;
  enrollStatus?:number;
  allowTeam?:boolean;
  multiWorkspace?:boolean;
}
const workspace1={
  workspaceId:"123e4567-e89b-42d3-a456-426614174000",
  displayName:"Ishi Nail Lab",role:"owner",connectedAccounts:0
};
const workspace2={
  workspaceId:"223e4567-e89b-42d3-a456-426614174000",
  displayName:"Second workspace",role:"viewer",connectedAccounts:0
};
function setup(options:UiFixtureOptions={}){
  const elements=new Map<string,FakeElement>();
  const pattern=/<([a-z][\w-]*)\b[^>]*\sid="([^"]+)"[^>]*>/giu;
  for(const match of privateLoginHtml.matchAll(pattern)){
    const node=new FakeElement(match[1],match[2]);
    node.hidden=/\shidden(?:\s|>)/u.test(match[0]);
    elements.set(match[2]!,node);
  }
  const listeners=new Map<string,EventHandler>();
  const dom={
    title:"",
    visibilityState:"visible",
    getElementById:(id:string)=>{
      const node=elements.get(id);
      if(node===undefined)throw new Error("Missing element #"+id);
      return node;
    },
    createElement:(tag:string)=>new FakeElement(tag),
    addEventListener:(name:string,handler:EventHandler)=>{listeners.set(name,handler);}
  };
  const url={pathname:"/app/login",
    hash:options.emailLinkHint===undefined?"":
      "#verify-email="+encodeURIComponent(options.emailLinkHint),search:""};
  const window={
    location:url,
    history:{replaceState:(state:unknown,name:string,path:string)=>{
      void state;void name;url.pathname=path;url.hash="";url.search="";
    }},
    confirm:(s:string)=>{void s;return true;}
  };
  let factors=options.factorCount??0;
  let pending=0;
  let enrollRequests=0;
  let refreshRequests=0;
  let logoutRequests=0;
  let factorReads=0;
  let restoreCalls=0;
  let pendingChecks=0;
  let restored=false;
  let restoredEmail="";
  const workspaces={
    items:options.multiWorkspace?[workspace1,workspace2]:[workspace1]
  };
  const originalState=options.state??"authenticated";
  const makeSession=(state:"authenticated"|"mfa_required",renewed=false)=>({
    status:state,
    csrfToken:renewed?"test_csrf_rotated":"test_csrf_initial",
    expiresAt:renewed || !options.nearExpiry
      ? new Date(Date.now()+3600000).toISOString()
      : new Date(Date.now()+60000).toISOString(),
    ...(state==="authenticated"
      ? {workspaces,memberInvitationsEnabled:options.allowTeam===true}
      : {})
  });
  const response=(payload:unknown,code=200)=>({
    ok:code>=200 && code<300,status:code,json:()=>Promise.resolve(payload)
  });
  const fetch=(path:string,request?:{method?:string;body?:string})=>{
    const mutation=request?.method==="POST";
    if(path==="/app/auth/session")return Promise.resolve(
      originalState==="unauthenticated"
        ? response({status:"unauthenticated"},401)
        : response(makeSession(originalState))
    );
    if(path==="/app/auth/csrf")
      return Promise.resolve(response({status:"unauthenticated"},401));
    if(path==="/app/auth/pending-otp"){
      pendingChecks++;
      return Promise.resolve(
        options.pendingEmailCookie || restored
          ? response({status:"awaiting_code"})
          : response({status:"unavailable"},401)
      );
    }
    if(path==="/app/auth/resume-otp" && mutation){
      restoreCalls++;
      const params=JSON.parse((request as {body?:string})?.body??"{}") as {email?:string};
      restoredEmail=params.email??"";
      if(options.restoreSuccess!==false)restored=true;
      return Promise.resolve(response({status:"if_recent_code_sent"},202));
    }
    if(path==="/app/auth/refresh" && mutation){
      refreshRequests++;
      return Promise.resolve(response(makeSession(originalState==="unauthenticated"?"authenticated":originalState,true)));
    }
    if(path==="/app/auth/mfa/factors"){
      factorReads++;
      return Promise.resolve(response({
        factors:Array.from({length:factors},(_,i)=>
          i===0?workspace1.workspaceId:workspace2.workspaceId),
        pendingCount:pending,canEnroll:true
      }));
    }
    if(path==="/app/auth/mfa/totp/enroll" && mutation){
      enrollRequests++;
      if(options.enrollStatus && options.enrollStatus!==200)
        return Promise.resolve(response({status:"enrollment_limited"},options.enrollStatus));
      pending=1;
      return Promise.resolve(response({
        factorId:workspace1.workspaceId,
        secret:"JBSWY3DPEHPK3PXP",
        qrCodeDataUrl:"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="
      }));
    }
    if(path==="/app/auth/mfa/totp/reset" && mutation){
      pending=0;
      return Promise.resolve(response({status:"incomplete_setup_cleared",cleared:1}));
    }
    if(path==="/app/auth/mfa/totp/verify" && mutation){
      factors=Math.max(1,factors);
      pending=0;
      return Promise.resolve(response(makeSession("authenticated",true)));
    }
    if(path==="/app/auth/logout" && mutation){
      logoutRequests++;
      return Promise.resolve(response({status:"signed_out"}));
    }
    throw new Error("Unexpected synthetic request: "+path);
  };
  let timerSeq=0;
  const timers=new Map<number,{callback:()=>void;delay:number}>();
  const setTimeout=(callback:()=>void,delay:number)=>{
    const id=++timerSeq;
    timers.set(id,{callback,delay});
    return id;
  };
  const clearTimeout=(id:number)=>{timers.delete(id);};
  runInNewContext(privateLoginJs,{window,document:dom,fetch,setTimeout,clearTimeout},{timeout:4000});
  const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
  const click=async(id:string)=>{
    const handler=dom.getElementById(id).listeners.get("click");
    if(!handler)throw new Error("Missing click handler "+id);
    await handler();await flush();
  };
  const submit=async(id:string)=>{
    const handler=dom.getElementById(id).listeners.get("submit");
    if(!handler)throw new Error("Missing submit handler "+id);
    await handler({preventDefault(){}});await flush();
  };
  const event=async(name:string,args:{key?:string;target?:FakeElement}={})=>{
    const handler=listeners.get(name);
    if(!handler)throw new Error("Missing document listener "+name);
    await handler({preventDefault(){},...args});await flush();
  };
  const runTimer=async()=>{
    const first=[...timers.entries()][0];
    if(!first)throw new Error("No scheduled timer to run");
    timers.delete(first[0]);
    first[1].callback();
    await flush();
  };
  return {dom,window,click,submit,flush,event,runTimer,timers,
    stats:()=>({enrollRequests,refreshRequests,logoutRequests,
      factorReads,restoreCalls,pendingChecks,restoredEmail})};
}

describe("secure workspace UX and real static frontend lifecycle",()=>{
  it("renders a separate polished public login and a hidden authenticated shell at boot",()=>{
    expect(privateLoginHtml).toContain('id="boot-panel"');
    expect(privateLoginHtml).toContain('id="auth-shell" class="auth-shell" hidden');
    expect(privateLoginHtml).toContain('id="dashboard-shell" class="dashboard-shell" hidden');
    expect(privateLoginHtml).toContain('id="skip-link"');
    expect(privateLoginHtml).toContain('aria-label="Workspace navigation"');
    expect(privateLoginHtml).not.toContain('id="mfa-reload"');
    expect(privateLoginHtml).not.toContain('id="refresh-session"');
    expect(privateLoginCss).toContain("@media(max-width:760px)");
    expect(privateLoginCss).toContain(":focus-visible");
    expect(privateLoginCss).toContain("[hidden]{display:none!important}");
    expect(privateLoginJs).not.toContain("innerHTML");
    expect(privateLoginJs).not.toContain("localStorage");
  });

  it("shows the workspace overview without any sign-in text, code form or MFA controls",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();
    expect(ui.dom.getElementById("boot-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("auth-shell").hidden).toBe(true);
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(false);
    expect(ui.window.location.pathname).toBe("/app/workspaces");
    expect(ui.dom.getElementById("workspace-title").textContent).toBe("Ishi Nail Lab");
    expect(ui.dom.getElementById("workspace-card-title").textContent).toBe("Ishi Nail Lab");
    expect(ui.dom.getElementById("workspace-role").textContent).toBe("Owner access");
    expect(ui.dom.getElementById("workspace-switcher").hidden).toBe(true);
    expect(ui.dom.getElementById("security-view").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(true);
    expect(ui.stats().factorReads).toBe(0);
    expect(ui.dom.getElementById("nav-team").hidden).toBe(true);
    expect(ui.dom.getElementById("skip-link").href).toBe("#primary-content");
  });

  it("makes security settings discoverable but keeps authenticator controls closed by default",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();
    await ui.click("account-button");
    expect(ui.dom.getElementById("account-menu").hidden).toBe(false);
    expect(ui.dom.getElementById("account-button").getAttribute("aria-expanded")).toBe("true");
    await ui.click("account-security");
    expect(ui.dom.getElementById("account-menu").hidden).toBe(true);
    expect(ui.dom.getElementById("security-view").hidden).toBe(false);
    expect(ui.dom.getElementById("overview-view").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-settings-slot").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-panel").hidden).toBe(true);
    await ui.click("manage-authenticators");
    expect(ui.dom.getElementById("mfa-settings-slot").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-summary").textContent).toContain("2 verified");
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-enrollment").hidden).toBe(true);
    expect(ui.stats().factorReads).toBe(1);
    await ui.click("manage-authenticators");
    expect(ui.dom.getElementById("mfa-panel").hidden).toBe(true);
  });

  it("shows QR and manual key only inside an explicit security setup and hides them after verification",async()=>{
    const ui=setup({factorCount:0});
    await ui.flush();
    await ui.click("nav-security");
    await ui.click("manage-authenticators");
    expect(ui.dom.getElementById("mfa-setup").hidden).toBe(false);
    await ui.click("mfa-enroll");
    expect(ui.stats().enrollRequests).toBe(1);
    expect(ui.dom.getElementById("mfa-qr").src).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(ui.dom.getElementById("mfa-qr").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-secret").textContent).toBe("JBSWY3DPEHPK3PXP");
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(false);
    await ui.click("manage-authenticators");
    await ui.click("manage-authenticators");
    expect(ui.dom.getElementById("mfa-secret").textContent).toBe("JBSWY3DPEHPK3PXP");
    expect(ui.stats().enrollRequests).toBe(1);
    ui.dom.getElementById("mfa-factor").value=workspace1.workspaceId;
    ui.dom.getElementById("mfa-code").value="123456";
    await ui.submit("mfa-form");
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(false);
    expect(ui.dom.getElementById("overview-view").hidden).toBe(false);
    expect(ui.dom.getElementById("security-view").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-secret").textContent).toBe("");
    expect(ui.dom.getElementById("mfa-qr").src).toBe("");
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(true);
  });

  it("requires MFA after email step-up, then hides the login and challenge on success",async()=>{
    const ui=setup({state:"mfa_required",factorCount:2});
    await ui.flush();
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(true);
    expect(ui.dom.getElementById("auth-shell").hidden).toBe(false);
    expect(ui.dom.getElementById("login-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-gate").hidden).toBe(false);
    expect(ui.dom.getElementById("auth-title").textContent).toBe("Verify it's you");
    expect(ui.dom.getElementById("mfa-factor-picker").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-factor").options).toHaveLength(2);
    expect(ui.window.location.pathname).toBe("/app/login");
    ui.dom.getElementById("mfa-factor").value=workspace2.workspaceId;
    ui.dom.getElementById("mfa-code").value="654321";
    await ui.submit("mfa-form");
    expect(ui.window.location.pathname).toBe("/app/workspaces");
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(false);
    expect(ui.dom.getElementById("auth-shell").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-code").value).toBe("");
    expect(ui.dom.getElementById("workspace-title").textContent).toBe("Ishi Nail Lab");
  });

  it("refreshes a near-expired session automatically without manual controls and preserves the screen",async()=>{
    const ui=setup({nearExpiry:true});
    await ui.flush();
    expect(ui.timers.size).toBeGreaterThan(0);
    expect(ui.stats().refreshRequests).toBe(0);
    await ui.click("nav-security");
    await ui.runTimer();
    expect(ui.stats().refreshRequests).toBe(1);
    expect(ui.dom.getElementById("security-view").hidden).toBe(false);
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(false);
    expect(ui.window.location.pathname).toBe("/app/workspaces");
  });

  it("hides team invitation navigation when feature is disabled, and supports multiple authorized workspaces",async()=>{
    const ui=setup({multiWorkspace:true,allowTeam:true});
    await ui.flush();
    expect(ui.dom.getElementById("nav-team").hidden).toBe(false);
    expect(ui.dom.getElementById("workspace-switcher").hidden).toBe(false);
    ui.dom.getElementById("workspace-select").value=workspace2.workspaceId;
    const change=ui.dom.getElementById("workspace-select").listeners.get("change");
    if(!change)throw Error("No workspace switch handler");
    await change();await ui.flush();
    expect(ui.dom.getElementById("workspace-title").textContent).toBe("Second workspace");
    expect(ui.dom.getElementById("workspace-role").textContent).toBe("Viewer access");
    await ui.click("nav-team");
    expect(ui.dom.getElementById("team-view").hidden).toBe(false);
    await ui.event("keydown",{key:"Escape"});
    expect(ui.dom.getElementById("account-menu").hidden).toBe(true);
  });

  it("signs out and clears all authenticated content without leaving security state behind",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();
    await ui.click("nav-security");
    await ui.click("manage-authenticators");
    await ui.click("sign-out");
    expect(ui.stats().logoutRequests).toBe(1);
    expect(ui.window.location.pathname).toBe("/app/login");
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(true);
    expect(ui.dom.getElementById("auth-shell").hidden).toBe(false);
    expect(ui.dom.getElementById("login-panel").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-factor").options).toHaveLength(0);
    expect(ui.dom.getElementById("status").textContent).toContain("Signed out");
  });

  it("a normal email login from the original browser resumes directly at the emailed OTP input",async()=>{
    const ui=setup({state:"unauthenticated",pendingEmailCookie:true});
    await ui.flush();
    expect(ui.dom.getElementById("boot-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("auth-shell").hidden).toBe(false);
    expect(ui.dom.getElementById("email-form").hidden).toBe(true);
    expect(ui.dom.getElementById("code-form").hidden).toBe(false);
    expect(ui.dom.getElementById("auth-title").textContent).toBe("Enter your email code");
    expect(ui.window.location.pathname).toBe("/app/login");
    expect(ui.stats().restoreCalls).toBe(0);
    expect(ui.stats().pendingChecks).toBe(1);
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-gate").hidden).toBe(true);
  });

  it("a code email link opened in a different browser restores the challenge without requesting another OTP",async()=>{
    const email="invited+tag@example.com";
    const ui=setup({state:"unauthenticated",emailLinkHint:email});
    await ui.flush();
    expect(ui.window.location.hash).toBe("");
    expect(ui.window.location.pathname).toBe("/app/login");
    expect(ui.stats().restoreCalls).toBe(1);
    expect(ui.stats().restoredEmail).toBe(email);
    expect(ui.stats().pendingChecks).toBe(2);
    expect(ui.dom.getElementById("email-form").hidden).toBe(true);
    expect(ui.dom.getElementById("code-form").hidden).toBe(false);
    expect(ui.dom.getElementById("auth-title").textContent).toBe("Enter your email code");
    expect(ui.dom.getElementById("mfa-gate").hidden).toBe(true);
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(true);
  });

  it("an expired cross-browser emailed link safely requires a new code without fake authentication",async()=>{
    const ui=setup({
      state:"unauthenticated",emailLinkHint:"invited@example.com",restoreSuccess:false
    });
    await ui.flush();
    expect(ui.window.location.hash).toBe("");
    expect(ui.stats().restoreCalls).toBe(1);
    expect(ui.dom.getElementById("email-form").hidden).toBe(false);
    expect(ui.dom.getElementById("code-form").hidden).toBe(true);
    expect(ui.dom.getElementById("status").textContent).toContain("expired");
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(true);
  });

  it("an arbitrary direct login visit still presents email, and active AAL2 sessions ignore link fragments",async()=>{
    const fresh=setup({state:"unauthenticated"});
    await fresh.flush();
    expect(fresh.dom.getElementById("email-form").hidden).toBe(false);
    expect(fresh.dom.getElementById("code-form").hidden).toBe(true);
    expect(fresh.stats().restoreCalls).toBe(0);
    const authenticated=setup({state:"authenticated",
      emailLinkHint:"different@example.com"});
    await authenticated.flush();
    expect(authenticated.window.location.hash).toBe("");
    expect(authenticated.dom.getElementById("dashboard-shell").hidden).toBe(false);
    expect(authenticated.stats().restoreCalls).toBe(0);
    expect(authenticated.dom.getElementById("code-form").hidden).toBe(true);
  });

  it("provides the security cooldown as a contextual error without generating a phantom QR",async()=>{
    const ui=setup({enrollStatus:429});
    await ui.flush();
    await ui.click("nav-security");
    await ui.click("manage-authenticators");
    await ui.click("mfa-enroll");
    expect(ui.stats().enrollRequests).toBe(1);
    expect(ui.dom.getElementById("mfa-qr").src).toBe("");
    expect(ui.dom.getElementById("mfa-enrollment").hidden).toBe(true);
    expect(ui.dom.getElementById("status").textContent).toContain("up to 15 minutes");
  });
});
