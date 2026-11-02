# Ishikeit private browser BFF authentication — 2026-11-02

**Security scope:** Phase 2 issue #230, feature flag OFF by default. This code
does **not** enable public signup, provider account onboarding, per-workspace
message routing or the Phase 3 full UI. All existing Ishi Nail Lab operations
continue unchanged.

## Source-backed decisions

- Supabase's official passwordless email OTP: `POST /auth/v1/otp` with
  `create_user:false`, then `POST /auth/v1/verify` with
  `email,token,type:'email'`. Require an email template containing
  `{{ .Token }}` — a magic-link template would not produce an entry code.
  https://supabase.com/docs/guides/auth/auth-email-passwordless
  https://github.com/supabase/auth/blob/master/openapi.yaml
- Refresh via `POST /auth/v1/token?grant_type=refresh_token`; Supabase
  single-use refresh tokens rotate. Store the replacement **atomically** under
  an exact SQL row lock; never retry an ambiguous network outcome.
  https://supabase.com/docs/guides/auth/sessions
- Verify current user/session with the existing trusted
  `SupabaseAuthPrincipalVerifier`, including official `GET /auth/v1/user`,
  exact issuer and live `auth.sessions` lookup. Query **current membership**
  server side; no browser-supplied role/workspace grants are accepted.
  https://supabase.com/docs/guides/auth/server-side/creating-a-client
- Browser gets only a randomly generated **opaque** 256-bit
  `__Host-ishikeit-session` cookie with
  `Secure; HttpOnly; SameSite=Strict; Path=/`, never Supabase access or
  refresh tokens. Separate `__Host-ishikeit-login` cookie for the pending
  email OTP, consumed once at successful login. No Domain attribute. No
  localStorage/sessionStorage JWTs.
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- Strict configured HTTPS Origin + Host and Content-Type JSON required on
  all mutations. `sec-fetch-site` crossing origins is denied. A fresh
  per-session HMAC CSRF token is returned on authenticated GET /session,
  required as `x-ishikeit-csrf` for refresh and logout, and verified
  constant-time. Read routes are same-origin with `no-store`, no CORS and
  non-permissive CSP. Both CSRF and Origin defenses are necessary.
  https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

## Implementation

- `migrations/0014_private_browser_auth.sql`: three private, RLS-on,
  no-public-client-grants tables for one-time login challenges with encrypted email values, durable keyed-HMAC
  rate buckets, and session records. Session IDs are SHA-256 hashes; provider
  access/refresh tokens use AES-256-GCM with per-value associated data and
  independent browser encryption key. Session max lifetime 12h.
- `src/auth/supabase-email-otp.ts`: bounded official Auth REST client;
  no signup or password endpoint and no service-role keys.
- `src/auth/private-browser-auth.ts`: server-only OTP request/verify,
  active-member check, encrypted cookie sessions, explicit session validation,
  serializing refresh and immediate local credential erasure before best-effort remote signout.
  Database throttles email OTP requests and remote OTP verification with keyed-HMAC privacy-preserving rate buckets; per-code
  retries capped at five. All public OTP request responses are intentionally
  generic to limit user enumeration.
- `src/http/private-browser-auth-routes.ts`: six routes under
  `/app/auth/`: `request-otp`, `verify-otp`, `session`, `workspaces`,
  `refresh`, `logout`. No user role, token or redirect URL is ever emitted.
  All endpoints are **absent** unless `BROWSER_AUTH_ENABLED=true` and every
  required environment value is present. The existing /ops bearer token is
  not a customer login and never authorizes these routes.
- `src/processes/http.ts`: registers the controller only under a complete
  opt-in configuration. Existing Meta, WhatsApp, Telegram, TikTok, LatePoint,
  inbound AI and dispatch systems are not modified.

## Operational activation HOLD

Do NOT enable the flag merely because this code is deployed:

1. Confirm actual Supabase Auth email OTP template, deliverability, users
   invited by an authorized administrator, permanent email verification
   and existing workspace membership. New sessions will be refused for users
   lacking an active workspace. Public registration must remain unavailable.
2. Independently verify Hostinger reverse proxy preserves exact
   `Host: apps.ishinaillab.com`, HTTPS cookie delivery, Origin and same-origin
   Fetch Metadata. Do not weaken host/origin checks based on unverified
   X-Forwarded-* headers. Set `BROWSER_AUTH_ORIGIN` to the exact canonical
   HTTPS site origin, `SUPABASE_AUTH_PROJECT_URL` to the correct Supabase
   project origin, and the current **publishable** `sb_publishable_` key.
3. Generate two independent 32-byte keys, base64 encode separately:
   `BROWSER_AUTH_ENCRYPTION_KEY_B64`,
   `BROWSER_AUTH_CSRF_KEY_B64`. Never reuse Meta, OAuth, WP, Hostinger
   or existing provider keys; never print them or put them in Git.
4. Verify known invited member with actual OTP in browser; check cookie
   attributes, CSRF, expiry, refresh, logout, multiple tabs/replicas, locked
   account and revoked membership, and no leakage to logs/browser storage.
5. Keep all provider account onboarding and dashboard public endpoints
   disabled until tenant-safe ingress/outbound, provider-specific app review,
   runtime entitlements and policies, disconnect cleanup and a finished UI.

## Residuals / fail-closed behavior

- If the OTP provider rejects a request, the browser receives the same
  generic request acknowledgment. Verification then fails safely.
- If the Supabase Auth service or PostgreSQL is unavailable, login/session
  operations fail closed; current messaging routes remain unaffected.
- The 12h browser session cap is absolute; expired sessions require a new
  OTP even if Supabase refresh tokens could technically remain valid.
- Automatic GET refresh is intentionally disabled: `POST /refresh`
  requires explicit CSRF protection. After an access token expires, the
  same-origin `GET /app/auth/csrf` can recover the CSRF token **only** for a
  still-valid nonrevoked BFF cookie; it never returns a bearer token and
  does not bypass Supabase refresh or current workspace authorization.
- No real user/workspace is provisioned, and no historical records are
  attributed to an account by these changes.
- A bounded, non-sending authentication cleanup process (30-minute checks when feature enabled) removes expired login challenges, expired or revoked sessions, and old rate-bucket entries. Explicit public onboarding and full conversations UI are separate
  maintenance steps. Never assert those are already complete.

## Test gates

Node 24 lint/typecheck/Vitest/build, existing provider suites,
HTTP origin/cookie/CSRF/disabled regression and disposable PostgreSQL 17
encryption/replay/throttle/refresh/logout/RLS regression. Apply migration
0014 only after full CI success; verify table counts zero, RLS and no client
access, and exact Hostinger SHA with live/ready. Production-enable only
after live proof and explicit operational configuration.

## Follow-up: private login shell and expiry-safe CSRF recovery

The disabled-by-default BFF also serves `GET /app` and `GET /app/login`
when enabled, with static same-origin `ui.js` and `ui.css`. It is a narrow
login and **read-only** workspace inventory, not the Phase 3 conversation
dashboard. Accessible labels, email/one-time-code inputs, live status and
mobile-responsive styling avoid inlined JavaScript, unsafe dynamic HTML,
third-party scripts or browser token persistence. CSP restricts script,
style, connect and form sources; the frontend uses `textContent` for
workspace names.

`GET /app/auth/csrf` is bound to an unexpired, nonrevoked opaque server-side
session. This supports POST refresh after a Supabase access token expires,
including after a tab reload, without exposing the access token or refresh
token. POST refresh still requires both exact same-origin metadata and the
HMAC CSRF header; actual user/session/membership verification happens on
refresh before any workspace data is returned. Negative HTTP tests cover
CSP, disabled routes, cookie revocation and CSRF recovery.

**Activation hold unchanged:** No `BROWSER_AUTH_ENABLED` production flag or
real user/bootstrap has been set. Before inviting users verify actual email
OTP template, canonical Hostinger proxy behavior and the provider's official
current security controls.

## Privacy hardening — migration 0015 (2026-11-02)

The first private BFF foundation had a plaintext email column in the short-lived
OTP attempt table, unsalted SHA-256 email/IP rate-bucket digests, and no
scheduled removal of expired, encrypted credential records. **Fix:**

- Migration `0015_browser_login_email_encryption.sql` removes the plaintext
  `email_address` column after *locking and verifying that the table is empty*
  and substitutes mandatory AES-256-GCM email ciphertext/IV/tag. This migration
  **fails closed** if there are any live login attempts requiring an explicit
  encrypted backfill. It must run before the new code is activated.
- The service decrypts the matching email using the one-time cookie hash as
  additional authenticated data, never writes the email as plaintext to its
  own private auth table, and uses HMAC-SHA-256 of the rate bucket key under
  the independent CSRF secret to avoid predictable email-address hashing.
- Logout deletes the entire local session row in one DB transaction **before**
  best-effort remote Auth signout, immediately erasing encrypted tokens and
  their decryption metadata from the active DB table.
- `PostgresBrowserAuthMaintenance.runOnce()` deletes at most 250 expired
  OTP challenges, 250 expired/revoked sessions and 250 rate buckets older than
  24h after expiry per pass; it uses `FOR UPDATE SKIP LOCKED` so replicas
  cannot delete a record while verification or refresh is holding its row.
  The non-sending runner operates only when `BROWSER_AUTH_ENABLED=true`.
- Isolated PostgreSQL 17 regression tests prove that no plaintext email
  column remains, ciphertext is not plaintext, rate hashes aren't trivial
  SHA-256 dictionaries, active records survive cleanup, expired records are
  removed, and logout removes tokens immediately.

The production browser login remains **disabled** until real authorized
user enrollment and email-template/Hostinger proxy verification succeed.
