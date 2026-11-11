/** Static, progressive login, step-up and workspace shell.
 * All workspace data and AAL2 are authorized by the server, not the UI.
 * Never persist or render Supabase bearer/refresh tokens or TOTP secrets
 * outside their one-use, authenticated enrollment response. No dependencies.
 */
export const privateLoginHtml = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>ISHIKEIT · Secure access</title>
<link rel="stylesheet" href="/app/auth/ui.css">
<script src="/app/auth/ui.js" defer></script>
</head><body>
<a class="skip-link" id="skip-link" href="#auth-main">Skip to main content</a>
<div id="boot-panel" class="boot-panel" role="status" aria-live="polite">
  <div class="brand"><span class="brand-symbol" aria-hidden="true">i</span><span>ISHIKEIT</span></div>
  <p class="muted">Checking your session…</p>
</div>

<div id="auth-shell" class="auth-shell" hidden>
  <header class="auth-brand"><span class="brand"><span class="brand-symbol" aria-hidden="true">i</span><span>ISHIKEIT</span></span></header>
  <main id="auth-main" class="auth-card">
    <p class="eyebrow" id="auth-step">SECURE ACCESS</p>
    <h1 id="auth-title">Sign in to Ishikeit</h1>
    <p id="auth-description" class="muted">Enter your email address to receive a sign-in code.</p>

    <section id="login-panel">
      <form id="email-form">
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" autocomplete="email" required maxlength="320" placeholder="you@example.com">
        <button id="send-code" type="submit">Continue with email</button>
      </form>
      <form id="code-form" hidden>
        <label for="code">Email verification code</label>
        <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="10" pattern="[0-9]{6,10}" required>
        <button id="verify-code" type="submit">Verify email</button>
        <button id="another-email" type="button" class="text-button">Use a different email</button>
      </form>
      <p class="auth-footnote">Access is limited to invited workspace members.</p>
    </section>

    <section id="mfa-gate" aria-label="Two-step verification" hidden>
      <div id="mfa-gate-slot">
        <section class="mfa-content" id="mfa-panel" aria-label="Authenticator verification" hidden>
          <p id="mfa-summary" class="muted"></p>
          <p id="mfa-pending-help" class="muted" hidden>Cancel this setup to start again.</p>
          <div id="mfa-setup" hidden>
            <button type="button" id="mfa-enroll">Set up an authenticator</button>
          </div>
          <section id="mfa-enrollment" aria-labelledby="mfa-enrollment-title" hidden>
            <h3 id="mfa-enrollment-title">Connect your authenticator</h3>
            <p class="muted">Scan this QR code with an authenticator app, or enter the setup key manually.</p>
            <img id="mfa-qr" class="mfa-qr" width="240" height="240" alt="Private QR code for authenticator setup" hidden>
            <p id="mfa-qr-fallback" class="muted" hidden>QR code unavailable. Use the manual key instead.</p>
            <label class="key-label" for="mfa-secret">Manual setup key</label>
            <output id="mfa-secret" class="mfa-secret"></output>
            <p class="muted">Keep this setup key private. Finish setup using the six-digit code below.</p>
          </section>
          <form id="mfa-form" hidden>
            <div id="mfa-factor-picker" hidden>
              <label for="mfa-factor">Authenticator</label>
              <select id="mfa-factor" aria-label="Choose authenticator"></select>
            </div>
            <label for="mfa-code">Six-digit authenticator code</label>
            <input id="mfa-code" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="6" pattern="[0-9]{6}" required>
            <button id="mfa-submit" type="submit">Verify and continue</button>
          </form>
          <button type="button" id="mfa-cancel" class="secondary" hidden>Cancel</button>
        </section>
      </div>
      <button type="button" class="text-button auth-switch-account" id="gate-sign-out">Use another account</button>
    </section>
  </main>
  <footer class="auth-footer">Protected access to your Ishikeit workspace</footer>
</div>

<div id="dashboard-shell" class="dashboard-shell" hidden>
  <header class="topbar">
    <div class="topbar-brand"><span class="brand"><span class="brand-symbol" aria-hidden="true">i</span><span>ISHIKEIT</span></span>
      <span class="topbar-divider" aria-hidden="true"></span>
      <span id="top-workspace" class="topbar-workspace">Workspace</span>
    </div>
    <div class="account-area" id="account-area">
      <button type="button" id="account-button" class="account-button" aria-haspopup="true" aria-controls="account-menu" aria-expanded="false">
        <span class="account-avatar" aria-hidden="true">A</span><span>Account</span><span class="chevron" aria-hidden="true">⌄</span>
      </button>
      <div id="account-menu" class="account-menu" hidden>
        <button type="button" id="account-security">Account security</button>
        <button type="button" id="sign-out">Sign out</button>
      </div>
    </div>
  </header>

  <div class="app-layout">
    <nav class="sidebar" aria-label="Workspace navigation">
      <span class="sidebar-label">WORKSPACE</span>
      <button type="button" class="nav-item" id="nav-overview" aria-current="page">Overview</button>
      <button type="button" class="nav-item" id="nav-team" hidden>Team</button>
      <span class="sidebar-label sidebar-label-secondary">ACCOUNT</span>
      <button type="button" class="nav-item" id="nav-security">Security</button>
    </nav>
    <main id="primary-content" class="main-content" tabindex="-1">
      <section id="overview-view" aria-labelledby="workspace-title">
        <p class="eyebrow">WORKSPACE OVERVIEW</p>
        <h1 id="workspace-title">Workspace</h1>
        <p class="page-description">Your space to manage your business in Ishikeit.</p>
        <div id="workspace-switcher" class="workspace-switcher" hidden>
          <label for="workspace-select">Current workspace</label>
          <select id="workspace-select"></select>
        </div>
        <article class="feature-card" aria-labelledby="workspace-card-title">
          <div class="workspace-icon" id="workspace-icon" aria-hidden="true">I</div>
          <div class="feature-card-body">
            <h2 id="workspace-card-title">Workspace</h2>
            <p id="workspace-role" class="muted">Your workspace</p>
          </div>
          <span class="state-label">Active</span>
        </article>
        <section class="next-section" aria-labelledby="next-heading">
          <h2 id="next-heading">Your workspace is ready</h2>
          <p>Messaging and automation tools will become available here as they are enabled. Your workspace access is secured with two-step verification.</p>
        </section>
      </section>

      <section id="security-view" aria-labelledby="security-heading" hidden>
        <p class="eyebrow">ACCOUNT SETTINGS</p>
        <h1 id="security-heading">Account security</h1>
        <p class="page-description">Manage how you verify your identity and protect your account.</p>
        <article class="settings-card" aria-labelledby="mfa-settings-heading">
          <div class="settings-card-head">
            <span class="security-icon" aria-hidden="true">✓</span>
            <div>
              <h2 id="mfa-settings-heading">Two-step verification (2FA)</h2>
              <p class="muted" id="mfa-account-description">Checking account protection…</p>
            </div>
            <button type="button" role="switch" id="mfa-account-toggle"
              class="security-switch" aria-label="Two-step verification for sign-in"
              aria-checked="true" aria-describedby="mfa-account-description" disabled>
              <span class="switch-track" aria-hidden="true"><span></span></span>
              <span class="switch-label">On</span>
            </button>
          </div>
          <p class="muted security-footnote">Security-sensitive changes always require an authenticator code, even when 2FA for sign-in is off.</p>
          <div class="devices-section" aria-labelledby="mfa-devices-heading">
            <div class="devices-title-row">
              <div><h3 id="mfa-devices-heading">Your authenticators</h3>
                <p class="muted">Manage the authenticators you use to verify your identity.</p></div>
              <button type="button" class="secondary" id="mfa-add">Set up an authenticator</button>
            </div>
            <div id="mfa-devices" class="device-list" aria-live="polite"></div>
            <p id="mfa-devices-empty" class="muted">Loading authenticators…</p>
          </div>
          <section id="mfa-change-panel" class="security-detail security-proof"
            aria-labelledby="mfa-change-title" hidden>
            <h3 id="mfa-change-title">Confirm security change</h3>
            <p id="mfa-change-description" class="muted"></p>
            <form id="mfa-change-form">
              <label for="mfa-proof-factor">Verify using</label>
              <select id="mfa-proof-factor" required></select>
              <label for="mfa-change-code">Six-digit authenticator code</label>
              <input id="mfa-change-code" type="text" inputmode="numeric"
                autocomplete="one-time-code" minlength="6" maxlength="6"
                pattern="[0-9]{6}" required>
              <div class="security-actions">
                <button id="mfa-change-confirm" type="submit">Confirm change</button>
                <button type="button" class="secondary" id="mfa-change-cancel">Cancel</button>
              </div>
            </form>
          </section>
          <div id="mfa-settings-slot" class="security-detail" hidden></div>
        </article>
      </section>

      <section id="team-view" aria-labelledby="team-heading" hidden>
        <p class="eyebrow">WORKSPACE SETTINGS</p>
        <h1 id="team-heading">Invite a teammate</h1>
        <p class="page-description">Send an invitation to someone who needs access to your workspace.</p>
        <div class="settings-card">
          <form id="member-invite-form">
            <label for="member-invite-workspace">Workspace</label>
            <select id="member-invite-workspace" required></select>
            <label for="member-invite-email">Teammate email</label>
            <input id="member-invite-email" type="email" autocomplete="off" required maxlength="320">
            <label for="member-invite-role">Role</label>
            <select id="member-invite-role">
              <option value="viewer">Viewer</option><option value="agent">Agent</option><option value="admin">Admin</option>
            </select>
            <button type="submit" id="member-invite-send">Send invitation</button>
          </form>
        </div>
      </section>
    </main>
  </div>
</div>
<p id="status" class="toast" role="status" aria-live="polite" aria-atomic="true" hidden></p>
</body></html>`;

export const privateLoginCss = `
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  font-synthesis:none;color:#272329;background:#f7f6f4;line-height:1.55}
*{box-sizing:border-box}
html{min-height:100%}
body{margin:0;min-height:100vh}
[hidden]{display:none!important}
button,input,select{font:inherit}
button{min-height:44px;padding:10px 18px;border:1px solid #775365;border-radius:11px;
  background:#775365;color:#fff;font-weight:650;cursor:pointer;
  transition:background .15s ease,box-shadow .15s ease}
button:hover{background:#684759}
button:disabled{cursor:wait;opacity:.57}
button.secondary{background:#fff;color:#684759;border-color:#dfd4da}
button.secondary:hover{background:#faf5f8}
button.text-button{background:transparent;color:#684759;border:0;padding:8px 4px;font-weight:650}
button.text-button:hover{text-decoration:underline;background:transparent}
input,select{min-width:0;width:100%;min-height:48px;padding:11px 14px;
  border:1px solid #cfc8cd;border-radius:10px;background:#fff;color:#272329}
input::placeholder{color:#817983}
input:focus-visible,select:focus-visible,button:focus-visible,.skip-link:focus-visible{
  outline:3px solid #b4799a;outline-offset:3px}
form{display:grid;gap:12px}
form>button{margin-top:8px}
label{font-size:.9rem;font-weight:650;color:#393038}
h1,h2,h3,p{margin-top:0}
h1{font-size:clamp(1.85rem,3vw,2.45rem);line-height:1.16;letter-spacing:-.045em;margin-bottom:12px}
h2{font-size:1.12rem;letter-spacing:-.012em;line-height:1.3;margin-bottom:7px}
h3{font-size:1rem;margin-bottom:8px}
p{margin-bottom:0}
.muted,.page-description{color:#736d76}
.page-description{font-size:1rem;margin-bottom:30px;max-width:620px}
.eyebrow{font-size:.73rem;font-weight:780;letter-spacing:.14em;color:#886b7b;margin-bottom:13px}
.brand{display:inline-flex;align-items:center;gap:10px;font-size:.92rem;letter-spacing:.16em;
  color:#433340;font-weight:820;white-space:nowrap}
.brand-symbol{display:grid;place-items:center;height:34px;width:34px;color:#fff;
  background:#775365;border-radius:11px;font-family:Georgia,serif;font-size:1.25rem;letter-spacing:0}
.skip-link{position:absolute;left:14px;top:-90px;padding:11px 16px;border-radius:8px;
  color:#fff;background:#493342;z-index:1000}
.skip-link:focus{top:12px}
.boot-panel{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:18px}
.boot-panel p{font-size:.9rem}
.auth-shell{min-height:100vh;display:flex;flex-direction:column;align-items:center;
  justify-content:center;padding:36px 20px;background:radial-gradient(ellipse at top,#f3eae9,#f8f6f4 60%)}
.auth-brand{width:100%;max-width:464px;margin:0 auto 28px}
.auth-card{width:100%;max-width:464px;padding:clamp(26px,5vw,40px);background:#fff;
  border:1px solid #e9e2e6;box-shadow:0 14px 45px #3c2d3610;
  border-radius:19px}
.auth-card h1{font-size:clamp(1.8rem,4vw,2.1rem)}
.auth-card #auth-description{margin-bottom:28px;line-height:1.6}
.auth-footnote{margin-top:24px;color:#817981;font-size:.79rem}
.auth-footer{color:#8a8288;font-size:.78rem;margin-top:28px;text-align:center}
#login-panel,#mfa-gate{display:grid;gap:16px}
.auth-switch-account{justify-self:center;margin-top:10px}
.mfa-content{display:grid;gap:18px}
.mfa-content form{gap:12px}
.mfa-content #mfa-summary{font-size:.91rem}
.mfa-content #mfa-setup{display:grid}
.mfa-content #mfa-recovery,.mfa-content #mfa-enrollment{display:grid;gap:13px}
.notice{padding:16px;border:1px solid #e4d6d6;background:#fcf6f5;border-radius:12px;font-size:.89rem}
.notice button{justify-self:start}
#mfa-enrollment{padding:18px;background:#fdfbfc;border:1px solid #ebe2e7;border-radius:13px}
.mfa-qr{display:block;width:min(100%,240px);height:auto;aspect-ratio:1;
  image-rendering:pixelated;background:#fff;padding:9px;border:1px solid #e8e0e5;border-radius:11px;margin:3px auto}
.mfa-secret{display:block;max-width:100%;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  font-size:.95rem;font-weight:700;letter-spacing:.05em;user-select:all;
  background:#f5eef1;border-radius:8px;padding:13px}
.key-label{display:block;margin-bottom:-6px}
.dashboard-shell{min-height:100vh;background:#f8f8f7}
.topbar{height:74px;position:sticky;top:0;z-index:40;display:flex;align-items:center;
  justify-content:space-between;gap:20px;padding:0 clamp(20px,4vw,42px);
  border-bottom:1px solid #e9e7e6;background:#fff}
.topbar-brand{display:flex;align-items:center;min-width:0;gap:22px}
.topbar-divider{height:25px;width:1px;background:#ded8dc}
.topbar-workspace{color:#6c626c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.91rem;font-weight:590}
.account-area{position:relative;flex-shrink:0}
.account-button{border:1px solid transparent;background:transparent;color:#42343e;
  display:flex;align-items:center;gap:10px;font-size:.87rem;font-weight:650;padding:7px 12px}
.account-button:hover{background:#f5f1f3}
.account-avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#e7dbe2;color:#654c5a;font-size:.82rem}
.chevron{font-size:1.2rem;color:#8c7d87;line-height:1}
.account-menu{position:absolute;right:0;top:calc(100% + 10px);width:220px;
  background:#fff;border:1px solid #e6dfe3;border-radius:13px;box-shadow:0 17px 48px #382e3820;padding:6px;display:grid;gap:2px;z-index:60}
.account-menu button{border:0;background:transparent;color:#362c36;text-align:left;font-weight:550;
  min-height:44px;padding:11px 13px}
.account-menu button:hover{background:#f6f1f4}
.app-layout{display:grid;grid-template-columns:228px minmax(0,1fr);max-width:1480px;margin:0 auto;min-height:calc(100vh - 74px)}
.sidebar{border-right:1px solid #ebe8e8;padding:30px 17px;display:flex;flex-direction:column;gap:5px}
.sidebar-label{font-size:.7rem;letter-spacing:.13em;font-weight:750;color:#918890;padding:7px 14px 10px}
.sidebar-label-secondary{margin-top:25px}
.nav-item{color:#635b64;background:transparent;border:0;font-weight:590;text-align:left;min-height:45px;border-radius:9px;padding:10px 14px}
.nav-item:hover{background:#f0ebee;color:#533e4d}
.nav-item[aria-current="page"]{background:#eee5eb;color:#634353;font-weight:750}
.main-content{min-width:0;width:100%;max-width:1000px;padding:clamp(30px,5vw,62px) clamp(20px,5vw,64px) 80px}
.main-content h1{margin-bottom:10px}
.feature-card,.settings-card{background:#fff;border:1px solid #e6e3e6;border-radius:16px;box-shadow:0 6px 20px #31283306}
.feature-card{display:flex;align-items:center;gap:17px;padding:24px;margin-top:18px}
.workspace-icon{flex-shrink:0;display:grid;place-items:center;width:54px;height:54px;
  font-size:1.3rem;font-weight:750;background:#f2e8ee;color:#775365;border-radius:14px}
.feature-card-body{min-width:0;flex:1}
.feature-card-body h2{font-size:1.1rem;margin-bottom:3px;overflow-wrap:anywhere}
.feature-card-body p{font-size:.88rem}
.state-label{font-size:.77rem;font-weight:750;color:#356f58;background:#e7f4ee;border-radius:99px;padding:6px 11px;white-space:nowrap}
.next-section{margin-top:34px;max-width:650px;padding:24px;background:#fff;border:1px solid #ede8ec;border-radius:14px}
.next-section h2{font-size:1rem;margin-bottom:8px}
.next-section p{font-size:.91rem;line-height:1.65;color:#777078}
.settings-card{padding:clamp(22px,4vw,30px);max-width:720px}
.settings-card-head{display:flex;align-items:center;gap:15px;flex-wrap:wrap;margin-bottom:24px}
.settings-card-head>div{flex:1;min-width:160px}
.settings-card-head p{font-size:.88rem}
.security-icon{display:grid;place-items:center;width:46px;height:46px;border-radius:12px;background:#e9f5ee;color:#356f58;font-size:1.25rem}
.security-detail{margin-top:23px;padding-top:22px;border-top:1px solid #eee8ec}
.workspace-switcher{max-width:420px;margin-bottom:22px;display:grid;gap:8px}
.toast{position:fixed;bottom:20px;right:20px;z-index:90;max-width:min(420px,calc(100vw - 40px));
  color:#fff;background:#433740;padding:13px 18px;border-radius:11px;
  box-shadow:0 12px 36px #251a2540;font-size:.9rem;overflow-wrap:anywhere}
@media(max-width:760px){
  .topbar{height:68px;padding:0 17px}
  .topbar-brand{gap:12px}
  .topbar-divider{display:none}
  .topbar-workspace{display:none}
  .app-layout{display:block}
  .sidebar{flex-direction:row;flex-wrap:wrap;gap:7px;border-right:0;border-bottom:1px solid #ebe8e8;padding:12px 15px}
  .sidebar-label{display:none}
  .nav-item{flex:0 0 auto;padding:9px 13px;min-height:42px}
  .main-content{padding:30px 20px 70px}
}
@media(max-width:460px){
  .auth-shell{padding:28px 16px;justify-content:flex-start}
  .auth-brand{margin-bottom:22px}
  .auth-card{padding:28px 23px}
  .feature-card{align-items:flex-start;flex-wrap:wrap;gap:13px}
  .feature-card .state-label{margin-left:67px}
  .settings-card-head{align-items:flex-start}
  .settings-card-head .state-label{margin-left:60px}
  .account-button{padding:6px}
  .account-button .account-avatar{width:30px;height:30px}
  .account-menu{right:0}
  .toast{left:15px;right:15px;bottom:15px;max-width:none}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

export const privateLoginJs = `"use strict";
// The email template may carry ONLY a URL-fragment email hint, never an OTP,
// Auth token or other sign-in capability. Browser GET, Referer, and server
// access logs do not contain this fragment. It is removed immediately.
let linkEmailHint=null;
if(window.location.hash.startsWith("#verify-email=")
  && window.location.hash.length<=2048){
  try{
    const email=decodeURIComponent(
      window.location.hash.slice("#verify-email=".length));
    if(email.length>=3 && email.length<=320)linkEmailHint=email;
  }catch{/* Malformed fragment is never reflected back to the page. */}
}
if(window.location.hash || window.location.search){
  window.history.replaceState(null,"",window.location.pathname==="/app/workspaces"
    ? "/app/workspaces" : "/app/login");
}
const get=id=>document.getElementById(id);
const bootPanel=get("boot-panel");
const authShell=get("auth-shell");
const dashboardShell=get("dashboard-shell");
const authTitle=get("auth-title");
const authDescription=get("auth-description");
const authStep=get("auth-step");
const loginPanel=get("login-panel");
const emailForm=get("email-form");
const codeForm=get("code-form");
const mfaGate=get("mfa-gate");
const mfaGateSlot=get("mfa-gate-slot");
const mfaSettingsSlot=get("mfa-settings-slot");
const mfaPanel=get("mfa-panel");
const mfaForm=get("mfa-form");
const mfaFactor=get("mfa-factor");
const mfaFactorPicker=get("mfa-factor-picker");
const mfaSummary=get("mfa-summary");
const mfaSetup=get("mfa-setup");
const mfaPendingHelp=get("mfa-pending-help");
const mfaCancel=get("mfa-cancel");
const mfaDevices=get("mfa-devices");
const mfaDevicesEmpty=get("mfa-devices-empty");
const mfaAccountToggle=get("mfa-account-toggle");
const mfaAccountDescription=get("mfa-account-description");
const mfaChangePanel=get("mfa-change-panel");
const mfaProofFactor=get("mfa-proof-factor");
const mfaEnrollment=get("mfa-enrollment");
const mfaSecret=get("mfa-secret");
const mfaQr=get("mfa-qr");
const mfaQrFallback=get("mfa-qr-fallback");
const memberInviteForm=get("member-invite-form");
const inviteWorkspace=get("member-invite-workspace");
const status=get("status");
const accountMenu=get("account-menu");
const accountButton=get("account-button");
let mode="boot"; // "login", "gate", "dashboard"
let selectedPanel="overview";
let csrfToken="";
let enrollmentFactorId="";
let mfaGeneration=0;
let authEpoch=0;
let sessionExpiresAt=0;
let refreshTimer=null;
let refreshInFlight=null;
let workspaceRows=[];
let currentWorkspaceId="";
let invitingEnabled=false;
let mfaState=null;
let securityChange=null;
let mfaRetryTimer=null;

function message(value){
  status.textContent=value;
  status.hidden=!value;
}
function request(path,body,csrf){
  const headers={"content-type":"application/json"};
  if(csrf)headers["x-ishikeit-csrf"]=csrf;
  return fetch(path,{method:"POST",credentials:"same-origin",headers,
    body:JSON.stringify(body),cache:"no-store",redirect:"error"});
}
function invalidateTimers(){
  if(refreshTimer!==null){clearTimeout(refreshTimer);refreshTimer=null;}
  if(mfaRetryTimer!==null){clearTimeout(mfaRetryTimer);mfaRetryTimer=null;}
}
function clearMfa(){
  mfaGeneration++;
  enrollmentFactorId="";
  mfaSecret.textContent="";
  mfaQr.removeAttribute("src");
  mfaQr.hidden=true;
  mfaQrFallback.hidden=true;
  mfaEnrollment.hidden=true;
  mfaForm.hidden=true;
  mfaSetup.hidden=true;
  mfaPendingHelp.hidden=true;
  mfaCancel.hidden=true;
  mfaFactorPicker.hidden=true;
  mfaFactor.replaceChildren();
  get("mfa-code").value="";
  mfaSummary.textContent="";
  mfaPanel.hidden=true;
  mfaSettingsSlot.hidden=true;
  mfaChangePanel.hidden=true;
  securityChange=null;
  mfaState=null;
  mfaDevices.replaceChildren();
  mfaDevicesEmpty.textContent="Loading authenticators…";
  mfaAccountToggle.disabled=true;
}
function closeAccountMenu(){
  accountMenu.hidden=true;
  accountButton.setAttribute("aria-expanded","false");
}
function setSessionExpiry(data){
  const expires=Date.parse(data.expiresAt);
  sessionExpiresAt=Number.isFinite(expires)?expires:0;
  scheduleRefresh();
}
function scheduleRefresh(){
  if(refreshTimer!==null){clearTimeout(refreshTimer);refreshTimer=null;}
  if(!sessionExpiresAt || (mode!=="dashboard" && mode!=="gate"))return;
  if(document.visibilityState==="hidden")return;
  // Automatic refresh only while the app is in the foreground. The 12-hour
  // absolute BFF session bound is enforced on the server, not extended here.
  const delay=Math.max(1000,Math.min(2147483647,sessionExpiresAt-Date.now()-180000));
  refreshTimer=setTimeout(()=>{void maintainSession();},delay);
}
async function maintainSession(){
  if((mode!=="dashboard" && mode!=="gate") || !csrfToken)return false;
  if(document.visibilityState==="hidden")return false;
  if(sessionExpiresAt && sessionExpiresAt-Date.now()>240000){scheduleRefresh();return true;}
  if(refreshInFlight!==null)return refreshInFlight;
  const generation=authEpoch;
  const operation=(async()=>{
    try{
      const response=await request("/app/auth/refresh",{},csrfToken);
      if(generation!==authEpoch)return false;
      if(response.status===401 || response.status===403){
        showLogin("Your session ended. Sign in to continue.");
        return false;
      }
      if(!response.ok)throw Error("Session service unavailable");
      const data=await response.json();
      if(generation!==authEpoch)return false;
      if(data.status==="mfa_required")showGate(data,true);
      else if(data.status==="authenticated")showDashboard(data,true);
      else throw Error("Invalid session response");
      return true;
    }catch{
      if(generation===authEpoch){
        message("Connection interrupted. Your session will be checked again when you return.");
        if(refreshTimer!==null)clearTimeout(refreshTimer);
        refreshTimer=setTimeout(()=>{void maintainSession();},30000);
      }
      return false;
    }
  })();
  refreshInFlight=operation;
  try{return await operation;}finally{if(refreshInFlight===operation)refreshInFlight=null;}
}
function showLogin(notice){
  authEpoch++;
  invalidateTimers();
  mode="login";
  csrfToken="";
  sessionExpiresAt=0;
  workspaceRows=[];
  currentWorkspaceId="";
  invitingEnabled=false;
  clearMfa();
  closeAccountMenu();
  mfaGateSlot.append(mfaPanel);
  mfaGate.hidden=true;
  loginPanel.hidden=false;
  authShell.hidden=false;
  dashboardShell.hidden=true;
  bootPanel.hidden=true;
  emailForm.hidden=false;
  codeForm.hidden=true;
  get("code").value="";
  authStep.textContent="SECURE ACCESS";
  get("skip-link").href="#auth-main";
  authTitle.textContent="Sign in to Ishikeit";
  authDescription.textContent="Enter your email address to receive a sign-in code.";
  document.title="ISHIKEIT · Sign in";
  window.history.replaceState(null,"","/app/login");
  message(notice||"");
}
function showGate(data,preserve){
  if(typeof data.csrfToken!=="string"){showLogin("Please sign in again.");return;}
  const previousMode=mode;
  mode="gate";
  get("skip-link").href="#auth-main";
  authStep.textContent="TWO-STEP VERIFICATION";
  authTitle.textContent="Verify it's you";
  authDescription.textContent="Enter the six-digit code from your authenticator app to continue.";
  document.title="ISHIKEIT · Verify your identity";
  window.history.replaceState(null,"","/app/login");
  bootPanel.hidden=true;
  dashboardShell.hidden=true;
  authShell.hidden=false;
  loginPanel.hidden=true;
  mfaGate.hidden=false;
  csrfToken=data.csrfToken;
  workspaceRows=[];
  currentWorkspaceId="";
  invitingEnabled=false;
  mfaGateSlot.append(mfaPanel);
  mfaPanel.hidden=false;
  if(!preserve && previousMode!=="gate")clearMfa();
  mfaPanel.hidden=false;
  setSessionExpiry(data);
  if(!preserve || previousMode!=="gate")void loadMfaFactors();
  message("");
}
function renderWorkspace(){
  const workspace=workspaceRows.find(item=>item.workspaceId===currentWorkspaceId)
    || workspaceRows[0];
  if(!workspace)return;
  currentWorkspaceId=workspace.workspaceId;
  const name=workspace.displayName;
  const role=workspace.role;
  get("top-workspace").textContent=name;
  get("workspace-title").textContent=name;
  get("workspace-card-title").textContent=name;
  get("workspace-role").textContent=role==="owner"?"Owner access":
    role==="admin"?"Admin access":role==="agent"?"Agent access":"Viewer access";
  get("workspace-icon").textContent=name.slice(0,1).toUpperCase();
  const selector=get("workspace-select");
  selector.replaceChildren();
  for(const item of workspaceRows){
    const option=document.createElement("option");
    option.value=item.workspaceId;
    option.textContent=item.displayName;
    selector.append(option);
  }
  selector.value=currentWorkspaceId;
  get("workspace-switcher").hidden=workspaceRows.length<=1;
}
function showPanel(panel){
  if(mode!=="dashboard")return;
  if(panel==="team" && !invitingEnabled)panel="overview";
  selectedPanel=panel;
  get("overview-view").hidden=panel!=="overview";
  get("team-view").hidden=panel!=="team";
  get("security-view").hidden=panel!=="security";
  for(const item of ["overview","team","security"]){
    const button=get("nav-"+item);
    if(item===panel)button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
  }
  closeAccountMenu();
  message("");
}
function showDashboard(data,preserve){
  if(data.status!=="authenticated" || !data.workspaces || !Array.isArray(data.workspaces.items)
    || data.workspaces.items.length===0 || typeof data.csrfToken!=="string"){
    showLogin("We couldn't confirm your workspace access. Sign in again.");
    return;
  }
  const priorMode=mode;
  mode="dashboard";
  csrfToken=data.csrfToken;
  workspaceRows=data.workspaces.items;
  invitingEnabled=data.memberInvitationsEnabled===true;
  if(!workspaceRows.some(item=>item.workspaceId===currentWorkspaceId))
    currentWorkspaceId=workspaceRows[0].workspaceId;
  renderWorkspace();
  const teamNav=get("nav-team");
  teamNav.hidden=!invitingEnabled;
  inviteWorkspace.replaceChildren();
  if(invitingEnabled){
    for(const workspace of workspaceRows){
      if(workspace.role!=="owner")continue;
      const option=document.createElement("option");
      option.value=workspace.workspaceId;option.textContent=workspace.displayName;
      inviteWorkspace.append(option);
    }
    teamNav.hidden=inviteWorkspace.options.length===0;
  }
  if(teamNav.hidden && selectedPanel==="team")selectedPanel="overview";
  authShell.hidden=true;
  dashboardShell.hidden=false;
  bootPanel.hidden=true;
  get("skip-link").href="#primary-content";
  document.title="ISHIKEIT · "+workspaceRows[0].displayName;
  window.history.replaceState(null,"","/app/workspaces");
  if(priorMode!=="dashboard" || !preserve){
    clearMfa();
  }
  mfaSettingsSlot.append(mfaPanel);
  setSessionExpiry(data);
  showPanel(preserve && priorMode==="dashboard"?selectedPanel:"overview");
}
async function loadMfaFactors(retried){
  const generation=++mfaGeneration;
  try{
    const response=await fetch("/app/auth/mfa/factors",{
      credentials:"same-origin",cache:"no-store",redirect:"error"
    });
    if(!response.ok)throw Error("Factor status unavailable");
    const data=await response.json();
    if(generation!==mfaGeneration || (mode!=="gate" && mode!=="dashboard"))return;
    const ids=Array.isArray(data.factors)?data.factors:[];
    const pending=Number.isInteger(data.pendingCount) && data.pendingCount>=0?data.pendingCount:0;
    const canEnroll=data.canEnroll===true;
    const keepPending=!!enrollmentFactorId && !!mfaSecret.textContent;
    mfaFactor.replaceChildren();
    if(keepPending){
      const item=document.createElement("option");
      item.value=enrollmentFactorId;item.textContent="New authenticator (finish setup)";
      mfaFactor.append(item);
    }
    for(let i=0;i<ids.length;i++){
      const option=document.createElement("option");
      option.value=ids[i];option.textContent="Authenticator "+String(i+1);
      mfaFactor.append(option);
    }
    if(keepPending)mfaFactor.value=enrollmentFactorId;
    mfaForm.hidden=!(keepPending || (mode==="gate" && ids.length>0));
    mfaFactorPicker.hidden=mfaFactor.options.length<=1;
    mfaEnrollment.hidden=!keepPending;
    mfaSetup.hidden=!canEnroll || keepPending || pending>0;
    mfaRecovery.hidden=!(canEnroll && pending>0);
    mfaSummary.textContent=keepPending
      ? "Finish setup using the QR code or manual key below."
      : mode==="gate" && ids.length>0
        ? "Choose an authenticator and enter its current code."
        : pending>0 && canEnroll
          ? "An unfinished setup needs to be discarded before you can try again."
          : ids.length>0
            ? String(ids.length)+" verified authenticator"+(ids.length===1?"":"s")+"."
            : "Set up an authenticator to secure your account.";
    mfaPanel.hidden=false;
  }catch{
    if(generation!==mfaGeneration || (mode!=="gate" && mode!=="dashboard"))return;
    if(!enrollmentFactorId){
      mfaForm.hidden=true;mfaSetup.hidden=true;mfaRecovery.hidden=true;
    }
    mfaSummary.textContent="We couldn't load your authenticators. Checking again…";
    if(!retried){
      mfaRetryTimer=setTimeout(()=>{
        mfaRetryTimer=null;
        if(generation===mfaGeneration)void loadMfaFactors(true);
      },2200);
    }else{
      mfaSummary.textContent="Authenticator information is temporarily unavailable. Reload this page to reconnect.";
    }
  }
}
function showCodeEntry(){
  if(mode!=="login")showLogin("");
  emailForm.hidden=true;
  codeForm.hidden=false;
  authStep.textContent="CHECK YOUR EMAIL";
  authTitle.textContent="Enter your email code";
  authDescription.textContent="Enter the verification code from your Ishikeit email to continue.";
  get("code").value="";
  get("code").focus();
  message("");
}
/** Code-entry resume requires an existing unexpired, cookie-bound attempt. */
async function pendingCodeAvailable(){
  try{
    const response=await fetch("/app/auth/pending-otp",{
      credentials:"same-origin",cache:"no-store",redirect:"error"
    });
    return response.ok && (await response.json()).status==="awaiting_code";
  }catch{return false;}
}
async function resumeEmailCodeStep(){
  // Capture and immediately discard any email fragment hint. Unlike an OTP,
  // this address is never sufficient to authenticate or authorize access.
  const hint=linkEmailHint;
  linkEmailHint=null;
  if(await pendingCodeAvailable()){
    showLogin("");
    showCodeEntry();
    return true;
  }
  if(hint!==null){
    try{
      const response=await request("/app/auth/resume-otp",{email:hint});
      if(response.status===202 && await pendingCodeAvailable()){
        showLogin("");
        showCodeEntry();
        return true;
      }
    }catch{/* An expired or offline link must not bypass OTP validation. */}
    showLogin("Your sign-in code may have expired. Request a fresh code to continue.");
    return true;
  }
  return false;
}
async function recoverSession(){
  const response=await fetch("/app/auth/csrf",{credentials:"same-origin",cache:"no-store"});
  if(!response.ok)return false;
  const data=await response.json();
  if(typeof data.csrfToken!=="string")return false;
  const fresh=await request("/app/auth/refresh",{},data.csrfToken);
  if(!fresh.ok)return false;
  const session=await fresh.json();
  if(session.status==="mfa_required")showGate(session,false);
  else if(session.status==="authenticated")showDashboard(session,false);
  else return false;
  return true;
}
async function initialize(){
  try{
    const response=await fetch("/app/auth/session",{
      credentials:"same-origin",cache:"no-store",redirect:"error"
    });
    if(response.ok){
      const session=await response.json();
      if(session.status==="mfa_required"){showGate(session,false);return;}
      if(session.status==="authenticated"){showDashboard(session,false);return;}
    }
    if(await recoverSession())return;
    if(await resumeEmailCodeStep())return;
  }catch{ /* No stored session or temporary service error. */ }
  showLogin("");
}

emailForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=get("send-code");button.disabled=true;
  try{
    const email=get("email").value.trim();
    const response=await request("/app/auth/request-otp",{email});
    if(response.status===202){
      showCodeEntry();
      authDescription.textContent="If this email has access, enter the code sent to it.";
    }else message("We couldn't send a code right now. Please try again.");
  }catch{message("Connection interrupted. Try again.");}
  finally{button.disabled=false;}
});
get("another-email").addEventListener("click",()=>showLogin(""));
codeForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=get("verify-code");button.disabled=true;
  try{
    const code=get("code").value.trim();
    const response=await request("/app/auth/verify-otp",{code});
    get("code").value="";
    if(response.status===503){
      showLogin("Your code may already have been used. Request a new code after the email cooldown.");
      return;
    }
    if(!response.ok){message("That code wasn't accepted. Check the email code and try again.");return;}
    const session=await fetch("/app/auth/session",{credentials:"same-origin",cache:"no-store"});
    if(!session.ok)throw Error("Session unavailable");
    const data=await session.json();
    if(data.status==="mfa_required")showGate(data,false);
    else showDashboard(data,false);
  }catch{message("We couldn't complete sign-in. Please try again.");}
  finally{button.disabled=false;}
});
function openSecurity(){
  showPanel("security");
}
get("nav-overview").addEventListener("click",()=>showPanel("overview"));
get("nav-security").addEventListener("click",openSecurity);
get("nav-team").addEventListener("click",()=>showPanel("team"));
get("workspace-select").addEventListener("change",()=>{
  const value=get("workspace-select").value;
  if(workspaceRows.some(item=>item.workspaceId===value)){
    currentWorkspaceId=value;renderWorkspace();
  }
});
accountButton.addEventListener("click",()=>{
  const next=accountMenu.hidden;
  accountMenu.hidden=!next;
  accountButton.setAttribute("aria-expanded",next?"true":"false");
});
get("account-security").addEventListener("click",openSecurity);
document.addEventListener("keydown",event=>{
  if(event.key==="Escape")closeAccountMenu();
});
document.addEventListener("click",event=>{
  if(!get("account-area").contains(event.target))closeAccountMenu();
});
get("manage-authenticators").addEventListener("click",async()=>{
  securityExpanded=!securityExpanded;
  mfaSettingsSlot.hidden=!securityExpanded;
  get("manage-authenticators").setAttribute("aria-expanded",securityExpanded?"true":"false");
  if(securityExpanded){
    mfaSettingsSlot.append(mfaPanel);
    mfaPanel.hidden=false;
    await loadMfaFactors();
  }else{
    // Hide management actions; never erase an in-progress one-use key.
    mfaPanel.hidden=true;
  }
});
memberInviteForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=get("member-invite-send");button.disabled=true;
  try{
    if(mode!=="dashboard" || !invitingEnabled || !csrfToken
       || !inviteWorkspace.value)throw Error("Not authorized");
    const response=await request(
      "/app/auth/workspaces/"+encodeURIComponent(inviteWorkspace.value)+"/invitations",
      {email:get("member-invite-email").value.trim(),role:get("member-invite-role").value},
      csrfToken
    );
    if(!response.ok)throw Error("Invitation unavailable");
    const result=await response.json();
    get("member-invite-email").value="";
    message(result.status==="invited"
      ? "Invitation sent. Access begins after email verification."
      : "Invitation needs administrator review.");
  }catch{message("Couldn't send invitation. Check workspace permissions and recipient.");}
  finally{button.disabled=false;}
});
get("mfa-enroll").addEventListener("click",async()=>{
  if(!csrfToken){message("Please sign in again.");return;}
  if(enrollmentFactorId){message("Complete or discard the current setup first.");return;}
  const button=get("mfa-enroll");button.disabled=true;
  try{
    const response=await request("/app/auth/mfa/totp/enroll",{},csrfToken);
    if(response.status===409){await loadMfaFactors();message("Discard the unfinished setup before adding another authenticator.");return;}
    if(response.status===429){message("Too many attempts. Please try again after the security cooldown (up to 15 minutes).");return;}
    if(!response.ok){message("Authenticator setup is unavailable. Please try again.");return;}
    const data=await response.json();
    if(typeof data.factorId!=="string" || typeof data.secret!=="string"
      || !/^[A-Z2-7]{16,128}$/.test(data.secret)){
      await loadMfaFactors();
      message("The setup response was incomplete. Please try again.");
      return;
    }
    enrollmentFactorId=data.factorId;
    mfaSecret.textContent=data.secret;
    const qr=typeof data.qrCodeDataUrl==="string" && data.qrCodeDataUrl.length<1500000
      && data.qrCodeDataUrl.startsWith("data:image/svg+xml;base64,")
      ? data.qrCodeDataUrl:"";
    if(qr){mfaQr.src=qr;mfaQr.hidden=false;mfaQrFallback.hidden=true;}
    else{mfaQr.removeAttribute("src");mfaQr.hidden=true;mfaQrFallback.hidden=false;}
    mfaEnrollment.hidden=false;
    mfaSetup.hidden=true;
    mfaRecovery.hidden=false;
    mfaForm.hidden=false;
    const option=document.createElement("option");
    option.value=data.factorId;option.textContent="New authenticator (finish setup)";
    mfaFactor.prepend(option);
    mfaFactor.value=data.factorId;
    mfaFactorPicker.hidden=mfaFactor.options.length<=1;
    mfaSummary.textContent="Scan the QR code or enter the key, then verify a six-digit code.";
    get("mfa-code").focus();
    message("");
  }catch{message("Connection interrupted. The setup may already exist. Reopen this page if necessary.");}
  finally{button.disabled=false;}
});
get("mfa-reset").addEventListener("click",async()=>{
  if(!csrfToken){message("Please sign in again.");return;}
  if(!window.confirm("Discard unfinished authenticator setup? Verified devices won't be removed."))return;
  const button=get("mfa-reset");button.disabled=true;
  try{
    const response=await request("/app/auth/mfa/totp/reset",{},csrfToken);
    if(!response.ok)throw Error("Reset unavailable");
    clearMfa();
    mfaPanel.hidden=false;
    await loadMfaFactors();
    message("Unfinished setup discarded.");
  }catch{message("Couldn't discard setup. Please try again.");}
  finally{button.disabled=false;}
});
mfaForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=get("mfa-submit");
  const factorId=mfaFactor.value;
  const code=get("mfa-code").value.trim();
  button.disabled=true;
  try{
    const response=await request("/app/auth/mfa/totp/verify",{factorId,code},csrfToken);
    if(!response.ok)throw Error("Authenticator verification failed");
    get("mfa-code").value="";
    const result=await response.json();
    // A successful challenge always completes the flow: no QR, code field,
    // factor list or setup controls remain on the workspace landing screen.
    clearMfa();
    showDashboard(result,false);
    message("");
  }catch{message("That authenticator code wasn't accepted. Try the current code.");}
  finally{button.disabled=false;}
});
async function logoutSession(){
  if(refreshInFlight!==null)await refreshInFlight;
  if(!csrfToken){showLogin("");return;}
  const generation=authEpoch;
  try{
    const response=await request("/app/auth/logout",{},csrfToken);
    if(generation!==authEpoch)return;
    if(!response.ok)throw Error("Sign-out unavailable");
    showLogin("");
    message("Signed out securely.");
  }catch{message("Couldn't sign out. Check your connection and try again.");}
}
get("sign-out").addEventListener("click",()=>{void logoutSession();});
get("gate-sign-out").addEventListener("click",()=>{void logoutSession();});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")void maintainSession();
  else if(refreshTimer!==null){clearTimeout(refreshTimer);refreshTimer=null;}
});
void initialize();`;
