# Priority 3 — Provider-application-bound account capability facts

Date: 2026-11-15 (Asia/Manila). **LOCAL-ONLY, NOT RELEASED.**

## Problem and intended behavior

Provider capability evidence was keyed only to the provider and immutable account ID.
Two OAuth/bot applications acting on the same account can have different grants.
Account-only latest-per-key evidence could therefore display another application's
right as granted or allow its denial to overwrite the correct application's
evidence, even if earlier tenant-claim time fencing is in place.

The corrected key is **provider, provider account, provider application, evidence
key**. The app identifier must be derived by a trusted, verified server-side
provider integration, not an owner-submitted browser field or account handle.

* `PostgresAccountCapabilityFacts.record` requires an explicit nonempty
  `providerApplicationKey`, refuses the reserved `legacy-unbound` sentinel,
  refuses cross-application mixed batches and keeps a newer denial within only
  that application's immutable key.
* `read` and `deleteAccount` require the exact app key; one app's cleanup
  cannot erase another app's evidence.
* The owner/admin-only capability evidence preview rechecks the workspace
  membership and locked connection in one PG17 transaction, reads the current
  immutable `provider_application_key` from that same row, and filters facts
  by exact provider, account, application, claim timing and post-transfer
  observed timestamp. `tenantSendingEnabled` is always false.
* Existing unscoped facts are retained as `legacy-unbound` during migration
  rather than guessed into a native OAuth app. New server-side writers
  explicitly attach application identity:
    - Existing Instagram Graph-backed legacy readback: `META_APP_ID`
    - Existing Messenger legacy Page subscription readback: `META_APP_ID`
    - Existing Telegram Bot API Business readback: numeric bot ID derived
      securely from the configured validated bot token
* **Do not silently relabel legacy facts to new native flow grants.** Native
  Instagram Login, Messenger Facebook Login for Business, and Telegram OIDC
  use separately namespaced authorization-intent application keys.
  Evidence produced by an existing legacy integration with the same
  underlying provider account is *not* automatic proof of these new grants.
  Until an exact native provider readback is recorded under the native
  connection's application key, its owner preview remains unverified.

## Database and rollout

Identical SQL is prepared in the application checkout as
`migrations/0024_provider_capability_application_scope.sql` and in the
**separate isolated, current-main** database repo checkout as
`supabase/migrations/20261115013500_provider_account_capability_app_scope.sql`.
Neither production Supabase DB nor the seven unpublished original app files
have been touched. The DB repo existing main had lagged 12 remote commits;
the isolated DB clone begins from live remote main at
`e57d2e471f5fec2629d188018218946445cc48f0`, avoiding any stale migration
base.

**IMPORTANT ROLLOUT CORRECTION (2026-11-15):** The initial in-place
ALTER TABLE approach above was REPLACED BEFORE DEPLOYMENT. A real PG17
regression proved it rejected older still-deployed account-only INSERT
statements and could break original legacy UPSERT conflict targets. The
replacement is an additive **side-by-side private v2 table**:
`provider_account_capability_facts_v2`, with the four-part key and
separate RLS/client privilege revocation. The old
`provider_account_capability_facts` table is kept **completely intact**
with its exact original three-part primary key and existing writers.

The expand-only migration copies historical original records into v2
only as non-authoritative `legacy-unbound`; no new OAuth application is
inferred. After the new application is deployed its facts writer, account
preview and read-only private queries exclusively use the v2 table.
Older running servers continue reading and writing the original table
until fully drained, without influencing the v2 app-scoped rights.
There is **NO automatic contract/drop step in Priority 3**: keep the
legacy table and its evidence until separately proven that no old writers
remain and retention/privacy requirements have been assessed.

The app's Instagram deauthorization and deletion handlers now purge
both tables for the exact credential account and its verified aliases.
The additive DB migration must be applied and its RLS verified
**before** releasing the new application, under authenticated protected
migration controls, with exact repository SHA/CI evidence. Do not allow
manual concurrent migrations or normal production changes without an
exclusive fenced release owner.

Do not merge or deploy either repository until an exclusive authenticated
release owner and necessary approvals are verified; issues #277/#284 and
existing provider App Review hold #169 remain in force.

## Verification and limits

A real disposable Node24/PostgreSQL17 pre-fix run failed the two new app-scope
regressions as expected. Updated app source, actual legacy runtime evidence
writers and matching migration then passed strict TypeScript, ESLint and the
focused 13/13 DB tests. A separate legacy-row backfill and quarantine regression was added and
verified. The complete isolated Node24/PostgreSQL17 suite subsequently passed
**982/982 tests in 122/122 files**, ESLint, strict TypeScript and production
build (test exit 0, Docker volume/network cleanup 0). No production app or
database migration was performed. This is not proof of provider permission approval.

Current technical limitations: native provider-specific permission readback
must be installed and observed for each actual account/application, and true
per-tenant sends remain disabled until live generation-fenced routing and
provider cleanup have separate verified acceptance. The older OAuth and
Messenger Page legacy send/readback are intentionally not relabeled as
native grants.

Authoritative security guidance:
https://www.rfc-editor.org/rfc/rfc9700.html
https://www.postgresql.org/docs/17/ddl-alter.html
https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

## 2026-11-15 follow-up after Windows agent recovery — native Telegram facts

The owner-confirmed native Telegram OIDC + Bot API Business `getBusinessConnection`
flow now optionally writes `telegram.business_connection` and
`telegram.rights.can_reply` as short-lived five-minute **app-scoped** verified
facts under `telegram-oidc-<client_id>`, only after matching the immutable
owner ID, enabled connection and `can_reply` with the correct registry
owner/admin. Prior native OIDC connection evidence remains separate from the
legacy Bot API bot-ID namespace. A failed evidence-preview write cannot
misreport an already-committed provider activation as failure or cause an
unsafe automatic retry; authorization remains independent of the preview.

TDD red test run: two new native coordinator tests failed because the
permission recorder had not been invoked. After implementation and a
TypeScript test-fixture correction, the restored Windows Ishi Local Agent
successfully ran the **entire** disposable Node24/PostgreSQL17 application
verification lab `ishikeit-p3-telegram-agent-restored-20261115`:
**984/984 Vitest tests passed in 122/122 files**, ESLint, strict TypeScript
and production compilation passed, test exit 0, Docker cleanup exit 0,
and no named lab container remained. All changes remain LOCAL ONLY.

## 2026-11-15 — conservative native provider readback evidence coverage

After the Telegram OIDC evidence write was finished, four additional official
native provider activation paths were updated in the isolated review checkout
to store **only the facts the observed account verification actually proves**:

- **TikTok account-holder OAuth:** `tiktok.business_account` is observed
  only after current account owner and Advanced Access eligibility match.
  `tiktok.messaging_api_authorization` is never inferred from the owner
  grant. TikTok Business Messaging API has a separate developer permission
  and privacy/security approval gate.
- **WhatsApp Embedded Signup v4:** exact app/config/phone/WABA business asset
  readback yields `whatsapp.business_account`; it does *not* infer
  `whatsapp.messaging_authorization`, recipient consent, app review, or
  user-level messaging.
- **Messenger Page Login for Business:** a reverified exact Page and app-bound
  token yield `messenger.page`; they do *not* infer the Meta app-level
  `messenger.messaging_authorization` right.
- **Instagram Login:** a fresh Professional-account ID and the original
  encrypted OAuth grant yield `instagram.oauth` and the observed
  `instagram.scope.instagram_business_manage_messages` only; they do *not*
  infer `instagram.app_access`, advanced app review, or an unobserved
  Creator/Business account subtype.

A small shared `src/auth/native-account-evidence.ts` helper writes
time-bounded five-minute proofs after **successful** registry activation.
An optional evidence cache error leaves features unverified without claiming
that an earlier durable activation failed, and cannot automatically retry the
OAuth grant. All changes are default-off within the existing dormant native
provider account-linking flows. Tenant sending stays explicitly disabled.

Four TDD regressions were observed to fail before implementation (their
recording sinks were never called). After implementation, the isolated
Node24 focused validation passed **38/38 tests in 4 suites**, ESLint and
strict TypeScript. Complete disposable Node24/PostgreSQL17 verification
`ishikeit-p3-all-native-evidence-20261115`: **988/988 tests across
122/122 files**, ESLint, strict TS, compiled production build; test exit 0,
cleanup exit 0, no lab containers remain. No customer messages or external
provider privileges were requested.

Authority: TikTok Business Messaging API official get-started and send
permission documentation; Meta official Embedded Signup permission and
app-review guidance. Normal developer-level OAuth and business identity
provenance is separate from authorization to operate a protected Messaging
API. Existing Meta App Review owner HOLD #169 remains in force.

## 2026-11-15 — strict Telegram Bot API Business connection binding

The native owner OIDC coordinator previously checked only that Bot API
`getBusinessConnection` confirmed the same signed Telegram owner ID,
`is_enabled` and `rights.can_reply`. A focused TDD RED test returned a
**different BusinessConnection.id for the same owner** and exposed an
incorrect activation. The coordinator now additionally requires the
exact returned immutable `connectionId` to match the owner-selected
`businessConnectionId` used in the official authenticated readback,
**before** registry activation or permission-fact persistence. This
prevents a caller or inconsistent provider response swapping a different
Business connection for the one being approved. Source:
https://core.telegram.org/bots/api#getbusinessconnection

The existing distinct signed OIDC account, bot application identity,
current role, independent registry row lock, connection generation, and
default-OFF tenant send gate continue to be enforced. No owner Telegram
settings or live Bot API calls were performed in this regression test.

## 2026-11-15 — original provider-readback time, no delayed freshness inflation

A previously overlooked transfer-provenance race existed in every native
identity-evidence producer: the provider account was verified BEFORE a
potentially slow PostgreSQL registry activation, but facts received a
new `observedAt` only AFTER registry activation returned. If an earlier
owner is disconnected and a newly verified workspace links the same
account while the delayed old activation/evidence write is pending, an
outdated old-owner observation can appear to have happened after the
new owner's claim and incorrectly contribute to the new workspace's
read-only permission display.

All native Instagram, Messenger, WhatsApp Embedded Signup v4 and TikTok
coordinators now capture the actual validated provider readback time
**after authenticated exact account/rights verification and before**
calling `activateVerified`. Both activation proof and optional
app-scoped evidence use that identical time. Native Telegram OIDC Bot API
rights confirmation likewise stamps evidence at its actual validated
`getBusinessConnection` readback, ahead of registry activation, rather
than when optional facts are recorded. The five-minute expiry is relative
to that verified readback, never delayed cache persistence.

The shared `recordNativeAccountIdentityEvidence` helper requires
`observedAt:Date` from its trusted server coordinator and cannot
silently reset it to a later time. A fresh TDD test first failed with
the wrong recorded time while the original implementation was present
(1 failed / 1 passed); after the fix, focused six-suite Node24 test
50/50, lint/strict TypeScript passed. Complete disposable Node24/
PostgreSQL17 `ishikeit-p3-provenance-time-20261115`: **992/992 tests
in 123/123 files**, ESLint, strict TypeScript and production build
passed, lab test exit 0, cleanup exit 0, no named lab resources remain.

The evidence preview never authorizes dispatch or impersonation,
provider app review remains separate, no owner/customer account or
production database was touched. Owner consent, exclusive fenced
release ownership and live customer/registration acceptance remain
outstanding for Priority 3.

## 2026-11-15 — Instagram original OAuth scopes are not refreshed by identity-only readback

A follow-on review found that while the prior `InstagramOAuthClient`
native activation verified the exact account ID from the current token,
the coordinator persisted the **original short-token OAuth scopes**
from its encrypted saved grant as if they were freshly revalidated
during this later identity-only call. An identity lookup alone does not
prove that the historical OAuth scope list remains current.

The native Instagram OAuth **complete** path now captures the actual
authorized OAuth grant's verified timestamp before the durable
connection claim, then optionally persists the observed
`instagram.scope.instagram_business_manage_messages` under the exact
`instagram-login-<app>` application key with a five-minute TTL
calculated from that original grant time. If the owner never completes
the claim or link transaction fails, no scope fact is persisted.
The later **confirm** path requires its original stored scopes as a
precondition for revalidating the identity, but now records **only**
`instagram.oauth` with a new fresh `provider_api` source. It never
renews the old scope fact or asserts `instagram.app_access`.
If current provider evidence or app-review privileges are missing,
the capability preview stays unverified, and tenant sends stay OFF.

Two focused regression expectations first failed (missing grant-time
record and falsely refreshed confirm-time scope). Their corrected
Node24 focused run verified **10/10 tests** across helper and native
Instagram integration, ESLint and strict TypeScript. Full Node24/PG17
suite remains the release verification requirement. No live OAuth call,
provider setting, customer message or source-review assumption was made.

## 2026-11-15 — same-provider, same-app account transfer provenance hardening

A real disposable PG17 regression exposed a remaining owner-rights preview
hazard: an earlier owner's in-flight provider readback can complete **after**
the same provider account is transferred to a different workspace. The
previous timestamp test (`observed_at >= new_link.created_at`) incorrectly
accepted the prior owner's result because both its observation and its
database write occurred after the new owner link. Before remediation this
test returned `official_account_replies=available` incorrectly (1 RED,
6 passing).

The v2 private facts table now adds nullable `source_connection_id uuid`.
Legacy/historical/unscoped fact rows intentionally keep it NULL.
Every native Instagram, Messenger, WhatsApp, TikTok and Telegram Business
verified proof is bound to its **server-verified registry connection ID**
after strict role, app, immutable provider ID and provider API verification.
The original Instagram OAuth grant also retains its actual originating
connection and original consent timestamp rather than acquiring fake fresh
scope rights from identity-only revalidation.

The protected owner/admin read-only preview requires exact matching:
provider + immutable provider account + provider application +
`source_connection_id=current connection UUID` + existing ownership,
timestamp, status, expiration and membership checks. Old owner proofs
cannot reauthorize a new owner even when recorded after transfer.
Unbound old evidence cannot be used for native account rights. The
writer refuses a single proof batch mixing connection IDs. If a late
old-owner proof overwrites the one-per-key v2 cache, the new owner's
rights become **unverified** until a new verified readback rather than
being incorrectly granted; tenant sending remains OFF throughout.
A future protected capability refresh must revalidate the exact current
connection and its generation and must not trust historical provider facts.

TDD RED: delayed previous-owner same-app readback incorrectly returned
`available` (1 failing real PG test / 6 passing). After fix the focused
Node24/PG17 eight-file suite passed 67/67, lint and strict TypeScript
PASS, Docker lab cleanup exit 0. A further negative test ensures that
same-app unbound legacy facts are invisible to the current owner. Full
independent verification is required before any commit.

The two matching SQL migrations remain **expand-only**, byte identical
between isolated app/DB review clones. The original legacy table and
writer's three-column conflict key remain untouched; no existing
production records, old app code, OAuth permissions, MFA or customer
traffic were modified. No production release or native account sending
was authorized.

### Final verification — origin-bound rollout (2026-11-15)

The full disposable Node 24 / PostgreSQL 17 lab
`ishikeit-p3-connection-bound-full2-20261115` completed with ESLint,
strict TypeScript, **994/994 Vitest tests across 123 files**, and a
compiled production build all PASS. Integration cases exercise true
cross-connection old-owner delayed readback, unbound legacy fact rejection,
same-app proof isolation, cross-connection mixed proof batch rejection,
actual anon/authenticated PostgreSQL database privileges, coexistence
with the original three-column INSERT and UPSERT, retained historic fact
quarantine, and Instagram account-deletion cleanup. Test exit 0, lab
cleanup 0, container list empty. No customer/provider data was used.

**No production writes were performed.** The native account preview
remains private read-only and tenant outgoing messaging remains OFF.
The GitHub protected release and provider owner consents remain separate
acceptance gates. This proof is not production approval or a release.
