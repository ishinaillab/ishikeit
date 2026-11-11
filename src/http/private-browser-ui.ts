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
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="10" pattern="[0-9]{6,10}" required>
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
    <section class="mfa-panel" id="member-invite-panel" aria-labelledby="member-invite-heading" hidden>
      <h2 id="member-invite-heading">Invite a workspace member</h2>
      <p class="note">Workspace owners can invite new teammates after verifying an authenticator. Invitations cannot grant owner or platform administrator privileges.</p>
      <form id="member-invite-form">
        <label for="member-invite-workspace">Workspace</label>
        <select id="member-invite-workspace" required></select>
        <label for="member-invite-email">Teammate email</label>
        <input id="member-invite-email" type="email" autocomplete="off" required maxlength="320">
        <label for="member-invite-role">Workspace role</label>
        <select id="member-invite-role">
          <option value="viewer">Viewer</option>
          <option value="agent">Agent</option>
          <option value="admin">Workspace admin</option>
        </select>
        <button type="submit" id="member-invite-send">Send invitation</button>
      </form>
    </section>
    <section class="mfa-panel" aria-labelledby="mfa-heading">
      <h2 id="mfa-heading">Two-step verification</h2>
      <p class="note">Protect account connections with an authenticator app. Verify a code to confirm your device before sensitive actions.</p>
      <div id="mfa-setup" hidden>
        <button type="button" class="secondary" id="mfa-enroll">Set up an authenticator</button>
        <div id="mfa-enrollment" hidden>
          <p class="note">Enter this setup key in your authenticator app. Keep it private. It will disappear after verification or sign-out.</p>
          <output id="mfa-secret" class="mfa-secret"></output>
        </div>
      </div>
      <form id="mfa-form" hidden>
        <label for="mfa-factor">Authenticator</label>
        <select id="mfa-factor" aria-label="Choose verified authenticator"></select>
        <label for="mfa-code">Six-digit authenticator code</label>
        <input id="mfa-code" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="6" pattern="[0-9]{6}" required>
        <button type="submit" id="mfa-submit">Verify authenticator</button>
      </form>
    </section>
    <button type="button" class="secondary" id="refresh-session">Renew session</button>
  </section>
  <p id="status" class="status" role="status" aria-live="polite"></p>
  <footer>ISHIKEIT · Secure workspace access</footer>
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
.mfa-panel{margin-top:26px;border-top:1px solid #eadedd;padding-top:24px}
.mfa-panel h2{font-size:1.12rem}
.mfa-secret{display:block;overflow-wrap:anywhere;background:#f8ecec;border-radius:9px;padding:12px;margin:12px 0;font-family:ui-monospace,monospace;font-size:.93rem;user-select:all}
select{width:100%;padding:12px;border:1px solid #cbbdbf;border-radius:10px;background:#fff;color:#332b2d;font:inherit}
footer{margin-top:58px;font-size:.81rem;color:#89777b;text-align:center}
[hidden]{display:none!important}
@media(prefers-reduced-motion:no-preference){button{transition:filter .15s ease}}
`;

export const privateLoginJs = `"use strict";
// Auth Admin invite links may append a short-lived session fragment.
// Ishikeit deliberately never reads or stores Supabase tokens from URL
// fragments; clear them from browser history before any other UI work.
if(window.location.hash || window.location.search){
  window.history.replaceState(null,"","/app/login");
}
const emailForm=document.getElementById("email-form");
const codeForm=document.getElementById("code-form");
const loginPanel=document.getElementById("login-panel");
const accountPanel=document.getElementById("account-panel");
const status=document.getElementById("status");
const workspaceList=document.getElementById("workspace-list");
const invitePanel=document.getElementById("member-invite-panel");
const inviteWorkspace=document.getElementById("member-invite-workspace");
const inviteForm=document.getElementById("member-invite-form");
let csrfToken="";
let enrollmentFactorId="";
const mfaSetup=document.getElementById("mfa-setup");
const mfaEnrollment=document.getElementById("mfa-enrollment");
const mfaSecret=document.getElementById("mfa-secret");
const mfaForm=document.getElementById("mfa-form");
const mfaFactor=document.getElementById("mfa-factor");
function clearMfa(){
  enrollmentFactorId="";
  mfaSecret.textContent="";
  mfaEnrollment.hidden=true;
  mfaForm.hidden=true;
  mfaSetup.hidden=true;
  mfaFactor.replaceChildren();
  document.getElementById("mfa-code").value="";
}
async function loadMfaFactors(){
  try{
    const response=await fetch("/app/auth/mfa/factors",{credentials:"same-origin",cache:"no-store"});
    if(!response.ok)throw Error("No MFA data");
    const data=await response.json();
    mfaFactor.replaceChildren();
    for(const id of data.factors){
      const option=document.createElement("option");
      option.value=id;
      option.textContent="Authenticator "+String(mfaFactor.options.length+1);
      mfaFactor.append(option);
    }
    mfaSetup.hidden=false;
    mfaForm.hidden=mfaFactor.options.length===0;
    if(mfaFactor.options.length===0)message("Set up an authenticator to protect account connections.");
  }catch{clearMfa();}
}

function message(s){status.textContent=s;}
async function request(path,body,csrf){
  const headers={"content-type":"application/json"};
  if(csrf)headers["x-ishikeit-csrf"]=csrf;
  return fetch(path,{method:"POST",credentials:"same-origin",headers,
    body:JSON.stringify(body),cache:"no-store",redirect:"error"});
}
function showLogin(){
  loginPanel.hidden=false;accountPanel.hidden=true;workspaceList.replaceChildren();csrfToken="";clearMfa();
  inviteWorkspace.replaceChildren();invitePanel.hidden=true;
}
function showAccount(data){
  csrfToken=data.csrfToken;
  workspaceList.replaceChildren();
  inviteWorkspace.replaceChildren();
  for(const workspace of data.workspaces.items){
    if(data.memberInvitationsEnabled===true && workspace.role==="owner"){
      const option=document.createElement("option");
      option.value=workspace.workspaceId;
      option.textContent=workspace.displayName;
      inviteWorkspace.append(option);
    }
    const li=document.createElement("li");
    const title=document.createElement("strong");
    title.textContent=workspace.displayName;
    const details=document.createElement("small");
    details.textContent=workspace.role+" · "+workspace.connectedAccounts+" connected accounts";
    li.append(title,details);workspaceList.append(li);
  }
  invitePanel.hidden=inviteWorkspace.options.length===0;
  accountPanel.hidden=false;loginPanel.hidden=true;message("Signed in.");
  void loadMfaFactors();
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
    if(r.status===503){
      // Supabase may already have consumed a valid OTP. Never invite the
      // user to retry that code: a fresh login challenge is necessary.
      document.getElementById("code").value="";
      codeForm.hidden=true;emailForm.hidden=false;
      message("A secure session could not be established. The code may have been accepted already. Request a new code after the email cooldown.");
      return;
    }
    if(!r.ok){message("Verification unsuccessful. Check your code.");return;}
    document.getElementById("code").value="";
    const session=await fetch("/app/auth/session",{credentials:"same-origin",cache:"no-store"});
    if(!session.ok)throw Error("session");
    showAccount(await session.json());
  }catch{message("Could not establish a session. Please sign in again.");}
  finally{button.disabled=false;}
});
inviteForm.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!csrfToken || !inviteWorkspace.value){
    message("An authorized workspace session is required.");return;
  }
  const button=document.getElementById("member-invite-send");
  button.disabled=true;
  try{
    const workspaceId=inviteWorkspace.value;
    const email=document.getElementById("member-invite-email").value.trim();
    const role=document.getElementById("member-invite-role").value;
    const response=await request(
      "/app/auth/workspaces/"+encodeURIComponent(workspaceId)+"/invitations",
      {email,role},csrfToken
    );
    if(!response.ok)throw Error("invitation rejected");
    const result=await response.json();
    document.getElementById("member-invite-email").value="";
    message(result.status==="invited"
      ? "Invitation requested. Workspace access begins only after email confirmation."
      : "Invitation status requires administrator review; it will not be automatically resent.");
  }catch{
    message("Invitation unavailable. Verify your authenticator, workspace ownership, and recipient.");
  }finally{button.disabled=false;}
});
document.getElementById("mfa-enroll").addEventListener("click",async()=>{
  if(!csrfToken){message("Session expired. Renew your session first.");return;}
  const button=document.getElementById("mfa-enroll");
  button.disabled=true;
  try{
    const response=await request("/app/auth/mfa/totp/enroll",{},csrfToken);
    if(!response.ok)throw Error("MFA enrollment unavailable");
    const data=await response.json();
    enrollmentFactorId=data.factorId;
    mfaSecret.textContent=data.secret;
    mfaEnrollment.hidden=false;
    mfaForm.hidden=false;
    const option=document.createElement("option");
    option.value=data.factorId;
    option.textContent="New authenticator";
    mfaFactor.prepend(option);
    mfaFactor.value=data.factorId;
    message("Enter the setup key in your authenticator app, then verify a code.");
  }catch{message("Unable to enroll an authenticator. Renew your session or contact support.");}
  finally{button.disabled=false;}
});
mfaForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=document.getElementById("mfa-submit");
  const factorId=mfaFactor.value;
  const code=document.getElementById("mfa-code").value.trim();
  button.disabled=true;
  try{
    const response=await request("/app/auth/mfa/totp/verify",{factorId,code},csrfToken);
    if(!response.ok)throw Error("MFA verification failed");
    document.getElementById("mfa-code").value="";
    mfaSecret.textContent="";
    mfaEnrollment.hidden=true;
    enrollmentFactorId="";
    const result=await response.json();
    showAccount(result);
    message("Authenticator verified. Your session is protected for privileged actions.");
  }catch{message("Authenticator code was not accepted. Check the code and try again.");}
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
