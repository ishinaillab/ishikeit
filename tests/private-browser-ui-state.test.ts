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
interface ChannelRowFixture {
  connectionId:string;
  workspaceId:string;
  provider:string;
  accountId:string;
  status:string;
  generation:number;
}
interface UiFixtureOptions {
  channelItems?:ChannelRowFixture[];
  channelReadStatus?:number;
  capabilityPayload?:unknown;
  capabilityReadStatus?:number;
  state?:"authenticated"|"mfa_required"|"unauthenticated";
  deferInitialSession?:boolean;
  pendingEmailCookie?:boolean;
  emailLinkHint?:string;
  restoreSuccess?:boolean;
  factorCount?:number;
  pendingInitial?:boolean;
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
  let pending=options.pendingInitial?1:0;
  let enrollRequests=0;
  let refreshRequests=0;
  let logoutRequests=0;
  let factorReads=0;
  let restoreCalls=0;
  let pendingChecks=0;
  let restored=false;
  let restoredEmail="";
  let securityChanges=0;
  let resetRequests=0;
  let channelReads=0;
  const channelPaths:string[]=[];
  let capabilityReads=0;
  const capabilityPaths:string[]=[];
  let signIn2faEnabled=true;
  const disabled=new Set<string>();
  const factorLabels=new Map<string,string>();
  let deletedByProvider=0;
  let copiedKey="";
  const navigator={clipboard:{writeText:(value:string)=>{copiedKey=value;return Promise.resolve();}}};
  const factorIds=[workspace1.workspaceId,workspace2.workspaceId];
  const workspaces={
    items:options.multiWorkspace?[workspace1,workspace2]:[workspace1]
  };
  const originalState=options.state??"authenticated";
  let completeInitialSession:(()=>void)|undefined;
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
    if(path==="/app/auth/session"){
      const result=originalState==="unauthenticated"
        ? response({status:"unauthenticated"},401)
        : response(makeSession(originalState));
      if(options.deferInitialSession && completeInitialSession===undefined){
        return new Promise<ReturnType<typeof response>>(resolve=>{
          completeInitialSession=()=>resolve(result);
        });
      }
      return Promise.resolve(result);
    }
    if(path==="/app/auth/csrf")
      return Promise.resolve(response({status:"unauthenticated"},401));
    if(path.startsWith("/app/auth/workspaces/")&&path.endsWith("/capabilities")){
      capabilityReads++;
      capabilityPaths.push(path);
      if(options.capabilityReadStatus && options.capabilityReadStatus!==200)
        return Promise.resolve(response({status:"capability_evidence_unavailable"},
          options.capabilityReadStatus));
      return Promise.resolve(response(options.capabilityPayload??{status:"unavailable"}));
    }
    if(path.startsWith("/app/auth/workspaces/") && path.includes("/connections")){
      channelReads++;
      channelPaths.push(path);
      const workspaceId=path.split("/")[4];
      if(options.channelReadStatus!==undefined && options.channelReadStatus!==200)
        return Promise.resolve(response({status:"connections_unavailable"},options.channelReadStatus));
      if(workspaceId!==workspace1.workspaceId)
        return Promise.resolve(response({status:"connections_unavailable"},403));
      const records=options.channelItems??[];
      const cursor=path.includes("?after=")
        ?decodeURIComponent(path.split("?after=")[1]??""):"";
      const start=cursor
        ?Math.max(0,records.findIndex(x=>x.connectionId===cursor)+1):0;
      const page=records.slice(start,start+20);
      const next=records.length>start+20?page[page.length-1]?.connectionId:undefined;
      return Promise.resolve(response({items:page,
        ...(next===undefined?{}:{nextCursor:next})}));
    }
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
      const ids=Array.from({length:factors},(_,i)=>factorIds[i]??workspace2.workspaceId);
      return Promise.resolve(response({
        factors:ids.filter(id=>!disabled.has(id)),
        devices:ids.map((id,i)=>({
          factorId:id,
          label:factorLabels.get(id)??(i===0?"Primary authenticator":"Backup authenticator"),
          enrolledAt:"2026-11-11T17:53:00.000Z",enabled:!disabled.has(id)
        })),
        pendingCount:pending,canEnroll:true,signIn2faEnabled
      }));
    }
    if(path==="/app/auth/mfa/preferences" && mutation){
      securityChanges++;
      const body=JSON.parse(request?.body??"{}") as {
        kind:"factor"|"sign_in"|"rename"|"remove"|"disable_app";factorId?:string;name?:string;enabled?:boolean
      };
      if(body.kind==="factor" && body.factorId){
        if(!body.enabled && factors-disabled.size<=1)
          return Promise.resolve(response({status:"last_authenticator_required"},409));
        if(body.enabled)disabled.delete(body.factorId);
        else disabled.add(body.factorId);
      }else if(body.kind==="rename" && body.factorId && body.name){
        factorLabels.set(body.factorId,body.name);
      }else if(body.kind==="remove" && body.factorId){
        deletedByProvider++;
        if(factors===1){factors=0;
          return Promise.resolve(response({status:"authenticator_removed_signin_required",removed:1}));}
        factors--;
      }else if(body.kind==="disable_app"){
        deletedByProvider+=factors;
        const count=factors;factors=0;
        return Promise.resolve(response({status:"authenticator_removed_signin_required",removed:count}));
      }else if(body.kind==="sign_in"){
        signIn2faEnabled=body.enabled===true;
      }
      return Promise.resolve(response({status:"changed",csrfToken:"test_csrf_settings_rotated"}));
    }
    if(path==="/app/auth/mfa/totp/enroll" && mutation){
      enrollRequests++;
      if(pending>0)return Promise.resolve(response({status:"mfa_incomplete_setup"},409));
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
      resetRequests++;
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
  runInNewContext(privateLoginJs,{window,document:dom,navigator,fetch,setTimeout,clearTimeout},{timeout:4000});
  const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
  const clickElement=async(element:FakeElement)=>{
    const handler=element.listeners.get("click");
    if(!handler)throw new Error("Missing dynamic click handler");
    await handler();await flush();
  };
  const click=async(id:string)=>clickElement(dom.getElementById(id));
  const input=async(id:string,value:string)=>{
    const node=dom.getElementById(id);node.value=value;
    const listener=node.listeners.get("input");
    if(!listener)throw new Error("No input handler for "+id);
    await listener();await flush();
  };
  const clickDevice=async(index:number)=>{
    const row=dom.getElementById("mfa-devices").children[index];
    if(!row?.children[1])throw Error("Missing device switch");
    await clickElement(row.children[1]);
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
  return {dom,window,click,clickElement,input,clickDevice,submit,flush,event,runTimer,timers,
    completeInitialSession:()=>{
      if(!completeInitialSession)throw Error("No pending initial session request");
      const done=completeInitialSession;completeInitialSession=undefined;done();
    },
    stats:()=>({enrollRequests,refreshRequests,logoutRequests,
      factorReads,restoreCalls,pendingChecks,restoredEmail,securityChanges,resetRequests,
      channelReads,channelPaths,capabilityReads,capabilityPaths,
      signIn2faEnabled,disabledCount:disabled.size,deletedByProvider,copiedKey,factors})};
}

describe("secure workspace UX and real static frontend lifecycle",()=>{

  it("shows only the branded shell during short session checks and never exposes an internal status",async()=>{
    expect(privateLoginHtml).not.toContain("Checking your session");
    expect(privateLoginHtml).toContain('id="boot-progress" class="boot-progress" aria-hidden="true" hidden');
    expect(privateLoginHtml).toContain('id="boot-slow-copy" class="muted" hidden');
    expect(privateLoginHtml).toContain('class="sr-only">Loading Ishikeit</span>');
    expect(privateLoginCss).toContain("@keyframes boot-progress-sweep");
    expect(privateLoginCss).toContain(".boot-progress{position:absolute");
    expect(privateLoginCss).toContain(".boot-panel .muted{position:absolute");
    expect(privateLoginCss).toContain(".boot-progress::before{width:100%;transform:none}");
    const ui=setup({state:"unauthenticated"});
    await ui.flush();
    expect(ui.dom.getElementById("boot-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("boot-progress").hidden).toBe(true);
    expect(ui.dom.getElementById("boot-slow-copy").hidden).toBe(true);
    expect(ui.timers.size).toBe(0);
  });

  it("delays visual progress on a slow check and clears it on authenticated navigation",async()=>{
    const ui=setup({deferInitialSession:true,state:"authenticated"});
    expect(ui.dom.getElementById("boot-panel").hidden).toBe(false);
    expect(ui.dom.getElementById("boot-progress").hidden).toBe(true);
    expect(ui.dom.getElementById("boot-slow-copy").hidden).toBe(true);
    expect(ui.dom.getElementById("auth-shell").hidden).toBe(true);
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(true);
    await ui.runTimer();
    expect(ui.dom.getElementById("boot-progress").hidden).toBe(false);
    expect(ui.dom.getElementById("boot-slow-copy").hidden).toBe(true);
    await ui.runTimer();
    expect(ui.dom.getElementById("boot-slow-copy").hidden).toBe(false);
    ui.completeInitialSession();
    await ui.flush();
    expect(ui.dom.getElementById("boot-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(false);
    expect(ui.dom.getElementById("auth-shell").hidden).toBe(true);
  });

  it("clears deferred splash timers when an existing session requires MFA",async()=>{
    const ui=setup({state:"mfa_required"});
    await ui.flush();
    expect(ui.dom.getElementById("boot-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("auth-shell").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-gate").hidden).toBe(false);
    expect(ui.dom.getElementById("boot-progress").hidden).toBe(true);
    expect(ui.dom.getElementById("boot-slow-copy").hidden).toBe(true);
  });


  it("uses one discoverable authenticator method and no confusing sign-in protection switch",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();await ui.click("nav-security");await ui.click("mfa-open-dialog");
    expect(privateLoginHtml).not.toContain("id=\"mfa-signin-toggle\"");
    expect(privateLoginHtml).not.toContain("Require authenticator at sign-in");
    expect(ui.dom.getElementById("mfa-configured-methods").children).toHaveLength(1);
    expect(ui.dom.getElementById("mfa-overview-description").textContent)
      .toContain("protect your sign-in");
  });

  it("allows adding a second or third authenticator after fresh AAL2 proof",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();await ui.click("nav-security");await ui.click("mfa-open-dialog");
    await ui.clickElement(ui.dom.getElementById("mfa-configured-methods").children[0]!);
    await ui.click("mfa-modal-add-device");
    await ui.input("mfa-modal-name","My Samsung");
    await ui.click("mfa-modal-connect-next");
    expect(ui.dom.getElementById("mfa-modal-proof").hidden).toBe(false);
    expect(ui.stats().enrollRequests).toBe(0);
    await ui.input("mfa-modal-proof-code","123456");
    await ui.submit("mfa-modal-proof-form");
    expect(ui.stats().enrollRequests).toBe(1);
    expect(ui.dom.getElementById("mfa-modal-instructions").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-modal-key").textContent).toBe("JBSWY3DPEHPK3PXP");
  });

  it("offers a functional restart for pending unfinished provider enrollment",async()=>{
    const ui=setup({factorCount:2,pendingInitial:true});
    await ui.flush();await ui.click("nav-security");await ui.click("mfa-open-dialog");
    await ui.clickElement(ui.dom.getElementById("mfa-configured-methods").children[0]!);
    await ui.click("mfa-modal-add-device");
    expect(ui.dom.getElementById("mfa-modal-pending-note").hidden).toBe(false);
    await ui.click("mfa-modal-restart");
    expect(ui.stats().resetRequests).toBe(1);
    expect(ui.dom.getElementById("mfa-modal-pending-note").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-modal-status").textContent)
      .toContain("Previous setup canceled");
  });

  it("opens a Meta-inspired overview and lists verified authentication app under active login codes",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();await ui.click("nav-security");
    await ui.click("mfa-open-dialog");
    expect(ui.dom.getElementById("mfa-modal-overview").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-configured-methods").children).toHaveLength(1);
    expect(ui.dom.getElementById("mfa-available-methods").children).toHaveLength(0);
    await ui.clickElement(ui.dom.getElementById("mfa-configured-methods").children[0]!);
    expect(ui.dom.getElementById("mfa-modal-manage").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-method-toggle").getAttribute("aria-checked")).toBe("true");
    expect(ui.dom.getElementById("mfa-modal-devices").children).toHaveLength(2);
  });

  it("adds a named authenticator only after verifying a six-digit code, with QR and copy key",async()=>{
    const ui=setup({factorCount:0});
    await ui.flush();await ui.click("nav-security");await ui.click("mfa-open-dialog");
    expect(ui.dom.getElementById("mfa-configured-methods").children).toHaveLength(0);
    expect(ui.dom.getElementById("mfa-available-methods").children).toHaveLength(1);
    await ui.clickElement(ui.dom.getElementById("mfa-available-methods").children[0]!);
    expect(ui.dom.getElementById("mfa-modal-connect-next").disabled).toBe(true);
    await ui.input("mfa-modal-name","   ");
    expect(ui.dom.getElementById("mfa-modal-connect-next").disabled).toBe(true);
    await ui.input("mfa-modal-name","My Samsung");
    expect(ui.dom.getElementById("mfa-modal-connect-next").disabled).toBe(false);
    await ui.click("mfa-modal-connect-next");
    expect(ui.stats().enrollRequests).toBe(1);
    expect(ui.dom.getElementById("mfa-modal-instructions").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-modal-qr").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-modal-key").textContent).toBe("JBSWY3DPEHPK3PXP");
    await ui.click("mfa-modal-copy");
    expect(ui.stats().copiedKey).toBe("JBSWY3DPEHPK3PXP");
    await ui.click("mfa-modal-enter-code");
    await ui.input("mfa-modal-verify-code","12a34");
    expect(ui.dom.getElementById("mfa-modal-verify-next").disabled).toBe(true);
    await ui.input("mfa-modal-verify-code","123456");
    expect(ui.dom.getElementById("mfa-modal-verify-next").disabled).toBe(false);
    await ui.submit("mfa-modal-verify-form");
    expect(ui.dom.getElementById("mfa-modal-success").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-modal-key").textContent).toBe("");
    expect(ui.dom.getElementById("mfa-modal-qr").src).toBe("");
    await ui.click("mfa-modal-done");
    expect(ui.dom.getElementById("mfa-configured-methods").children).toHaveLength(1);
  });

  it("renames an authenticator with fresh proof, then removes the selected factor permanently",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();await ui.click("nav-security");await ui.click("mfa-open-dialog");
    await ui.clickElement(ui.dom.getElementById("mfa-configured-methods").children[0]!);
    await ui.clickElement(ui.dom.getElementById("mfa-modal-devices").children[1]!);
    await ui.click("mfa-modal-edit-rename");
    expect(ui.dom.getElementById("mfa-modal-rename-name").value).toBe("Backup authenticator");
    await ui.input("mfa-modal-rename-name","  My Samsung  ");
    expect(ui.dom.getElementById("mfa-modal-rename-save").disabled).toBe(false);
    await ui.click("mfa-modal-rename-save");
    await ui.input("mfa-modal-proof-code","123456");
    await ui.submit("mfa-modal-proof-form");
    expect(ui.dom.getElementById("mfa-modal-manage").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-modal-devices").children[1]?.children[0]?.children[0]?.textContent)
      .toBe("My Samsung");
    await ui.clickElement(ui.dom.getElementById("mfa-modal-devices").children[1]!);
    await ui.click("mfa-modal-edit-remove");
    await ui.click("mfa-modal-remove-cancel");
    expect(ui.stats().deletedByProvider).toBe(0);
    await ui.click("mfa-modal-edit-remove");
    await ui.click("mfa-modal-remove-confirm-button");
    await ui.input("mfa-modal-proof-code","123456");
    await ui.submit("mfa-modal-proof-form");
    expect(ui.stats().deletedByProvider).toBe(1);
    expect(ui.dom.getElementById("mfa-modal-devices").children).toHaveLength(1);
    expect(ui.dom.getElementById("mfa-method-toggle").getAttribute("aria-checked")).toBe("true");
  });

  it("Cancel keeps all factors, but Turn off permanently deletes all and requires sign-in",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();await ui.click("nav-security");await ui.click("mfa-open-dialog");
    await ui.clickElement(ui.dom.getElementById("mfa-configured-methods").children[0]!);
    await ui.click("mfa-method-toggle");
    expect(ui.dom.getElementById("mfa-modal-method-confirm").hidden).toBe(false);
    await ui.click("mfa-modal-method-cancel");
    expect(ui.stats().securityChanges).toBe(0);
    expect(ui.stats().factors).toBe(2);
    await ui.click("mfa-method-toggle");
    await ui.click("mfa-modal-turn-off");
    await ui.input("mfa-modal-proof-code","123456");
    await ui.submit("mfa-modal-proof-form");
    expect(ui.stats().deletedByProvider).toBe(2);
    expect(ui.stats().factors).toBe(0);
    expect(ui.dom.getElementById("mfa-dialog").hidden).toBe(true);
    expect(ui.dom.getElementById("auth-shell").hidden).toBe(false);
  });


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


  it("shows a truthful empty Channels registry without claiming provider access",async()=>{
    const ui=setup();await ui.flush();
    expect(ui.dom.getElementById("nav-channels").hidden).toBe(false);
    await ui.click("nav-channels");
    expect(ui.dom.getElementById("channels-view").hidden).toBe(false);
    expect(ui.dom.getElementById("channels-status").textContent)
      .toBe("No accounts have been linked to this workspace yet.");
    expect(privateLoginHtml).toContain("not a live provider permission check");
    expect(ui.dom.getElementById("channels-list").children).toHaveLength(0);
    expect(ui.dom.getElementById("channels-more").hidden).toBe(true);
    expect(ui.stats().channelReads).toBe(1);
    await ui.click("channels-refresh");
    expect(ui.stats().channelReads).toBe(2);
    expect(privateLoginHtml).not.toContain('id="channels-connect"');
  });

  it("renders verified tenant rows as text and fixed internal status without XSS",async()=>{
    const row:ChannelRowFixture={
      connectionId:"123e4567-e89b-42d3-a456-426614174001",
      workspaceId:workspace1.workspaceId,
      provider:"instagram",
      accountId:'<img src=x onerror="alert(1)">',
      status:"verifying",generation:2
    };
    const ui=setup({channelItems:[row]});await ui.flush();
    await ui.click("nav-channels");
    const list=ui.dom.getElementById("channels-list");
    expect(list.children).toHaveLength(1);
    const card=list.children[0]!;
    expect(card.getAttribute("role")).toBe("listitem");
    expect(card.children[0]!.children[0]!.textContent).toBe("instagram");
    expect(card.children[0]!.children[1]!.textContent)
      .toBe("Provider account ID: "+row.accountId);
    expect(card.children[1]!.textContent).toBe("Verification pending");
    expect(ui.dom.getElementById("channels-status").textContent)
      .toContain("Showing 1 account registry");
    expect(privateLoginJs).not.toContain("innerHTML");
    expect(ui.stats().channelPaths).toEqual([
      "/app/auth/workspaces/"+workspace1.workspaceId+"/connections"
    ]);
  });

  it("renders source-bounded per-account rights evidence while explicitly denying live sending",async()=>{
    const row:ChannelRowFixture={
      connectionId:"123e4567-e89b-42d3-a456-426614174001",
      workspaceId:workspace1.workspaceId,provider:"telegram",
      accountId:"9001",status:"connected",generation:2
    };
    const payload={
      connection:row,capability:{
        provider:"telegram",accountId:"9001",
        contractRevision:"2026-11-02.1",tenantSendingEnabled:false,
        features:[{id:"official_account_replies",evidenceStatus:"available",
          reason:"All reviewed API requirements verified for this account"}],
        evidence:[{key:"telegram.rights.can_reply",status:"granted",
          source:"provider_connection_readback",
          validUntil:new Date(Date.now()+300000).toISOString()}]
      }
    };
    const ui=setup({channelItems:[row],capabilityPayload:payload});
    await ui.flush();await ui.click("nav-channels");
    const card=ui.dom.getElementById("channels-list").children[0]!;
    const info=card.children[0]!;
    const toggle=info.children[info.children.length-2]!;
    const panel=info.children[info.children.length-1]!;
    expect(toggle.textContent).toBe("View verified permissions");
    expect(panel.hidden).toBe(true);
    await ui.clickElement(toggle);
    expect(panel.hidden).toBe(false);
    expect(panel.children[0]?.textContent).toContain("not a message-send");
    expect(panel.children[1]?.children[0]?.textContent).toContain("sending still disabled");
    expect(panel.children[2]?.children[0]?.textContent)
      .toContain("telegram.rights.can_reply: granted");
    expect(ui.stats().capabilityReads).toBe(1);
    expect(ui.stats().capabilityPaths).toEqual([
      "/app/auth/workspaces/"+workspace1.workspaceId+
      "/connections/"+row.connectionId+"/capabilities"
    ]);
    await ui.clickElement(toggle);
    expect(panel.hidden).toBe(true);
    expect(ui.stats().capabilityReads).toBe(1);
  });

  it("rejects a forged other-account evidence response without rendering its values",async()=>{
    const row:ChannelRowFixture={
      connectionId:"123e4567-e89b-42d3-a456-426614174001",
      workspaceId:workspace1.workspaceId,provider:"telegram",
      accountId:"9001",status:"connected",generation:2
    };
    const ui=setup({channelItems:[row],capabilityPayload:{
      connection:{...row,accountId:"FOREIGN-TENANT-ACCOUNT"},
      capability:{provider:"telegram",accountId:"FOREIGN-TENANT-ACCOUNT",
        tenantSendingEnabled:false,
        features:[{id:"bad",evidenceStatus:"available",
          reason:"SECRET-NEVER-SHOW"}],evidence:[]}
    }});
    await ui.flush();await ui.click("nav-channels");
    const info=ui.dom.getElementById("channels-list").children[0]!.children[0]!;
    const toggle=info.children[info.children.length-2]!;
    const panel=info.children[info.children.length-1]!;
    await ui.clickElement(toggle);
    expect(panel.children[0]?.textContent).toContain("could not be verified");
    expect(panel.children[0]?.textContent).not.toContain("SECRET-NEVER-SHOW");
    expect(ui.stats().capabilityReads).toBe(1);
  });

  it("paginates the account registry in bounded pages with no duplicate first page",async()=>{
    const rows:ChannelRowFixture[]=Array.from({length:21},(_,i)=>({
      connectionId:"123e4567-e89b-42d3-a456-"+(426614174001+i).toString().padStart(12,"0"),
      workspaceId:workspace1.workspaceId,
      provider:i%2?"telegram":"instagram",
      accountId:"provider-"+i,status:"connected",generation:1
    }));
    const ui=setup({channelItems:rows});await ui.flush();
    await ui.click("nav-channels");
    expect(ui.dom.getElementById("channels-list").children).toHaveLength(20);
    expect(ui.dom.getElementById("channels-more").hidden).toBe(false);
    await ui.click("channels-more");
    expect(ui.dom.getElementById("channels-list").children).toHaveLength(21);
    expect(ui.dom.getElementById("channels-more").hidden).toBe(true);
    expect(ui.stats().channelPaths[1]).toContain("?after="+rows[19]!.connectionId);
    expect(ui.dom.getElementById("channels-status").textContent)
      .toContain("Showing 21");
  });

  it("keeps viewer workspaces out of Channels and clears records on account switching/sign-out",async()=>{
    const rows:ChannelRowFixture[]=[{
      connectionId:"123e4567-e89b-42d3-a456-426614174001",
      workspaceId:workspace1.workspaceId,
      provider:"telegram",accountId:"private-owner-id",
      status:"connected",generation:3
    }];
    const ui=setup({multiWorkspace:true,channelItems:rows});await ui.flush();
    await ui.click("nav-channels");
    expect(ui.dom.getElementById("channels-list").children).toHaveLength(1);
    await ui.click("nav-overview");
    expect(ui.dom.getElementById("channels-list").children).toHaveLength(0);
    ui.dom.getElementById("workspace-select").value=workspace2.workspaceId;
    const onChange=ui.dom.getElementById("workspace-select").listeners.get("change");
    if(!onChange)throw Error("No workspace switch");
    await onChange();await ui.flush();
    expect(ui.dom.getElementById("nav-channels").hidden).toBe(true);
    expect(ui.stats().channelReads).toBe(1);
    ui.dom.getElementById("workspace-select").value=workspace1.workspaceId;
    await onChange();await ui.flush();
    expect(ui.dom.getElementById("nav-channels").hidden).toBe(false);
    await ui.click("nav-channels");
    expect(ui.dom.getElementById("channels-list").children).toHaveLength(1);
    await ui.click("sign-out");
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(true);
    expect(ui.dom.getElementById("channels-list").children).toHaveLength(0);
  });

  it("denies fake or unavailable registry responses with a safe retry message",async()=>{
    const ui=setup({channelReadStatus:403});await ui.flush();
    await ui.click("nav-channels");
    expect(ui.dom.getElementById("channels-list").children).toHaveLength(0);
    expect(ui.dom.getElementById("channels-status").textContent)
      .toContain("Couldn't load accounts");
    expect(ui.dom.getElementById("channels-more").hidden).toBe(true);
    expect(ui.dom.getElementById("channels-refresh").disabled).toBe(false);
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

  it("shows already-enrolled authenticators immediately on Security, separate from Add",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();
    await ui.click("account-button");
    expect(ui.dom.getElementById("account-menu").hidden).toBe(false);
    await ui.click("account-security");
    expect(ui.dom.getElementById("security-view").hidden).toBe(false);
    expect(ui.dom.getElementById("overview-view").hidden).toBe(true);
    expect(ui.dom.getElementById("account-menu").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-devices").children).toHaveLength(2);
    expect(ui.dom.getElementById("mfa-account-toggle").getAttribute("aria-checked")).toBe("true");
    expect(ui.dom.getElementById("mfa-devices").children[0]?.children[1]?.getAttribute("aria-checked")).toBe("true");
    expect(ui.dom.getElementById("mfa-settings-slot").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-enrollment").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(true);
    expect(ui.stats().enrollRequests).toBe(0);
    expect(ui.stats().factorReads).toBe(1);
  });

  it("shows QR and setup key only on Add and returns to Security with verified devices afterward",async()=>{
    const ui=setup({factorCount:0});
    await ui.flush();
    await ui.click("nav-security");
    expect(ui.dom.getElementById("mfa-devices").children).toHaveLength(0);
    await ui.click("mfa-add");
    expect(ui.stats().enrollRequests).toBe(1);
    expect(ui.dom.getElementById("mfa-qr").src).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(ui.dom.getElementById("mfa-qr").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-secret").textContent).toBe("JBSWY3DPEHPK3PXP");
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-cancel").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-pending-help").hidden).toBe(true);
    ui.dom.getElementById("mfa-factor").value=workspace1.workspaceId;
    ui.dom.getElementById("mfa-code").value="123456";
    await ui.submit("mfa-form");
    expect(ui.dom.getElementById("dashboard-shell").hidden).toBe(false);
    expect(ui.dom.getElementById("security-view").hidden).toBe(false);
    expect(ui.dom.getElementById("overview-view").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-secret").textContent).toBe("");
    expect(ui.dom.getElementById("mfa-qr").src).toBe("");
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-devices").children).toHaveLength(1);
  });

  it("Cancel below setup code and dropdown removes only unfinished enrollment",async()=>{
    expect(privateLoginHtml.indexOf('id="mfa-cancel"'))
      .toBeGreaterThan(privateLoginHtml.indexOf('id="mfa-submit"'));
    expect(privateLoginHtml).not.toContain("Discard unfinished setup");
    expect(privateLoginHtml).not.toContain("An earlier authenticator setup was not finished.");
    const ui=setup({factorCount:2});
    await ui.flush();
    await ui.click("nav-security");
    await ui.click("mfa-add");
    expect(ui.dom.getElementById("mfa-cancel").hidden).toBe(false);
    await ui.click("mfa-cancel");
    expect(ui.stats().resetRequests).toBe(1);
    expect(ui.dom.getElementById("mfa-secret").textContent).toBe("");
    expect(ui.dom.getElementById("mfa-qr").src).toBe("");
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-devices").children).toHaveLength(2);
    expect(ui.dom.getElementById("security-view").hidden).toBe(false);
  });

  it("changes only the selected authenticator after proof from another active device",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();
    await ui.click("nav-security");
    await ui.clickDevice(1);
    expect(ui.dom.getElementById("mfa-change-panel").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-proof-factor").options).toHaveLength(1);
    expect(ui.dom.getElementById("mfa-devices").children[1]?.children[1]?.getAttribute("aria-checked")).toBe("true");
    expect(ui.stats().securityChanges).toBe(0);
    ui.dom.getElementById("mfa-change-code").value="123456";
    await ui.submit("mfa-change-form");
    expect(ui.stats().securityChanges).toBe(1);
    expect(ui.dom.getElementById("mfa-devices").children[1]?.children[1]?.getAttribute("aria-checked")).toBe("false");
    expect(ui.dom.getElementById("mfa-change-panel").hidden).toBe(true);
    await ui.clickDevice(1);
    ui.dom.getElementById("mfa-change-code").value="654321";
    await ui.submit("mfa-change-form");
    expect(ui.stats().securityChanges).toBe(2);
    expect(ui.dom.getElementById("mfa-devices").children[1]?.children[1]?.getAttribute("aria-checked")).toBe("true");
    expect(ui.dom.getElementById("mfa-devices").children).toHaveLength(2);
  });

  it("keeps authenticator switch names stable across toggles per WAI-ARIA APG",async()=>{
    const ui=setup({factorCount:2});
    await ui.flush();
    await ui.click("nav-security");
    const list=ui.dom.getElementById("mfa-devices");
    const before=list.children[1]?.children[1]?.getAttribute("aria-label");
    expect(before).toBe("Backup authenticator");
    await ui.clickDevice(1);
    ui.dom.getElementById("mfa-change-code").value="654321";
    await ui.submit("mfa-change-form");
    const after=list.children[1]?.children[1];
    expect(after?.getAttribute("aria-label")).toBe(before);
    expect(after?.getAttribute("aria-checked")).toBe("false");
    expect(ui.dom.getElementById("mfa-last-device-help").hidden).toBe(false);
    await ui.clickDevice(1);
    ui.dom.getElementById("mfa-change-code").value="123456";
    await ui.submit("mfa-change-form");
    expect(list.children[1]?.children[1]?.getAttribute("aria-label")).toBe(before);
    expect(ui.dom.getElementById("mfa-last-device-help").hidden).toBe(true);
  });

  it("never offers a switch to disable the last usable authenticator",async()=>{
    const ui=setup({factorCount:1});
    await ui.flush();
    await ui.click("nav-security");
    const control=ui.dom.getElementById("mfa-devices").children[0]?.children[1];
    expect(control?.disabled).toBe(true);
    expect(control?.getAttribute("aria-describedby")).toBe("mfa-last-device-help");
    expect(control?.getAttribute("aria-label")).toBe("Primary authenticator");
    expect(ui.dom.getElementById("mfa-last-device-help").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-account-toggle").disabled).toBe(false);
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
    await ui.click("mfa-add");
    expect(ui.stats().enrollRequests).toBe(1);
    expect(ui.dom.getElementById("mfa-qr").src).toBe("");
    expect(ui.dom.getElementById("mfa-enrollment").hidden).toBe(true);
    expect(ui.dom.getElementById("status").textContent).toContain("up to 15 minutes");
  });
});
