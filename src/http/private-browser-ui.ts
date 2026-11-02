/** Static, framework-free login and read-only workspace switcher shell.
 * It contains NO provider tokens, session secrets, inline event handlers,
 * dynamic HTML injection or third-party scripts. BFF is OFF by default.
 * This is the pre-Phase-3 access shell, not the full conversations dashboard.
 */
export const privateLoginHtml = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>ISHIKEIT · Private access</title>
<link rel="stylesheet" href="/app/auth/ui.css">
<script src="/app/auth/ui.js" defer></script>
</head><body>
<main class="layout">
  <header><p class="eyebrow">ISHIKEIT</p><h1>Private workspace access</h1>
  <p class="intro">Sign in using the verification code sent to your invited email address.</p></header>
  <section class="surface" id="login-panel">
    <form id="email-form" autocomplete="on">
      <label for="email">Work email</label>
      <input id="email" name="email" type="email" autocomplete="email" required maxlength="320" placeholder="you@example.com">
      <button type="submit" id="send-code">Send verification code</button>
    </form>
    <form id="code-form" hidden>
      <label for="code">Email verification code</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="8" pattern="[0-9]{6,8}" required>
      <button type="submit" id="verify-code">Verify and sign in</button>
      <button type="button" class="secondary" id="another-email">Use another email</button>
    </form>
    <p class="note">Only existing authorized workspace members can sign in. This does not create an account.</p>
  </section>
  <section class="surface" id="account-panel" hidden>
    <div class="section-head"><h2>Your workspaces</h2>
      <button type="button" class="secondary" id="sign-out">Sign out</button></div>
    <p class="note">Only workspaces your current membership permits are shown. Conversation management is not yet enabled here.</p>
    <ul id="workspace-list" class="workspaces"></ul>
    <button type="button" class="secondary" id="refresh-session">Renew session</button>
  </section>
  <p id="status" class="status" role="status" aria-live="polite"></p>
  <footer>Technique-first. Style-forward. Always clean.</footer>
</main>
</body></html>`;

export const privateLoginCss = `
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#332b2d;background:#f7f1ec;line-height:1.5}
*{box-sizing:border-box}
body{margin:0;min-height:100vh}
.layout{max-width:600px;margin:auto;padding:7vh 24px 50px}
.eyebrow{font-size:.83rem;font-weight:750;letter-spacing:.24em;color:#9b6171}
h1{font-size:clamp(1.95rem,4vw,2.65rem);letter-spacing:-.045em;line-height:1.12;margin:.6rem 0 1rem}
h2{font-size:1.28rem;margin:0}
.intro{color:#6f6063;max-width:480px}
.surface{background:#fffdfb;border:1px solid #e7d9d9;border-radius:18px;padding:clamp(22px,5vw,34px);margin:26px 0 0;box-shadow:0 8px 38px #452e3411}
form{display:flex;flex-direction:column;gap:12px}
label{font-weight:650;font-size:.94rem}
input{width:100%;padding:14px 15px;font:inherit;border:1px solid #cbbdbf;border-radius:10px;background:#fff;color:#332b2d}
input:focus-visible,button:focus-visible{outline:3px solid #df95ae;outline-offset:2px}
button{padding:13px 16px;font:inherit;font-weight:700;border-radius:10px;border:1px solid #8f5365;background:#8f5365;color:white;cursor:pointer}
button:hover{filter:brightness(.95)}
button:disabled{opacity:.55;cursor:wait}
button.secondary{background:transparent;color:#8f5365}
.note{font-size:.85rem;color:#76676b;margin:17px 0 0}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.workspaces{padding:0;list-style:none;display:grid;gap:12px;margin:22px 0}
.workspaces li{padding:16px;border-radius:12px;background:#faf3f3;border:1px solid #f0dddd}
.workspaces strong{display:block}
.workspaces small{color:#735f65}
.status{min-height:1.4rem;font-size:.95rem;font-weight:550;color:#774455;margin:20px 0}
footer{margin-top:58px;font-size:.81rem;color:#89777b;text-align:center}
[hidden]{display:none!important}
@media(prefers-reduced-motion:no-preference){button{transition:filter .15s ease}}
`;

export const privateLoginJs = `"use strict";
const emailForm=document.getElementById("email-form");
const codeForm=document.getElementById("code-form");
const loginPanel=document.getElementById("login-panel");
const accountPanel=document.getElementById("account-panel");
const status=document.getElementById("status");
const workspaceList=document.getElementById("workspace-list");
let csrfToken="";
function message(s){status.textContent=s;}
async function request(path,body,csrf){
  const headers={"content-type":"application/json"};
  if(csrf)headers["x-ishikeit-csrf"]=csrf;
  return fetch(path,{method:"POST",credentials:"same-origin",headers,
    body:JSON.stringify(body),cache:"no-store",redirect:"error"});
}
function showLogin(){
  loginPanel.hidden=false;accountPanel.hidden=true;workspaceList.replaceChildren();csrfToken="";
}
function showAccount(data){
  csrfToken=data.csrfToken;
  workspaceList.replaceChildren();
  for(const workspace of data.workspaces.items){
    const li=document.createElement("li");
    const title=document.createElement("strong");
    title.textContent=workspace.displayName;
    const details=document.createElement("small");
    details.textContent=workspace.role+" · "+workspace.connectedAccounts+" connected accounts";
    li.append(title,details);workspaceList.append(li);
  }
  accountPanel.hidden=false;loginPanel.hidden=true;message("Signed in.");
}
async function recoverSession(){
  const r=await fetch("/app/auth/csrf",{credentials:"same-origin",cache:"no-store"});
  if(!r.ok)return false;
  const b=await r.json();
  if(typeof b.csrfToken!=="string")return false;
  const refreshed=await request("/app/auth/refresh",{},b.csrfToken);
  if(!refreshed.ok)return false;
  showAccount(await refreshed.json());return true;
}
async function initialize(){
  try{
    const r=await fetch("/app/auth/session",{credentials:"same-origin",cache:"no-store"});
    if(r.ok){showAccount(await r.json());return;}
    if(await recoverSession())return;
  }catch{/* Offline or not yet configured. */}
  showLogin();
}
emailForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=document.getElementById("send-code");button.disabled=true;
  try {
    const email=document.getElementById("email").value.trim();
    const r=await request("/app/auth/request-otp",{email});
    if(r.status===202){
      emailForm.hidden=true;codeForm.hidden=false;
      message("If this email is invited, a verification code was sent.");
    }else message("Unable to request a code. Check your email and try again.");
  }catch{message("Connection unavailable. Try again.");}
  finally{button.disabled=false;}
});
document.getElementById("another-email").addEventListener("click",()=>{
  codeForm.hidden=true;emailForm.hidden=false;message("");
});
codeForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=document.getElementById("verify-code");button.disabled=true;
  try {
    const code=document.getElementById("code").value.trim();
    const r=await request("/app/auth/verify-otp",{code});
    if(!r.ok){message("Verification unsuccessful. Check your code.");return;}
    document.getElementById("code").value="";
    const session=await fetch("/app/auth/session",{credentials:"same-origin",cache:"no-store"});
    if(!session.ok)throw Error("session");
    showAccount(await session.json());
  }catch{message("Could not establish a session. Please sign in again.");}
  finally{button.disabled=false;}
});
document.getElementById("refresh-session").addEventListener("click",async()=>{
  try{
    if(!csrfToken){
      if(!await recoverSession())throw Error("missing session");
      message("Session renewed.");
      return;
    }
    const r=await request("/app/auth/refresh",{},csrfToken);
    if(!r.ok)throw Error("session expired");
    showAccount(await r.json());message("Session renewed.");
  }catch{showLogin();message("Please sign in again.");}
});
document.getElementById("sign-out").addEventListener("click",async()=>{
  try{
    const r=await request("/app/auth/logout",{},csrfToken);
    if(!r.ok)throw Error("sign-out");
    showLogin();codeForm.hidden=true;emailForm.hidden=false;
    message("Signed out.");
  }catch{message("Sign-out unavailable. Please try again.");}
});
void initialize();
`;
