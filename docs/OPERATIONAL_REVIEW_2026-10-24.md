# Ishikeit operational review — 2026-10-24 (PHT)

> Read-only application / WordPress / Cloudflare investigation, plus one controlled Supabase security migration. This checkpoint branch is **not** intended for Hostinger deployment. The application production branch remains `main`. Do not use retired `/ishinaillab/ishi`.

## Canonical references

- App: `ishinaillab/ishikeit` `main`; current latest inspected app commit `f02dfc57471d32ad8b86efaebd832148e3576a23` (2026-10-11).
- Database: `ishinaillab/ishikeit-db` `main`.
- Backend: `https://apps.ishinaillab.com` (Hostinger, Node 24, Fastify).
- WordPress AI Engine bridge: `https://www.ishinaillab.com/wp-json/ishi-ai/v1`, plugin Ishi AI Bridge 0.3.0.
- TikTok Comment-to-Message: unmerged `ishikeit` PR #71 / `feature/tiktok-comment-to-message`; this branch diverged from `main` by +20/-2 commits at review time.

## Production application check — 2026-10-24

Public endpoints retrieved independently via Context web scrape (raw response bytes):

- `GET /health/live` → `{"status":"ok"}`.
- `GET /health/ready` → `{"status":"ready"}`.
- `GET /health/capabilities` → `architecture=event-action-v1`, `canonicalEventSchema=2`, `actionSchema=1`, `operationalMetricsSchema=2`, `wordpressBridgeApiSchema=3`, `wordpressBridgeStorageSchema=1.1.1`; `processorEnabled=true`, `actionDispatchEnabled=true`, `processorCanaryPartitionCount=0`, `processorCutoverAt=2026-09-30T10:31:25.208Z`, `videoInterpreterProvider=none`. TikTok Business Messaging read/webhook/image schema markers remain exposed; this does **not** prove provider approval or production message delivery.
- These public health endpoints do not expose the running commit SHA. Do not assume that current production revision equals a GitHub commit unless Hostinger build metadata is read separately.
- WordPress authenticated connector confirms Ishi AI Bridge `0.3.0` **active**, AI Engine Pro `3.8.6` **active**.
- Authenticated private bridge health itself was **not** tested. Unauthenticated scraping of that endpoint encountered an anti-bot/access wall. Do not treat that as a failed authenticated bridge call.

## Supabase live database and incident findings

Project `ishikeit-db` reported `ACTIVE_HEALTHY`. At review time:

- `public.inbound_events`: 499 rows; `public.outbox`: 712 rows; `public.outbox_attempts`: 659 rows.
- Outbox pending across topics: 0.
- `inbound.event.accepted`: 32 historical dead letters, 10 newly dead-lettered within previous seven days, all latest on 2026-10-20.
- `action.dispatch`: 11 historical dead letters, zero newly dead-lettered within previous seven days.
- Recent failed inbound records from Messenger, WhatsApp, Telegram explicitly record `WordPress AI bridge returned HTTP 502` or (WhatsApp) `HTTP 522`; no evidence of provider outbound send faults causing these inbound-processing failures.
- Latest recorded message and outbound publish: Telegram 2026-10-23T09:37 UTC. Recent successful Instagram, Messenger, WhatsApp messages recorded before that.
- **Do not automatically replay old dead-lettered customer messages:** delay/duplicate sends would be possible. Require human review and safe per-conversation replay strategy.

## Cloudflare incident evidence — 2026-10-20

Read-only authorized Cloudflare GraphQL `httpRequestsAdaptiveGroups` for zone `ishinaillab.com`, bridge request path `/wp-json/ishi-ai/v1/turn`:

For **2026-10-20T13:45:00Z through 14:50:00Z**:

- 45 requests: `edgeResponseStatus=502`, `originResponseStatus=502` (the origin returned bad gateway).
- 1 request: `edgeResponseStatus=522`, `originResponseStatus=0` (origin connection timeout).
- 2 requests: `edgeResponseStatus=525`, `originResponseStatus=0` (origin TLS handshake failure).

Other non-bridge paths also showed `522` in that incident window, supporting an origin/connectivity incident rather than a social-platform-specific fault.

For **2026-10-21T00:00:00Z to 2026-10-24T00:00:00Z**, the bridge path's available aggregated analytics recorded 3 responses with `edgeResponseStatus=200` and `originResponseStatus=200` and no other result groups. This suggests recovery; it does **not** establish permanent reliability or diagnose the underlying host/PHP process mechanism.

Cloudflare's legacy Zone Analytics API is sunset; use GraphQL Analytics API for subsequent investigations. GraphQL adaptive counts are subject to sampling/retention rules as provided by Cloudflare.

The WordPress PHP error log available through Easy MCP AI is `error_log_ishinaillab_com` (380,528 bytes at the time read), with no lines matching the October 20 date string or `ishi-ai`. The available live log does not prove what PHP/FastCGI was doing during the incident. Hostinger PHP-FPM/webserver/origin logs and resource ceilings for that window remain unverified.

WordPress Site Health performed during review: 27 good / 4 recommended / 2 critical on async run, with the criticals including Aipatch Scanner score 45/100 (site-level concern separate from Ishikeit) and page caching absent / median homepage server response 1,694 ms. LiteSpeed Cache is currently inactive by deliberate prior decision; do **not** enable page caching without checking Elementor correctness, booking, customer data and `/wp-json/ishi-ai/v1/*` non-cache requirements. Site Health aggregate counts varied with runs, so refer to named tests rather than assuming fixed totals.

## Critical Supabase security exposure — **remediated on production**

Supabase Security Advisor initially reported `rls_disabled_in_public` on `public.outbox_attempts` and broad `anon`/`authenticated` table privileges.

Executed production migration through authorized Supabase MCP:

- migration version: `20261023205748`
- migration name: `secure_outbox_attempts_rls_and_client_access`
- DDL:
  ```sql
  REVOKE ALL PRIVILEGES ON TABLE public.outbox_attempts FROM anon, authenticated;
  ALTER TABLE public.outbox_attempts ENABLE ROW LEVEL SECURITY;
  ```
- Verified `relrowsecurity=true`; `anon` and `authenticated` have no `SELECT` on that table; `postgres` retains `INSERT`; Security Advisor's `rls_disabled_in_public` finding is gone. Other internal tables have RLS enabled without client policies intentionally.
- Canonical Git migration file committed and fetched for read-back:
  `ishinaillab/ishikeit-db` `main`: `supabase/migrations/20261023205748_secure_outbox_attempts_rls_and_client_access.sql`, commit `b0586a230dc5647c3c9ad461df1caf4f4151d47e`.
- Post-change `/health/live` and `/health/ready` remain healthy, both workers enabled; outbox still zero pending. No artificial customer message was sent; a new real post-migration message canary has not yet been performed.

Supabase reference: https://supabase.com/docs/guides/api/securing-your-api

## Pending engineering / external gates

1. Obtain authorized Hostinger historical origin/PHP-FPM/webserver logs/resource telemetry for 2026-10-20 13:45–14:50 UTC or a subsequent recurrence. Diagnose the **cause of** origin 502/522/525, not merely the resulting API status. Investigate concurrency/process limits, TLS origin handshake, PHP worker overload, WordPress request latency, and external AI timeouts only when logs support a conclusion.
2. Run fresh authenticated Ishi AI Bridge health and safe future canary (not a customer replay) when available; protect idempotency, no-cache semantics, private tokens and policy limits.
3. Verify Hostinger's currently deployed application revision from build metadata; public endpoint health alone proves availability, not SHA parity.
4. TikTok Business Messaging approval/provider eligibility remains unverified. Do not present a database-less TikTok path as live.
5. PR #71 currently diverges from `main` (ahead 20 / behind 2). Refresh branch and rerun Node 24 CI/tests and cross-channel regressions **before** any merge; retain existing `TIKTOK_COMMENT_TO_MESSAGE_ENABLED` gating and do not activate provider calls without provider permissions and controlled validation.
6. Preserve existing production messaging, Cloudflare rules, WordPress security guards, customer data, booking operations and canonical domains. No unrelated provider mutations or dead-letter replays occurred during this review.

## October 24 continuation — validated diagnostics, security patches, and TikTok integration preflight

### Corrected origin-error interpretation

Inspection of the **deployed** Ishi AI Bridge 0.3.0 source (`wordpress/ishi-ai-bridge/includes/class-ai.php` and `class-rest.php`) confirmed the bridge itself intentionally returns JSON 502 on AI Engine exceptions, invalid AI results, or empty replies. Therefore Cloudflare's `originResponseStatus=502` does **not**, by itself, prove a PHP-FPM/Hostinger web-server gateway failure. Separately observed HTTP 522 and 525 on bridge and unrelated assets do indicate origin connection/TLS problems at the time. Both mechanisms may have contributed. Underlying reason for October 20 AI failures remains unproven without historical application log details. Fresh read-only WPVibe GET `/ishi-ai/v1/health` using WordPress credentials returned 401 because the route specifically requires a *separate bridge bearer token*. This is expected authorization behavior and is not a bridge outage. Do not bypass authentication or read secrets from local `.env` files; local tool guards block protected secret paths.

Production WordPress has Ishi AI Bridge 0.3.0 active; `wp cron test` succeeded. Bridge's WordPress turn storage held 2 completed rows during inspection; this does not identify the failed October 20 turns because failed requests release the idempotency claim. Production outbox remained at 0 pending, 43 historical dead letters through final check, no new ingress since 2026-10-23T09:37Z.

### PR #74 — bridge error code observability, not deployed

- Branch `fix/wordpress-bridge-diagnostic-codes-20261024`, draft PR https://github.com/ishinaillab/ishikeit/pull/74.
- HTTP failures now conditionally annotate `ProcessingFailure` with only regex-allowlisted WordPress REST `ishi_ai_bridge_...` codes, preserving retryability and Retry-After. No response body, messages, headers or credentials copied. Two new tests.
- **Node 24.22.1 local validation:** 34 test files / 246 tests, lint/typecheck/build passed.
- **GitHub Actions CI run 40025675068:** success.
- Unmerged and undeployed; no customer-facing message/DB change.

### PR #75 — npm lockfile security patches, not deployed

- Branch `fix/dependency-audit-20261024`, draft PR https://github.com/ishinaillab/ishikeit/pull/75.
- Upgraded resolved Fastify 5.12.7, Zod 4.6.7, Vitest 4.1.12, @vitest/mocker 4.1.12, Vite 8.3.5 without changing source or declared `package.json` ranges.
- `npm audit`: 5 advisories (2 high/2 moderate/1 low) to **zero**.
- **Node 24.22.1 local validation:** 34 test files / 244 tests, lint/typecheck/build passed.
- **GitHub Actions CI run 40026637480:** success.
- GitHub connector used to update files after local Windows Git push failed with 403 (different Windows Git identity). Corrected GitHub branch files from CRLF to LF so final PR remains focused (145 additions/137 removals); no credential settings changed.
- Unmerged and undeployed.

### PR #71 — TikTok Comment-to-Message integration preflight

- Draft PR https://github.com/ishinaillab/ishikeit/pull/71 remains unmerged; branch currently ahead 20 and behind 2 relative to canonical `main`. Provider approval, account eligibility, protected status readback, and live messaging canaries unverified.
- Independently fetched original branch into isolated Windows worktree and ran **Node 24.22.1** lint/typecheck/35 test files/**252 tests**/build, all PASS. Its old lockfile still reported 6 audit advisories.
- In a **separate local-only integration worktree**, attempted merge against current `main` and confirmed exactly one conflict in `docs/CONTINUATION.md` (the two branches both append an entry). Reconciled locally preserving BOTH TikTok and Oct 11 security histories; created local-only merge commit `1bcc4dc` (not pushed). Applied the reviewed PR #74 diagnostic files and PR #75 patched `package-lock.json` into that worktree.
- Combined **Node 24.22.1 preflight** passed: lint, typecheck, **35 test files / 254 tests**, and production TypeScript build. `npm audit`: **0 vulnerabilities**. No TikTok API interaction and no provider mutation.
- This **does not mean PR #71 remote GitHub branch has been rebased/merged**: conflict resolution and combined validation currently exist only under `C:\\Users\\MBDS\\Desktop\\project-materials\\Documents\\ishikeit-integration-preflight-20261024`. Do not claim the feature is deployed/eligible, nor bypass PR #71's explicit live activation/merge gate.

### Monitoring and release gates

- Created an hourly condition watch **Ishikeit Health Watch** on Oct 24, checking public Ishikeit liveness/readiness and Supabase pending/dead letters when accessible; baseline pending 0/dead 43. Silent if healthy; no provider actions or DB writes.
- Public `/health/ready` continued returning `{"status":"ready"}` after these operations. No production `main` merge/deploy was performed.
- Follow established rollout authorization, staging and deployment verification before merging production branches. Never replay historic dead-lettered customer messages automatically.

## October 24 follow-up — changes after the initial review (verified)

### Supabase sequence privilege closure

- Production migration `20261023213701_restrict_outbox_attempts_sequence_client_roles` applied successfully to Supabase project `vhmrliqemkfxblzsoyaz`.
- `REVOKE ALL PRIVILEGES ON SEQUENCE public.outbox_attempts_id_seq FROM anon, authenticated;`
- SQL readback: anonymous/authenticated roles have neither SELECT nor USAGE on the sequence; postgres and service_role still have USAGE. Previously applied RLS/table-grant fix remains active.
- Database migration recorded in `ishinaillab/ishikeit-db` main at `supabase/migrations/20261023213701_restrict_outbox_attempts_sequence_client_roles.sql`; Git commit `b15db9831a5b044f460b19b2434d097d25e8a264`.
- Queue remained `pending=0`, `dead_lettered=43`, `outbox=712`, `outbox_attempts=659` following security operations. No customer messages were replayed.

### App security and reliability PRs merged to GitHub main

- [PR #75](https://github.com/ishinaillab/ishikeit/pull/75): patched npm lockfile, keeping `package.json` unchanged. Node 24 lint/typecheck/build and 244 tests passed; GitHub CI Node, PHP lint and context-continuity jobs passed; `npm audit` zero advisories. Squash-merged to `main` at commit `7aa6e63ba9dbbfd6f2df822adfc7b752bc7ce8ca`.
- [PR #74](https://github.com/ishinaillab/ishikeit/pull/74): safe bounded JSON bridge diagnostic code extraction with regex allowlist, no body/private data logs; new test covers oversized response without Content-Length. Reconciled with PR #75 via two-parent merge commit `120dfd87676b6406771b4259fba1de6591155f85`. Node 24 lint/typecheck/build and 247 tests passed, 0 npm advisories; GitHub CI successful. Squash-merged to `main` at `d294c63ed88c56651d0bbb00b7265c829cb0bc1c`.
- IMPORTANT: **GitHub merge is not proof that Hostinger production deployed that exact SHA**. Independently rechecking public `/health/live` yielded ok and `/health/ready` yielded ready, but no commit SHA was exposed from these endpoints. Hostinger build/deploy provenance still requires authorized Hostinger runtime metadata.

### TikTok Comment-to-Message reconciled, gated, not deployed

- [Draft PR #71](https://github.com/ishinaillab/ishikeit/pull/71) reconciled with current `main` in isolated Windows worktree; only `docs/CONTINUATION.md` conflicted and its two append-only histories were preserved.
- Verified Node `24.22.1`: 35 test files / **255 passed**, ESLint, typecheck, build all pass; `npm audit` 0 advisories.
- Published resulting Git two-parent merge commit `b64e5569c3c67022e2b6150430410556c8331d71` to the existing PR branch. The server-computed Git tree SHA `1dbaa928cb7a2785037be483694d0c3befebafac` matched the exact local staged tree verified after the successful full test run. GitHub reports PR #71 mergeable with `behind=0`. It remains **draft, unmerged and production-inactive**, pending confirmed TikTok Business Messaging provider approval, business account Advanced Access/VBA eligibility, review of native provider workflows, explicit release decision and controlled canary.

### Verified official TikTok automatic-message scope

- Official v1.3 API docs currently enumerate create/update/status-on-off/get/delete/sort automatic-message operations, separate from TikTok Ads `creative/auto_message` welcome templates.
- Official `/open_api/v1.3/business/message/auto_message/update/` contract includes types `WELCOME_MESSAGE`, `SUGGESTED_QUESTION`, `CHAT_PROMPT`, and `FOLLOW_WELCOME`, with provider audit/review controls. Requires TikTok Business Messaging API data privacy/security access, an authorized TikTok account with Advanced Access or VBA, and account owner 18+.
- Source: https://business-api.tiktok.com/portal/docs/update-the-automatic-message-for-a-business-account/v1.3
- TikTok's account Business Suite feature may require message moderation 1–5 business days; do not confuse this with ad-level message templates: https://ads.tiktok.com/resources/help/article/how-to-set-up-auto-messages-for-business-accounts
- TikTok for Business MCP tools visible to this session include `creative_auto_message_create/get` for **ads**, not the business-account `business/message/auto_message` endpoints. Do not use ad-level tools to mutate account organic Business Messaging flows.
- Do not fabricate missing provider access, approval or an auto-message execution result. Next implementation should build a separate gated account-level controller with provider readback and tests before any settings mutation.

### Ongoing guardrails

- Preserve existing Ishi AI Bridge authentication (dedicated bearer token) and no-cache semantics.
- Historical AI Bridge 502/522/525 origin fault remains incompletely root-caused; the diagnostic PR improves future reporting but does not magically fix the October 20 historical problem.
- Preserve WordPress security/booking/customer data. Do not enable TikTok provider controls or reprocess past dead letters without a separate eligibility/idempotency review.

## October 24 additional progress — TikTok automatic-message foundation

- [Draft stacked PR #76](https://github.com/ishinaillab/ishikeit/pull/76) created with base `feature/tiktok-comment-to-message` (draft PR #71). Head branch `feature/tiktok-automatic-messages-read-20261024`; most recent initial validation commit `41534d14d459e5d4562eba00d94582dd4162453c`.
- New `src/messaging/tiktok-automatic-message-read.ts`: account-level, unregistered, **read-only** TikTok Business Messaging `business/message/auto_message/get/` client for WELCOME_MESSAGE, SUGGESTED_QUESTION, CHAT_PROMPT, FOLLOW_WELCOME; returns only type/ID/status/review metadata, not actual response text. No HTTP route, no provider write, no user message.
- New `tests/tiktok-automatic-message-read.test.ts`: seven mock tests covering provider path/method/header, account separation, disabled state, absent/malformed results, retryable rate limits, missing token and type rejection.
- Independent Windows Node 24.22.1 full `npm run check` PASSED: **36 files / 262 tests**, ESLint, TypeScript, build. `npm audit --json` reported **zero advisories**. GitHub Actions CI run `40030536173` subsequently completed with conclusion **success**; independently verified.
- Official TikTok API documentation indexes Business Messaging automatic-message CRUD/status and separate ad-level creative auto-message operations. The business API calls require TikTok Business Messaging and approved account access. `get` HTTP method and precise response schema are **mock-tested** and must be verified with approved authorized provider account before any real enablement.
- Both PRs #71 and #76 remain DRAFT/unmerged, no production activation. Continue with moderation-aware provider-native controls only after confirmed eligibility and successful authorized readbacks.


## October 24 PHT — Hostinger deployment verification and TikTok retrieval contract hardening

### GitHub / Hostinger release evidence (new)

- [PR #77](https://github.com/ishinaillab/ishikeit/pull/77) added privacy-safe compiled-JS fingerprinting and `GET /health/build`. Target Node 24 local `npm run check`: **35 files, 250 tests passed**, lint/types/build green. GitHub Actions CI `40031611768` succeeded. Squash-merged to `main` SHA `61d2c61abce13faef293520d1a417cd9c1564a5e`.
- Immediately after merge, public `https://apps.ishinaillab.com/health/build` returned HTTP 404, then independently started returning JSON `status:ok, artifactSha256:33e993774075a73bfc48be2ba1495f820ad9653e3793e2f8e829d5ca0c7c18a8, sourceRevision:null`. Existing `/health/live=ok`, `/health/ready=ready` stayed healthy.
- [PR #78](https://github.com/ishinaillab/ishikeit/pull/78) added GitHub CI verification and logging of the fingerprint of the *actual compiled JS* after `npm run check`. All three CI jobs in workflow `40032164758` passed. **Node 24 job `120682810402` log included `ISHIKEIT_ARTIFACT_SHA256=33e993774075a73bfc48be2ba1495f820ad9653e3793e2f8e829d5ca0c7c18a8`, exactly matching a fresh public Hostinger `/health/build` query.** This confirms compiled JavaScript content parity between Linux CI and running Hostinger app (hash normalizes CRLF). PR #78 was squash-merged to `main` SHA `b8a2a482d10e59d54d7aa04bc216e148bb7c826c`.
- **Claim boundary:** This establishes content parity, NOT the exact Hostinger hPanel deployment ID/commit SHA. `sourceRevision` is null; checking the authoritative deployment record in Hostinger hPanel remains open. Hostinger's Node.js deployment guidance: https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/ . Do not infer exact git revision from a ready status alone.
- Production Supabase outbox final readback at 2026-10-23 22:14 UTC: 0 pending, 43 historical dead-lettered, 669 published. `public.outbox_attempts` RLS enabled; client roles cannot SELECT the table or USAGE the `outbox_attempts_id_seq`. No new queue accumulation, no historical replay, no customer messaging tests or sends.

### TikTok automatic-message transport gate

- Official TikTok docs list account-level automatic-message get/update APIs. A community Go SDK classifies `business/message/auto_message/get/` as a GET request; a separate generated SDK catalog labels it POST with JSON body. The definitive authorized TikTok account request contract has not been confirmed.
- Draft [PR #76](https://github.com/ishinaillab/ishikeit/pull/76), stacked on draft [PR #71](https://github.com/ishinaillab/ishikeit/pull/71), now requires explicit construction option `transport:"GET_QUERY"|"POST_JSON"`, no guessed default. GET encodes only `business_id` and `auto_message_type` in query; POST_JSON calls the exact `auto_message/get/` endpoint with JSON request body. Both paths are unregistered and inert in production; no provider mutation, no customer sends. Regression tests cover both transports and constructor fail-closed behavior. GitHub Actions run `40031218385` passed all CI jobs.
- **Approval remains required** to perform authorized provider readback, validate response schema, and then consider settings mutation/moderation workflows. PR #71 is currently unmerged and its mergeability may change when `main` advances; reconcile and retest before any eventual release. The latest main includes the new build identity and CI provenance commits; parent TikTok feature branches must not accidentally deploy until eligible.

### Next work / cautions

1. Confirm hPanel **Deployments** records the successful Hostinger build for canonical `main`, and check app runtime/resource logs around the original Oct20 WordPress AI bridge 502/522/525 failures. Public health endpoints cannot root-cause an old origin incident.
2. Keep hourly Ishikeit Health Watch enabled. Investigate new queue dead letters only; do not automatically replay the 43 historical records.
3. Perform authorized WordPress AI bridge health with its dedicated token and end-to-end test-account messaging verification when proper credentials/tests are available; never bypass authentication.
4. Reconcile draft PR #71 and stacked PR #76 with advancing `main`, verify official TikTok Business Messaging account approval, request contract and capabilities, then stage gated canary deployment.
5. Preserve all WordPress booking/payment/customer data and the previously established premium-plugin security hold; no TikTok runtime activation or WordPress config changes occurred in this continuation.
