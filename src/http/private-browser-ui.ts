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
  <header><p class="eyebrow">ISHIKEIT</p><h1 id="page-title">Private workspace access</h1>
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
      <div id="mfa-recovery" hidden>
        <p class="note">An earlier authenticator setup was not completed. You can discard that unverified setup and start again. Verified devices will not be removed.</p>
        <button type="button" class="secondary" id="mfa-reset">Discard incomplete setup</button>
      </div>
      <div id="mfa-setup" hidden>
        <button type="button" class="secondary" id="mfa-enroll">Set up an authenticator</button>
      </div>
      <section id="mfa-enrollment" aria-labelledby="mfa-enrollment-title" hidden>
        <h3 id="mfa-enrollment-title">Connect your authenticator app</h3>
        <p class="note">Scan this QR code with Google Authenticator or another authenticator app. If scanning is unavailable, enter the setup key manually.</p>
        <img id="mfa-qr" class="mfa-qr" width="260" height="260" alt="Authenticator setup QR code; keep private" hidden>
        <p id="mfa-qr-fallback" class="note" hidden>QR code unavailable. Use the manual setup key below.</p>
        <p class="setup-key-label">Manual setup key</p>
        <output id="mfa-secret" class="mfa-secret" aria-label="Manual authenticator setup key"></output>
        <p class="note">Keep the key private. It disappears when you verify, discard this setup, or sign out. Then enter the current six-digit code below.</p>
      </section>
      <form id="mfa-form" hidden>
        <div id="mfa-factor-picker" hidden>
          <label for="mfa-factor">Authenticator device</label>
          <select id="mfa-factor" aria-label="Choose authenticator"></select>
        </div>
        <label for="mfa-code">Six-digit authenticator code</label>
        <input id="mfa-code" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="6" pattern="[0-9]{6}" required>
        <button type="submit" id="mfa-submit">Verify authenticator</button>
      </form>
      <button type="button" class="secondary" id="mfa-reload">Refresh authenticator status</button>
    </section>
    <button type="button" class="secondary" id="refresh-session">Renew session</button>
  </section>
  <p id="status" class="status" role="status" aria-live="polite"></p>
  <footer>ISHIKEIT · Secure workspace access</footer>
</main>
</body></html>`;

export const privateLoginCss = `
:root{
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  color:#332b2d;background:#f7f1ec;line-height:1.55
}
*{box-sizing:border-box}
body{margin:0;min-height:100vh}
.layout{max-width:680px;margin:auto;padding:clamp(24px,6vh,70px) clamp(18px,4vw,30px) 50px}
.eyebrow{font-size:.83rem;font-weight:750;letter-spacing:.24em;color:#9b6171}
h1{font-size:clamp(1.95rem,4vw,2.65rem);letter-spacing:-.045em;line-height:1.12;margin:.6rem 0 1rem}
h2{font-size:1.28rem;margin:0}
h3{font-size:1rem;margin:0}
.intro{color:#6f6063;max-width:520px}
.surface{background:#fffdfb;border:1px solid #e7d9d9;border-radius:18px;
  padding:clamp(22px,5vw,34px);margin:24px 0 0;
  box-shadow:0 8px 38px #452e3411}
#login-panel,#account-panel{display:grid;gap:20px}
form{display:grid;gap:14px;min-width:0}
label,.setup-key-label{font-weight:650;font-size:.94rem}
input,select{min-width:0;width:100%;min-height:46px;padding:12px 14px;font:inherit;
  border:1px solid #cbbdbf;border-radius:10px;background:#fff;color:#332b2d}
input:focus-visible,button:focus-visible,select:focus-visible{
  outline:3px solid #df95ae;outline-offset:2px
}
button{min-height:46px;padding:12px 16px;font:inherit;font-weight:700;
  border-radius:10px;border:1px solid #8f5365;background:#8f5365;
  color:white;cursor:pointer;max-width:100%;white-space:normal}
button:hover{filter:brightness(.95)}
button:disabled{opacity:.55;cursor:wait}
button.secondary{background:transparent;color:#8f5365}
.note{font-size:.88rem;color:#76676b;margin:0;line-height:1.55}
.section-head{display:flex;justify-content:space-between;align-items:center;
  gap:14px;flex-wrap:wrap}
.workspaces{padding:0;list-style:none;display:grid;gap:12px;margin:0}
.workspaces li{padding:16px;border-radius:12px;background:#faf3f3;border:1px solid #f0dddd}
.workspaces strong{display:block}
.workspaces small{color:#735f65}
.status{min-height:1.4rem;font-size:.95rem;font-weight:550;color:#774455;margin:20px 0}
.mfa-panel{display:grid;gap:18px;margin-top:6px;border-top:1px solid #eadedd;padding-top:26px}
.mfa-panel h2{font-size:1.12rem}
#mfa-recovery,#mfa-setup,#mfa-enrollment,#mfa-factor-picker{
  display:grid;gap:14px;min-width:0
}
#mfa-recovery{padding:16px;border-radius:12px;background:#faf3f3}
#mfa-enrollment{padding:18px;border:1px solid #e7d9d9;border-radius:12px;
  background:#fff8f6}
.mfa-qr{display:block;width:min(100%,260px);height:auto;aspect-ratio:1;
  padding:8px;border:1px solid #eee;background:white;border-radius:10px;
  image-rendering:pixelated;margin:2px auto}
.mfa-secret{display:block;min-width:0;max-width:100%;overflow-wrap:anywhere;
  background:#f8ecec;border-radius:9px;padding:14px;font-family:ui-monospace,monospace;
  font-size:1rem;font-weight:700;letter-spacing:.08em;user-select:all}
#refresh-session{margin-top:8px}
footer{margin-top:56px;font-size:.81rem;color:#89777b;text-align:center}
[hidden]{display:none!important}
@media(max-width:480px){
  .section-head{align-items:stretch}
  .section-head button{width:100%}
  .mfa-panel button,#refresh-session{width:100%}
}
@media(prefers-reduced-motion:no-preference){button{transition:filter .15s ease}}
`;

export const privateLoginJs = `"use strict";
// Auth Admin invite links may append a short-lived session fragment.
// Ishikeit deliberately never reads or stores Supabase tokens from URL
// fragments; clear them from browser history before any other UI work.
if(window.location.hash || window.location.search){
  // Preserve the only two supported route paths; discard token fragments
  // and query strings without accidentally sending a signed-in user to login.
  window.history.replaceState(null,"",window.location.pathname==="/app/workspaces"
    ? "/app/workspaces" : "/app/login");
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
const mfaQr=document.getElementById("mfa-qr");
const mfaQrFallback=document.getElementById("mfa-qr-fallback");
const mfaFactorPicker=document.getElementById("mfa-factor-picker");
const mfaRecovery=document.getElementById("mfa-recovery");
const pageTitle=document.getElementById("page-title");
let mfaLoadGeneration=0;
const mfaForm=document.getElementById("mfa-form");
const mfaFactor=document.getElementById("mfa-factor");
function clearMfa(){
  mfaLoadGeneration++;
  mfaRecovery.hidden=true;
  enrollmentFactorId="";
  mfaSecret.textContent="";
  mfaQr.removeAttribute("src");
  mfaQr.hidden=true;
  mfaQrFallback.hidden=true;
  mfaEnrollment.hidden=true;
  mfaForm.hidden=true;
  mfaSetup.hidden=true;
  mfaFactor.replaceChildren();
  mfaFactorPicker.hidden=true;
  document.getElementById("mfa-code").value="";
}
async function loadMfaFactors(){
  const generation=++mfaLoadGeneration;
  try{
    const response=await fetch("/app/auth/mfa/factors",{credentials:"same-origin",cache:"no-store"});
    if(!response.ok)throw Error("MFA factors unavailable");
    const data=await response.json();
    if(generation!==mfaLoadGeneration || accountPanel.hidden)return;
    const verifiedIds=Array.isArray(data.factors) ? data.factors : [];
    const pendingCount=Number.isInteger(data.pendingCount) && data.pendingCount>=0
      ? data.pendingCount : 0;
    const canEnroll=data.canEnroll===true;
    // Supabase shares an unverified TOTP seed ONLY in the original enroll response.
    // Never discard that one-use key merely because factor listing fails or
    // an authenticated session is renewed in the background.
    const keepPending=!!enrollmentFactorId && !!mfaSecret.textContent;
    mfaFactor.replaceChildren();
    if(keepPending){
      const pending=document.createElement("option");
      pending.value=enrollmentFactorId;
      pending.textContent="New authenticator (verify setup)";
      mfaFactor.append(pending);
    }
    for(const id of verifiedIds){
      const option=document.createElement("option");
      option.value=id;
      option.textContent="Verified authenticator "+String(mfaFactor.options.length+1);
      mfaFactor.append(option);
    }
    if(keepPending)mfaFactor.value=enrollmentFactorId;
    mfaEnrollment.hidden=!keepPending;
    mfaFactorPicker.hidden=mfaFactor.options.length<=1;
    mfaForm.hidden=mfaFactor.options.length===0;
    // An in-progress setup must be verified or explicitly discarded BEFORE
    // starting a new one. Otherwise the seed is lost and the provider
    // accumulates unusable unverified factors.
    mfaSetup.hidden=!canEnroll || keepPending || pendingCount>0;
    mfaRecovery.hidden=!(canEnroll && pendingCount>0);
    if(keepPending){
      message("Finish connecting your authenticator with the QR code or setup key.");
    }else if(pendingCount>0 && canEnroll){
      message("An incomplete authenticator setup exists. Discard it before starting again.");
    }else if(!canEnroll && verifiedIds.length>0){
      message("Verify an existing authenticator before enrolling a backup device.");
    }else if(canEnroll && verifiedIds.length===0){
      message("Set up an authenticator to protect your account.");
    }
  }catch{
    if(generation!==mfaLoadGeneration || accountPanel.hidden)return;
    // Do not erase a received setup secret on transient network/factor-list
    // errors. A simple Refresh authenticator status can retry the readback.
    if(!enrollmentFactorId){
      mfaSetup.hidden=true;
      mfaRecovery.hidden=true;
      mfaForm.hidden=true;
    }
    message("Could not refresh authenticator status. Keep this page open and try again.");
  }
}

function message(s){status.textContent=s;}
async function request(path,body,csrf){
  const headers={"content-type":"application/json"};
  if(csrf)headers["x-ishikeit-csrf"]=csrf;
  return fetch(path,{method:"POST",credentials:"same-origin",headers,
    body:JSON.stringify(body),cache:"no-store",redirect:"error"});
}
function showLogin(){
  window.history.replaceState(null,"","/app/login");
  pageTitle.textContent="Private workspace access";
  document.title="ISHIKEIT · Private access";
  loginPanel.hidden=false;accountPanel.hidden=true;workspaceList.replaceChildren();csrfToken="";clearMfa();
  inviteWorkspace.replaceChildren();invitePanel.hidden=true;
}
function showAccount(data){
  window.history.replaceState(null,"","/app/workspaces");
  pageTitle.textContent="Your workspaces";
  document.title="ISHIKEIT · Your workspaces";
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
  if(enrollmentFactorId){message("Finish or discard the current authenticator setup.");return;}
  const button=document.getElementById("mfa-enroll");
  button.disabled=true;
  message("Starting authenticator setup...");
  try{
    const response=await request("/app/auth/mfa/totp/enroll",{},csrfToken);
    if(response.status===409){
      await loadMfaFactors();
      message("An incomplete setup already exists. Discard it before starting another.");
      return;
    }
    if(response.status===429){
      message("Too many setup attempts. Wait for the security cooldown (up to 15 minutes) before trying again. Do not repeatedly click the button.");
      return;
    }
    if(!response.ok){
      message("Unable to start authenticator setup. Refresh authenticator status or renew your session.");
      return;
    }
    const data=await response.json();
    if(typeof data.factorId!=="string" || typeof data.secret!=="string"
      || !/^[A-Z2-7]{16,128}$/.test(data.secret)){
      message("Authenticator setup response unavailable. Refresh status to discard incomplete setup.");
      await loadMfaFactors();
      return;
    }
    enrollmentFactorId=data.factorId;
    mfaSecret.textContent=data.secret;
    const qr=typeof data.qrCodeDataUrl==="string" && data.qrCodeDataUrl.length<1500000
      && data.qrCodeDataUrl.startsWith("data:image/svg+xml;base64,")
      ? data.qrCodeDataUrl : "";
    if(qr){
      mfaQr.src=qr;
      mfaQr.hidden=false;
      mfaQrFallback.hidden=true;
    }else{
      mfaQr.removeAttribute("src");
      mfaQr.hidden=true;
      mfaQrFallback.hidden=false;
    }
    mfaEnrollment.hidden=false;
    mfaForm.hidden=false;
    mfaSetup.hidden=true;
    mfaRecovery.hidden=false;
    const option=document.createElement("option");
    option.value=data.factorId;
    option.textContent="New authenticator (verify setup)";
    mfaFactor.prepend(option);
    mfaFactor.value=data.factorId;
    mfaFactorPicker.hidden=mfaFactor.options.length<=1;
    message("Scan the QR code or enter the setup key in your authenticator, then verify a six-digit code below.");
  }catch{
    message("Connection unavailable. Refresh authenticator status before retrying; a new factor may have been created.");
  }finally{button.disabled=false;}
});

document.getElementById("mfa-reload").addEventListener("click",async()=>{
  const button=document.getElementById("mfa-reload");
  button.disabled=true;
  try{await loadMfaFactors();}
  finally{button.disabled=false;}
});
document.getElementById("mfa-reset").addEventListener("click",async()=>{
  if(!csrfToken){message("Session expired. Sign in again.");return;}
  if(!window.confirm("Discard any incomplete authenticator setup? Verified authenticators will stay active."))return;
  const button=document.getElementById("mfa-reset");button.disabled=true;
  try{
    const response=await request("/app/auth/mfa/totp/reset",{},csrfToken);
    if(!response.ok)throw Error("Reset unavailable");
    const result=await response.json();
    clearMfa();
    await loadMfaFactors();
    message(result.cleared>0
      ? "Incomplete setup discarded. You can now set up an authenticator."
      : "No incomplete authenticator setup remained.");
  }catch{
    message("Could not discard the incomplete setup. Renew your session or contact support.");
  }finally{button.disabled=false;}
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
    // Clear both the manual key and its QR from DOM, including image data URL.
    enrollmentFactorId="";
    mfaSecret.textContent="";
    mfaQr.removeAttribute("src");
    mfaQr.hidden=true;
    mfaQrFallback.hidden=true;
    mfaEnrollment.hidden=true;
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
