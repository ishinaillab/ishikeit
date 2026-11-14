/** Telegram OIDC's browser return is a read-only, isolated document.
 * No provider authorization code is exchanged on GET. The document strips
 * state/code from browser URL before same-site CSRF-bound POST.
 * Private BFF session is HttpOnly/Strict and independent of Telegram.
 */
export function telegramOIDCReturnHtml(state:string,code:string):string{
  if(!/^[A-Za-z0-9_-]{43}$/u.test(state)||
    !/^[A-Za-z0-9._~%-]{8,4096}$/u.test(code))
    throw new Error("Invalid Telegram OIDC authorization callback");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Telegram · Ishikeit</title>
<link rel="stylesheet" href="/app/auth/ui.css">
<script src="/app/auth/telegram-return.js" defer></script>
</head><body><main class="auth-card" style="margin:5rem auto;max-width:32rem"
id="telegram-return" data-oauth-state="${state}" data-oauth-code="${code}">
<p class="eyebrow">TELEGRAM ACCOUNT VERIFICATION</p>
<h1>Verify your Telegram identity</h1>
<p id="telegram-connect-status" role="status" aria-live="polite">
Completing identity verification…</p>
<p><a href="/app/workspaces">Return to your workspace</a></p>
</main></body></html>`;
}
export const telegramOIDCReturnJs=`"use strict";
(async()=>{
  const root=document.getElementById("telegram-return");
  const status=document.getElementById("telegram-connect-status");
  if(!root||!status)return;
  const state=root.getAttribute("data-oauth-state");
  const authorizationCode=root.getAttribute("data-oauth-code");
  root.removeAttribute("data-oauth-state");
  root.removeAttribute("data-oauth-code");
  window.history.replaceState(null,"","/app/auth/connect/telegram/return");
  try{
    const csrf=await fetch("/app/auth/csrf",{
      credentials:"same-origin",cache:"no-store",redirect:"error"
    });
    if(!csrf.ok)throw Error("authentication required");
    const proof=await csrf.json();
    if(!proof||typeof proof.csrfToken!=="string")throw Error("csrf");
    const response=await fetch("/app/auth/connect/telegram/complete",{
      method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",
      headers:{"content-type":"application/json","x-ishikeit-csrf":proof.csrfToken},
      body:JSON.stringify({state,authorizationCode})
    });
    if(!response.ok)throw Error("owner validation");
    const result=await response.json();
    if(result.status!=="verifying")throw Error("owner");
    status.textContent="Your Telegram identity is verified in Ishikeit. To authorize Business messaging, return to Channels and confirm your Telegram Business connection. No messages have been sent.";
  }catch{
    status.textContent="Telegram identity was not verified. Sign in and retry from Channels.";
  }
})();`;
