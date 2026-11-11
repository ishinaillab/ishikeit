import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { privateLoginHtml, privateLoginJs } from "../src/http/private-browser-ui.js";

/** A deterministic, network-free DOM harness for the *actual shipped JS*.
 * It exercises the click handlers and their hidden/visible state without
 * ever requesting a production OTP or exposing an actual owner secret.
 */
class FakeElement {
  hidden=false;
  disabled=false;
  textContent="";
  value="";
  src="";
  children:FakeElement[]=[];
  listeners=new Map<string,(event?:{preventDefault():void})=>Promise<void>|void>();
  get options():FakeElement[]{return this.children;}
  replaceChildren(...nodes:FakeElement[]):void{this.children=[...nodes];}
  append(...nodes:FakeElement[]):void{this.children.push(...nodes);}
  prepend(...nodes:FakeElement[]):void{this.children.unshift(...nodes);}
  removeAttribute(name:string):void{if(name==="src")this.src="";}
  addEventListener(name:string,handler:(event?:{preventDefault():void})=>Promise<void>|void):void{
    this.listeners.set(name,handler);
  }
}

function setup(status=200,authState:"authenticated"|"mfa_required"="authenticated",factorCount=0){
  const elements=new Map<string,FakeElement>();
  const tags=/<[a-z][^>]*\sid="([^"]+)"[^>]*>/giu;
  for(const match of privateLoginHtml.matchAll(tags)){
    const element=new FakeElement();
    element.hidden=/\shidden(?:\s|>)/u.test(match[0]);
    elements.set(match[1]!,element);
  }
  const dom={
    title:"",
    getElementById:(id:string)=>{
      const item=elements.get(id);
      if(!item)throw new Error("Missing DOM element "+id);
      return item;
    },
    createElement:(tag:string)=>{void tag;return new FakeElement();}
  };
  let pendingCount=0,requests=0;
  const url={hash:"",search:"",pathname:"/app/login"};
  const window={
    location:url,
    history:{replaceState:(state:unknown,name:string,path:string)=>{void state;void name;url.pathname=path;}},
    confirm:(message:string)=>{void message;return true;}
  };
  const response=(data:unknown,code=200)=>({
    ok:code>=200 && code<300,status:code,json:()=>Promise.resolve(data)
  });
  const fetch=(path:string,options?:{method?:string})=>{
    const mutation=options?.method==="POST";
    if(path==="/app/auth/session")return Promise.resolve(response(authState==="mfa_required"
      ? {status:"mfa_required",csrfToken:"synthetic_csrf_for_unit_tests_only",
          expiresAt:"2027-01-01T00:00:00Z"}
      : {status:"authenticated",csrfToken:"synthetic_csrf_for_unit_tests_only",
          memberInvitationsEnabled:false,
          workspaces:{items:[{
            workspaceId:"123e4567-e89b-42d3-a456-426614174000",
            displayName:"Test",role:"owner",connectedAccounts:0
          }]}}));
    if(path==="/app/auth/mfa/factors")return Promise.resolve(response({
      factors:Array.from({length:factorCount},(_,i)=>
        i===0?"123e4567-e89b-42d3-a456-426614174000":"223e4567-e89b-42d3-a456-426614174000"),
      pendingCount,canEnroll:factorCount===0
    }));
    if(path==="/app/auth/mfa/totp/enroll" && mutation){
      requests++;
      if(status!==200)return Promise.resolve(response({status:"mfa_enrollment_rate_limited"},status));
      pendingCount=1;
      return Promise.resolve(response({
        factorId:"123e4567-e89b-42d3-a456-426614174000",
        secret:"JBSWY3DPEHPK3PXP",
        qrCodeDataUrl:"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="
      }));
    }
    if(path==="/app/auth/mfa/totp/verify" && mutation)return Promise.resolve(response({
      status:"authenticated",csrfToken:"new_synthetic_csrf_after_rotation",
      workspaces:{items:[{workspaceId:"123e4567-e89b-42d3-a456-426614174000",
        displayName:"Test",role:"owner",connectedAccounts:0}]}
    }));
    if(path==="/app/auth/logout" && mutation)return Promise.resolve(response({status:"signed_out"}));
    if(path==="/app/auth/mfa/totp/reset" && mutation){
      pendingCount=0;
      return Promise.resolve(response({status:"incomplete_setup_cleared",cleared:1}));
    }
    throw new Error("Unexpected request in synthetic DOM test: "+path);
  };
  runInNewContext(privateLoginJs,{window,document:dom,fetch},{timeout:2000});
  const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
  const click=async(id:string)=>{
    const handler=dom.getElementById(id).listeners.get("click");
    if(!handler)throw new Error("Missing click handler for "+id);
    await handler();await flush();
  };
  const submit=async(id:string)=>{
    const handler=dom.getElementById(id).listeners.get("submit");
    if(!handler)throw new Error("Missing form handler for "+id);
    await handler({preventDefault(){}});await flush();
  };
  return {dom,window,flush,click,submit,getEnrollmentRequests:()=>requests};
}

describe("private browser TOTP setup actual frontend state transitions",()=>{
  it("shows a scannable QR and manual key outside any hidden setup parent, retains them on refresh",async()=>{
    const ui=setup();
    await ui.flush();
    expect(ui.dom.getElementById("account-panel").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-setup").hidden).toBe(false);
    expect(ui.window.location.pathname).toBe("/app/workspaces");
    const setupStart=privateLoginHtml.indexOf('id="mfa-setup"');
    const setupEnd=privateLoginHtml.indexOf("</div>",setupStart);
    expect(privateLoginHtml.indexOf('id="mfa-enrollment"')).toBeGreaterThan(setupEnd);
    await ui.click("mfa-enroll");
    expect(ui.getEnrollmentRequests()).toBe(1);
    expect(ui.dom.getElementById("mfa-setup").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-enrollment").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-qr").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-qr").src).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(ui.dom.getElementById("mfa-secret").textContent).toBe("JBSWY3DPEHPK3PXP");
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(false);
    // A single authenticator can be verified without an empty dropdown.
    expect(ui.dom.getElementById("mfa-factor-picker").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-factor").options).toHaveLength(1);
    await ui.click("mfa-reload");
    expect(ui.dom.getElementById("mfa-enrollment").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-secret").textContent).toBe("JBSWY3DPEHPK3PXP");
    expect(ui.getEnrollmentRequests()).toBe(1);
    await ui.click("mfa-enroll");
    expect(ui.getEnrollmentRequests()).toBe(1);
    await ui.click("mfa-reset");
    expect(ui.dom.getElementById("mfa-secret").textContent).toBe("");
    expect(ui.dom.getElementById("mfa-qr").src).toBe("");
    expect(ui.dom.getElementById("mfa-enrollment").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-setup").hidden).toBe(false);
  });

  it("never exposes workspaces at AAL1 and supports primary/backup MFA step-up",async()=>{
    const ui=setup(200,"mfa_required",2);
    await ui.flush();
    expect(ui.dom.getElementById("login-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("account-panel").hidden).toBe(false);
    expect(ui.window.location.pathname).toBe("/app/login");
    expect(ui.dom.getElementById("workspace-content").hidden).toBe(true);
    expect(ui.dom.getElementById("account-heading").textContent)
      .toBe("Complete two-step verification");
    expect(ui.dom.getElementById("member-invite-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-form").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-factor-picker").hidden).toBe(false);
    expect(ui.dom.getElementById("mfa-factor").options).toHaveLength(2);
    // Simulated backup device: no real TOTP, cookies or identity data involved.
    ui.dom.getElementById("mfa-factor").value="223e4567-e89b-42d3-a456-426614174000";
    ui.dom.getElementById("mfa-code").value="123456";
    await ui.submit("mfa-form");
    expect(ui.window.location.pathname).toBe("/app/workspaces");
    expect(ui.dom.getElementById("workspace-content").hidden).toBe(false);
    expect(ui.dom.getElementById("account-heading").textContent).toBe("Your workspaces");
    expect(ui.dom.getElementById("mfa-code").value).toBe("");
    await ui.click("sign-out");
    expect(ui.window.location.pathname).toBe("/app/login");
    expect(ui.dom.getElementById("account-panel").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-qr").src).toBe("");
  });

  it("explains provider cooldown without creating a phantom QR or duplicate factor",async()=>{
    const ui=setup(429);
    await ui.flush();
    await ui.click("mfa-enroll");
    expect(ui.getEnrollmentRequests()).toBe(1);
    expect(ui.dom.getElementById("mfa-enrollment").hidden).toBe(true);
    expect(ui.dom.getElementById("mfa-qr").src).toBe("");
    expect(ui.dom.getElementById("status").textContent).toContain("up to 15 minutes");
    expect(ui.dom.getElementById("mfa-enroll").disabled).toBe(false);
  });
});
