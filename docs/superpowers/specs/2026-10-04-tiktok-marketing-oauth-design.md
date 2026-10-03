# TikTok Marketing OAuth design

Date: 2026-10-04
Status: approved architecture; implementation complete on feature branch; pending merge/deploy
Scope: advertiser authorization foundation only

## 1. Purpose

Add the TikTok Marketing API advertiser-authorization boundary to Ishikeit without changing the working TikTok Business Messaging path or the provider-neutral durable event/action architecture.

This milestone establishes secure advertiser authorization, durable encrypted Marketing API credentials, account discovery, and protected operational status. It deliberately does **not** create, update, pause, or spend money on campaigns, ad groups, ads, creatives, budgets, bids, leads, or other marketing resources.

The resulting boundary must support later capability families such as:

- `tiktok / marketing / campaign.*`
- `tiktok / marketing / adgroup.*`
- `tiktok / marketing / ad.*`
- `tiktok / marketing / reporting.*`
- future TikTok lead/account operations

Those later capabilities must not be routed through `tiktok / messaging / message.send`.

## 2. Current repository baseline

Ishikeit already has a separate TikTok Business Messaging OAuth flow:

- `src/auth/tiktok-oauth.ts`
- `src/auth/tiktok-token-manager.ts`
- `POST /ops/tiktok/oauth/start`
- `GET /ops/tiktok/oauth/status`
- `GET /ishikeit/oauth/tiktok/callback/`
- provider namespace `tiktok`
- token exchange through the TikTok account-holder `/tt_user/oauth2/token/` contract
- refresh-token lifecycle through `/tt_user/oauth2/refresh_token/`
- messaging adapter `tiktok / messaging / message.send`

That flow is production-sensitive and must remain behaviorally unchanged by this work.

The advertiser redirect already registered/intended for Ishikeit is:

`https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/`

## 3. Current TikTok contract

Current TikTok API for Business documentation distinguishes advertiser authorization for the Marketing API from TikTok account-holder authorization.

For advertiser authorization:

1. the developer uses the app's generated **Advertiser authorization URL**;
2. the advertiser reviews permissions and authorizes the app;
3. TikTok redirects to the registered advertiser redirect URL with a one-time authorization code;
4. the authorization code is valid for one hour and can be used only once;
5. the server exchanges the code through `POST /open_api/v1.3/oauth2/access_token/`;
6. the current Marketing API flow returns a long-term access token;
7. the legacy Marketing `/oauth2/refresh_token/` flow is deprecated because Marketing access tokens are long-term;
8. authorized advertiser accounts can be enumerated with the Marketing authentication advertiser-list operation.

This is a different lifecycle from the existing Business Messaging / TikTok-account flow, whose access tokens are short-lived and refreshed through the `tt_user` endpoints.

Authoritative references used for this design:

- TikTok API for Business — Authorization, doc ID `1738373141733378`
- TikTok API for Business — Deprecated Endpoints, doc ID `1740579480076290`
- TikTok official Business API SDK — Authentication API (`/open_api/v1.3/oauth2/access_token/` and advertiser-list operation)

The generated SDK still contains older refresh-token wording around the shared authentication endpoint. For Marketing OAuth lifetime/refresh behavior, the current TikTok provider documentation and current deprecation notice are authoritative over stale generated SDK prose.

Implementation must re-check the live TikTok reference immediately before coding request/response parsers. Where current provider documentation does not guarantee a response field, code must not infer it.

## 4. Architectural decision

Create a dedicated Marketing OAuth boundary rather than adding a mode to the current Business Messaging OAuth classes.

New logical components:

- `TikTokMarketingOAuthClient`
- `TikTokMarketingOAuthService`
- a later, separate Marketing credential provider when Marketing API operations are introduced

The existing `TikTokOAuthClient`, `TikTokOAuthService`, and `TikTokAccessTokenManager` remain dedicated to TikTok account-holder / Business Messaging authorization.

### Why separate classes

The two authorization families differ in:

- authorization URL purpose;
- token endpoint contract;
- authorization-code lifetime;
- access-token lifetime;
- refresh semantics;
- account identity;
- permissions;
- later API operations.

Combining them behind a mode flag would make credential rules and failure handling conditional throughout the class and increase the chance of a Marketing credential being used for messaging or vice versa.

## 5. Credential namespace and isolation

Use a distinct durable OAuth provider namespace:

`tiktok-marketing`

Do not store Marketing API credentials under the existing `tiktok` provider namespace.

This guarantees that:

- Business Messaging token lookup cannot select a Marketing token;
- Marketing code cannot silently select a Business Messaging token;
- status and revocation can be scoped to the correct authorization family;
- future dispatchers can request a Marketing credential by advertiser ID without coupling to messaging.

## 6. OAuth state and CSRF protection

Reuse the existing durable `oauth_authorization_states` mechanism.

`TikTokMarketingOAuthService.beginAuthorization()` will:

1. generate 32 random bytes;
2. encode them as base64url state;
3. SHA-256 hash the state before persistence;
4. persist only the hash with provider `tiktok-marketing`, exact advertiser redirect URI, and expiry;
5. copy the TikTok-generated advertiser authorization URL;
6. set/replace only its `state` query parameter;
7. return the authorization URL and state expiry.

The callback must consume state atomically before exchanging the code. A state is one-time, provider-scoped, expiry-bounded, and redirect-URI-bound.

No raw authorization code, state, token, app secret, or token response may be logged.

## 7. HTTP surface

Add a separate dependency to `ServerDeps`, for example `tiktokMarketingOAuth`.

### Protected start

`POST /ops/tiktok/marketing/oauth/start`

- requires the existing `OPS_METRICS_TOKEN` bearer credential;
- returns `private, no-store`;
- returns the generated advertiser authorization URL and expiry;
- does not expose app secret or stored credentials.

### Public callback

`GET /ishikeit/oauth/tiktok/advertiser/callback/`

Accepted query inputs are limited to the current documented authorization-code aliases TikTok actually sends after final implementation verification. The parser must not accept arbitrary query data as identity.

The callback:

1. rejects missing state/code;
2. atomically consumes state;
3. exchanges the authorization code server-side;
4. verifies/discovers authorized advertiser accounts using TikTok's current Marketing authentication/account-discovery contract;
5. stores encrypted credentials;
6. returns a generic human-readable success page with no access token and no secret data.

Failures return a generic browser message. Logs may contain only a safe stage classification, provider HTTP/code metadata, and a short state fingerprint.

### Protected status

`GET /ops/tiktok/marketing/oauth/status`

The initial status surface returns only non-secret operational metadata, such as:

- configured/unconfigured;
- authorized advertiser IDs;
- granted scopes if TikTok returns them as part of the verified contract;
- credential version/update metadata if needed for operations.

It must never return an access token, app secret, authorization code, ciphertext, IV, authentication tag, or raw provider response.

## 8. Marketing token persistence

### No synthetic expiry

The current OAuth store requires `access_expires_at NOT NULL`. Current Marketing documentation describes the advertiser token as long-term and deprecates the Marketing refresh endpoint. The implementation must **not** invent an expiry timestamp such as 2099, `Date.MAX_VALUE`, or a guessed lifetime merely to satisfy the existing schema.

Add a database migration that makes `oauth_credentials.access_expires_at` nullable.

Update the repository model so `OAuthCredential.accessExpiresAt` can be absent.

Existing providers remain stricter:

- Instagram authorization continues to persist a real expiry and its token manager must continue to require one where refresh logic depends on it.
- TikTok Business Messaging continues to persist a real access-token expiry and refresh-token expiry and must continue to pass the existing readiness/refresh rules.
- only an OAuth family whose authoritative provider contract has no usable expiry may persist `NULL`.

This is a representational change, not a change to the behavior of existing token managers.

### Advertiser identity

After the Marketing access token is obtained, use TikTok's authenticated advertiser-list operation to establish which advertiser IDs the token can manage.

For the first milestone, persist one `tiktok-marketing` credential row per authorized advertiser ID. Each row:

- uses the advertiser ID as `account_id`;
- stores the access token encrypted through the existing AES-256-GCM `CredentialCipher`;
- stores no refresh token unless TikTok's current Marketing contract explicitly requires one at implementation time;
- stores `access_expires_at = NULL` when the current contract provides no expiry;
- stores only verified scope metadata.

A token authorizing several advertiser IDs may therefore be encrypted into several advertiser-scoped rows. This duplication is intentional in the first milestone because it gives deterministic advertiser-ID lookup without introducing a second credential/alias abstraction before a Marketing dispatcher exists.

If later production evidence shows that a single Marketing grant routinely spans many advertisers and requires centralized token rotation/revocation, replace this with a grant-plus-alias model in a dedicated migration. Do not introduce that complexity speculatively in this milestone.

## 9. Configuration contract

The advertiser authorization belongs to the same TikTok API for Business developer app already represented by `TIKTOK_BUSINESS_APP_ID` and `TIKTOK_BUSINESS_APP_SECRET`. Reuse those app credentials rather than introducing duplicate Marketing app-ID/app-secret variables.

Add only Marketing-specific configuration:

`TIKTOK_MARKETING_AUTHORIZATION_URL`
`TIKTOK_MARKETING_REDIRECT_URI`
`TIKTOK_MARKETING_OAUTH_STATE_TTL_SECONDS` (default 600)
`TIKTOK_MARKETING_OAUTH_REQUEST_TIMEOUT_MS` (default 10000)

Reuse `TIKTOK_BUSINESS_API_VERSION` (currently default `v1.3`) unless TikTok documents a different Marketing API version contract at implementation time.

The redirect URI is fixed for production to:

`https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/`

Marketing OAuth is considered configured only when the existing TikTok developer app ID/secret plus both Marketing-specific URL settings are present. A partial Marketing OAuth configuration is a startup validation error. The existing Business Messaging account-holder authorization URL is **not** required merely to enable Marketing OAuth.

Production validation must require:

- existing `TIKTOK_BUSINESS_APP_ID`;
- existing `TIKTOK_BUSINESS_APP_SECRET`;
- HTTPS advertiser authorization URL;
- official TikTok host for the generated authorization URL;
- HTTPS redirect URI;
- no query string or fragment on the redirect URI;
- trailing slash matching the registered URI;
- `OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64`;
- `OPS_METRICS_TOKEN`.

Business Messaging authorization and Marketing authorization remain independently enableable even though they share the same developer-app identity.

## 10. Provider client behavior

`TikTokMarketingOAuthClient` owns only Marketing authentication calls in this milestone.

Responsibilities:

- exchange one-time authorization code;
- enumerate advertisers accessible to the returned access token;
- validate successful provider response shape;
- bound request duration;
- classify provider vs transport failure;
- never log credentials.

The client must use only current, documented Marketing API endpoints. It must not call the Business Messaging `tt_user` token/refresh endpoints.

Provider errors should expose only safe structured metadata:

- retryable;
- HTTP status when available;
- TikTok error code when available;
- normalized stage.

Do not expose provider response bodies through public callback responses.

## 11. Readiness and rollout

Marketing OAuth is configuration-gated.

Adding its code must not make `/health/ready` fail merely because Marketing OAuth is intentionally unconfigured.

When fully configured, readiness should verify only local prerequisites required to safely serve the OAuth flow:

- OAuth schema is present;
- encryption store is ready.

Readiness must not require an advertiser to already be authorized. Authorization is an operational state, not a process-start prerequisite.

Do not register any Marketing action dispatcher in this milestone.

Do not change:

- `PROCESSOR_ENABLED`;
- `ACTION_DISPATCH_ENABLED`;
- TikTok Business Messaging webhook registration;
- current messaging token managers;
- current Messenger/Instagram/WhatsApp/Telegram adapters.

## 12. Security requirements

- server-side token exchange only;
- state generated with cryptographic randomness;
- only state hash persisted;
- one-time state consumption;
- exact redirect binding;
- AES-256-GCM credential encryption through the existing cipher;
- no tokens/secrets in Git or committed docs;
- no tokens in logs;
- the shared TikTok developer app secret remains included in logger redaction;
- operational start/status protected by bearer auth;
- callback and ops responses use `no-store`;
- strict request timeout;
- bounded provider error messages;
- no Marketing mutation endpoints in this milestone.

No second Marketing app secret is introduced. Existing redaction of `TIKTOK_BUSINESS_APP_SECRET` must remain effective for both OAuth families.

## 13. TDD and regression coverage

Implementation follows test-first development.

Minimum tests:

1. Marketing client posts to the current documented Marketing `/oauth2/access_token/` endpoint rather than a `tt_user` endpoint.
2. Request contains only the documented app/code fields.
3. Transport failures are retryable.
4. Provider rejections are classified safely.
5. Missing/invalid token response is rejected.
6. Advertiser discovery returns validated advertiser IDs.
7. Begin authorization persists only the state hash.
8. Callback state is one-time.
9. Expired/invalid state is rejected before credential persistence.
10. Callback does not expose token/secret data.
11. One credential is encrypted/persisted per verified advertiser ID.
12. Marketing credentials use provider `tiktok-marketing`, not `tiktok`.
13. Marketing credentials can represent `accessExpiresAt = undefined`.
14. Existing Instagram expiring-token tests remain green.
15. Existing TikTok Business Messaging refresh tests remain green.
16. Partial Marketing env configuration fails validation.
17. Unconfigured Marketing OAuth leaves its routes unavailable without harming health.
18. Ops routes require bearer auth.
19. HTTP responses are no-store.
20. Existing messaging adapter registrations and tests remain green.

Full repository gate after implementation:

- lint;
- typecheck;
- full test suite;
- production build;
- `git diff --check`;
- context-continuity check.

Database migration validation must include Supabase schema lint/dry-run using the project-native workflow before production application.

## 14. Expected code/database touch points

Application repository, likely:

- `src/auth/tiktok-marketing-oauth.ts` — new
- `tests/tiktok-marketing-oauth.test.ts` — new
- `src/auth/oauth-store.ts` — nullable access expiry support
- `tests/support/memory-oauth-store.ts` — nullable access expiry support
- `src/config/env.ts`
- `tests/env.test.ts`
- `.env.example`
- `src/http/server.ts`
- `tests/http.test.ts`
- `src/processes/http.ts`
- `src/observability/logger.ts` and its tests if needed for redaction
- `docs/CONTINUATION.md`

Database repository:

- one migration making `oauth_credentials.access_expires_at` nullable

No new campaign/action adapter is part of this change.

## 15. Rollout sequence

1. Merge and apply the database migration first.
2. Merge application support with Marketing OAuth environment unset.
3. Verify existing production health and the four currently working messaging platforms are unaffected.
4. Add only the Marketing advertiser authorization URL and redirect URI/settings to Hostinger while reusing the existing TikTok developer app ID/secret.
5. Verify protected start/status routes and generated authorization URL without exposing credentials.
6. Complete one real advertiser authorization interactively.
7. Verify advertiser-scoped encrypted credential rows and protected status.
8. Run a **read-only** Marketing API proof against the authorized advertiser, if a suitable current endpoint is available and approved for the granted scope.
9. Update `docs/CONTINUATION.md` with verified production evidence.

No campaign creation, update, budget, bid, or delivery-changing call is authorized by this rollout.

## 16. Success criteria

This milestone is complete when:

- the advertiser authorization route exists and matches the registered redirect URI;
- a real advertiser can authorize Ishikeit;
- one-time state protection is proven;
- the Marketing authorization code is exchanged through the current Marketing endpoint;
- authorized advertiser IDs are established from TikTok rather than inferred from callback text;
- credentials are encrypted and isolated under `tiktok-marketing`;
- no fake expiry is stored;
- protected status shows non-secret authorization state;
- existing TikTok Business Messaging behavior is unchanged;
- existing Messenger, Instagram, WhatsApp, and Telegram regressions remain green;
- repository checks pass;
- production authorization is verified without making a marketing mutation.

## 17. Explicit non-goals

Not included:

- campaign creation/update;
- ad-group creation/update;
- ad/creative creation/update;
- budget or bid changes;
- campaign status changes;
- audience mutation;
- lead retrieval or mutation;
- Marketing reporting UI;
- scheduled ad-management automation;
- automatic advertiser authorization;
- storing app secrets anywhere except server-side secret storage;
- merging TikTok Business Messaging and Marketing OAuth into one token family.
