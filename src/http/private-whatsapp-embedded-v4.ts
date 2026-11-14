/** Private WhatsApp Embedded Signup v4 uses a dedicated CSP rather than
 * weakening the normal Ishikeit browser dashboard's no-third-party policy.
 * This page is dormant unless the owner enables the exact v4 config.
 */
export function whatsappEmbeddedV4Html(workspaceId:string):string{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(workspaceId))
    throw Error("Invalid workspace ID");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Connect WhatsApp · Ishikeit</title>
<link rel="stylesheet" href="/app/auth/ui.css">
<script src="/app/auth/whatsapp-v4.js"></script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>
</head><body>
<main class="auth-card" id="whatsapp-v4" data-workspace-id="${workspaceId}">
<p class="eyebrow">WHATSAPP BUSINESS AUTHORIZATION</p>
<h1>Connect your WhatsApp business</h1>
<p class="muted">Authorize your own WhatsApp business assets through Meta's
Embedded Signup v4. Ishikeit verifies the Messaging account and phone
identity before recording a private connection. Messaging is not activated.</p>
<button id="wa-launch" type="button" disabled>Continue with Meta</button>
<p id="wa-status" role="status" aria-live="polite">
Verifying your Ishikeit workspace and preparing secure Meta signup.</p>
<p><a href="/app/workspaces">Return to your workspace</a></p>
</main></body></html>`;
}

/** No localStorage/sessionStorage, raw provider logging, wildcard postMessage
 * origin or app tokens. The Meta JS SDK does not return our anti-replay state,
 * so that state is bound via the first-party same-origin session/CSRF/nonce.
 */
export const whatsappEmbeddedV4Js=`"use strict";
(()=>{
  let initialized=false;
  let sdkLoaded=false;
  let ownerConfig=null;
  let state=null;
  let completed=false;
  let launched=false;
  let assetCandidate=null;
  let shortCode=null;
  let shortCodeAt=0;
  let pairingTimer=null;
  const numeric=/^[1-9][0-9]{4,31}$/;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const allowedMetaOrigins=new Set([
    "https://www.facebook.com","https://web.facebook.com"
  ]);
  function status(message){
    const node=document.getElementById("wa-status");
    if(node)node.textContent=message;
  }
  function button(){return document.getElementById("wa-launch");}
  function disable(){
    if(button())button().disabled=true;
  }
  function fail(message){
    completed=true;
    shortCode=null;
    assetCandidate=null;
    state=null;
    if(pairingTimer!==null)clearTimeout(pairingTimer);
    pairingTimer=null;
    disable();
    status(message+" Return to your workspace and start a new authorization.");
  }
  function configureSDK(){
    if(initialized||!sdkLoaded||!ownerConfig)return;
    if(typeof FB==="undefined"||typeof FB.init!=="function"||
       typeof FB.login!=="function")return;
    FB.init({
      appId:ownerConfig.appId,autoLogAppEvents:false,
      xfbml:false,version:ownerConfig.graphVersion
    });
    initialized=true;
    if(button()&&!launched&&!completed)button().disabled=false;
    status("Meta authorization is ready. Continue to connect your own business.");
  }
  window.fbAsyncInit=()=>{sdkLoaded=true;configureSDK();};
  function acceptEvent(event){
    if(!launched||completed||!allowedMetaOrigins.has(event.origin))return;
    if(typeof event.data!=="string"||event.data.length>16384)return;
    let data;
    try{data=JSON.parse(event.data);}catch{return;}
    if(!data||data.type!=="WA_EMBEDDED_SIGNUP")return;
    if(data.event!=="FINISH")return;
    const v=data.data;
    if(!v||typeof v!=="object"||!numeric.test(v.waba_id)||
       !numeric.test(v.phone_number_id))return;
    const candidate={messagingAccountId:v.waba_id,phoneNumberId:v.phone_number_id};
    if(assetCandidate&&(assetCandidate.messagingAccountId!==candidate.messagingAccountId||
      assetCandidate.phoneNumberId!==candidate.phoneNumberId)){
      fail("Meta returned conflicting WhatsApp asset identities.");
      return;
    }
    assetCandidate=candidate;
    void pairAndSubmit();
  }
  window.addEventListener("message",acceptEvent);
  async function pairAndSubmit(){
    if(completed||!launched||!shortCode||!assetCandidate||!state)return;
    if(performance.now()-shortCodeAt>25000){
      fail("The short-lived Meta authorization code expired.");
      return;
    }
    completed=true;
    const code=shortCode;
    shortCode=null;
    if(pairingTimer!==null)clearTimeout(pairingTimer);
    pairingTimer=null;
    disable();
    status("Verifying your WhatsApp account with Meta…");
    const root=document.getElementById("whatsapp-v4");
    const workspaceId=root?.getAttribute("data-workspace-id");
    const currentState=state;
    state=null;
    if(!uuid.test(workspaceId||"")){
      fail("Invalid workspace context.");
      return;
    }
    try{
      const csrf=await fetch("/app/auth/csrf",{
        credentials:"same-origin",cache:"no-store",redirect:"error"
      });
      if(!csrf.ok)throw Error("session");
      const auth=await csrf.json();
      if(!auth||typeof auth.csrfToken!=="string")throw Error("csrf");
      const path="/app/auth/workspaces/"+encodeURIComponent(workspaceId)+
        "/connections/whatsapp/complete";
      const reply=await fetch(path,{
        method:"POST",credentials:"same-origin",redirect:"error",cache:"no-store",
        headers:{"content-type":"application/json","x-ishikeit-csrf":auth.csrfToken},
        body:JSON.stringify({state:currentState,authorizationCode:code,
          ...assetCandidate})
      });
      if(!reply.ok)throw Error("grant");
      const linked=await reply.json();
      if(linked.status!=="verifying")throw Error("unexpected");
      status("WhatsApp phone identity verified. Return to Channels to confirm "+
        "the connection. Messaging and webhook subscriptions remain disabled.");
    }catch{
      status("This WhatsApp authorization could not be verified. "+
        "Return to your workspace and start again.");
    }
    assetCandidate=null;
  }
  function onMetaCode(response){
    if(completed||!launched)return;
    const received=response?.authResponse?.code;
    if(typeof received!=="string"||received.length<8||received.length>4096||
       !/^[A-Za-z0-9._~%-]+$/.test(received)){
      fail("Meta did not return a valid exchangeable code.");
      return;
    }
    shortCode=received;
    shortCodeAt=performance.now();
    // Meta says the exchangeable SDK code lasts just 30 seconds. Never wait
    // for an event past a conservative 8-second pairing window.
    pairingTimer=setTimeout(()=>{
      if(!completed)fail("Meta did not return the matching account session event.");
    },8000);
    void pairAndSubmit();
  }
  async function initialize(){
    const root=document.getElementById("whatsapp-v4");
    const workspaceId=root?.getAttribute("data-workspace-id");
    if(!uuid.test(workspaceId||"")){
      fail("Invalid workspace context.");
      return;
    }
    try{
      const response=await fetch("/app/auth/csrf",{
        credentials:"same-origin",cache:"no-store",redirect:"error"
      });
      if(!response.ok)throw Error("unauthorized");
      const csrf=await response.json();
      if(!csrf||typeof csrf.csrfToken!=="string")throw Error("csrf");
      const start=await fetch("/app/auth/workspaces/"+
        encodeURIComponent(workspaceId)+"/connections/whatsapp/start",{
        method:"POST",credentials:"same-origin",redirect:"error",cache:"no-store",
        headers:{"content-type":"application/json","x-ishikeit-csrf":csrf.csrfToken},
        body:"{}"
      });
      if(!start.ok)throw Error("intent");
      const result=await start.json();
      if(result.status!=="owner_authorization_required"||
        typeof result.state!=="string"||result.state.length!==43||
        !numeric.test(result.appId)||!numeric.test(result.configId)||
        !/^v[0-9]{1,2}[.][0-9]{1,2}$/.test(result.graphVersion))
        throw Error("invalid configuration");
      if(result.browserNonce!==undefined||result.accessToken!==undefined)
        throw Error("secret leak");
      state=result.state;
      ownerConfig={appId:result.appId,
        graphVersion:result.graphVersion,configId:result.configId};
      configureSDK();
      if(!initialized)status("Loading Meta's secure authorization dialog…");
    }catch{
      fail("WhatsApp signup is not enabled for your workspace or the session expired.");
    }
  }
  document.addEventListener("DOMContentLoaded",()=>{
    const launch=button();
    if(!launch)return;
    launch.addEventListener("click",()=>{
      if(!initialized||!state||!ownerConfig||completed||launched)return;
      launched=true;
      disable();
      status("Complete the WhatsApp authorization in Meta's popup.");
      try{
        FB.login(onMetaCode,{
          config_id:ownerConfig.configId,response_type:"code",
          override_default_response_type:true,extras:{setup:{}}
        });
      }catch{fail("Meta authorization could not open.");}
    });
    void initialize();
  });
})();`;
