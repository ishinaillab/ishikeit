# Priority 3 — cancellation of UNACTIVATED provider connections (local-only, 2026-11-15)

## Scope and non-negotiable limit

This is a **partial account-lifecycle feature** that remedies the absence of an
authenticated, owner-facing *pending-link cancellation request*. It is not a
complete disconnect or provider deauthorization operation. The new
`allowWorkspaceDisconnectRequests` BFF option defaults to **false**;
`src/processes/http.ts` deliberately does **not** enable it. No live
connection, legacy studio customer traffic, webhook subscription, provider
credential, Auth session, MFA factor, production database or feature flag is
changed by this isolated implementation.

An unactivated connection may request cancellation only while its registry
status is `verifying`. The result is **`disconnecting`**, with a strictly
incremented generation, one durable `disconnect_requested` audit and the
global provider account claim retained. Repeating the same request is idempotent
and never creates another audit or releases a claim. An already active
`connected`, `paused` or revoked connection is refused. This guard matters
because the legacy dispatch and subscriptions do not yet use the generation-
fenced tenant registry for all production paths; merely updating a registry
row would not prove that messaging stopped.

## Trust, transport, and UI

- The only optional mutation is POST
  `/app/auth/workspaces/:workspaceId/connections/:connectionId/cancel-pending`.
  It is absent unless both the existing private connection inventory and the
  **separate** cancellation gate are enabled and the controller exists.
- Same-origin exact Host and Origin, Fetch-Site, JSON content type,
  `__Host-` Secure HttpOnly browser session, session-derived CSRF,
  exact UUID route parameters and an empty body are required.
- The server-side BFF independently obtains and checks the real Supabase AAL2
  session, current authenticating principal and actual session identity.
  PostgreSQL independently revalidates the owner/admin role in the active
  workspace under its authorized transaction and locks the exact connection
  row. Browser-supplied account identity, privilege, provider, status,
  generation or credential IDs are never accepted.
- HTTP 202 means **only pending cleanup**. Browser response contains safe
  connection metadata; errors are generic, no token or provider exception.
- The Channels action **Cancel pending link** appears only for a verified
  `verifying` record, on an owner/admin workspace, with the server's separate
  cancellation flag. The UI verifies returned workspace/connection/generation,
  shows `Disconnect requested`, and explicitly says the provider cleanup is
  still pending and account cannot be transferred. An active connection is
  never offered a misleading partial disconnect action. No `innerHTML`,
  browser token storage or external OAuth callback changes.

## Delayed permission evidence after account transfer

An independently tested review fix also closes a subtle cross-workspace
readback issue: `provider_account_capability_facts` rows are keyed globally
by immutable provider account ID. Requiring `recorded_at >= connection.created_at`
alone can still accept a *delayed* previous-owner observation that was written
after the new owner relinked the account. In an owner/admin transaction,
readback first requires the account and connection's exact database identity,
excludes disconnected/revoked/disconnecting statuses, and for a provider
account with any *previous disconnected connection* additionally requires the
provider's **observed_at >= current connection.created_at**. This prevents a
late-arriving old grant from appearing current. A new freshly observed provider
readback after relink is still eligible for the **read-only evidence preview**.
In all cases `tenantSendingEnabled=false`.

The historical-claim lookup is currently defensive inside this read-only
endpoint; migration/index tuning may be considered after measured load.
This is not a general entitlement engine, current app-review authorization,
or permission to send messages. A saved evidence snapshot can be missing,
revoked or stale without making a disconnected account sendable.

## Test evidence and remaining release gates

Both missing-implementation red tests were observed against real Node24/
PostgreSQL17 fixtures. The first implementation run failed lint due to new
test-helper typing, which was corrected without weakening security guards.
The subsequent full disposable Node24/PG17 run passed **978/978** tests in
**122/122** files, with ESLint, TypeScript and production build passing, and
test container/PG data/network removed (exit 0). A separate genuine PG17
regression reproduced late previous-owner evidence returning *available*
incorrectly; after the scoped query fix the focused **5/5** tests passed.
The final full-suite rerun against the complete updated source and docs is now **verified PASS**: 978/978 Vitest cases in 122/122 files, ESLint, strict TypeScript and compiled production build all passed, Docker test exit 0, cleanup exit 0, and the named project's test resources were removed. This is still *local* acceptance, not protected PR CI or live provider-owner consent.

Still outstanding for Priority 3 completion:
1. Exclusive externally enforced release ownership and protected PR review,
   latest main merge base reconciliation, four CI jobs, and exact deployment.
   GitHub issue #284's comments are progress indicators, **not** an atomic
   exclusive lock or automatic takeover.
2. Real owner-controlled provider setup/consent and immutable asset readbacks:
   Instagram and Facebook Page Meta app permissions and exact callbacks,
   WhatsApp Embedded Signup v4/Tech Provider status and provisional token-type
   verification, TikTok actual account-holder and Messaging app approval,
   Telegram BotFather OIDC and Bot API Business owner/rights.
3. Fully safe active-account disconnect: prove generation-fenced active tenant
   ingress/queued send stop across **all** live workers and legacy routes,
   provider-specific official revocation/subscription cleanup, retryable
   ambiguous outcomes, secret removal, privacy retention, verified release of
   the uniqueness claim and fresh authorization for a new workspace. Neither
   an unactivated cancellation nor a `disconnecting` row proves these.
4. General-public App Review and per-account entitlements (#169/#206/#230)
   plus real owner/customer acceptance, not merely mocked provider tests.
   No Priority 4 worker-routing/canary sends or Priority 5 failover changes
   have been activated by this local-only source.

Authorities: OAuth Security Best Current Practice
https://www.rfc-editor.org/rfc/rfc9700.html ;
OWASP Authorization Cheat Sheet
https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html ;
Telegram official Bot API BusinessConnection
https://core.telegram.org/bots/api#businessconnection ;
PostgreSQL 17 date/time and transaction timestamp semantics
https://www.postgresql.org/docs/17/functions-datetime.html .

Canonical seven unpublished checkout modifications, three real first-owner
authenticators, five scheduled tasks, original production legacy credential
paths, customer messaging and Meta App Review owner hold remain preserved.

## 2026-11-15 — Safe completion of a tokenless pending cancellation

A separate real PG17 TDD RED suite found the missing safe completion
path: the existing `Cancel pending link` operation permanently reserved
even a NEVER-ACTIVATED link with **no encrypted credential reference, no
provider connection identity and no activated_at**. It also exposed an
incorrect idempotent-path response: the pending-link cancellation API
could acknowledge an ALREADY-ACTIVE disconnect in the `disconnecting`
state. Both failures were reproduced before the repair.

The internal registry now supports
`completeTokenlessUnactivatedDisconnect` only after a server-side
owner/admin, signed workspace session and explicit prior
`disconnect_requested`. The database independently rechecks the
connection row locked `FOR UPDATE` and rejects all previously active,
credential-bound or provider-connection-bound claims. A successful
never-activated cleanup atomically increments generation, writes
`disconnected_at`, appends exactly one `disconnected` audit, and
releases the globally unique account claim for a separately verified
new link. Repeated calls return the same result without duplicate audit.
The old, live dispatch routes are not touched.

The owner-facing BFF performs its original AAL2 session verification and
pending transition first. It then attempts only the safe tokenless
completion. Its separate OFF-by-default route returns **200 +
`status=disconnected`** only after actual database finalization, or
**202 + `status=disconnecting`** when independent provider cleanup
is needed or its verification is unavailable. Browser UI validates
workspace ID, connection ID, state, status code and the fenced
generation; shows *Disconnected* and the truthful notice that
**provider-side app authorizations are not revoked** for 200; and
otherwise keeps the provider-cleanup pending claim visibly reserved.
It never treats an already activated account as an unactivated link,
and it never enables native sends.

This is **not** a completed active-disconnect, OAuth provider-token
revocation, webhook unsubscription, queue fencing or customer-owned
provider entitlement release. Accounts carrying encrypted credentials
or provider connection identities deliberately remain claimed until
official provider cleanup can be independently verified. Safe active
disconnect requires routing cutover, signed provider proof, durable
retryable cleanup and generation-fenced workers. That remains blocked
from production by the existing release hold and provider consent.

Verification: disposable Node24/PG17 focused suite: **105/105 cases
in four files**, including real BFF encrypted-session AAL2
verification, the registry's PG authorization/unique claim and
audit, HTTP 200/202 and browser DOM. ESLint and strict TypeScript
passed, Docker cleanup exit 0. Full suite final acceptance follows.

### Final candidate verification

- Full disposable Node24/PostgreSQL17 suite after BFF/UI integration: **999/999 Vitest tests in 123 files**, ESLint, strict TypeScript, compiled production build all passed; test/cleanup exit 0, no named Docker containers/volumes remaining.
- Additional concurrency regression using two simultaneous pending tokenless completion requests: 29/29 real PG17 tests pass, both return the same completed generation and only one `disconnected` audit is written.
- This change is isolated: the separate `Cancel pending link` route remains disabled in production. All active/provider credential disconnect paths remain fail-closed; no external revocation or tenant send is implied.
