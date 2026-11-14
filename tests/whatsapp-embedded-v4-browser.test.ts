import {runInNewContext} from "node:vm";
import {setImmediate} from "node:timers/promises";
import {describe,expect,it,vi} from "vitest";
import {
  whatsappEmbeddedV4Html,whatsappEmbeddedV4Js
} from "../src/http/private-whatsapp-embedded-v4.js";

const workspaceId="123e4567-e89b-42d3-a456-426614174000";
const code="meta-short-lived-code-123456789",state="S".repeat(43);
const waba="987654321098765",phone="123456789012345";
const finishEvent=JSON.stringify({
  type:"WA_EMBEDDED_SIGNUP",event:"FINISH",
  data:{waba_id:waba,phone_number_id:phone,business_id:"111111111111111"}
});
type Callback=()=>void;
type MessageCallback=(event:{origin:string;data:string})=>void;
type LoginCallback=(response:unknown)=>void;
function setup(){
  let clock=1000;
  let messageCallback:MessageCallback|undefined;
  let domReady:Callback|undefined;
  let click:Callback|undefined;
  let login:LoginCallback|undefined;
  let timeout:Callback|undefined;
  let initialized=false;
  const status={textContent:""};
  const button={
    disabled:true,addEventListener:(type:string,fn:Callback)=>{
      if(type==="click")click=fn;
    }
  };
  const container={getAttribute:(name:string)=>name==="data-workspace-id"
    ?workspaceId:null};
  const calls:Array<{path:string;body:Record<string,unknown>|null}>=[];
  const mockFetch=vi.fn((path:string,options?:RequestInit)=>{
    let payload:Record<string,unknown>|null=null;
    if(typeof options?.body==="string"){
      const raw:unknown=JSON.parse(options.body);
      payload=raw!==null&&typeof raw==="object"?raw as Record<string,unknown>:null;
    }
    calls.push({path,body:payload});
    if(path==="/app/auth/csrf")
      return Promise.resolve({ok:true,json:()=>Promise.resolve({csrfToken:"C".repeat(43)})});
    if(path.endsWith("/connections/whatsapp/start"))
      return Promise.resolve({ok:true,json:()=>Promise.resolve({
        status:"owner_authorization_required",state,
        appId:"1042452472116584",configId:"123456789012345",
        graphVersion:"v26.0"
      })});
    if(path.endsWith("/connections/whatsapp/complete"))
      return Promise.resolve({ok:true,json:()=>Promise.resolve({status:"verifying"})});
    throw Error("Unexpected route");
  });
  const fb={
    init:vi.fn(()=>{initialized=true;}),
    login:vi.fn((fn:LoginCallback,options:unknown)=>{login=fn;void options;})
  };
  const dom={
    getElementById:(name:string)=>{
      if(name==="wa-status")return status;
      if(name==="wa-launch")return button;
      if(name==="whatsapp-v4")return container;
      return null;
    },
    addEventListener:(type:string,fn:Callback)=>{
      if(type==="DOMContentLoaded")domReady=fn;
    }
  };
  const win={
    fbAsyncInit:undefined as Callback|undefined,
    addEventListener:(type:string,fn:MessageCallback)=>{
      if(type==="message")messageCallback=fn;
    }
  };
  runInNewContext(whatsappEmbeddedV4Js,{
    document:dom,window:win,FB:fb,fetch:mockFetch,
    performance:{now:()=>clock},
    setTimeout:(fn:Callback)=>{timeout=fn;return 1;},
    clearTimeout:()=>{timeout=undefined;}
  });
  async function prepare(){
    domReady?.();
    await setImmediate();
    win.fbAsyncInit?.();
    await setImmediate();
  }
  return {
    prepare,button,status,fb,calls,mockFetch,
    launch:()=>click?.(),message:(origin:string,data=finishEvent)=>
      messageCallback?.({origin,data}),
    code:()=>login?.({authResponse:{code}}),
    advance:(ms:number)=>{clock+=ms;},
    expire:()=>timeout?.(),
    isInitialized:()=>initialized
  };
}
describe("shipping WhatsApp v4 Facebook SDK browser event/authorization safety",()=>{
  it("uses an isolated owner page with no inline scripts and no query code",()=>{
    const html=whatsappEmbeddedV4Html(workspaceId);
    expect(html).toContain("https://connect.facebook.net/en_US/sdk.js");
    expect(html).toContain("data-workspace-id=\""+workspaceId+"\"");
    expect(html).not.toContain(code);
    expect(html).not.toContain(state);
  });
  it("allows only exact Meta session-event origin, pairs code once and posts no provider bearer",async()=>{
    const p=setup();
    await p.prepare();
    expect(p.isInitialized()).toBe(true);
    expect(p.button.disabled).toBe(false);
    p.launch();
    expect(p.fb.login).toHaveBeenCalledWith(expect.any(Function),
      expect.objectContaining({response_type:"code",extras:{setup:{}}}));
    p.message("https://badfacebook.com");
    p.message("https://www.facebook.com.evil.example");
    p.message("https://www.facebook.com",JSON.stringify({
      type:"WA_EMBEDDED_SIGNUP",event:"FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data:{waba_id:waba,phone_number_id:phone}
    }));
    p.code();
    await setImmediate();
    expect(p.calls.filter(c=>c.path.endsWith("/complete"))).toHaveLength(0);
    p.message("https://www.facebook.com");
    await setImmediate();
    const posts=p.calls.filter(c=>c.path.endsWith("/complete"));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({
      state,authorizationCode:code,messagingAccountId:waba,phoneNumberId:phone
    });
    expect(JSON.stringify(posts[0])).not.toContain("accessToken");
    p.message("https://www.facebook.com");
    p.code();
    await setImmediate();
    expect(p.calls.filter(c=>c.path.endsWith("/complete"))).toHaveLength(1);
    expect(p.status.textContent).toContain("Messaging and webhook subscriptions remain disabled");
  });
  it("rejects expired code and spoofed origin, never exchanging it after the 25s bound",async()=>{
    const p=setup();
    await p.prepare();p.launch();p.code();p.advance(26000);
    p.message("https://www.facebook.com");
    await setImmediate();
    expect(p.calls.filter(c=>c.path.endsWith("/complete"))).toHaveLength(0);
    expect(p.button.disabled).toBe(true);
    expect(p.status.textContent).toContain("expired");
  });
  it("enforces a finite event-pairing timeout after code reception",async()=>{
    const p=setup();await p.prepare();p.launch();p.code();
    p.expire();
    p.message("https://www.facebook.com");
    await setImmediate();
    expect(p.calls.filter(c=>c.path.endsWith("/complete"))).toHaveLength(0);
    expect(p.status.textContent).toContain("matching account session event");
  });
});
