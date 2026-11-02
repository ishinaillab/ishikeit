# Phase 2 — verified Ishikeit principal and live login-session boundary

**Status: 2026-11-02 · Issue #230 · server-private implementation only.**

This increment provides a trusted actor for workspace account-connect intents. It does
**not** create a login screen, accept browser cookies, expose public OAuth endpoints,
migrate existing provider accounts or authorize sending messages.

## Authoritative technical basis

- Supabase Auth's authenticated `GET /auth/v1/user` API and official
  `auth.getUser(jwt)` semantics: this is a live network lookup of the user,
  unlike treating a decoded `getSession` user object as verified.
  https://supabase.com/docs/reference/javascript/auth-getuser
  https://github.com/supabase/auth/blob/master/openapi.yaml
- Supabase Auth's JWTs expose an exact `session_id`, whose presence in
  `auth.sessions` can be checked for sensitive actions to catch prior sign-out
  despite a not-yet-expired JWT:
  https://supabase.com/docs/guides/auth/sessions
  https://supabase.com/docs/guides/auth/managing-user-data
- Supabase anonymous users also have `authenticated` role; role alone is not
  safe for granting workspace access. Require a permanent, provider-confirmed
  `is_anonymous=false` user:
  https://supabase.com/docs/guides/auth/users
- User editable `user_metadata` is **never** role or workspace authorization.
  The server separately loads the current member role from its private DB.
  https://supabase.com/docs/guides/database/postgres/row-level-security
- OAuth 2.0 Security BCP and OWASP session protections:
  https://www.rfc-editor.org/rfc/rfc9700
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

## New internal contract

`src/auth/supabase-workspace-principal.ts` implements `SupabaseAuthPrincipalVerifier`:

1. Accept a bounded JWT **only from a server-owned authenticated request
   transport**. Decode the claims solely for early project/expiry/format
   rejection (this is *not* signature verification and not sufficient for login).
2. Require the exact configured project issuer, authenticated audience and
   role, UUID subject and UUID session identifier, with unexpired token.
   Project base URL is restricted to one exact `https://<ref>.supabase.co`
   origin. An `sb_publishable_` project key is accepted; no
   `sb_secret_` or service-role key is allowed.
3. Send that **exact JWT** in an authenticated `GET /auth/v1/user` call
   over verified HTTPS, with redirects blocked, no cache, bounded response,
   fixed timeout and sanitized failures. Never log credentials or provider
   response contents. Require an independently verified matching UUID
   permanent user (`role=authenticated`, `is_anonymous=false`, not banned).
4. Query the **exact** `auth.sessions` row for this token's session ID and
   same user ID; fail closed when revoked, signed out or database unavailable.
5. Return only trusted `{issuer,subject,sessionId,expiresAt}`. Never take
   display username, role, e-mail or tenant ownership from JWT metadata.

`src/auth/authenticated-workspace-connection.ts` is an internal orchestrator.
It freshly invokes the verifier on both `begin` and `consume`, then passes
the verified actor and exact session ID to the existing
`PostgresWorkspaceConnectionIntents` registry. That registry independently
checks real owner/admin membership in an active workspace from database,
single-use CSRF state, browser nonce, expected provider/application and exact
HTTPS redirect. **No web request is allowed to supply an actor or session ID
as an authorization assertion.**

The additive migration `migrations/0013_ishikeit_intent_auth_session.sql`
adds nullable `auth_session_id` to connection intents. New authenticated
flows bind that field and require the same exact login session on callback.
All existing unused intents remain NULL. Supabase Auth session revocation is
verified by the authenticator, not by a foreign key to `auth.sessions`.
No user rows, credentials or production integrations are modified.

## Authentication remains disabled until a verified browser transport exists

The current `/ops` bearer token is **not** a customer login. Before exposing
these methods in the future Phase 3 application:

- Use an official supported Supabase Auth login/session flow and a
  server-managed session/BFF: host-only `Secure; HttpOnly; SameSite` cookie,
  CSRF protection and strict Origin checks on mutations. Do not put bearer
  tokens or refresh tokens in localStorage. Resolve reverse proxy HTTPS trust
  without accepting untrusted forwarded host headers.
- Bind connection intent's browser nonce to the same verified browser and
  login session with a separate `__Host-` HttpOnly Secure cookie.
  Browser JavaScript must not receive tokens/nonce. Never use GET to mutate.
- Configure server-owned provider app/redirect allowlists, exact registered
  callback URIs, required provider consent, provider documented PKCE support
  and actual provider account ID/scope verification. No automatic public
  approval, unknown provider features or subscription upgrades.
- Rate-limit login, begin, callback, revoke and disconnect operations;
  decide session/CSRF rotation, logout, lost-device and account deletion
  contracts before enabling authentication endpoints.
- Complete tenant-aware signed webhook routing, AI and outbound send-time
  connection generation fences before using this mechanism for customers.
  Legacy Ishi account binding, OAuth and messaging routes remain unchanged.

## Verification and rollout

New unit tests use a fake **official Auth endpoint**, fake signed-session
database lookup and synthetic JWTs. They prove the service never treats a
locally decoded token as trusted and rejects foreign issuer, wrong
audience/role, expired token, mismatched user, anonymous/banned account,
revoked sessions, provider outages, SSRF URL and secret keys. An internal
auth facade test ensures caller-supplied principals cannot bypass verified
actor construction. Disposable PostgreSQL17 tests apply migration 0013
after migrations 0010/0011 and prove a valid state cannot be consumed
using another session ID from the same principal.

After full CI success apply migration 0013 with the official Supabase
migration interface; verify that intent table is empty, private RLS/client
grants are unchanged and the new column/index exists. Require verified
Hostinger exact-SHA deployment and production liveness/readiness. No
production app configuration, workspace identity, webhook mapping or
published local code is changed.
