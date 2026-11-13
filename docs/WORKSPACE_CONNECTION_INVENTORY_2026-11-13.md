# Private workspace connection inventory — 2026-11-13

## Scope and rollout status

This implements the **read-only, private account-inventory API prerequisite** for [#230](https://github.com/ishinaillab/ishikeit/issues/230). It does **not** enroll, activate, connect, disconnect, claim, transfer, backfill or mutate any provider account. It does **not** enable shadow routing, change the webhook/outbox workers, or imply that Telegram, Instagram, Messenger, WhatsApp or TikTok accounts are tenant-bound in production.

Only when the existing `BROWSER_AUTH_ENABLED` server flag is true, the private BFF registers:

```http
GET /app/auth/workspaces/:workspaceId/connections?after=<optional UUID>
```

The response is a bounded `{ items, nextCursor? }` page, ordered by immutable `connectionId`, maximum 20 rows per page at the BFF. Each row includes `connectionId`, `workspaceId`, `provider`, `accountId`, internal `status` and `generation`. This **registry status is not an independent assertion of provider-side rights, credentials, channel entitlement, current grant freshness, or send authorization**. No OAuth scopes, app secrets, customer messages, session tokens, cookie values, credential pointers, raw evidence records or any foreign tenant rows are returned. Historical empty inventory is legitimate, not a failure to discover the owner's real outside provider accounts.

## Authorization boundaries

1. The exact Host and same-site request restrictions, `__Host-` Secure/HttpOnly/SameSite=Strict cookie-only browser session, private cache headers and anti-clickjacking/CSP/no-store policy match the existing private browser auth endpoints. There is no new public signup, bearer token or generic operator API.
2. `PrivateBrowserAuthService.listWorkspaceConnections` reloads the current opaque browser session from the encrypted server-side store, checks the live Auth session, and requires **fresh Supabase AAL2 and the factor bound to the same live session** using the existing privileged verifier. It verifies issuer, subject and session equality. Browser JavaScript never receives the Supabase Auth bearer.
3. The server-private PostgreSQL registry independently validates the requested workspace ID, actor proof and bounded cursor, then checks the current **active workspace** and **active owner/admin membership** under `FOR SHARE OF m,w` in the transaction containing the read. Agent/viewer, revoked, foreign workspace, suspended workspace and missing auth are denied. This avoids treating `workspaceId` from the URL, any frontend role, or earlier login decisions as sufficient authority.
4. Tenant scope is enforced by `WHERE workspace_id=$1`; pagination is bounded and deterministic over UUID. The existing RLS-enabled, client-grant-revoked underlying tables remain unchanged and not directly exposed to Supabase Data API client roles. There are **no database migrations** in this change.
5. All failures return fixed public statuses; exceptions and provider data are never rendered into the HTTP response. The inventory cannot mutate connection generations, credentials, pending intents, or any live legacy sending path.

## Acceptance evidence (isolated tests; not owner live acceptance)

- Windows direct source checks: ESLint and TypeScript typecheck pass, focused `tests/private-browser-auth-http.test.ts` **26/26 passed**.
- Isolated Docker Compose `ishi-inventory-review-20261113` with Node **24** and PostgreSQL **17**: **842/842 tests, 102/102 files passed**, including actual PG17 tenant authorization, role, suspended/revoked membership, one-use account claim lifecycle, inventory pagination and owner MFA regressions; ESLint, TypeScript typecheck and build passed. Test container exit **0**.
- The Node source was mounted read-only; containers, network and exclusive disposable Postgres volume were removed. No live user credentials, production PostgreSQL data, provider send, OAuth readback, WordPress or production environment were used in this test.
- Before declaring this delivered, verify all protected GitHub PR CI jobs, merge, protected main SHA, exact Hostinger deploy source SHA/finish, and fresh public endpoint smoke. **Do not claim actual owner-authenticated inventory acceptance without an owner-controlled session**.

## Remaining #230 work

Actual owner-approved provider-native immutable account identity/authorization readback, encrypted per-account credentials, session/AAL2/CSRF-bounded connection wizard, persistent explicit owner claims, account UI with clear connection status and grant reasons, tenant-safe durable inbox/outbox and generation fencing **at every dispatch**, provider-right freshness #206, and controlled live routing cutover still require separate implementation and acceptance. Never auto-claim accounts from handles/webhooks, enable public onboarding or remove the current Telegram legacy owner fallback until real ownership and cutover are verified.

## Primary authoritative guidance

- OWASP Authorization Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html> — deny by default, least privilege, authorization on every request.
- OWASP REST API assessment: <https://cheatsheetseries.owasp.org/cheatsheets/REST_Assessment_Cheat_Sheet.html> — tenant identifier swap tests to prevent BOLA.
- Supabase Auth MFA: <https://supabase.com/docs/guides/auth/auth-mfa> — AAL2 factor proof and stale-session handling.
- PostgreSQL 17 row security: <https://www.postgresql.org/docs/17/ddl-rowsecurity.html> — RLS/default deny, distinct from server-private trusted SQL.
- PostgreSQL 17 explicit row locks: <https://www.postgresql.org/docs/17/explicit-locking.html> — shared member/workspace authorization fences.
