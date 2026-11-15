/** TikTok account-holder's browser return is a read-only, isolated document.
 * No provider authorization code is exchanged on GET. The document strips
 * state/code from browser URL before same-site CSRF-bound POST.
 * Private BFF session is HttpOnly/Strict and independent of TikTok.
 */
export function tiktokAccountReturnHtml(state:string,code:string):string{
  if(!/^[A-Za-z0-9_-]{43}$/u.test(state)||
    !/^[A-Za-z0-9._~%-]{8,4096}$/u.test(code))
    throw new Error("Invalid TikTok account-holder authorization callback");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect TikTok · Ishikeit</title>
<link rel="stylesheet" href="/app/auth/ui.css">
<script src="/app/auth/tiktok-return.js" defer></script>
</head><body><main class="auth-card" style="margin:5rem auto;max-width:32rem"
id="tiktok-return" data-oauth-state="${state}" data-oauth-code="${code}">
<p class="eyebrow">TIKTOK ACCOUNT AUTHORIZATION</p>
<h1>Verify your TikTok identity</h1>
<p id="tiktok-connect-status" role="status" aria-live="polite">
Completing identity verification…</p>
<p><a href="/app/workspaces">Return to your workspace</a></p>
</main></body></html>`;
}
export const tiktokAccountReturnJs=`"use strict";
(async()=>{
  const root=document.getElementById("tiktok-return");
  const status=document.getElementById("tiktok-connect-status");
  if(!root||!status)return;
  const state=root.getAttribute("data-oauth-state");
  const authorizationCode=root.getAttribute("data-oauth-code");
  root.removeAttribute("data-oauth-state");
  root.removeAttribute("data-oauth-code");
  window.history.replaceState(null,"","/app/auth/connect/tiktok/return/");
  try{
    const csrf=await fetch("/app/auth/csrf",{
      credentials:"same-origin",cache:"no-store",redirect:"error"
    });
    if(!csrf.ok)throw Error("authentication required");
    const proof=await csrf.json();
    if(!proof||typeof proof.csrfToken!=="string")throw Error("csrf");
    const response=await fetch("/app/auth/connect/tiktok/complete",{
      method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",
      headers:{"content-type":"application/json","x-ishikeit-csrf":proof.csrfToken},
      body:JSON.stringify({state,authorizationCode})
    });
    if(!response.ok)throw Error("owner validation");
    const result=await response.json();
    if(result.status!=="verifying")throw Error("owner");
    status.textContent="Your TikTok account grant was verified. Open Channels to confirm account eligibility. Business Messaging automation remains disabled.";
  }catch{
    status.textContent="TikTok account could not be verified. Sign in and retry from Channels.";
  }
})();`;
