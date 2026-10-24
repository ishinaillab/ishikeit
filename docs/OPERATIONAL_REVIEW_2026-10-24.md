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


## October 24 PHT — Post-release draft branch reconciliation

Canonical Ishikeit `main` at `b8a2a482d10e59d54d7aa04bc216e148bb7c826c` contains deployed build identity and CI fingerprint verification. Live `https://apps.ishinaillab.com/health/build` and GitHub Node24 CI job `120682810402` independently returned the **same compiled JS SHA256** `33e993774075a73bfc48be2ba1495f820ad9653e3793e2f8e829d5ca0c7c18a8`. Healthy liveness/readiness and zero pending database jobs; historical dead letters 43. Git SHA remains unknown at Hostinger because sourceRevision is null; inspect hPanel deployment if exact build record needed.

Updated draft PR #71 (`feature/tiktok-comment-to-message`) to merge current `main`. Git merge of application source, new health/build route and CI fingerprint workflow was automatic; only append-only `docs/CONTINUATION.md` required preserving both histories. A clean Windows isolated worktree passed Node 24.22.1 lint/typecheck/build, **36 files / 258 tests**, and `npm audit=0`. Locally staged tree `fb649464c4e7619ff21a64eb0a1f63b1195b8a27` exactly matched the GitHub created tree; non-force, expected-head two-parent merge commit `141bc67ffd21f1612910a4bd8b87e986e7448436` published to the existing PR branch. Its GitHub CI run `40032843805` **passed**. PR71 now behind=0/mergeable, remains DRAFT/unmerged.

Updated stacked draft PR #76 (`feature/tiktok-automatic-messages-read-20261024`) to include the refreshed PR71 parent. Automatic Git merge had **no conflicts**, including documentation. A second clean Windows isolated worktree passed Node 24.22.1 lint/typecheck/build, **37 files / 267 tests**, and `npm audit=0`. Locally staged tree `21a746381f3e38091d1d4848d65077d61dcf67fb` matched the GitHub-created tree exactly; non-force two-parent merge commit `00d8118044217e0310b48b813e803b2762a34e9e` published to the existing PR branch. PR76 now behind=0/mergeable and DRAFT/unmerged. GitHub CI run `40033215029` subsequently completed with **success**; all three jobs (Node 24, PHP lint, context-continuity) passed. The exact reconciled PR76 branch therefore has both local and independent GitHub CI validation.

Both drafts remain dormant: NO TikTok OAuth/provider account authorization approval asserted; NO real provider get/update calls, customer messages or historical replay. PR76 requires an explicitly approved GET_QUERY or POST_JSON transport and a verified provider readback before activation. Production is unaffected by feature branch merge commits. Original local worktrees and user files were preserved. Continue with documented external approval gate and authenticated canary only when available.


## October 24 follow-on diagnostics — Cloudflare, WordPress, Supabase (read-only)

The user explicitly connected Cloudflare. Native Cloudflare connector authenticated and found active zone `ishinaillab.com` (zone `3d5c34a2f7183b53847f33ad1158e84a`). SSL setting `strict`; `apps.ishinaillab.com`, `www.ishinaillab.com` and root A records proxied. No configuration writes.

Attempted `POST /graphql` `httpRequestsAdaptiveGroups` grouped by edge/origin HTTP codes for the October 20 WordPress bridge incident, but Cloudflare analytics rejected the request with **Rate limiter budget depleted**, requesting five minutes before retry. Do not claim historical edge/origin breakdown verified. The legacy REST zone dashboard analytics endpoint returned HTTP 404, sunset; use GraphQL after throttle clears rather than retrying the legacy API. WordPress PHP error log inspection (native Easy MCP AI) produced zero lines matching `Fatal error` and `2026-10-20` in the *currently readable log*, so past faults could have rotated or been recorded in inaccessible origin logs; absence is not proof that none occurred. `wp cron test` returned exit 0 and spawn status 200.

Supabase readback 2026-10-23T22:54Z: public.outbox 712 total, pending 0, historical dead letters 43, most recent outbox created 2026-10-23T09:37Z. Inbound processed historical counts: WhatsApp 244, Instagram 91, Telegram 56, Messenger 34. Last 24 hours: only 2 Telegram inbound; no recent WhatsApp/Instagram/Messenger receipts. These historical processed rows are not evidence of *current* live end-to-end provider delivery.

Historical Oct20 outbox_attempts: Meta retry 16 / dead_letter 4 / published 9; Telegram retry 24 / dead_letter 6. These are **attempts**, not unique messages; avoid interpreting 10 dead-letter attempts as 10 separate customer messages. Similar timing across Meta and Telegram suggests testing common WordPress brain/origin dependency first, without assuming confirmed causality. Cloudflare zone active strict + proxy is not itself an explanation for 522/525. No fake canaries or customer message replays were run.

Next steps: after Cloudflare GraphQL rate limit clears, obtain October 20 edgeResponseStatus vs originResponseStatus on exact `/wp-json/ishi-ai/v1/turn` route; verify WordPress AI Bridge with dedicated bearer token in authorized canary environment; check Hostinger origin logs/AI Engine failures. Do not relax TLS, adjust DNS, or replay historical outbox without evidence.


## October 24 08:50 Manila — confirmed October 20 root-path analysis, PHP diagnostics, npm security, guarded recovery

### Verified October 20 origin error breakdown
- Cloudflare GraphQL `httpRequestsAdaptiveGroups` on active `ishinaillab.com` zone `3d5c34a2f7183b53847f33ad1158e84a`, exact private route `/wp-json/ishi-ai/v1/turn`, 2026-10-20 UTC: 47 origin 502/edge 502; 2 edge 525/origin 0; 1 edge 522/origin 0; 2 edge 200/origin 200. Per-hour 502: 5 at 13:00 UTC and 42 at 14:00 UTC. Two successful route calls appeared at 15:00 and 16:00 UTC. These are analytics counts, not unique users.
- Supabase `public.inbound_events` on Oct20: six Telegram (`bot`), two WhatsApp, and one Messenger failed rows have `last_error` mentioning HTTP 502; one more WhatsApp row mentions 522. `public.outbox_attempts` on Oct20 shows Meta 16 retries +4 dead-letter attempts; Telegram 24 retries +6 dead-letter attempts. These are **attempts, not unique messages**. Processing errors span channels, consistent with a common WordPress AI Bridge dependency; exact upstream exception still unknown.
- Production WordPress plugin `Ishi AI Bridge` version 0.3.0 active, bot ID `default`; source `includes/class-ai.php` calls AI Engine `$mwai->simpleChatbotQuery` and returns `ishi_ai_bridge_ai_failed` HTTP 502 when it throws. Invalid or empty replies can also return 502. Old logs record generic error markers only; accessible current PHP log has no Oct20 details, so **do not assert exactly which exception occurred**. WordPress cron test still passes. WordPress AI Engine `wp_mwai_logs` completion records show two successful chatbot completions later on Oct20 at 15:19/16:57 UTC, plus Oct23 successes. The historical incident was intermittent, not evidence of permanent chatbot unavailability. Cloudflare SSL remains Full (strict), DNS proxied; no change required from this evidence alone.

### PR #79 — future-safe WordPress plugin logging, source merged but not installed
- [PR #79](https://github.com/ishinaillab/ishikeit/pull/79) `fix/ai-bridge-safe-failure-categories-20261024` merged after CI `40045281914` all three jobs passed. Squash main `747dbe8e70c6e32c98692ef0ea4f50d65e6575e2`.
- Source WordPress bridge bumped to 0.3.1 (unchanged schema 1.1.1), with eight allowlisted categories: rate_limit, quota, authentication, timeout, transport, upstream, runtime, other. Only the category, generic code, and existing short hashed reference enter future PHP logs; never upstream raw message, provider error body, secret or customer text. Existing REST response codes, retryability, idempotency and auth unmodified.
- New executable PHP regression `tests/php/ishi-ai-bridge-diagnostics.php` verifies eight failure categories, redaction, unchanged success behavior, upload and transcription logging; GitHub PHP CI emitted `Ishi AI Bridge sanitized failure diagnostics: PASS`. **Production WP-CLI readback after merge still reports installed Ishi AI Bridge v0.3.0.** Source merge does not auto-upgrade custom WordPress plugin. No live upgrade, plugin activation, or unsupervised customer canary. Plugin deployment requires safe backup/rollback and an authorized health-and-canary check with dedicated bearer credential.

### PR #81 — new October 2026 fast-uri URI advisory patched
- Fresh `npm audit` found moderate GHSA-w74x-v6f9-j3xg / CVE-2026-110306 for `fast-uri` 3.1.8 and 4.2.1, transitively installed by Fastify validation chain. Official fix versions 3.1.9 and 4.2.3.
- [PR #81](https://github.com/ishinaillab/ishikeit/pull/81) patch touches only `package-lock.json`: four exact entries from 3.1.8->3.1.9 or 4.2.1->4.2.3 (12 lines replaced), `package.json` unchanged. Isolated Node24 `npm run check` passed 250 tests/35 files and build/lint/typecheck; `npm audit` 0 advisories. GitHub CI `40046185808` success. Squash-merged main `a25b8111b20d87d53de2d3ce2d95b960b0749b73`. Installed runtime dependencies at Hostinger still need authenticated independent readback; public compiled-JS hash alone does NOT prove new npm package versions deployed.

### Draft PR #80 — bounded WordPress 502/522/525 recovery, stays off
- [PR #80](https://github.com/ishinaillab/ishikeit/pull/80) adds `AI_BRIDGE_OUTAGE_RECOVERY_ENABLED=false` (default off). When explicitly enabled only, retryable `ProcessingFailure` with precisely matched WordPress bridge HTTP 502, 503, 504, 522, 525 receives max seven attempts, 2m/4m/8m/16m/30m/30m gaps (~90m horizon). Other errors/provider sends/authorization unchanged; bound individual Retry-After to 2h. This is future operations logic; no historical 43 dead-letter replays.
- After merging npm patch, branch was reconciled preserving both append-only continuity histories. Combined staged tree `211fe660c8d94825a77556ddb40ebcb8eab51e63` matched GitHub tree exactly; merge commit `959aa954700d614466508a36cf4a9db8de97ff71` fast-forwarded existing branch. Isolated Node24 all-check 256 tests/35 files, lint/typecheck/build passed, `npm audit` zero. GitHub CI `40046509986` all jobs success. PR #80 is **draft, unmerged, inactive** until tester-account canary, delayed-response/human-handoff review and authorized rollout.
- Readback ~2026-10-24 00:45 UTC: Supabase queue pending 0, historical dead letters 43, latest enqueued event 2026-10-23 09:37Z. Public Node `/health/build` returns compiled SHA256 `33e993774075a73bfc48be2ba1495f820ad9653e3793e2f8e829d5ca0c7c18a8`, sourceRevision null, and live readiness healthy. Compiled code parity was independently proven earlier, but new npm dependency install is not yet proved from that fingerprint.
- Updated existing hourly condition automation **Ishikeit Health Watch** (id `6adbd15997088191b4ef1d162259ebd3`) to look for *new* repeated WordPress bridge origin 502 or edge 522/525 in the prior hour when Cloudflare aggregate analytics are available, plus current health/status/dead-letter baselines. Never count Oct20 historical failures as current. Automation remains enabled, but tool readback showed platform `notifications_enabled:false` and there is no writable notification-control setting in this session; future delivery might require user notification settings.

### Still blocked / next action
1. Verify authoritative Hostinger deployment and **installed fast-uri** versions from authenticated hPanel/runtime. Do not claim the npm upgrade was deployed based solely on source merge.
2. Backup and stage custom WordPress bridge 0.3.1 release; deploy only with reversible installer, direct health/read-only test and authorized test-account canary, then review sanitized category logs for any **new** 502. The Oct20 exception cannot be reconstructed without old origin logs.
3. Complete tests for Instagram/Messenger/WhatsApp/Telegram using authorized testers; avoid actual customer traffic and do not fabricate canary success.
4. Do not activate default-off PR #80 or unmerged TikTok PRs #71/#76 without their distinct eligibility, user-experience, provider access and rollback gates.
5. Keep WordPress SSL Full(strict), current DNS, backups, provider credentials, LatePoint bookings/payments and historical dead-letter rows unchanged.


## October 24 PHT — Hostinger installed npm dependency verification CONFIRMED

- Source fix [PR #81](https://github.com/ishinaillab/ishikeit/pull/81), main commit `a25b8111b20d87d53de2d3ce2d95b960b0749b73`, patched four lockfile `fast-uri` dependency versions: nested 3.1.8 -> 3.1.9 (three resolved paths), root 4.2.1 -> 4.2.3. Node24 250 tests and security audit 0 passed. Initially the live compiled-JS fingerprint alone could not attest installed npm tree.
- [PR #82](https://github.com/ishinaillab/ishikeit/pull/82) built a **read-only installed-package provenance check**; local source has SHA-256 of only actual `node_modules/fast-uri/package.json` `name` and `version` metadata at four known resolved locations, fixed ordering and NUL separators. On absent/invalid package paths it returns null. Does not read package-lock.json, env, secrets, message data, or executable dependency source. GitHub Node 24 CI run `40047575845` passed **252 tests**, typecheck/lint/build, PHP checks and context continuity. CI verified actual installed versions 3.1.9, 3.1.9, 3.1.9, 4.2.3 before logging only hash.
- Squash merged PR #82 to main commit `218018e7fac9be167d34d1920b3cf4975e87e00f`. GitHub CI emitted **compiled artifact** SHA256 `aa62b961f7702c33c61617def09b86ca067bbbdf90bfee7036f1f6e6b1f3c55e` and **installed fast-uri metadata** SHA256 `f53c17ad469b82b25905639a11a765c3f4af3286d527168288a55dab846605d3`.
- Verified fresh **live** `https://apps.ishinaillab.com/health/build` on October 24 PHT returned `status:ok`, `artifactSha256:aa62b961f7702c33c61617def09b86ca067bbbdf90bfee7036f1f6e6b1f3c55e`, and `installedFastUriSha256:f53c17ad469b82b25905639a11a765c3f4af3286d527168288a55dab846605d3`, **exactly matching both CI fingerprints**. `sourceRevision:null`; Hostinger hPanel deploy ID/commit SHA unverified. This is strong evidence of installed package *metadata* parity for four specified packages, not proof of executable byte integrity or a complete runtime dependency audit. The specific fast-uri dependency patch is closed at this evidence level; maintain normal advisory surveillance.
- WordPress AI Bridge remains version 0.3.0. Its /health endpoint rejects WordPress administrator credentials (401) without the independent bridge bearer; dedicated token must never be bypassed. WPVibe WP-CLI plugin install allows WordPress.org slug, not arbitrary custom ZIP from private GitHub; WordPress.com connection lists 0 eligible sites. Ishi Local Agent and Refresh Test both intermittently returned internal errors and cannot currently be relied upon for Hostinger SSH or local packaging. Do not falsely claim custom WordPress plugin 0.3.1 deployed. Continue with staged rollback packaging and a legitimate authorized custom-plugin deployment channel.
- Queue most recent read: 0 pending / 43 historical dead letters, no replay. PR #80 longer WordPress outage retries is draft, disabled by default, and must remain inactive until delayed-reply/handoff canary.


## October 24 PHT follow-on — packaged rollback candidates, safe bridge health probe, Meta/WhatsApp readbacks

### CI-only WordPress release bundles (no plugin installed)
- [PR #83](https://github.com/ishinaillab/ishikeit/pull/83) merged as app main commit `f8d5fa2423fa1ce24bd61af3a1b6383253508314`. New `.github/workflows/ishi-ai-bridge-release.yml` generates only the seven PHP files required by Ishi AI Bridge from canonical `HEAD` v0.3.1, plus a v0.3.0 **repository baseline** rollback ZIP from historical commit `b8a2a482d10e59d54d7aa04bc216e148bb7c826c`, `SHA256SUMS.txt`, and `ROLLBACK_README.txt`. The repository baseline ZIP has NOT been proven byte-identical to the live v0.3.0 plugin, so a verified Hostinger file/database backup is still needed before replacement.
- CI package workflow [run 40048136724](https://github.com/ishinaillab/ishikeit/actions/runs/40048136724) succeeded; GitHub Actions artifact `ishi-ai-bridge-versioned-bundles`, id `12541698277`, expires **2027-01-22T01:05Z**, contains both ZIPs and checksum/readme. CI full app tests/WordPress lint passed. GitHub workflow is NOT a plugin installer and did not modify WordPress or Hostinger config.

### Dedicated-token, read-only health probe
- [PR #84](https://github.com/ishinaillab/ishikeit/pull/84) merged app main commit `d3606bcc1dce174ceaa025ee8d2601b31c99ed51`. It added `scripts/probe-wordpress-ai-bridge.mjs` and `scripts/test-probe-wordpress-ai-bridge.mjs`. The probe is GET-only, canonical `https://www.ishinaillab.com/wp-json/ishi-ai/v1/health` only, requires existing dedicated `ISHI_AI_BRIDGE_TOKEN` and `WORDPRESS_AI_BRIDGE_URL` in a trusted runtime, cap response at 4 KiB, avoid redirects, log only fixed allowlisted health fields and coarse statuses (not botId, secrets, raw bodies or customer messages). Does not call AI generation or provider APIs. Correct WordPress administrator REST credentials **do not** substitute for the dedicated bearer: observed admin-scoped GET /health returned HTTP 401.
- GitHub Actions run `40048754235` completed success: six native Node mock health-probe tests, **252 existing Vitest tests**, ESLint, TS build/typecheck, PHP bridge tests and continuity; no real provider call. No credentials exposed, live probe not yet executed. Tooling CI initially failed on typed ESLint inclusion and Vitest discovering `*.test.mjs`; both were corrected with a file-scoped official disableTypeChecked override for Node .mjs and native test filename `test-probe-wordpress-ai-bridge.mjs`.
- Deployment requirements remain open: active WordPress bridge still reported v0.3.0 as of prior read; no authorized custom plugin ZIP replacement through WPVibe, zero WordPress.com eligible sites, Ishi Local Agent and Refresh Test intermittent internal failures, no Hostinger authorized terminal/dedicated bearer for live probe. No override/bypass attempts. Keep PR #80 delayed-reply recovery and TikTok PRs draft/inactive.

### Meta/WhatsApp account-side configuration inventory (read-only)
- Native Meta DevTools MCP lists app `Ishikeit` id `1042452472116584` with admin/read+manage access. Current app webhook subscriptions are enabled for `page.messages`, `instagram.messages/standby/messaging_handover`, and `whatsapp_business_account.messages`, all targeting `apps.ishinaillab.com` callbacks. No subscription changes were made.
- Ishí Nail Lab WhatsApp business verified and profile complete, connected Ishikeit developer app, app-level callback configured and published. Of two non-test Messaging Account profiles enumerated, **one account** with the registered Philippine production number is subscribed to Ishikeit; the other separate account is not subscribed and has a **verified but unregistered** number. Do not register, verify, or subscribe the second account without distinct business need. A separate public test account was omitted by the tool and is not a production channel. No live outbound messages or tester sends were performed.
- Meta App Review check for Ishikeit returned `submission_status:NO_SUBMISSION`, `privileges:[]`, while `can_submit:true` and baseline app privacy policy/business verification settings passed. This describes this developer app's App Review state, NOT necessarily every Instagram product scope or TikTok's separate provider approval; check the exact Instagram privileges and user-initiated review submission before any claims of Advanced Access. App rate limiter reports healthy 0%, but its `call_volume` did not establish actual WhatsApp/Instagram message delivery. Historic Supabase rows and active webhook configuration are not replacement for authorized end-to-end tester canaries.

### Latest release and evidence boundaries
- Hostinger runtime `/health/build` verified after PR #82: artifact hash `aa62b961f7702c33c61617def09b86ca067bbbdf90bfee7036f1f6e6b1f3c55e`, installed four-fast-uri metadata hash `f53c17ad469b82b25905639a11a765c3f4af3286d527168288a55dab846605d3`; both equal Node24 CI, proving installed patched fast-uri name/version metadata parity. PR #83/#84 added CI/source scripts but no compiled JS change. Current Hostinger sourceRevision null; hPanel deployment ID unverified.
- Last Supabase read: 0 pending, 43 historical dead letters, no replay. Observe future Cloudflare origin 502 and edge 522/525. Never change SSL strict, WAF, DNS, WP premium plugins, booking/payments or historical messages on speculation.


### Final readback at 2026-10-24 01:16 UTC / 09:16 Asia/Manila
- Live Hostinger `/health/ready` reported `ready`; `/health/build` returned compiled SHA256 `aa62b961f7702c33c61617def09b86ca067bbbdf90bfee7036f1f6e6b1f3c55e` and installed fast-uri metadata SHA256 `f53c17ad469b82b25905639a11a765c3f4af3286d527168288a55dab846605d3`, both matching CI; `sourceRevision:null`.
- Supabase `public.outbox`: **0 pending, 43 historical dead-lettered, 669 published**. No customer replay or provider canary.
- Live WordPress `Ishi AI Bridge`: still active **0.3.0**. Reproducible reviewed source ZIP v0.3.1 exists but not installed. Dedicated bearer probe code is merged but cannot execute in live trusted Hostinger runtime until an authenticated terminal or equivalent provider-secret-preserving connector becomes available.
- GitHub [PR #80](https://github.com/ishinaillab/ishikeit/pull/80) remains draft/unmerged; mergeable=false after `main` advanced with later diagnostics, so reconcile and rerun tests **before** any future approved activation. `AI_BRIDGE_OUTAGE_RECOVERY_ENABLED` remains OFF in production.
- User-facing follow-up: do not request private access tokens in chat or bypass bridge auth. Finish verified production WordPress plugin backup/rollback, install v0.3.1 through supported authenticated installer, run GET-only bridge health probe from trusted runtime and then explicit authorized test-account flow before changing auto-retry policy or introducing live TikTok features.


## October 24, 2026 Manila morning — WordPress v0.3.1 installation preflight, NOT DEPLOYED

User expressly authorized continuing the production-safe bridge upgrade, starting with a verified rollback. Read-only fresh evidence:

- WordPress WPVibe native WP-CLI confirms the custom `ishi-ai-bridge` **active v0.3.0**; `wp cron test` HTTP 200 success. AI Engine plugin inventory classifies `ishi-ai-bridge` as **not editable** by its managed-plugin editing tools. `wp plugin update ishi-ai-bridge --dry-run` returned **"No update available for this plugin"**, so the WordPress.org updater path cannot install the custom GitHub v0.3.1 ZIP. No live changes.
- User-authorized Windows `Ishi Local Agent` briefly responded after prior intermittent errors; it reports Windows, full local process policy. Installed `ssh`/`scp`/`sftp` exist but `C:\Users\MBDS\.ssh\config` absent, `.ssh` inventory has only known_hosts, no public key or configured connection. Therefore no authenticated Hostinger SSH/custom WordPress filesystem connection was established. Remote Desktop Commander device offline. TRIGGERcmd exposes unrelated Elementor actions, not a Hostinger installer. WordPress.com connector lists zero eligible sites. Plugin discovery finds no connected Hostinger hPanel/file-management app. Do not fabricate a deployment route or use WP snippets/SQL to bypass the installer.
- UpdraftPlus `updraft_backup_history` exists in WordPress with 4 backup records. Timestamped Oct 10–12, **none of those registry records includes a database archive**; the latest **plugin-only** registered backup is from Oct 12 (UTC). Updraft remote service setting is empty. These registry observations do **not** invalidate independently downloaded offsite backups; they mean no **fresh, complete** server-side recoverable production checkpoint was established.
- The local Windows `C:\Users\MBDS\Documents` folder contains 9 Updraft ZIP/GZ backup archives totaling approximately 1,168.6 MiB, with source backup timestamps around Oct 11–12, last copied on Oct 14. Local Oct 12 pair `backup_2026-10-12-1717_Ishi_adec8b8c3b8e-plugins.zip` (approx 142.3 MiB) and matching `...-db.gz` (approx 8.7 MiB) independently read/tested:
  - Plugin archive enumerated **33,126 ZIP entries** and `python -m zipfile -t` returned `Done testing`, exit 0 (CRC/archive integrity).
  - Inspected only the embedded main plugin version header at `ishi-ai-bridge/ishi-ai-bridge.php`; archive contains **v0.3.0**. No source or customer records were printed.
  - The database gzip was streamed to EOF using Python's `gzip` module with no exception, **47,086,521 uncompressed bytes** (gzip integrity). The initial PowerShell .NET gzip attempt returned zero bytes due to script behavior and was superseded by the successful Python verification; do not confuse this with a corrupt archive.
- Crucial limitation: these are **October 12 snapshots** (copied October 14), not verified byte-for-byte against the live Oct 24 plugin/files/database. No current production snapshot or restore test has occurred. Thus **rollout gate remains BLOCKED**. The user-approved instruction to deploy safely does not warrant replacing the active custom plugin without a current backup and supported authenticated installer.
- Versioned audited 0.3.1 installation and repo-baseline 0.3.0 rollback ZIPs remain available from successful GitHub Actions [run 40048136724](https://github.com/ishinaillab/ishikeit/actions/runs/40048136724). No plugin ZIP upload, deactivation, restart, external sends, or customer-message replay happened during this pass.

**Next authorized actions once Hostinger hPanel/SSH or a supported backup/ZIP installer is connected:** (1) create a **new** full database and current `wp-content/plugins/ishi-ai-bridge` snapshot, copy off-server, verify ZIP/GZIP/checksums and that restore controls are usable; (2) stage a clean upload of v0.3.1 from validated archive and preserve actual current live plugin bytes for immediate rollback; (3) deploy in a reversible maintenance window without affecting bookings/payment; (4) verify `wp plugin get` is v0.3.1, readiness, PHP logs and dedicated-token GET-only `scripts/probe-wordpress-ai-bridge.mjs` from the trusted runtime; (5) authorized test accounts only for Instagram/Messenger/WhatsApp/Telegram; (6) review draft PR #80's delayed replies/handoff policy separately. No secret bearer token is to be shared in chat.

- Further WPVibe read-only option checks confirm **both** `updraft_interval` and `updraft_interval_database` are `manual`. WordPress is not configured to automatically schedule Updraft full-site or database backups through those options. This does not prove Hostinger-level backups are absent; Hostinger hPanel backup data is inaccessible through current connected tools. A fresh full snapshot through an authenticated WordPress Updraft UI or Hostinger hPanel plus an off-server copy must precede the custom plugin replacement.


## October 24 Manila ~09:50–10:00 — validated PR #80 and prepared local WordPress install bundles

User asked "Continue" after production WordPress bridge upload remained blocked by lack of a fresh live backup and signed-in hosting UI. This pass performed safe operations only:

- WordPress bridge live remains **0.3.0 active**; Supabase queue **0 pending / 43 historical dead letters**, unchanged. Windows Local Agent available, but no configured Hostinger SSH keys/alias or browser-based hPanel control; no live plugin replacement.
- Reconciled the **existing draft PR #80** `feature/gated-wordpress-bridge-outage-retries-20261024` against full main `d3606bcc1dce174ceaa025ee8d2601b31c99ed51`. Six app/test/config files on main matched exact old common base, so reused tested feature blobs; merged append-only `docs/CONTINUATION.md` without dropping new main sections. GitHub commit `2283f792675da93fd2c4d762109bae618b3babb6`, tree `296739a7ab8c17863ea0a6294b2ce4c770d79ae0`, fast-forward branch (merge commit with old feature + main parents). GitHub CI run `40051919422` **success**, mergeable true at that point. Independent isolated Windows worktree `C:\Users\MBDS\Desktop\project-materials\Documents\ishikeit-outage-revalidation-20261024` passed Node24 **258 tests / 35 files**, ESLint, TypeScript, build, six additional read-only WordPress probe mock tests, and npm audit **0 vulnerabilities**. Feature remains **draft, UNMERGED and OFF by default**; do not activate delayed retries without a separate human-handoff and user-experience canary.
- Consulted current official Hostinger and WordPress help. Hostinger hPanel Websites → Dashboard → Backups offers a manual Create Backup for eligible Business or higher plans (actual tier unknown), covering files/database; separately downloadable current backups. **WordPress Admin Plugins → Add New → Upload Plugin → Replace current with uploaded** supports standard custom-plugin ZIP replacement without SSH. Thus no SSH is intrinsically needed, but an *interactive signed-in administrator session* and verified current backup remain necessary; the connected WPVibe/MCP content tools do not perform this workflow. References: https://www.hostinger.com/support/2298928-how-to-create-backups-at-hostinger/ ; https://www.hostinger.com/support/5981435-how-to-download-backups-at-hostinger/ ; https://wordpress.org/documentation/article/manage-plugins/ . Updraft's `manual` schedule does **not** prove Hostinger-level backups are disabled.
- WordPress WPVibe read-only `list_files` shows expected **7 PHP files** in installed `plugins/ishi-ai-bridge` (admin, ai, auth, rest, storage, validation, plugin header). No byte-exact current source backup was created; old off-server 2026-10-12 archives cannot replace it.
- Created local Windows folder `C:\Users\MBDS\Desktop\project-materials\Documents\Ishi-AI-Bridge-Release-20261024` with **two exact Git-object, allowlisted, 7-PHP-file ZIPs**, from `git archive`: `ishi-ai-bridge-0.3.1.zip` from reviewed source commit `d3606bcc1dce174ceaa025ee8d2601b31c99ed51` (13,236 bytes, SHA256 `13109b397a23b3d9269381b346a5bb36f4bc5c658eb0a8f06abc05ea7b8701e6`); `ishi-ai-bridge-0.3.0-repository-baseline.zip` from historical commit `b8a2a482d10e59d54d7aa04bc216e148bb7c826c` (12,708 bytes, SHA256 `ab9e698fb0988ed6b0ee74cf529932ab6b6b6b0e82bf443cd38fc5b824043fb9`). Both `python -m zipfile -t` CRC checks passed, exact **7 PHP files** excluding two normal directory entries, and plugin headers read back v0.3.1 and v0.3.0 respectively. Added local `SHA256SUMS.txt` and `README-BEFORE-UPLOAD.txt` via audited local file-writes. **The local baseline rollback ZIP is not a verified fresh backup of production**.
- [PR #85](https://github.com/ishinaillab/ishikeit/pull/85) merged app `main` at `2e3dcfdd0ef088a2487ecbc4b3949c5bbe4139d1`, docs-only `docs/WORDPRESS_AI_BRIDGE_RELEASE_RUNBOOK.md` and `docs/CONTINUATION.md`. Official backup/download instructions, current plugin-folder backup, artifact integrity, WordPress admin ZIP replacement, bearer-only health check, authorized test-account canaries and *plugin-only rollback* to avoid erasing LatePoint/WooCommerce customer transactions. GitHub CI run `40052315308` all jobs success; no live WordPress writes.
- Release readiness remains **BLOCKED only on missing verified fresh production backup and signed-in Hostinger/WordPress interactive admin interface**, not on code/package tests. Do not request secrets in chat, use SQL/WP snippets to bypass installation, restore old database blindly, or claim v0.3.1 deployed. Read-only checks and the existing hourly watch remain safe.


### Additional morning closure — PR #80 post-runbook reconciliation and bridge request sample

- Docs-only runbook [PR #85](https://github.com/ishinaillab/ishikeit/pull/85) merged into main `2e3dcfdd0ef088a2487ecbc4b3949c5bbe4139d1` after initial PR #80 CI. Reconciled **the same original PR #80 branch** again, preserving latest main runbook and the bounded retry code/tests without force-push: merge commit `0dea0a6245e017e419861ac0d6b3c96f47f38d2b`, combined tree `3feeaa48b91753741a1d3d300138e1d4c5592cff`. Follow-on GitHub CI run `40052730567` **all jobs successful**; PR #80 confirmed **draft:true, open, mergeable:true**, no missing main commits. This is NOT a feature activation, merge into main, provider send or customer replay.
- The locally created `Ishi-AI-Bridge-Release-20261024` ZIPs were read back again using .NET ZIP APIs: each has two normal folder records and exactly **seven** PHP file records, and header versions `0.3.0`/ `0.3.1` as expected. Local audited `SHA256SUMS.txt` and `README-BEFORE-UPLOAD.txt` created beside the ZIPs. Archive SHA256s recorded above are for **these Windows local ZIPs**, not automatically asserted identical to the GitHub Actions artifact ZIP bytes; both are built from pinned reviewed Git source and have separately verified metadata.
- Cloudflare GraphQL read-only query for exact WordPress bridge `/wp-json/ishi-ai/v1/turn` between **2026-10-23T16:00Z and 2026-10-24T04:00Z** returned no grouped requests. Thus there are **no visible requests in this sample window**, not proof that the authenticated bridge/AI provider is healthy under real message load or that all new interactions work. Earlier Oct20 origin 502 incident remains historical and not explained by this sample.
- No Hostinger hPanel session, current production backup, WordPress ZIP replacement, live bearer token test or authorized provider canary obtained. **Live Ishi AI Bridge remains v0.3.0.** True deployment still explicitly blocked at fresh verified current backup + signed-in interactive WordPress/Hostinger access. Never upload install ZIP through insecure alternate execution or restore historical database over new orders/bookings.


### Hostinger Connector user-invoked readback — October 24
- User invoked `@Hostinger Connector` to continue the backed-up Ishi AI Bridge custom plugin rollout. Installed plugin skills `hostinger/skill.md`, `websites/skill.md` and `WORDPRESS.md`/`OPERATIONS.md`/`DEPLOYMENT.md` references loaded successfully.
- Connected Windows Ishi Local Agent read-only preflight: Node `v26.10.0`, Codex CLI installed, ten Hostinger MCP service categories registered **and enabled** in `C:\Users\MBDS\.codex\config.toml`: hosting, wordpress, agency-hosting, domains, dns, billing, reach, ecommerce, vps, and wordpress-sites. No configuration changes or credential reads. `codex mcp list` confirmed all ten categories enabled.
- **Current ChatGPT tool session did NOT expose any `hosting_*` or Hostinger MCP actions**, despite availability of the installed Hostinger Connector skills and local Codex registrations. Do not infer an authenticated Hostinger API session or attempt to replace the lack of account-native tools with direct API/SSH/shell workarounds. Hostinger skill requires authenticated `hosting_listWebsitesV1` before account-specific backup/WordPress operations; no such call could be made.
- Independent authenticated WPVibe read-only check still reports custom `ishi-ai-bridge` **active v0.3.0**. Local reviewed v0.3.1 and historical baseline packages remain prepared, but **no current production backup was created, no custom ZIP installed**, and no provider messages replayed. Next session needs actual Hostinger hosting+WordPress tool exposure/OAuth consent or supported signed-in interactive Hostinger hPanel/WordPress installer, then verified current backups and reversible upgrade.


### October 24 ~10:17 Asia/Manila — Hostinger Connector registration vs ChatGPT exposure; six exact live PHP matches

User requested continuing after invoking `@Hostinger Connector`. Hostinger skill installed/loaded; local Codex Hostinger MCP categories are enabled, but **this current ChatGPT execution has no Hostinger hosting/WordPress actions listed in its tool registry**. Directory search exposes Hostinger Mail, not the hosting account connector. It is therefore impossible to obtain authenticated `hosting_listWebsitesV1` or Hostinger file/database backups from this conversation. Do not use direct Hostinger API/SSH or ad hoc shell workarounds for a missing account-native tool. A desktop-app reload / enabled Hostinger account connector is needed before the required fresh backup and deploy gates.

Useful independent read-only progress: WPVibe `read_file` retrieved the seven active PHP files under `wp-content/plugins/ishi-ai-bridge/`, each fully numbered in the response, and compared normalized source (stripping line-number prefixes and CRLF) against reviewed v0.3.0 baseline commit `b8a2a482d10e59d54d7aa04bc216e148bb7c826c`:
- Exact **6 of 7**: `ishi-ai-bridge.php`, `includes/class-admin.php`, `includes/class-ai.php`, `includes/class-rest.php`, `includes/class-storage.php`, `includes/class-validation.php`.
- `includes/class-auth.php` matches the baseline in its first **1659** characters and last **132**, but the read-only WPVibe output replaced one **37-character** baseline span with a **10-character redaction marker**. The masked span means the full live file **cannot** be byte-confirmed. No unmasked secret or source content was logged.
- Saved this nonsecret evidence locally alongside the two already tested source ZIP packages at `C:\Users\MBDS\Desktop\project-materials\Documents\Ishi-AI-Bridge-Release-20261024\PRODUCTION-SOURCE-COMPARISON.txt`. Do not call these ZIPs a verified current live rollback, and do not skip the fresh Hostinger WordPress files+database backup requirement.
- Latest native WPVibe readback still reports plugin **active v0.3.0**, Supabase counts **0 pending / 43 historical dead letters / 669 published** at 2026-10-24 02:17 UTC, and app `/health/ready` remains reachable. No live writes, WordPress installer, backup execution, provider canary or queue replays took place.
