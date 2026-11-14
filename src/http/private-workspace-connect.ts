/** OAuth callback is a NO-STORE, no-referrer document. It never redeems a
 * code on GET; the browser strips it from the address bar, retrieves a
 * same-origin CSRF token using the existing Strict opaque BFF session, and
 * submits a one-use POST. The independent HttpOnly Lax browser nonce remains
 * server-only and is checked against the one-use database intent.
 */
export function instagramConnectionReturnHtml(state:string,code:string):string{
  const safe=/^[A-Za-z0-9_-]{43}$/u;
  const safeCode=/^[A-Za-z0-9._~%-]{8,4096}$/u;
  if(!safe.test(state)||!safeCode.test(code))
    throw new Error("Invalid Instagram authorization response");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Instagram account authorization · Ishikeit</title>
<link rel="stylesheet" href="/app/auth/ui.css">
<script src="/app/auth/instagram-return.js" defer></script>
</head><body><main class="auth-card" style="margin:5rem auto;max-width:32rem"
  id="instagram-return" data-oauth-state="${state}" data-oauth-code="${code}">
<p class="eyebrow">SECURE ACCOUNT AUTHORIZATION</p>
<h1>Connecting Instagram</h1>
<p role="status" aria-live="polite" id="instagram-connect-status">
Finishing your account authorization…</p>
<p><a href="/app/workspaces">Return to your workspace</a></p>
</main></body></html>`;
}

export const instagramConnectionReturnJs=`"use strict";
(async()=>{
  const root=document.getElementById("instagram-return");
  const status=document.getElementById("instagram-connect-status");
  if(!root||!status)return;
  const state=root.getAttribute("data-oauth-state");
  const authorizationCode=root.getAttribute("data-oauth-code");
  root.removeAttribute("data-oauth-state");
  root.removeAttribute("data-oauth-code");
  // Never leave an authorization code in browser history after navigation.
  window.history.replaceState(null,"","/app/auth/connect/instagram/return");
  try{
    const csrf=await fetch("/app/auth/csrf",{
      credentials:"same-origin",cache:"no-store",redirect:"error"
    });
    if(!csrf.ok)throw Error("login");
    const proof=await csrf.json();
    if(!proof||typeof proof.csrfToken!=="string")throw Error("login");
    const response=await fetch("/app/auth/connect/instagram/complete",{
      method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",
      headers:{"content-type":"application/json","x-ishikeit-csrf":proof.csrfToken},
      body:JSON.stringify({state,authorizationCode})
    });
    if(!response.ok)throw Error("connect");
    const result=await response.json();
    if(!result||result.status!=="verifying")throw Error("connect");
    status.textContent="Instagram account verified. Open Channels in your workspace and confirm activation. Messaging automation remains inactive.";
  }catch{
    status.textContent="Authorization could not be completed. Sign in and start a new connection from Channels.";
  }
})();`;
