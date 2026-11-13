# Channels workspace account inventory — 2026-11-13

## Purpose and release boundary

Issue [#230](https://github.com/ishinaillab/ishikeit/issues/230) needs tenant-safe, self-service provider account connections. This milestone adds **only** a read-only Channels navigation and internal connected-account registry display to the existing authenticated Ishikeit workspace shell. It uses the private, AAL2/session-protected API released in [PR #286](https://github.com/ishinaillab/ishikeit/pull/286), `GET /app/auth/workspaces/:workspaceId/connections?after=<UUID>`.

It does **not** enable OAuth connection onboarding, claims, account transfer, provider credential readback, sends, account disconnect, webhooks, tenant-routing changes or production database migrations. The literal registry state `connected` must never be presented as an authorization decision about provider API permissions, paid subscription, or a live send grant. No Connect button is offered until an authenticated owner-initiated, provider-native consent flow and routing fences exist.

## UI behavior and privacy protection

- **Channels** is discoverable in the workspace navigation only for the verified current workspace's **owner/admin** role. Agent/viewer workspaces have no Channels navigation entry. The server remains the sole authority: even a forged UI request is denied by the private backend's live Supabase Auth MFA/session and PostgreSQL membership checks.
- The current selected workspace is displayed. A read-only list supports refresh and deterministic 20-item cursor pagination with a Show more button. The empty state reads **“No accounts have been linked to this workspace yet.”** When an account is listed, it displays provider name, immutable provider account ID, internal registry generation and a deliberately qualified internal status. Labels are fixed UI text, not provider-generated HTML.
- Explicit explanatory copy states that this is an **internal connection status, not a live provider permission check**. There are no account-link or send actions.
- Untrusted provider/account fields and workspace display names are inserted with `textContent` only. No raw HTML is compiled from provider values; XSS/DOM injection is not possible through this renderer. The request is same-origin, no-cache, credentialed only via the existing browser's opaque HttpOnly session cookie. No Supabase bearer or privileged secret is sent to JavaScript.
- The client bounds and checks the response shape, exact workspace ID per row, UUID cursor and connection IDs, fixed status allowlist, generation positive safe integer, maximum 20 records, and rejects invalid responses. Rejected/failed reads show only a fixed explanatory error, not raw API errors or credentials. Server-side RLS/tenant isolation remains independently mandatory; browser checks are defense in depth.
- State is reset when navigating away, switching workspaces, losing the permissioned workspace, returning to the MFA gate, logging out or entering the login screen. Request generation, current auth session epoch and workspace identity prevent stale asynchronous fetch responses from populating a different workspace's screen after a fast change.
- The view uses accessible headings, aria-live status, list semantics, 44px minimum button target via existing shell styles, keyboard-operable navigation, responsive cards and reduced-motion inheritance. No new third-party UI scripts or dependencies.
- No new environment variables are necessary. The UI appears within already-enabled private browser access. The underlying inventory API still enforces live AAL2 for actual data retrieval even though navigation may be visible to the currently displayed owner/admin.

## Automated acceptance

- New synthetic-browser tests execute the **actual shipped** UI JavaScript with a bounded fake DOM. Coverage includes authentic empty state, no Connect action, successful refresh, malicious account-ID rendered as inert text, qualified status, 21-account pagination, permissioned workspace switching, viewer hiding, sign-out clearing, fixed errors and no stale session information.
- Existing MFA/login/OTP factor management and browser security regression suites remain part of project tests. Source unit tests do not constitute owner-controlled browser acceptance.
- The Node 24/PostgreSQL 17 disposable Compose lab runs lint, typecheck, the full serial Vitest suite and a production build. Record exact results in the latest #277 checkpoint and PR when observed.
- Protected GitHub CI and exact Hostinger deploy source/health readbacks are required before declaring delivered. No real owner session, genuine provider-native account, or message routing acceptance is claimed by this task.

## Remaining critical #230 requirements

The registry in live Supabase previously contained **zero** verified provider-account claims, so this UI is expected to show the empty state. Genuine provider-native account identity proof/owner consent and encrypting per-account credentials, connect/disconnect wizard, tenant-bound durable ingress/outbox, per-send generation fencing, controlled cutover, and real provider-origin canary are separate uncompleted gates. Keep the existing Telegram Business legacy owner fallback and all production MFA factors intact. Related #206 governs actual provider-granted capabilities and freshness, and #216 covers real booking/checkout acceptance.

## Current authoritative references

- [W3C Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/) — WCAG 2.2 AA, semantic navigation and keyboard accessibility
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) — accessibility behavior
- [OWASP Cross-Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) — safe DOM sinks and output encoding
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — deny by default, least privilege, enforce each request
- [MDN Using the Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) — credentials and cache controls
- [Supabase Auth MFA](https://supabase.com/docs/guides/auth/auth-mfa) — trusted AAL assurance and current factor checks
- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html) — membership/context read fences
