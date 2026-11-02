# Phase 2 — server-private workspace-bound connection intents (issue #230)

**Status (2026-11-02):** Additive, internal OAuth authorization preflight only. NOT enabled as a browser route, provider callback, public account onboarding or disconnected-account cleanup. Do not use this feature to claim that Instagram, Messenger, WhatsApp, Telegram or TikTok integrations are ready for self-service.

## Contract

`migrations/0011_ishikeit_connection_intents.sql` adds one private table with workspace ID, initiating verified principal, provider, provider **application** identifier, exact pre-registered HTTPS redirect URI, SHA-256 hashes of 256-bit state and 256-bit browser binding secret, 10-minute expiry, and one-use consumption timestamp.

`PostgresWorkspaceConnectionIntents` in `src/persistence/workspace-connection-intents.ts` accepts a **trusted server-established principal** (never a browser-controlled issuer/subject), and first verifies current **owner/admin** membership in an **active workspace**. Only then can it issue one cryptographically random state and separate browser nonce for a connection attempt.

- The raw **state** is meant for the official provider authorization URL. Only its hash is stored in the database.
- The raw **browser nonce** is meant ONLY for a short-lived `Secure; HttpOnly; SameSite=Lax; Path=/` host-only browser cookie (prefer `__Host-` naming with no Domain attribute). It is not a JS-facing value, OAuth state parameter, querystring, provider request, analytics event or log field. Hash only in DB. The route/cookie issuance is NOT implemented yet.
- A distinct transaction-specific PKCE `code_verifier` is derived using HMAC-SHA-256 over the state, keyed by the browser nonce and a context label. It need not be stored in DB or sent to the browser. S256 `code_challenge` is returned for provider integrations **only when that provider officially supports PKCE**. No provider-specific OAuth URL construction or token exchange changed in this milestone.
- The callback must pass the **verified workspace, principal, expected provider/application and the exact trusted registered redirect** as **server context**, plus the OAuth state and matching host-only browser cookie; the database atomically consumes exactly one matching nonexpired intent. Provider mix-up, account/workspace confusion, session swapping, previous state, expired intent, revoked membership, inactive workspace or wrong redirect must fail closed.
- `consume` only proves authorization initiation continuity and generates a PKCE verifier; it does NOT establish the provider account identity, token scopes, app-review status or consent. A separate provider adapter must exchange the code, validate official immutable identity and rights, then call the existing verified workspace account registry.
- Current `/ishikeit/oauth/instagram/*` and TikTok OAuth callbacks retain their legacy operator-private behavior. They are NOT linked to intents and MUST NOT be exposed publicly. No modification of live Meta/Telegram/TikTok webhook/dispatch, Ishi owner default, WordPress AI, customer data or tokens.

## Before activating any provider flow

1. Implement a real verified Ishikeit login/session boundary (current `/ops` bearer token does NOT represent a workspace member), session rotation/revocation and CSRF protection. Never trust user-controlled JWT metadata, issuer/subject or role from request JSON.
2. Ensure strict origin/host verification, approved provider OAuth app credentials, exact callback configuration and issuer separation / mix-up protection, plus provider-confirmed support for PKCE S256; configure cookie attributes in secure reverse-proxy environments and use browser consent/logout appropriate for the product. No open redirects or callback data leaks.
3. Complete provider-specific official identity/scope and app-approval readbacks. Begin and consume a connect intent only after the provider is eligible. No permanent provider account ID or subscription guessed from a username.
4. Add stronger transaction fencing for revoked sessions and operational rate limiting; safely expire/delete old intents without exposing them through Data API. Verify callback denial, concurrent use, provider retries, same-browser multiple connections, and cross-workspace isolation.
5. Complete tenant-aware inbox/outbox/AI/consent and secure disconnect cleanup before offering public accounts; existing provider-specific reply windows, anti-abuse and opt-out rules remain authoritative.

## Tests and deployment

The existing isolated PostgreSQL 17 `tests/workspace-connections-postgres.integration.test.ts` applies migration 0010 then 0011, exercises cryptographic hashing, S256 challenge/verifier consistency, single-use concurrent consumption, wrong workspace/actor/provider/app/redirect/nonce, revoked membership, expired state and no client grants/RLS policies. Database tests never run against production. Apply migration 0011 to Supabase only after CI passes and inspect empty private table. No real customer rows should be created.

## Primary references

- OAuth 2.0 Security Best Current Practice RFC 9700: https://www.rfc-editor.org/rfc/rfc9700
- PKCE RFC 7636: https://www.rfc-editor.org/rfc/rfc7636
- Supabase private client role/RLS: https://supabase.com/docs/guides/api/securing-your-api and https://supabase.com/docs/guides/database/postgres/row-level-security
- Current official provider docs must be checked **per provider** before any actual OAuth/token grant change (Meta developers.facebook.com, Telegram core.telegram.org, TikTok business-api.tiktok.com); do not assume their separate flows have universal PKCE support.
