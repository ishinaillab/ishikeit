# TikTok Marketing OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, advertiser-scoped TikTok Marketing API OAuth foundation that reuses Ishikeit's existing encrypted OAuth infrastructure without changing the working TikTok Business Messaging path or adding any marketing mutation.

**Architecture:** Introduce a dedicated `TikTokMarketingOAuthClient` and `TikTokMarketingOAuthService` using provider namespace `tiktok-marketing`. Reuse the existing TikTok developer app ID/secret and OAuth state/encryption store, but keep advertiser authorization URL, callback, credentials, and later Marketing API operations isolated from Business Messaging. Make OAuth access expiry nullable in storage so long-term Marketing credentials do not receive invented expiry dates.

**Tech Stack:** Node.js 24, TypeScript 5.9, Fastify 5, Zod 4, PostgreSQL/Supabase, Vitest 4, Pino 9, TikTok API for Business Marketing API v1.3.

**Spec:** `docs/superpowers/specs/2026-10-04-tiktok-marketing-oauth-design.md`

## Global Constraints

- Existing Messenger, Instagram, WhatsApp, Telegram, and TikTok Business Messaging behavior must remain unchanged.
- Marketing OAuth provider namespace is exactly `tiktok-marketing`.
- Reuse `TIKTOK_BUSINESS_APP_ID`, `TIKTOK_BUSINESS_APP_SECRET`, and `TIKTOK_BUSINESS_API_VERSION`; do not introduce duplicate Marketing app credentials.
- Production advertiser callback is exactly `https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/`.
- Marketing authorization uses TikTok's current long-term-token `POST /open_api/v1.3/oauth2/access_token/` contract.
- Advertiser discovery uses `GET /open_api/v1.3/oauth2/advertiser/get/` with `app_id`, `secret`, and `Access-Token`.
- Do not call the Business Messaging `tt_user` token/refresh endpoints from Marketing OAuth.
- Do not invent an access-token expiry when TikTok's current Marketing contract does not provide one.
- No campaign, ad group, ad, creative, budget, bid, audience, lead, or delivery mutation is in scope.
- No provider credential, authorization code, raw OAuth state, or raw provider response may be committed or logged.
- Every application PR that changes a context-sensitive boundary must update `docs/CONTINUATION.md`.
- Database schema changes belong in `ishinaillab/ishikeit-db` migrations and must be applied before production application code that depends on them.

## Review Focus

- Callback query contains both `code` and `auth_code` but with different values: accept only the current documented Marketing authorization parameter chosen during implementation verification and never silently choose an ambiguous value.
- TikTok token exchange succeeds but advertiser discovery returns no advertiser IDs: reject completion and persist no credential rather than creating an unusable grant.
- One token authorizes multiple advertiser IDs: persist deterministic advertiser-scoped rows without crossing into the `tiktok` messaging namespace.
- Existing Instagram or TikTok Business Messaging credentials have real expiries: nullable schema support must not weaken their refresh/readiness checks.
- Marketing configuration is only partially present: startup validation must fail clearly rather than registering half-working OAuth routes.

---

### Task 1: Make OAuth access expiry nullable without changing existing provider semantics

**Files:**
- Modify: `ishinaillab/ishikeit/src/auth/oauth-store.ts`
- Modify: `ishinaillab/ishikeit/tests/support/memory-oauth-store.ts`
- Modify: `ishinaillab/ishikeit/tests/tiktok-token-manager.test.ts`
- Modify: `ishinaillab/ishikeit/tests/instagram-token-manager.test.ts`
- Create: `ishinaillab/ishikeit-db/supabase/migrations/20261004010000_nullable_oauth_access_expiry.sql`

**Interfaces:**
- Consumes: existing `OAuthCredentialStore`, `OAuthCredential`, `PostgresOAuthCredentialStore`.
- Produces: `OAuthCredential.accessExpiresAt?: Date`; persisted `access_expires_at` may be SQL `NULL`.
- Existing Instagram and TikTok Business Messaging token managers continue to require a concrete expiry wherever their refresh logic depends on it.

- [ ] **Step 1: Write failing application tests for nullable expiry and strict existing-provider behavior**

Add tests that assert:
- `MemoryOAuthStore.put()` and `get()` round-trip a credential with no `accessExpiresAt`.
- TikTok Business Messaging refresh/readiness rejects or treats as unusable a `tiktok` credential whose `accessExpiresAt` is absent.
- Instagram token management does not silently treat an absent expiry as a valid non-expiring Instagram token.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

`npm test -- tests/tiktok-token-manager.test.ts tests/instagram-token-manager.test.ts`

Expected: compile/test failure because `OAuthCredential.accessExpiresAt` is currently required or existing code assumes a `Date`.

- [ ] **Step 3: Change the application model and PostgreSQL row decoder**

In `src/auth/oauth-store.ts`:
- change `OAuthCredential.accessExpiresAt` to `accessExpiresAt?: Date`;
- change `CredentialRow.access_expires_at` to `Date | null`;
- pass `credential.accessExpiresAt ?? null` on insert/update;
- decode SQL `NULL` as omitted `accessExpiresAt`.

Do not change refresh behavior in existing token managers except for the minimum explicit guard required to preserve current semantics.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused test command.

Expected: PASS.

- [ ] **Step 5: Add the database migration**

Create `20261004010000_nullable_oauth_access_expiry.sql` containing only the forward-compatible schema change required to drop the `NOT NULL` constraint from `public.oauth_credentials.access_expires_at`.

Do not modify unrelated OAuth tables or existing rows.

- [ ] **Step 6: Validate the database migration locally/read-only**

In `ishikeit-db`, run the project-native Supabase migration/lint or dry-run workflow available in the authenticated environment. At minimum verify the migration parses and that the resulting column is nullable without changing existing data.

Expected: no schema lint/dry-run error.

- [ ] **Step 7: Commit each repository**

Database repository commit:

`git add supabase/migrations/20261004010000_nullable_oauth_access_expiry.sql && git commit -m "Allow long-term OAuth credentials without expiry"`

Application repository commit:

`git add src/auth/oauth-store.ts tests/support/memory-oauth-store.ts tests/tiktok-token-manager.test.ts tests/instagram-token-manager.test.ts && git commit -m "Support OAuth credentials without synthetic expiry"`

---

### Task 2: Implement the TikTok Marketing authentication client

**Files:**
- Create: `src/auth/tiktok-marketing-oauth.ts`
- Create: `tests/tiktok-marketing-oauth.test.ts`

**Interfaces:**
- Consumes: `fetch`, TikTok app ID/secret, API version, request timeout.
- Produces:
  - `TikTokMarketingTokenResult { accessToken: string; scopes: readonly string[] }`
  - `TikTokMarketingAdvertiser { advertiserId: string; advertiserName?: string }`
  - `TikTokMarketingOAuthClientLike.exchangeAuthorizationCode(authCode: string): Promise<TikTokMarketingTokenResult>`
  - `TikTokMarketingOAuthClientLike.listAuthorizedAdvertisers(accessToken: string): Promise<readonly TikTokMarketingAdvertiser[]>`
  - `TikTokMarketingOAuthRequestError` with `retryable`, optional `status`, optional `providerCode`, and a normalized `stage`.

- [ ] **Step 1: Write failing tests for token exchange**

Tests must assert:
- POST URL is `https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/`;
- JSON body contains exactly `app_id`, `auth_code`, and `secret`;
- no redirect URI or `tt_user` field is added;
- a valid provider response yields only the validated access token/scopes required by the service;
- missing/empty access token is rejected.

- [ ] **Step 2: Run the new test file and verify RED**

Run:

`npm test -- tests/tiktok-marketing-oauth.test.ts`

Expected: FAIL because the new module/classes do not exist.

- [ ] **Step 3: Implement the minimal token-exchange client**

Create `TikTokMarketingOAuthClient` with:

`constructor(options: { appId: string; appSecret: string; apiVersion?: string; requestTimeoutMs?: number; fetchImpl?: typeof fetch })`

and:

`exchangeAuthorizationCode(authCode: string): Promise<TikTokMarketingTokenResult>`

Use JSON POST and `AbortSignal.timeout`.

- [ ] **Step 4: Run token-exchange tests and verify GREEN**

Run the focused test file.

Expected: token-exchange cases PASS.

- [ ] **Step 5: Write failing tests for advertiser discovery and error classification**

Tests must assert:
- GET URL is `/open_api/v1.3/oauth2/advertiser/get/`;
- query contains exact `app_id` and `secret`;
- header contains exact `Access-Token`;
- returned advertiser IDs are non-empty strings and duplicates are removed deterministically;
- empty advertiser result is represented as an empty list, not a synthetic account;
- transport/429/5xx failures are retryable;
- provider permanent rejection is non-retryable;
- safe error metadata contains no token or secret.

- [ ] **Step 6: Implement advertiser discovery and shared response validation**

Add:

`listAuthorizedAdvertisers(accessToken: string): Promise<readonly TikTokMarketingAdvertiser[]>`

and centralized safe TikTok response/error parsing inside the module.

- [ ] **Step 7: Run the full Marketing OAuth unit test file**

Run:

`npm test -- tests/tiktok-marketing-oauth.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

`git add src/auth/tiktok-marketing-oauth.ts tests/tiktok-marketing-oauth.test.ts && git commit -m "Add TikTok Marketing OAuth client"`

---

### Task 3: Add the durable Marketing OAuth service

**Files:**
- Modify: `src/auth/tiktok-marketing-oauth.ts`
- Modify: `tests/tiktok-marketing-oauth.test.ts`
- Modify: `tests/support/memory-oauth-store.ts` only if an observable test helper is required

**Interfaces:**
- Consumes: `OAuthCredentialStore`, `TikTokMarketingOAuthClientLike`, generated advertiser authorization URL, redirect URI.
- Produces:
  - `TikTokMarketingOAuthController.beginAuthorization(): Promise<{ authorizationUrl: string; expiresAt: string }>`
  - `completeAuthorization(state: string, authCode: string): Promise<{ advertiserIds: readonly string[] }>`
  - `status(): Promise<{ authorized: boolean; advertiserIds: readonly string[] }>`

- [ ] **Step 1: Write failing tests for one-time state**

Assert:
- 32 random bytes become base64url state;
- only SHA-256 state hash is stored under provider `tiktok-marketing`;
- exact redirect URI is persisted;
- state expires after configured TTL;
- authorization URL preserves TikTok's generated URL and replaces/adds only `state`;
- replaying the same state is rejected.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

`npm test -- tests/tiktok-marketing-oauth.test.ts`

Expected: FAIL because service is absent.

- [ ] **Step 3: Implement `TikTokMarketingOAuthService.beginAuthorization()` and state consumption**

Use the existing OAuth store's `createAuthorizationState` and `consumeAuthorizationState` with provider `tiktok-marketing`.

- [ ] **Step 4: Write failing completion/persistence tests**

Assert:
- invalid/expired state prevents token exchange;
- state is consumed before exchange so replay cannot retry provider authorization;
- successful exchange followed by zero advertisers rejects completion and stores nothing;
- N verified advertisers persist N `tiktok-marketing` credentials;
- each row uses the advertiser ID as `accountId`;
- each row stores the same access token encrypted by the real store boundary later, no refresh token, and no synthetic `accessExpiresAt`;
- Marketing credentials never use provider `tiktok`;
- callback result/status does not contain the access token or app secret.

- [ ] **Step 5: Implement completion and status**

Implement:

`completeAuthorization(state: string, authCode: string): Promise<{ advertiserIds: readonly string[] }>`

and:

`status(): Promise<{ authorized: boolean; advertiserIds: readonly string[] }>`

Sort advertiser IDs for deterministic status output.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Marketing OAuth test file.

Expected: PASS.

- [ ] **Step 7: Commit**

`git add src/auth/tiktok-marketing-oauth.ts tests/tiktok-marketing-oauth.test.ts && git commit -m "Persist TikTok Marketing advertiser authorization"`

---

### Task 4: Add Marketing OAuth environment validation

**Files:**
- Modify: `src/config/env.ts`
- Modify: `tests/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: existing `TIKTOK_BUSINESS_APP_ID`, `TIKTOK_BUSINESS_APP_SECRET`, `TIKTOK_BUSINESS_API_VERSION`, `OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64`, `OPS_METRICS_TOKEN`.
- Produces:
  - `TIKTOK_MARKETING_AUTHORIZATION_URL?: string`
  - `TIKTOK_MARKETING_REDIRECT_URI?: string`
  - `TIKTOK_MARKETING_OAUTH_STATE_TTL_SECONDS: number` default 600
  - `TIKTOK_MARKETING_OAUTH_REQUEST_TIMEOUT_MS: number` default 10000

- [ ] **Step 1: Write failing environment tests**

Assert:
- no Marketing variables is valid and leaves Marketing OAuth disabled;
- both Marketing URLs plus existing app ID/secret/encryption/ops token is valid;
- either Marketing URL alone fails;
- Marketing URLs without TikTok app ID/secret fail;
- configured Marketing OAuth without encryption key fails;
- configured Marketing OAuth without ops token fails;
- production authorization URL must be HTTPS and use `tiktok.com` or a subdomain;
- redirect must be HTTPS, have no query/fragment, and end in `/`;
- Business Messaging OAuth can remain independently configured or unconfigured.

- [ ] **Step 2: Run env tests and verify RED**

Run:

`npm test -- tests/env.test.ts`

Expected: FAIL because new variables/validation do not exist.

- [ ] **Step 3: Implement Zod fields and `superRefine` validation**

Do not introduce `TIKTOK_MARKETING_APP_ID`, `TIKTOK_MARKETING_APP_SECRET`, or a second API version.

- [ ] **Step 4: Update `.env.example`**

Document only the Marketing authorization URL, advertiser callback URI, state TTL, and request timeout, explicitly noting reuse of the existing TikTok developer app ID/secret.

- [ ] **Step 5: Run env tests and typecheck**

Run:

`npm test -- tests/env.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

`git add src/config/env.ts tests/env.test.ts .env.example && git commit -m "Configure TikTok Marketing OAuth"`

---

### Task 5: Expose protected Marketing OAuth start/status and public advertiser callback

**Files:**
- Modify: `src/http/server.ts`
- Modify: `tests/http.test.ts`

**Interfaces:**
- Consumes: `TikTokMarketingOAuthController`.
- Produces `ServerDeps.tiktokMarketingOAuth?: { service: TikTokMarketingOAuthController }`.
- Produces routes:
  - `POST /ops/tiktok/marketing/oauth/start`
  - `GET /ops/tiktok/marketing/oauth/status`
  - `GET /ishikeit/oauth/tiktok/advertiser/callback/`

- [ ] **Step 1: Write failing route-registration and auth tests**

Assert:
- routes are absent when `tiktokMarketingOAuth` is undefined;
- supplying Marketing OAuth without `OPS_METRICS_TOKEN` throws at server construction;
- start/status reject missing/wrong bearer with 401 and `WWW-Authenticate`;
- authenticated start/status return `private, no-store`.

- [ ] **Step 2: Run HTTP tests and verify RED**

Run:

`npm test -- tests/http.test.ts`

Expected: FAIL because new dependency/routes do not exist.

- [ ] **Step 3: Add `tiktokMarketingOAuth` to `ServerDeps` and protected routes**

Match existing TikTok operational-route patterns without changing the current `/ops/tiktok/oauth/*` routes.

- [ ] **Step 4: Write failing callback tests**

Pin:
- missing state/code returns 400 and performs no exchange;
- use the current documented advertiser callback parameter `auth_code` as the required authorization code;
- if both `auth_code` and legacy/auxiliary `code` are present with different values, use only `auth_code` and never infer advertiser identity from either `code` or `id`;
- callback response is `no-store`;
- success text contains advertiser IDs or a generic count only, never the access token/secret;
- provider/service failure returns generic 400 text;
- warning log contains no raw state, auth code, token, or secret.

- [ ] **Step 5: Implement the public callback**

Add safe state fingerprint logging using SHA-256 truncation, mirroring the Instagram callback pattern.

- [ ] **Step 6: Run HTTP tests and verify GREEN**

Run the HTTP test file.

Expected: PASS.

- [ ] **Step 7: Commit**

`git add src/http/server.ts tests/http.test.ts && git commit -m "Expose TikTok Marketing OAuth routes"`

---

### Task 6: Wire Marketing OAuth into the HTTP process without affecting messaging dispatch

**Files:**
- Modify: `src/processes/http.ts`
- Modify: `tests/http.test.ts` if process-level behavior is already covered there
- Modify: `docs/CONTINUATION.md`

**Interfaces:**
- Consumes: environment from Task 4 and service/client from Tasks 2-3.
- Produces: configuration-gated Marketing OAuth service passed to `buildServer`.
- No `ActionDispatcher.register(...)` call for Marketing in this task.

- [ ] **Step 1: Write/extend a failing regression test for unconfigured Marketing OAuth**

Assert that an environment with existing messaging configuration and no Marketing variables does not construct/register Marketing OAuth routes and does not alter existing dispatcher/provider behavior.

- [ ] **Step 2: Verify RED if a new process seam is required**

Run the smallest existing test file that owns process/server wiring. If direct process import is not testable because it boots the service, keep the test at env + HTTP dependency boundaries rather than adding a production-only testing hook.

- [ ] **Step 3: Wire the Marketing client/service**

Define `tiktokMarketingOAuthConfigured` from:
- existing TikTok app ID/secret;
- `TIKTOK_MARKETING_AUTHORIZATION_URL`;
- `TIKTOK_MARKETING_REDIRECT_URI`;
- encryption store availability.

Instantiate `TikTokMarketingOAuthClient` with the shared app credentials/API version and Marketing timeout, then `TikTokMarketingOAuthService`.

Pass it to `buildServer` only when complete.

- [ ] **Step 4: Preserve readiness semantics**

Ensure:
- unconfigured Marketing OAuth does not affect readiness;
- configured Marketing OAuth requires the already-existing OAuth store to be ready;
- no advertiser authorization is required for `/health/ready`;
- existing TikTok Business Messaging `tiktokAuthorizationReady()` remains unchanged.

- [ ] **Step 5: Update durable continuation context**

Add a concise section to `docs/CONTINUATION.md` recording:
- new Marketing OAuth boundary;
- provider namespace;
- exact callback;
- nullable-expiry migration dependency;
- no Marketing mutation support;
- existing messaging paths unchanged;
- production activation remains configuration/interactivity-gated until verified.

Do not record secrets.

- [ ] **Step 6: Run focused tests and full local gate**

Run:

`npm test -- tests/tiktok-marketing-oauth.test.ts tests/env.test.ts tests/http.test.ts tests/tiktok-oauth.test.ts tests/tiktok-token-manager.test.ts`

Then:

`npm run check`

Then:

`git diff --check`

Expected: all PASS with no warnings/errors.

- [ ] **Step 7: Commit**

`git add src/processes/http.ts docs/CONTINUATION.md && git commit -m "Wire TikTok Marketing OAuth foundation"`

Include any task-owned test file if it changed.

---

### Task 7: Review both repository diffs before merge

**Files:**
- Review all files changed in `ishikeit`.
- Review migration changed in `ishikeit-db`.

**Interfaces:**
- Consumes: completed Tasks 1-6.
- Produces: merge-ready branches with no scope expansion.

- [ ] **Step 1: Inspect the application diff**

Check specifically for:
- any `tt_user` use inside Marketing code;
- any `tiktok-marketing` credential lookup inside messaging code;
- any second TikTok app secret variable;
- any synthetic expiry;
- any Marketing action dispatcher registration;
- any secret/raw callback query logging;
- any unrelated refactor.

Expected: none.

- [ ] **Step 2: Inspect database diff**

Expected: one migration changing only `oauth_credentials.access_expires_at` nullability.

- [ ] **Step 3: Run application CI-equivalent gate from a clean install if execution environment permits**

`npm ci --ignore-scripts && npm run check`

Expected: PASS.

- [ ] **Step 4: Re-run database migration validation**

Use `supabase migration list`, schema lint/dry-run, or the strongest non-destructive project-native validation available before merge.

Expected: pending migration is exactly the new nullable-expiry migration and validates cleanly.

- [ ] **Step 5: Ensure no secrets are present**

Search changed files for token-like values, TikTok secret material, authorization codes, database URLs, and local handoff paths containing credentials.

Expected: no secrets.

---

### Task 8: Merge and deploy in dependency order

**Files/Systems:**
- `ishinaillab/ishikeit-db`
- production Supabase project
- `ishinaillab/ishikeit`
- Hostinger Node application

**Interfaces:**
- Consumes: merge-ready database and application branches.
- Produces: production code capable of serving Marketing OAuth while still disabled until Marketing URL settings are configured.

- [ ] **Step 1: Merge the database migration first**

After CI/review, merge the `ishikeit-db` migration branch.

- [ ] **Step 2: Apply the migration with Supabase CLI**

Run authenticated:

`supabase migration list`

then:

`supabase db push`

then verify migration list again.

Expected: local/remote migration histories agree and `access_expires_at` is nullable.

- [ ] **Step 3: Merge the application branch**

Merge only after database application is verified.

- [ ] **Step 4: Verify Hostinger deploy with Marketing OAuth still unconfigured**

Verify:
- deployed SHA is the merged application revision;
- `GET /health/live` = 200;
- `GET /health/ready` = 200;
- `GET /health/capabilities` still reports the expected existing runtime;
- recent runtime logs contain no new warnings/errors;
- existing four active messaging paths remain operational, and TikTok Business Messaging behavior is unchanged if active.

- [ ] **Step 5: Record deployment evidence**

Update `docs/CONTINUATION.md` in a follow-up context-only commit if deployment state differs from what the implementation PR could know before merge.

---

### Task 9: Configure and verify Marketing OAuth without making a marketing mutation

**Files/Systems:**
- Hostinger environment secret storage
- TikTok API for Business app configuration
- production PostgreSQL OAuth tables

**Interfaces:**
- Consumes: deployed Marketing OAuth code and existing TikTok developer app credentials.
- Produces: verified advertiser authorization only.

- [ ] **Step 1: Confirm the registered advertiser redirect URL**

It must exactly match:

`https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/`

Do not change the account-holder callback.

- [ ] **Step 2: Add only Marketing-specific runtime settings**

Set:
- `TIKTOK_MARKETING_AUTHORIZATION_URL`
- `TIKTOK_MARKETING_REDIRECT_URI`
- optional non-secret timeout/TTL overrides only if intentionally different from defaults

Reuse the already-stored TikTok app ID/secret and OAuth encryption key.

- [ ] **Step 3: Verify routes before interactive authorization**

Authenticated start:
- returns an official TikTok authorization URL;
- contains a fresh state;
- contains no secret/token.

Authenticated status:
- returns `authorized=false` or an empty advertiser list before first authorization.

Health remains green.

- [ ] **Step 4: Complete one real advertiser authorization interactively**

This requires the advertiser/account owner's TikTok verification and consent. Do not automate around TikTok's verification challenge.

- [ ] **Step 5: Verify durable result without exposing token values**

Confirm:
- callback succeeds;
- at least one advertiser ID came from `/oauth2/advertiser/get/`;
- one `tiktok-marketing` credential row exists per verified advertiser;
- `access_expires_at IS NULL` for the Marketing row when no expiry is provided by the current contract;
- no `tiktok` Business Messaging credential was overwritten;
- status returns advertiser IDs only;
- logs contain no secret, token, raw state, or auth code.

- [ ] **Step 6: Run one read-only Marketing API proof**

Use a current documented read-only endpoint for one authorized advertiser, preferably account details, and verify the Marketing token is accepted.

Do not create/update campaigns, ads, budgets, bids, audiences, leads, or other marketing resources.

- [ ] **Step 7: Record final production checkpoint**

Update `docs/CONTINUATION.md` with:
- actual deployed SHA;
- database migration applied state;
- authorized advertiser IDs only if they are non-secret operational identifiers appropriate for durable context;
- read-only provider proof;
- explicit statement that Marketing mutations remain unimplemented.

Commit the context update and verify CI.
