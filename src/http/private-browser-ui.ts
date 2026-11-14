import { mfaModalHtml,mfaModalCss,mfaModalJs } from "./private-browser-mfa-modal.js";

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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Questrial&family=Lusitana:wght@400;700&display=swap">
<link rel="stylesheet" href="/app/auth/ui.css">
<script src="/app/auth/ui.js" defer></script>
</head><body>
<a class="skip-link" id="skip-link" href="#auth-main">Skip to main content</a>
<div id="boot-panel" class="boot-panel" role="status" aria-live="polite">
  <div class="brand"><span class="brand-symbol" aria-hidden="true">i</span><span>ISHIKEIT</span></div>
  <div id="boot-progress" class="boot-progress" aria-hidden="true" hidden></div>
  <p id="boot-slow-copy" class="muted" hidden>Opening Ishikeit…</p>
  <span class="sr-only">Loading Ishikeit</span>
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
      <button type="button" class="nav-item" id="nav-channels" hidden>Channels</button>
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

      <section id="channels-view" aria-labelledby="channels-heading" hidden>
        <p class="eyebrow">WORKSPACE CHANNELS</p>
        <h1 id="channels-heading">Connected accounts</h1>
        <p class="page-description">Review the accounts recorded for your current workspace.</p>
        <div class="channels-toolbar">
          <p id="channels-context" class="muted">Current workspace</p>
          <button type="button" id="channels-connect-instagram" class="secondary" hidden>Connect Instagram</button>
          <button type="button" id="channels-connect-whatsapp" class="secondary" hidden>Connect WhatsApp</button>
          <button type="button" id="channels-connect-messenger" class="secondary" hidden>Connect Messenger</button>
          <button type="button" id="channels-connect-telegram" class="secondary" hidden>Connect Telegram</button>
          <button type="button" id="channels-connect-tiktok" class="secondary" hidden>Connect TikTok</button>
          <button type="button" id="channels-refresh" class="secondary">Refresh status</button>
        </div>
        <p id="channels-note" class="muted channels-note">This list shows Ishikeit's internal connection status, not a live provider permission check. Account linking and sending remain unavailable until verified provider authorization is implemented.</p>
        <p id="channels-status" role="status" aria-live="polite" aria-atomic="true"></p>
        <div id="channels-list" class="channels-list" role="list" aria-label="Workspace accounts"></div>
        <button type="button" id="channels-more" class="secondary" hidden>Show more accounts</button>
      </section>

      <section id="security-view" aria-labelledby="security-heading" hidden>
        <p class="eyebrow">ACCOUNT SETTINGS</p>
        <h1 id="security-heading">Account security</h1>
        <p class="page-description">Manage how you verify your identity and protect your account.</p>
        ${mfaModalHtml}
        <article class="settings-card legacy-mfa-panel" hidden aria-labelledby="mfa-settings-heading">
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
              <span class="switch-label" id="mfa-account-switch-label">On</span>
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
            <p id="mfa-last-device-help" class="muted last-device-note" hidden>Keep at least one authenticator enabled so you can approve security changes and recover access.</p>
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
:root{
  /* Actual Qwery Nails light-scheme variables, read from the live generated skin CSS. */
  --ishi-cream:#FFF8F3;--ishi-paper:#FFFFFF;--ishi-blush:#F8E0D2;
  --ishi-border:#F8E0D2;--ishi-ink:#242530;--ishi-muted:#5A565F;
  --ishi-pink:#FFABB4;--ishi-pink-hover:#F18B96;
  --ishi-heading-font:"Lusitana",Georgia,serif;
  --ishi-body-font:"Questrial","Segoe UI",sans-serif;
  color-scheme:light;font-family:var(--ishi-body-font);
  font-synthesis:none;color:var(--ishi-ink);background:var(--ishi-cream);line-height:1.62
}
*{box-sizing:border-box}
html{min-height:100%}
body{margin:0;min-height:100vh}
[hidden]{display:none!important}
button,input,select{font:inherit}
button{min-height:44px;padding:10px 18px;border:1px solid var(--ishi-pink);border-radius:7px;
  background:var(--ishi-pink);color:var(--ishi-ink);font-weight:650;cursor:pointer;
  transition:background .15s ease,box-shadow .15s ease}
button:hover{background:var(--ishi-pink-hover);border-color:var(--ishi-pink-hover);color:var(--ishi-ink)}
button:disabled{cursor:not-allowed;opacity:.57}
button.secondary{background:#fff;color:var(--ishi-ink);border-color:var(--ishi-border)}
button.secondary:hover{background:var(--ishi-blush);color:var(--ishi-ink)}
button.text-button{background:transparent;color:var(--ishi-ink);border:0;padding:8px 4px;font-weight:650}
button.text-button:hover{text-decoration:underline;background:var(--ishi-blush);color:var(--ishi-ink)}
input,select{min-width:0;width:100%;min-height:48px;padding:11px 14px;
  border:1px solid #bbaeb6;border-radius:7px;background:#fff;color:var(--ishi-ink)}
input::placeholder{color:var(--ishi-muted)}
input:focus-visible,select:focus-visible,button:focus-visible,.skip-link:focus-visible{
  outline:3px solid var(--ishi-ink);outline-offset:3px}
form{display:grid;gap:12px}
form>button{margin-top:8px}
label{font-size:.9rem;font-weight:650;color:var(--ishi-ink)}
h1,h2,h3,p{margin-top:0}
h1,h2,h3{font-family:var(--ishi-heading-font);font-weight:400;letter-spacing:0}
h1{font-size:clamp(1.85rem,3vw,2.45rem);line-height:1.18;margin-bottom:12px}
h2{font-size:1.21rem;line-height:1.32;margin-bottom:7px}
h3{font-size:1.07rem;margin-bottom:8px}
p{margin-bottom:0}
.muted,.page-description{color:var(--ishi-muted)}
.page-description{font-size:1rem;margin-bottom:30px;max-width:620px}
.eyebrow{font-size:.73rem;font-weight:750;letter-spacing:.13em;color:var(--ishi-muted);margin-bottom:13px}
.brand{display:inline-flex;align-items:center;gap:10px;font-size:.92rem;letter-spacing:.16em;
  color:var(--ishi-ink);font-weight:750;white-space:nowrap}
.brand-symbol{display:grid;place-items:center;height:34px;width:34px;color:var(--ishi-ink);
  background:var(--ishi-pink);border-radius:7px;font-family:var(--ishi-heading-font);font-size:1.25rem;letter-spacing:0}
.skip-link{position:absolute;left:14px;top:-90px;padding:11px 16px;border-radius:8px;
  color:#fff;background:var(--ishi-ink);z-index:1000}
.skip-link:focus{top:12px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0,0,0,0);white-space:nowrap;border:0}
.boot-panel{position:relative;min-height:100vh;display:grid;place-content:center;justify-items:center;gap:20px;
  background:linear-gradient(145deg,var(--ishi-cream),var(--ishi-paper) 90%)}
.boot-progress{position:absolute;left:50%;top:calc(50% + 30px);transform:translateX(-50%);
  width:132px;height:3px;border-radius:999px;overflow:hidden;background:var(--ishi-blush)}
.boot-progress::before{content:"";display:block;width:42%;height:100%;border-radius:inherit;
  background:var(--ishi-pink-hover);animation:boot-progress-sweep 1.35s ease-in-out infinite}
@keyframes boot-progress-sweep{
  0%{transform:translateX(-110%)}
  50%{transform:translateX(105%)}
  100%{transform:translateX(255%)}
}
.boot-panel .muted{position:absolute;left:50%;top:calc(50% + 46px);
  transform:translateX(-50%);white-space:nowrap;font-size:.85rem}
.auth-shell{min-height:100vh;display:flex;flex-direction:column;align-items:center;
  justify-content:center;padding:36px 20px;background:linear-gradient(145deg,#FFF8F3,#FFFFFF 90%)}
.auth-brand{width:100%;max-width:464px;margin:0 auto 28px}
.auth-card{width:100%;max-width:464px;padding:clamp(26px,5vw,40px);background:#fff;
  border:1px solid var(--ishi-border);box-shadow:0 14px 45px rgba(36,37,48,.08);
  border-radius:12px}
.auth-card h1{font-size:clamp(1.8rem,4vw,2.1rem)}
.auth-card #auth-description{margin-bottom:28px;line-height:1.6}
.auth-footnote{margin-top:24px;color:var(--ishi-muted);font-size:.79rem}
.auth-footer{color:var(--ishi-muted);font-size:.78rem;margin-top:28px;text-align:center}
#login-panel,#mfa-gate{display:grid;gap:16px}
.auth-switch-account{justify-self:center;margin-top:10px}
.mfa-content{display:grid;gap:18px}
.mfa-content form{gap:12px}
.mfa-content #mfa-summary{font-size:.91rem}
.mfa-content #mfa-setup{display:grid}
.mfa-content #mfa-recovery,.mfa-content #mfa-enrollment{display:grid;gap:13px}
.notice{padding:16px;border:1px solid #e4d6d6;background:#fcf6f5;border-radius:12px;font-size:.89rem}
.notice button{justify-self:start}
#mfa-enrollment{padding:18px;background:var(--ishi-cream);border:1px solid var(--ishi-border);border-radius:13px}
.mfa-qr{display:block;width:min(100%,240px);height:auto;aspect-ratio:1;
  image-rendering:pixelated;background:#fff;padding:9px;border:1px solid var(--ishi-border);border-radius:8px;margin:3px auto}
.mfa-secret{display:block;max-width:100%;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  font-size:.95rem;font-weight:700;letter-spacing:.05em;user-select:all;
  background:var(--ishi-blush);color:var(--ishi-ink);border-radius:8px;padding:13px}
.key-label{display:block;margin-bottom:-6px}
.dashboard-shell{min-height:100vh;background:var(--ishi-cream)}
.topbar{height:74px;position:sticky;top:0;z-index:40;display:flex;align-items:center;
  justify-content:space-between;gap:20px;padding:0 clamp(20px,4vw,42px);
  border-bottom:1px solid var(--ishi-border);background:#fff}
.topbar-brand{display:flex;align-items:center;min-width:0;gap:22px}
.topbar-divider{height:25px;width:1px;background:var(--ishi-border)}
.topbar-workspace{color:var(--ishi-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.91rem;font-weight:590}
.account-area{position:relative;flex-shrink:0}
.account-button{border:1px solid transparent;background:transparent;color:var(--ishi-ink);
  display:flex;align-items:center;gap:10px;font-size:.87rem;font-weight:650;padding:7px 12px}
.account-button:hover{background:var(--ishi-blush);color:var(--ishi-ink)}
.account-avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--ishi-blush);color:var(--ishi-ink);font-size:.82rem}
.chevron{font-size:1.2rem;color:var(--ishi-muted);line-height:1}
.account-menu{position:absolute;right:0;top:calc(100% + 10px);width:220px;
  background:#fff;border:1px solid var(--ishi-border);border-radius:9px;box-shadow:0 17px 48px rgba(36,37,48,.14);padding:6px;display:grid;gap:2px;z-index:60}
.account-menu button{border:0;background:transparent;color:var(--ishi-ink);text-align:left;font-weight:550;
  min-height:44px;padding:11px 13px}
.account-menu button:hover{background:var(--ishi-blush);color:var(--ishi-ink)}
.app-layout{display:grid;grid-template-columns:228px minmax(0,1fr);max-width:1480px;margin:0 auto;min-height:calc(100vh - 74px)}
.sidebar{border-right:1px solid var(--ishi-border);padding:30px 17px;display:flex;flex-direction:column;gap:5px}
.sidebar-label{font-size:.7rem;letter-spacing:.13em;font-weight:750;color:var(--ishi-muted);padding:7px 14px 10px}
.sidebar-label-secondary{margin-top:25px}
.nav-item{color:var(--ishi-ink);background:transparent;border:0;font-weight:590;text-align:left;min-height:45px;border-radius:9px;padding:10px 14px}
.nav-item:hover{background:var(--ishi-blush);color:var(--ishi-ink)}
.nav-item[aria-current="page"]{background:var(--ishi-blush);color:var(--ishi-ink);font-weight:750}
.main-content{min-width:0;width:100%;max-width:1000px;padding:clamp(30px,5vw,62px) clamp(20px,5vw,64px) 80px}
.main-content h1{margin-bottom:10px}
.feature-card,.settings-card{background:#fff;border:1px solid var(--ishi-border);border-radius:10px;box-shadow:0 6px 20px rgba(36,37,48,.035)}
.feature-card{display:flex;align-items:center;gap:17px;padding:24px;margin-top:18px}
.workspace-icon{flex-shrink:0;display:grid;place-items:center;width:54px;height:54px;
  font-size:1.3rem;font-weight:750;background:var(--ishi-blush);color:var(--ishi-ink);border-radius:9px}
.feature-card-body{min-width:0;flex:1}
.feature-card-body h2{font-size:1.1rem;margin-bottom:3px;overflow-wrap:anywhere}
.feature-card-body p{font-size:.88rem}
.state-label{font-size:.77rem;font-weight:750;color:#356f58;background:#e7f4ee;border-radius:99px;padding:6px 11px;white-space:nowrap}
.next-section{margin-top:34px;max-width:650px;padding:24px;background:#fff;border:1px solid var(--ishi-border);border-radius:10px}
.next-section h2{font-size:1rem;margin-bottom:8px}
.next-section p{font-size:.91rem;line-height:1.65;color:var(--ishi-muted)}
.settings-card{padding:clamp(22px,4vw,30px);max-width:720px}
.settings-card-head{display:flex;align-items:center;gap:15px;flex-wrap:wrap;margin-bottom:24px}
.settings-card-head>div{flex:1;min-width:160px}
.settings-card-head p{font-size:.88rem}
.security-icon{display:grid;place-items:center;width:46px;height:46px;border-radius:9px;background:var(--ishi-blush);color:var(--ishi-ink);font-size:1.25rem}
.security-detail{margin-top:23px;padding-top:22px;border-top:1px solid var(--ishi-border)}
.security-footnote{max-width:570px;font-size:.88rem;line-height:1.55;margin:-8px 0 27px}
.devices-section{padding-top:23px;border-top:1px solid var(--ishi-border)}
.devices-title-row{display:flex;align-items:center;justify-content:space-between;
  flex-wrap:wrap;gap:16px;margin-bottom:18px}
.devices-title-row>div{flex:1;min-width:210px}
.devices-title-row h3{font-size:1.08rem;margin-bottom:5px}
.devices-title-row p{font-size:.86rem}
.devices-title-row button{white-space:normal;flex-shrink:0}
.device-list{display:grid;gap:10px}
.device-row{display:flex;align-items:center;justify-content:space-between;gap:15px;
  border:1px solid var(--ishi-border);background:#fff;border-radius:8px;padding:16px}
.device-info{min-width:0;flex:1}
.device-info strong{display:block;font-size:.93rem;font-weight:700;overflow-wrap:anywhere}
.device-info p{margin-top:3px;font-size:.8rem}
.security-switch{display:inline-flex;align-items:center;justify-content:center;gap:10px;
  flex-shrink:0;min-height:44px;padding:8px 12px;color:var(--ishi-ink);background:#fff;
  border:1px solid var(--ishi-border);border-radius:8px;font-size:.84rem}
.security-switch:hover{background:var(--ishi-blush);color:var(--ishi-ink)}
.security-switch:disabled{cursor:not-allowed;opacity:.6}
.security-switch .switch-track{display:flex;align-items:center;width:40px;height:23px;
  padding:3px;background:#777B81;border-radius:99px;transition:background .15s ease}
.security-switch .switch-track span{width:17px;height:17px;border-radius:50%;
  background:white;box-shadow:0 1px 3px #0003;transition:transform .15s ease}
.security-switch[aria-checked="true"] .switch-track{background:var(--ishi-ink)}
.security-switch[aria-checked="true"] .switch-track span{transform:translateX(17px)}
.security-switch .switch-label{min-width:24px}
.last-device-note{margin-top:12px;font-size:.83rem;line-height:1.5}
.security-proof{background:var(--ishi-cream);border:1px solid var(--ishi-border);border-radius:9px;
  padding:20px;margin-top:23px}
.security-proof .muted{font-size:.87rem;margin:0 0 16px}
.security-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.security-actions button{flex:1 1 140px}
#mfa-settings-slot{max-width:580px}
#mfa-cancel{justify-self:stretch}

.workspace-switcher{max-width:420px;margin-bottom:22px;display:grid;gap:8px}
.channels-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;margin:22px 0 12px}
.channels-toolbar .muted{margin:0}
.channels-note{line-height:1.55;max-width:76ch}
#channels-status{min-height:1.5em;margin:18px 0;color:var(--ishi-muted)}
.channels-list{display:grid;gap:12px;margin-bottom:18px}
.channel-row{padding:18px 20px;border:1px solid var(--ishi-border);border-radius:12px;background:#fff;display:flex;align-items:flex-start;justify-content:space-between;gap:15px}
.channel-info{min-width:0;display:grid;gap:6px}
.channel-info strong{font-size:1rem;overflow-wrap:anywhere}
.channel-info p{margin:0;overflow-wrap:anywhere}
.channel-state{flex-shrink:0;max-width:45%;text-align:right;border:1px solid var(--ishi-border);border-radius:999px;padding:6px 11px;font-size:.82rem;font-weight:650;line-height:1.4;overflow-wrap:anywhere;background:var(--ishi-blush)}
@media(max-width:460px){.channel-row{flex-direction:column}.channel-state{max-width:100%;text-align:left}}
.toast{position:fixed;bottom:20px;right:20px;z-index:90;max-width:min(420px,calc(100vw - 40px));
  color:#fff;background:var(--ishi-ink);padding:13px 18px;border-radius:9px;
  box-shadow:0 12px 36px rgba(36,37,48,.25);font-size:.9rem;overflow-wrap:anywhere}
@media(max-width:760px){
  .topbar{height:68px;padding:0 17px}
  .topbar-brand{gap:12px}
  .topbar-divider{display:none}
  .topbar-workspace{display:none}
  .app-layout{display:block}
  .sidebar{flex-direction:row;flex-wrap:wrap;gap:7px;border-right:0;border-bottom:1px solid var(--ishi-border);padding:12px 15px}
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
@media(prefers-reduced-motion:reduce){
  .boot-progress::before{width:100%;transform:none}
  *{animation:none!important;transition:none!important}
}
.legacy-mfa-panel[hidden]{display:none!important}
${mfaModalCss}
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
const bootProgress=get("boot-progress");
const bootSlowCopy=get("boot-slow-copy");
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
const mfaLastDeviceHelp=get("mfa-last-device-help");
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
const channelsList=get("channels-list");
const channelsStatus=get("channels-status");
const channelsMore=get("channels-more");
const channelsRefresh=get("channels-refresh");
const channelsConnectInstagram=get("channels-connect-instagram");
const channelsConnectWhatsApp=get("channels-connect-whatsapp");
const channelsConnectMessenger=get("channels-connect-messenger");
const channelsConnectTelegram=get("channels-connect-telegram");
const channelsConnectTikTok=get("channels-connect-tiktok");
const channelsNote=get("channels-note");
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
let instagramConnectEnabled=false;
let whatsappEmbeddedV4Enabled=false;
let messengerConnectEnabled=false;
let telegramConnectEnabled=false;
let tiktokConnectEnabled=false;
let connectionsEpoch=0;
let connectionsLoading=false;
let connectionsNext=null;
let mfaState=null;
let securityChange=null;
let lastPendingCount=0;
let mfaRetryTimer=null;
// Keep the initial check invisible during normal fast navigation. Show a
// lightweight progress line after a perceptible wait and a plain-language
// explanation only if opening the app is unusually slow.
let bootProgressTimer=setTimeout(()=>{
  bootProgressTimer=null;
  if(mode==="boot")bootProgress.hidden=false;
},900);
let bootSlowTimer=setTimeout(()=>{
  bootSlowTimer=null;
  if(mode==="boot")bootSlowCopy.hidden=false;
},4000);
function finishBoot(){
  if(bootProgressTimer!==null){
    clearTimeout(bootProgressTimer);bootProgressTimer=null;
  }
  if(bootSlowTimer!==null){
    clearTimeout(bootSlowTimer);bootSlowTimer=null;
  }
  bootPanel.hidden=true;
}

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
  lastPendingCount=0;
  mfaDevices.replaceChildren();
  mfaDevicesEmpty.textContent="Loading authenticators…";
  mfaLastDeviceHelp.hidden=true;
  mfaAccountToggle.disabled=true;
}
function resetConnections(){
  connectionsEpoch++;
  connectionsLoading=false;
  connectionsNext=null;
  channelsList.replaceChildren();
  channelsStatus.textContent="";
  channelsMore.hidden=true;
  channelsMore.disabled=false;
  channelsRefresh.disabled=false;
  channelsConnectInstagram.disabled=false;
  channelsConnectTelegram.disabled=false;
  channelsConnectTikTok.disabled=false;
}
function channelsAllowed(){
  const workspace=workspaceRows.find(item=>item.workspaceId===currentWorkspaceId);
  return workspace && (workspace.role==="owner" || workspace.role==="admin");
}
function channelStatusLabel(value){
  const labels={
    verifying:"Verification pending",
    connected:"Connected in Ishikeit",
    attention_required:"Needs attention",
    paused:"Paused",
    disconnecting:"Disconnect requested",
    disconnected:"Disconnected",
    revoked:"Access revoked"
  };
  return Object.hasOwn(labels,value)?labels[value]:"Status unavailable";
}
async function loadConnections(more){
  if(mode!=="dashboard" || selectedPanel!=="channels"
     || !channelsAllowed() || connectionsLoading)return;
  if(!more)resetConnections();
  else if(!connectionsNext)return;
  const generation=connectionsEpoch;
  const session=authEpoch;
  const workspaceId=currentWorkspaceId;
  const cursor=more?connectionsNext:null;
  const stillCurrent=()=>generation===connectionsEpoch && session===authEpoch
    && mode==="dashboard" && selectedPanel==="channels"
    && workspaceId===currentWorkspaceId;
  connectionsLoading=true;
  channelsRefresh.disabled=true;
  channelsMore.disabled=true;
  channelsStatus.textContent=more?"Loading more accounts…":"Loading accounts…";
  try{
    const path="/app/auth/workspaces/"+encodeURIComponent(workspaceId)
      +"/connections"+(cursor?"?after="+encodeURIComponent(cursor):"");
    const response=await fetch(path,{credentials:"same-origin",
      cache:"no-store",redirect:"error"});
    if(!stillCurrent())return;
    if(response.status===401){showLogin("Your session ended. Sign in to continue.");return;}
    if(!response.ok)throw Error("Account inventory unavailable");
    const data=await response.json();
    if(!stillCurrent())return;
    const allowedStatuses=new Set(["verifying","connected","attention_required",
      "paused","disconnecting","disconnected","revoked"]);
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(!data || !Array.isArray(data.items) || data.items.length>20
      || (data.nextCursor!==undefined &&
        (typeof data.nextCursor!=="string" || !uuid.test(data.nextCursor)
         || data.nextCursor===cursor))
      || data.items.some(row=>!row || row.workspaceId!==workspaceId
        || typeof row.provider!=="string" || row.provider.length>128
        || typeof row.accountId!=="string" || row.accountId.length>256
        || typeof row.connectionId!=="string" || !uuid.test(row.connectionId)
        || !allowedStatuses.has(row.status) || !Number.isSafeInteger(row.generation)
        || row.generation<1))
      throw Error("Invalid account inventory");
    for(const record of data.items){
      const card=document.createElement("article");
      card.className="channel-row";card.setAttribute("role","listitem");
      const info=document.createElement("div");info.className="channel-info";
      const title=document.createElement("strong");title.textContent=record.provider;
      const id=document.createElement("p");id.className="muted";
      id.textContent="Provider account ID: "+record.accountId;
      const generationText=document.createElement("p");
      generationText.className="muted";
      generationText.textContent="Registry generation "+record.generation;
      info.append(title,id,generationText);
      const state=document.createElement("span");state.className="channel-state";
      state.textContent=channelStatusLabel(record.status);
      card.append(info,state);
      if(instagramConnectEnabled && record.provider==="instagram" &&
         record.status==="verifying"){
        const activate=document.createElement("button");
        activate.type="button";activate.className="secondary";
        activate.textContent="Confirm Instagram activation";
        activate.setAttribute("aria-label","Confirm activation for Instagram account "+record.accountId);
        activate.addEventListener("click",async()=>{
          if(!channelsAllowed() || !instagramConnectEnabled ||
             record.workspaceId!==currentWorkspaceId || mode!=="dashboard")return;
          activate.disabled=true;
          channelsStatus.textContent="Checking this account with Instagram…";
          try{
            const result=await request("/app/auth/workspaces/"+
              encodeURIComponent(record.workspaceId)+"/connections/"+
              encodeURIComponent(record.connectionId)+"/activate",{},csrfToken);
            if(!result.ok)throw Error("Activation unavailable");
            channelsStatus.textContent="Account confirmed. Automation remains disabled until tenant routing is approved.";
            void loadConnections(false);
          }catch{
            activate.disabled=false;
            channelsStatus.textContent="Activation could not be verified. Try again after checking your account permission.";
          }
        });
        card.append(activate);
      }
      if(whatsappEmbeddedV4Enabled && record.provider==="whatsapp" &&
         record.status==="verifying"){
        const activate=document.createElement("button");
        activate.type="button";activate.className="secondary";
        activate.textContent="Confirm WhatsApp number";
        activate.setAttribute("aria-label","Confirm WhatsApp number "+record.accountId);
        activate.addEventListener("click",async()=>{
          if(!whatsappEmbeddedV4Enabled||!channelsAllowed()||
            record.workspaceId!==currentWorkspaceId||
            mode!=="dashboard"||!csrfToken)return;
          activate.disabled=true;
          channelsStatus.textContent="Rechecking the WhatsApp number with Meta…";
          try{
            const response=await request(
              "/app/auth/workspaces/"+encodeURIComponent(record.workspaceId)+
              "/connections/"+encodeURIComponent(record.connectionId)+
              "/whatsapp-activate",{},csrfToken);
            if(!response.ok)throw Error("Activation denied");
            channelsStatus.textContent="WhatsApp number confirmed. Messages, number registration and "+
              "webhook subscriptions remain disabled until separate provider approval.";
            void loadConnections(false);
          }catch{
            activate.disabled=false;
            channelsStatus.textContent="WhatsApp number could not be verified. Check your provider rights.";
          }
        });
        card.append(activate);
      }
      if(messengerConnectEnabled && record.provider==="messenger" &&
         record.status==="verifying"){
        const activate=document.createElement("button");
        activate.type="button";activate.className="secondary";
        activate.textContent="Confirm Messenger Page";
        activate.setAttribute("aria-label","Confirm Messenger Page "+record.accountId);
        activate.addEventListener("click",async()=>{
          if(!messengerConnectEnabled||!channelsAllowed()||
            record.workspaceId!==currentWorkspaceId||
            mode!=="dashboard"||!csrfToken)return;
          activate.disabled=true;
          channelsStatus.textContent="Verifying your Page with Meta…";
          try{
            const response=await request(
              "/app/auth/workspaces/"+encodeURIComponent(record.workspaceId)+
              "/connections/"+encodeURIComponent(record.connectionId)+
              "/messenger-activate",{},csrfToken);
            if(!response.ok)throw Error("Page activation denied");
            channelsStatus.textContent="Page verified. Automation remains disabled until tenant routing is approved.";
            void loadConnections(false);
          }catch{
            activate.disabled=false;
            channelsStatus.textContent="Messenger Page verification unavailable. Check current Page permissions and try again.";
          }
        });
        card.append(activate);
      }
      if(telegramConnectEnabled && record.provider==="telegram" &&
         record.status==="verifying"){
        const form=document.createElement("form");
        form.className="channel-telegram-confirm";
        const label=document.createElement("label");
        label.textContent="Telegram Business connection ID";
        const businessInput=document.createElement("input");
        businessInput.type="text";businessInput.required=true;
        businessInput.maxLength=256;businessInput.minLength=5;
        businessInput.autocomplete="off";businessInput.spellcheck=false;
        businessInput.placeholder="Business connection ID";
        const submit=document.createElement("button");
        submit.type="submit";submit.className="secondary";
        submit.textContent="Verify Telegram Business";
        label.append(businessInput);form.append(label,submit);
        form.addEventListener("submit",async event=>{
          event.preventDefault();
          if(!telegramConnectEnabled || !channelsAllowed() ||
             record.workspaceId!==currentWorkspaceId ||
             mode!=="dashboard" || !csrfToken)return;
          const candidate=businessInput.value.trim();
          if(candidate.length<5 || candidate.length>256 ||
             /[\\x00-\\x1f\\x7f]/u.test(candidate)){
            channelsStatus.textContent="Enter a valid Telegram Business connection ID.";
            return;
          }
          submit.disabled=true;
          channelsStatus.textContent="Checking your Telegram Business connection…";
          try{
            const response=await request(
              "/app/auth/workspaces/"+encodeURIComponent(record.workspaceId)+
              "/connections/"+encodeURIComponent(record.connectionId)+
              "/telegram-business",
              {businessConnectionId:candidate},csrfToken
            );
            if(!response.ok)throw Error("Business verification refused");
            businessInput.value="";
            channelsStatus.textContent="Telegram Business readback confirmed for your account. Automation remains inactive until tenant routing is approved.";
            void loadConnections(false);
          }catch{
            submit.disabled=false;businessInput.value="";
            channelsStatus.textContent="Telegram Business connection was not verified. Confirm the owner and granted rights in Telegram and try again.";
          }
        });
        card.append(form);
      }
      if(tiktokConnectEnabled && record.provider==="tiktok" &&
         record.status==="verifying"){
        const activate=document.createElement("button");
        activate.type="button";activate.className="secondary";
        activate.textContent="Verify TikTok account";
        activate.setAttribute("aria-label","Verify TikTok account "+record.accountId);
        activate.addEventListener("click",async()=>{
          if(!tiktokConnectEnabled || !channelsAllowed() ||
             record.workspaceId!==currentWorkspaceId ||
             mode!=="dashboard" || !csrfToken)return;
          activate.disabled=true;
          channelsStatus.textContent="Confirming your TikTok account ownership and eligibility…";
          try{
            const response=await request(
              "/app/auth/workspaces/"+encodeURIComponent(record.workspaceId)+
              "/connections/"+encodeURIComponent(record.connectionId)+
              "/tiktok-activate",{},csrfToken
            );
            if(!response.ok)throw Error("TikTok account verification unavailable");
            channelsStatus.textContent="TikTok account readback verified. Messaging automation remains disabled until the app has approved messaging access.";
            void loadConnections(false);
          }catch{
            activate.disabled=false;
            channelsStatus.textContent="TikTok account could not be verified. Check the provider account authorization and try again.";
          }
        });
        card.append(activate);
      }
      channelsList.append(card);
    }
    connectionsNext=data.nextCursor===undefined?null:data.nextCursor;
    channelsMore.hidden=connectionsNext===null;
    channelsStatus.textContent=channelsList.children.length===0
      ?"No accounts have been linked to this workspace yet."
      :"Showing "+channelsList.children.length+" account registry record(s).";
  }catch{
    if(!stillCurrent())return;
    channelsList.replaceChildren();
    connectionsNext=null;
    channelsMore.hidden=true;
    channelsStatus.textContent="Couldn't load accounts. Try refreshing this page.";
  }finally{
    if(stillCurrent()){
      connectionsLoading=false;
      channelsRefresh.disabled=false;
      channelsMore.disabled=false;
    }
  }
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
  resetConnections();
  clearMfa();
  closeAccountMenu();
  mfaGateSlot.append(mfaPanel);
  mfaGate.hidden=true;
  loginPanel.hidden=false;
  authShell.hidden=false;
  dashboardShell.hidden=true;
  finishBoot();
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
  finishBoot();
  dashboardShell.hidden=true;
  authShell.hidden=false;
  loginPanel.hidden=true;
  mfaGate.hidden=false;
  csrfToken=data.csrfToken;
  workspaceRows=[];
  currentWorkspaceId="";
  invitingEnabled=false;
  resetConnections();
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
  get("nav-channels").hidden=!channelsAllowed();
  get("channels-context").textContent="Workspace: "+name;
  channelsConnectInstagram.hidden=!(instagramConnectEnabled && channelsAllowed());
  channelsConnectWhatsApp.hidden=!(whatsappEmbeddedV4Enabled && channelsAllowed());
  channelsConnectMessenger.hidden=!(messengerConnectEnabled && channelsAllowed());
  channelsConnectTikTok.hidden=!(tiktokConnectEnabled && channelsAllowed());
  channelsConnectTelegram.hidden=!(telegramConnectEnabled && channelsAllowed());
  channelsNote.textContent=(instagramConnectEnabled||whatsappEmbeddedV4Enabled||
    messengerConnectEnabled||tiktokConnectEnabled||
    telegramConnectEnabled)
    ?"Provider account authentication is separate from messaging permission. Confirm any provider Business connection separately. The registry does not activate messaging or automation."
    :"This is a private registry inventory, not a live provider permission check. Account onboarding and sending are currently unavailable.";
}
function showPanel(panel){
  if(mode!=="dashboard")return;
  if(panel==="team" && !invitingEnabled)panel="overview";
  if(panel==="channels" && !channelsAllowed())panel="overview";
  if(selectedPanel==="channels" && panel!=="channels")resetConnections();
  selectedPanel=panel;
  get("overview-view").hidden=panel!=="overview";
  get("channels-view").hidden=panel!=="channels";
  get("team-view").hidden=panel!=="team";
  get("security-view").hidden=panel!=="security";
  for(const item of ["overview","channels","team","security"]){
    const button=get("nav-"+item);
    if(item===panel)button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
  }
  closeAccountMenu();
  message("");
  // Security settings and verified device switches are visible upon entering
  // the page; no "Set up" or hidden accordion is needed to list them.
  if(panel==="security")void loadMfaFactors();
  if(panel==="channels")void loadConnections(false);
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
  instagramConnectEnabled=data.instagramConnectEnabled===true;
  whatsappEmbeddedV4Enabled=data.whatsappEmbeddedV4Enabled===true;
  messengerConnectEnabled=data.messengerConnectEnabled===true;
  telegramConnectEnabled=data.telegramConnectEnabled===true;
  tiktokConnectEnabled=data.tiktokConnectEnabled===true;
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
  if(!channelsAllowed() && selectedPanel==="channels"){
    resetConnections();
    selectedPanel="overview";
  }
  authShell.hidden=true;
  dashboardShell.hidden=false;
  finishBoot();
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
function renderMfaDeviceList(data){
  if(mode!=="dashboard")return;
  const raw=Array.isArray(data.devices)?data.devices:[];
  const devices=raw.filter(item=>item && typeof item.factorId==="string"
    && typeof item.label==="string" && typeof item.enabled==="boolean");
  mfaState={devices,signIn2faEnabled:data.signIn2faEnabled!==false,
    canEnroll:data.canEnroll===true,pendingCount:data.pendingCount||0};
  const on=mfaState.signIn2faEnabled;
  mfaAccountToggle.setAttribute("aria-checked",on?"true":"false");
  get("mfa-account-switch-label").textContent=on?"On":"Off";
  mfaAccountDescription.textContent=on
    ?"An authenticator code is required when you sign in."
    :"Sign-in requires only your email code. Security changes still need an authenticator.";
  mfaAccountToggle.disabled=devices.length===0;
  mfaDevices.replaceChildren();
  const count=devices.filter(item=>item.enabled).length;
  mfaLastDeviceHelp.hidden=!(devices.length>0 && count===1);
  for(const device of devices){
    const row=document.createElement("div");row.className="device-row";
    const information=document.createElement("div");information.className="device-info";
    const heading=document.createElement("strong");heading.textContent=device.label;
    const details=document.createElement("p");details.className="muted";
    let date="";
    if(typeof device.enrolledAt==="string"){
      const parsed=Date.parse(device.enrolledAt);
      if(Number.isFinite(parsed))
        date=" · Added "+new Date(parsed).toLocaleDateString(undefined,{dateStyle:"medium"});
    }
    details.textContent=(device.enabled?"Enabled":"Disabled")+date;
    information.append(heading,details);
    const control=document.createElement("button");
    control.type="button";control.className="security-switch";
    control.setAttribute("role","switch");
    control.setAttribute("aria-checked",device.enabled?"true":"false");
    // The WAI-ARIA switch's accessible name must stay stable across state changes.
    control.setAttribute("aria-label",device.label);
    const track=document.createElement("span");track.className="switch-track";
    track.setAttribute("aria-hidden","true");
    track.append(document.createElement("span"));
    const text=document.createElement("span");text.className="switch-label";
    text.textContent=device.enabled?"On":"Off";
    control.append(track,text);
    // At least one usable authenticator must remain for privileged actions
    // and recovery, even if sign-in MFA is switched off.
    control.disabled=device.enabled && count<=1;
    if(control.disabled){
      control.setAttribute("aria-describedby","mfa-last-device-help");
      control.title="Keep at least one authenticator enabled for security and recovery.";
    }
    control.addEventListener("click",()=>{
      openSecurityChange({kind:"factor",factorId:device.factorId,
        enabled:!device.enabled,label:device.label});
    });
    row.append(information,control);
    mfaDevices.append(row);
  }
  mfaDevicesEmpty.hidden=devices.length>0;
  mfaDevicesEmpty.textContent=devices.length===0
    ?"No authenticators have been added yet.":"";
}
function openSecurityChange(mutation){
  if(mode!=="dashboard" || !csrfToken || !mfaState)return;
  if(enrollmentFactorId){
    message("Finish or cancel the authenticator setup before changing security settings.");
    return;
  }
  const devices=mfaState.devices;
  const options=devices.filter(item=>item.enabled
    && !(mutation.kind==="factor" && !mutation.enabled
      && item.factorId===mutation.factorId));
  if(!options.length){
    message("Keep another authenticator enabled before disabling this one.");
    return;
  }
  securityChange=mutation;
  mfaProofFactor.replaceChildren();
  for(const device of options){
    const option=document.createElement("option");
    option.value=device.factorId;option.textContent=device.label;
    mfaProofFactor.append(option);
  }
  get("mfa-change-code").value="";
  const verb=mutation.enabled?"Enable":"Disable";
  const subject=mutation.kind==="sign_in"?"two-step verification for sign-in":mutation.label;
  get("mfa-change-title").textContent=mutation.kind==="enroll"
    ?"Verify to add an authenticator":verb+" "+subject;
  get("mfa-change-description").textContent=mutation.kind==="sign_in" && !mutation.enabled
    ?"Future sign-ins will use your email code without a second step. An authenticator remains required for sensitive changes. Other sessions will be signed out."
    :"For your protection, enter a fresh code from an enabled authenticator. Other signed-in sessions will be signed out.";
  get("mfa-change-confirm").textContent=verb+" and confirm";
  mfaChangePanel.hidden=false;
  get("mfa-change-code").focus();
  message("");
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
    lastPendingCount=pending;
    const canEnroll=data.canEnroll===true;
    const keepPending=!!enrollmentFactorId && !!mfaSecret.textContent;
    if(mode==="dashboard")renderMfaDeviceList(data);
    mfaFactor.replaceChildren();
    if(keepPending){
      const item=document.createElement("option");
      item.value=enrollmentFactorId;
      item.textContent="New authenticator (finish setup)";
      mfaFactor.append(item);
    }
    for(let i=0;i<ids.length;i++){
      const device=Array.isArray(data.devices)
        ? data.devices.find(item=>item.factorId===ids[i]):undefined;
      const option=document.createElement("option");
      option.value=ids[i];
      option.textContent=device && typeof device.label==="string"
        ? device.label:"Authenticator "+String(i+1);
      mfaFactor.append(option);
    }
    if(keepPending)mfaFactor.value=enrollmentFactorId;
    mfaForm.hidden=!(keepPending || (mode==="gate" && ids.length>0));
    mfaFactorPicker.hidden=mfaFactor.options.length<=1;
    mfaEnrollment.hidden=!keepPending;
    mfaSetup.hidden=!(mode==="gate" && canEnroll && !keepPending && pending===0);
    const interrupted=pending>0 && !keepPending && canEnroll;
    mfaPendingHelp.hidden=!(interrupted && (mode==="gate" || !mfaSettingsSlot.hidden));
    mfaCancel.hidden=!(keepPending || (interrupted && (mode==="gate" || !mfaSettingsSlot.hidden)));
    mfaSummary.textContent=keepPending
      ?"Scan the QR code or enter the setup key, then verify the current six-digit code."
      :mode==="gate" && ids.length>0
        ?"Select an authenticator and enter its current code."
        :interrupted
          ?"Cancel this setup to start a new one."
          :"";
    mfaPanel.hidden=mode==="dashboard"
      && !keepPending && mfaPendingHelp.hidden;
    if(mode==="dashboard" && !mfaPanel.hidden)mfaSettingsSlot.hidden=false;
  }catch{
    if(generation!==mfaGeneration || (mode!=="gate" && mode!=="dashboard"))return;
    if(!enrollmentFactorId){
      mfaForm.hidden=true;mfaSetup.hidden=true;mfaPendingHelp.hidden=true;
      mfaCancel.hidden=true;
    }
    if(mode==="dashboard"){
      mfaDevicesEmpty.hidden=false;
      mfaDevicesEmpty.textContent="Couldn't load authenticators. Checking again…";
      mfaAccountToggle.disabled=true;
    }else mfaSummary.textContent="Checking your authenticators again…";
    if(!retried){
      mfaRetryTimer=setTimeout(()=>{
        mfaRetryTimer=null;
        if(generation===mfaGeneration)void loadMfaFactors(true);
      },2200);
    }else{
      if(mode==="dashboard")
        mfaDevicesEmpty.textContent="Authenticators are temporarily unavailable. Reload to reconnect.";
      else mfaSummary.textContent="Authenticator information is temporarily unavailable. Reload this page to reconnect.";
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
get("nav-channels").addEventListener("click",()=>showPanel("channels"));
get("nav-security").addEventListener("click",openSecurity);
get("nav-team").addEventListener("click",()=>showPanel("team"));
get("workspace-select").addEventListener("change",()=>{
  const value=get("workspace-select").value;
  if(workspaceRows.some(item=>item.workspaceId===value)){
    currentWorkspaceId=value;renderWorkspace();
    if(selectedPanel==="channels"){
      resetConnections();
      if(channelsAllowed())void loadConnections(false);
      else showPanel("overview");
    }
  }
});
channelsConnectInstagram.addEventListener("click",async()=>{
  if(!instagramConnectEnabled || !channelsAllowed() || mode!=="dashboard" ||
     !csrfToken || !currentWorkspaceId)return;
  const workspaceId=currentWorkspaceId;
  channelsConnectInstagram.disabled=true;
  channelsStatus.textContent="Opening Instagram authorization…";
  try{
    const response=await request("/app/auth/workspaces/"+
      encodeURIComponent(workspaceId)+"/connections/instagram/start",{},csrfToken);
    if(workspaceId!==currentWorkspaceId || mode!=="dashboard")return;
    if(!response.ok)throw Error("Authorization unavailable");
    const data=await response.json();
    const url=new URL(data.authorizationUrl);
    if(url.origin!=="https://www.instagram.com" ||
      url.pathname!=="/oauth/authorize")throw Error("Invalid provider authorization");
    window.location.assign(url.toString());
  }catch{
    if(workspaceId===currentWorkspaceId && mode==="dashboard"){
      channelsConnectInstagram.disabled=false;
      channelsStatus.textContent="Instagram authorization could not be started. Check your permissions and try again.";
    }
  }
});
channelsConnectWhatsApp.addEventListener("click",()=>{
  if(!whatsappEmbeddedV4Enabled||!channelsAllowed()||mode!=="dashboard"||
    !csrfToken||!currentWorkspaceId)return;
  const workspaceId=currentWorkspaceId;
  channelsConnectWhatsApp.disabled=true;
  // Meta's official Embedded Signup v4 JS SDK must launch from an actual
  // user gesture on its dedicated first-party CSP page, not here after fetch.
  window.location.assign("/app/auth/workspaces/"+
    encodeURIComponent(workspaceId)+"/whatsapp/signup");
});
channelsConnectMessenger.addEventListener("click",async()=>{
  if(!messengerConnectEnabled||!channelsAllowed()||mode!=="dashboard"||
    !csrfToken||!currentWorkspaceId)return;
  const workspaceId=currentWorkspaceId;
  channelsConnectMessenger.disabled=true;
  channelsStatus.textContent="Opening authorized Facebook Page login…";
  try{
    const response=await request("/app/auth/workspaces/"+
      encodeURIComponent(workspaceId)+"/connections/messenger/start",{},csrfToken);
    if(workspaceId!==currentWorkspaceId||mode!=="dashboard")return;
    if(!response.ok)throw Error("Messenger Page authorization unavailable");
    const data=await response.json();
    const url=new URL(data.authorizationUrl);
    if(url.origin!=="https://www.facebook.com"||
      !new RegExp("^/v[0-9]{1,2}[.][0-9]{1,2}/dialog/oauth$","u").test(url.pathname))
      throw Error("Unrecognized Meta login host");
    window.location.assign(url.toString());
  }catch{
    if(workspaceId===currentWorkspaceId&&mode==="dashboard"){
      channelsConnectMessenger.disabled=false;
      channelsStatus.textContent="Messenger authorization could not start. Verify workspace access and Meta setup.";
    }
  }
});
channelsConnectTelegram.addEventListener("click",async()=>{
  if(!telegramConnectEnabled||!channelsAllowed()||mode!=="dashboard"||
     !csrfToken||!currentWorkspaceId)return;
  const workspaceId=currentWorkspaceId;
  channelsConnectTelegram.disabled=true;
  channelsStatus.textContent="Opening verified Telegram sign-in…";
  try{
    const response=await request("/app/auth/workspaces/"+
      encodeURIComponent(workspaceId)+"/connections/telegram/start",{},csrfToken);
    if(workspaceId!==currentWorkspaceId||mode!=="dashboard")return;
    if(!response.ok)throw Error("Telegram identity verification unavailable");
    const data=await response.json();
    const url=new URL(data.authorizationUrl);
    if(url.origin!=="https://oauth.telegram.org" || url.pathname!=="/auth")
      throw Error("Unrecognized Telegram auth host");
    window.location.assign(url.toString());
  }catch{
    if(workspaceId===currentWorkspaceId&&mode==="dashboard"){
      channelsConnectTelegram.disabled=false;
      channelsStatus.textContent="Telegram authorization could not start. Check your workspace role and try again.";
    }
  }
});
channelsConnectTikTok.addEventListener("click",async()=>{
  if(!tiktokConnectEnabled||!channelsAllowed()||mode!=="dashboard"||
     !csrfToken||!currentWorkspaceId)return;
  const workspaceId=currentWorkspaceId;
  channelsConnectTikTok.disabled=true;
  channelsStatus.textContent="Opening TikTok account holder authorization…";
  try{
    const response=await request("/app/auth/workspaces/"+
      encodeURIComponent(workspaceId)+"/connections/tiktok/start",{},csrfToken);
    if(workspaceId!==currentWorkspaceId||mode!=="dashboard")return;
    if(!response.ok)throw Error("TikTok authorization unavailable");
    const data=await response.json();
    const url=new URL(data.authorizationUrl);
    if(url.protocol!=="https:"||
       !["ads.tiktok.com","business-api.tiktok.com","www.tiktok.com"]
         .includes(url.hostname)||url.username||url.password)
      throw Error("Untrusted TikTok account authorization");
    window.location.assign(url.toString());
  }catch{
    if(workspaceId===currentWorkspaceId&&mode==="dashboard"){
      channelsConnectTikTok.disabled=false;
      channelsStatus.textContent="TikTok account authorization could not start. Verify your permissions and retry.";
    }
  }
});
channelsRefresh.addEventListener("click",()=>{void loadConnections(false);});
channelsMore.addEventListener("click",()=>{void loadConnections(true);});
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
get("mfa-account-toggle").addEventListener("click",()=>{
  if(!mfaState)return;
  openSecurityChange({kind:"sign_in",enabled:!mfaState.signIn2faEnabled});
});
get("mfa-add").addEventListener("click",()=>{void beginEnrollment();});
get("mfa-change-cancel").addEventListener("click",()=>{
  securityChange=null;
  mfaChangePanel.hidden=true;
  get("mfa-change-code").value="";
});
get("mfa-change-form").addEventListener("submit",async event=>{
  event.preventDefault();
  if(mode!=="dashboard" || !csrfToken || !securityChange)return;
  const requestChange=securityChange;
  const proofFactorId=mfaProofFactor.value;
  const code=get("mfa-change-code").value.trim();
  const submit=get("mfa-change-confirm");submit.disabled=true;
  try{
    if(requestChange.kind==="enroll"){
      // Sign-in 2FA can be switched off, but enrolling a backup still needs
      // fresh AAL2 before GoTrue will create the factor.
      const verified=await request("/app/auth/mfa/totp/verify",
        {factorId:proofFactorId,code},csrfToken);
      if(!verified.ok)throw Error("Proof not verified");
      const result=await verified.json();
      csrfToken=result.csrfToken;
      setSessionExpiry(result);
      securityChange=null;mfaChangePanel.hidden=true;
      if(mfaState)mfaState.canEnroll=true;
      await beginEnrollment();
      return;
    }
    const payload=requestChange.kind==="sign_in"
      ? {kind:"sign_in",enabled:requestChange.enabled,proofFactorId,code}
      : {kind:"factor",factorId:requestChange.factorId,
          enabled:requestChange.enabled,proofFactorId,code};
    const response=await request("/app/auth/mfa/preferences",payload,csrfToken);
    if(response.status===409){
      message("Keep at least one active authenticator. You can disable another device after enabling a backup.");
      await loadMfaFactors();
      return;
    }
    if(response.status===429){
      message("Security changes are temporarily limited. Try again after the 15-minute cooldown.");
      return;
    }
    if(!response.ok)throw Error("Security change rejected");
    const updated=await response.json();
    if(updated.status!=="changed" || typeof updated.csrfToken!=="string")
      throw Error("Security update incomplete");
    csrfToken=updated.csrfToken;
    securityChange=null;mfaChangePanel.hidden=true;
    get("mfa-change-code").value="";
    await loadMfaFactors();
    message("Security settings updated. Other signed-in sessions were signed out.");
  }catch{
    message("The code wasn't accepted or the security change couldn't be saved. Try a current code.");
  }finally{submit.disabled=false;}
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
async function beginEnrollment(){
  if(!csrfToken){message("Please sign in again.");return;}
  if(enrollmentFactorId){
    message("Finish this setup or select Cancel before starting another.");
    return;
  }
  const inSettings=mode==="dashboard";
  if(inSettings){
    if(mfaState && !mfaState.canEnroll && mfaState.devices.length){
      openSecurityChange({kind:"enroll",enabled:true,
        label:"another authenticator"});
      return;
    }
    mfaSettingsSlot.append(mfaPanel);
    mfaSettingsSlot.hidden=false;
    mfaPanel.hidden=false;
    mfaChangePanel.hidden=true;
    securityChange=null;
  }
  const button=get(inSettings?"mfa-add":"mfa-enroll");
  button.disabled=true;
  try{
    const response=await request("/app/auth/mfa/totp/enroll",
        {name:inSettings?"Authenticator":"Primary authenticator"},csrfToken);
    if(response.status===409){
      if(inSettings)mfaSettingsSlot.hidden=false;
      mfaCancel.hidden=false;
      mfaPendingHelp.hidden=false;
      await loadMfaFactors();
      message("Select Cancel to restart this setup.");
      return;
    }
    if(response.status===429){
      message("Too many attempts. Please try again after the security cooldown (up to 15 minutes).");
      return;
    }
    if(!response.ok){
      message("Authenticator setup is unavailable. Please try again.");
      return;
    }
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
    mfaPendingHelp.hidden=true;
    mfaCancel.hidden=false;
    mfaForm.hidden=false;
    mfaPanel.hidden=false;
    if(inSettings)mfaSettingsSlot.hidden=false;
    const option=document.createElement("option");
    option.value=data.factorId;option.textContent="New authenticator (finish setup)";
    mfaFactor.prepend(option);
    mfaFactor.value=data.factorId;
    mfaFactorPicker.hidden=mfaFactor.options.length<=1;
    mfaSummary.textContent="Scan the QR code or enter the key, then verify the six-digit code.";
    get("mfa-code").focus();
    message("");
  }catch{
    message("Connection interrupted. Setup may be pending. Reopen Security to continue.");
  }finally{button.disabled=false;}
}
get("mfa-enroll").addEventListener("click",()=>{void beginEnrollment();});
mfaCancel.addEventListener("click",async()=>{
  if(!csrfToken){message("Please sign in again.");return;}
  const button=mfaCancel;button.disabled=true;
  try{
    if(enrollmentFactorId || lastPendingCount>0){
      // Explicit Cancel removes only unfinished GoTrue enrollment. All
      // existing verified primary/backup authenticators remain enrolled.
      const response=await request("/app/auth/mfa/totp/reset",{},csrfToken);
      if(!response.ok)throw Error("Cancel unavailable");
    }
    const currentMode=mode;
    clearMfa();
    if(currentMode==="gate")mfaPanel.hidden=false;
    await loadMfaFactors();
    message("Setup canceled.");
  }catch{message("Couldn't cancel this setup. Please try again.");}
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
    const wasSettings=mode==="dashboard";
    clearMfa();
    showDashboard(result,wasSettings);
    message(wasSettings?"Authenticator added successfully.":"");
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
${mfaModalJs}
void initialize();`;
