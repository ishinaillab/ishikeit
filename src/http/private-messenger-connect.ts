/** Facebook Login for Business owner return: GET is read-only. No
 * credentials exchanged or stored until same-origin CSRF-bound POST.
 * The provider code/state are stripped from history before any network use.
 */
export function messengerPageReturnHtml(state:string,code:string):string{
  if(!/^[A-Za-z0-9_-]{43}$/u.test(state)||
    !/^[A-Za-z0-9._~%-]{8,4096}$/u.test(code))
    throw Error("Invalid Messenger owner authorization callback");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Messenger Page · Ishikeit</title>
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="/app/auth/ui.css">
<script src="/app/auth/messenger-return.js" defer></script>
</head><body><main class="auth-card" style="margin:5rem auto;max-width:34rem"
id="messenger-return" data-oauth-state="${state}" data-oauth-code="${code}">
<p class="eyebrow">MESSENGER PAGE AUTHORIZATION</p>
<h1>Verify your Facebook Page</h1>
<p class="muted">Enter the numeric Page ID for the Page you authorized in Meta.
Ishikeit verifies it using Meta's own Page access-token and task readback.
This does not turn on messaging.</p>
<form id="messenger-page-form">
<label for="messenger-page-id">Facebook Page ID</label>
<input id="messenger-page-id" required inputmode="numeric" autocomplete="off"
pattern="[1-9][0-9]{4,31}" maxlength="32" minlength="5"
placeholder="Numeric Page ID">
<button type="submit">Verify Page authorization</button>
</form>
<p id="messenger-connect-status" role="status" aria-live="polite">
Provide your authorized Page ID to continue.</p>
<p><a href="/app/workspaces">Return to your workspace</a></p>
</main></body></html>`;
}
export const messengerPageReturnJs=`"use strict";
(()=>{
  const root=document.getElementById("messenger-return");
  const form=document.getElementById("messenger-page-form");
  const input=document.getElementById("messenger-page-id");
  const status=document.getElementById("messenger-connect-status");
  if(!root||!form||!input||!status)return;
  const state=root.getAttribute("data-oauth-state");
  const authorizationCode=root.getAttribute("data-oauth-code");
  root.removeAttribute("data-oauth-state");
  root.removeAttribute("data-oauth-code");
  window.history.replaceState(null,"","/app/auth/connect/messenger/return");
  let submitted=false;
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(submitted)return;
    const pageId=input.value.trim();
    if(!/^[1-9][0-9]{4,31}$/.test(pageId)){
      status.textContent="Enter the numeric Facebook Page ID you authorized.";
      return;
    }
    submitted=true;
    const button=form.querySelector("button");
    if(button)button.disabled=true;
    status.textContent="Verifying Page access and ownership with Meta…";
    try{
      const proof=await fetch("/app/auth/csrf",{
        credentials:"same-origin",cache:"no-store",redirect:"error"
      });
      if(!proof.ok)throw Error("session");
      const data=await proof.json();
      if(!data||typeof data.csrfToken!=="string")throw Error("csrf");
      const response=await fetch("/app/auth/connect/messenger/complete",{
        method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",
        headers:{"content-type":"application/json","x-ishikeit-csrf":data.csrfToken},
        body:JSON.stringify({state,authorizationCode,pageId})
      });
      if(!response.ok)throw Error("provider");
      const result=await response.json();
      if(result.status!=="verifying")throw Error("link");
      form.hidden=true;
      input.value="";
      status.textContent="Page identity verified. Open Channels to confirm activation. No customer messages were sent.";
    }catch{
      submitted=false;
      if(button)button.disabled=false;
      status.textContent="Page verification could not be completed. Check your Page ID, permissions and session.";
    }
  });
})();`;
