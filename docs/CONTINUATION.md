# Ishikeit continuation handoff

## 2026-11-02 — Phase 2 clickable customer booking links

- Actual Meta and Telegram messages after Phase 2 rollout contained AI-generated `[Complete Your Booking](https://...)` Markdown embedded in plain provider text payloads. Ishikeit adapters send Meta Messenger/Instagram `message.text`, WhatsApp Cloud `text.body`, and Telegram `sendMessage` without parse_mode. A Markdown label cannot be assumed to render as an actionable URL in those transports.
- Added `src/processing/explicit-links.ts` to replace only valid Markdown HTTP(S) inline links with `Label: https://...`, preserving signed URL bytes. `MessageReceivedHandler` converts text parts before Meta's grapheme/UTF-8 message splitting and durable ordered outbox actions; Telegram and future providers receive explicit readable URLs. Media, idempotency, business-hours and consent gates untouched.
- Tests validate helper output and end-to-end handler text across Messenger, Instagram, WhatsApp, Telegram bot. Locally Node24/PostgreSQL17 583/583 across 81 suites, lint, typecheck, build passed. See `docs/PHASE2_LINK_RENDERING_2026-11-02.md` and PR #218. Still requires exact production deployment/canaries, and Easy MCP AI credential allowlist (#216) remains an independent gate.


## Nov 2 Phase 2 — explicit customer-facing links for Meta and Telegram text channels

- Actual customer-origin replies persisted in Supabase across Messenger, Instagram, WhatsApp and Telegram used the AI Engine markdown syntax `[Complete Your Booking](https://www.ishinaillab.com/?ishi_booking_slot=...)` in raw text. The provider senders use ordinary Meta `message.text` or WhatsApp `text.body` and Telegram `sendMessage` without a markdown `parse_mode`; an inline Markdown label is not a provider-supported guaranteed clickable link. This is a practical customer link-opening risk independent of HMAC validity or booked slot.
- PR #218 implements `src/processing/explicit-links.ts` and applies it at the AI-to-action boundary **before** Meta message chunking and durable outbox creation. For `[label](https://URL)`, output is `label: https://URL` with the signed URL unchanged; ordinary text/media preserved. Applies to Messenger, Instagram, WhatsApp, Telegram and future text senders without altering provider APIs or account rights. Six dedicated tests cover exact URL and all four live text channels; full 583/583 Node24/PG17 tests pass, lint/typecheck/build pass.
- Production deployment and actual per-client clickable URL rendering still require post-merge verification. Date guard (LatePoint Addon - Ishikeit Automation 0.1.2), global enabled ability and active bot prompt are live, but the Easy MCP AI existing client credential has a separate narrow 13/926 tool allowlist; do not disable safety controls or incorrectly mark booking E2E complete. See docs/PHASE2_LINK_RENDERING_2026-11-02.md and issue #216.


## Nov 2 Phase 2 customer-date mismatch safeguard

- Actual inbound Instagram customer request after Manila midnight on Nov 2 said **tomorrow**, but one AI Engine bot response said tomorrow and sent a signed LatePoint booking link dated **Nov 2** (today), before later resolving tomorrow as Nov 3. This is an observed mismatch even though the link could be valid and 8 AM available. Preserve customer intent and fail closed when relative date contradicts server-local date.
- `LatePoint Addon - Ishikeit Automation` 0.1.2 adds optional `day_offset` (0 today, 1 tomorrow, max 30) checked against WordPress `wp_timezone()` inside the same availability+link PHP request. If the supplied absolute date conflicts with the relative day, return `verification_unavailable` with no URL and do not call native LatePoint abilities. Eight PHP regression tests passed (wrong day, tomorrow, invalid offset) and 577 Node24/PostgreSQL17 tests, lint/typecheck/build passed. Update active AI Engine bot to pass `day_offset=1` for tomorrow only after WordPress plugin rollout. This does not change a booking, checkout, consent, or any premium plugin.
- Ongoing owner acceptance: the Easy MCP AI read-only client token shows 13/926 scoped tools despite global enabling the new ability, and still needs a narrow explicit credential permit; no unauthorized scope bypass. Phase 2 all-channel transport canaries passed, but official Telegram postrelease account and complete booking checkout acceptance remain separate. See docs/BOOKING_CONCIERGE_2026-11-01.md and issue #216.


## Booking add-on MCP client exposure (2026-11-01)

- The active addon `LatePoint Addon - Ishikeit Automation` v0.1.0 passed live authenticated ability tests: declined 8 AM, verified 9 AM link and past date blocked. No booking created.
- v0.1.1 sets `meta.public=true` per WordPress `wp_register_ability` client-discovery rules, retaining the authenticated `permission_callback`. Easy MCP AI enabled the new ability globally (667 enabled); this does not widen token-specific scopes.
- Vendor official guidance confirms API tokens with Read-only access snapshot tools on creation. The active "AI Engine - LatePoint (read-only)" token only sees 13 of 917 global tools, so exact new-tool access must be verified/narrowly authorized with an official credential scope edit. Do not change it to Full access or bypass controls.
- Active AI chatbot `default` now excludes rejected times, never reuses broken booking links, never invents checkout holds and identifies itself as AI. Fail closed if combined ability not exposed to its MCP client. See docs/BOOKING_CONCIERGE_2026-11-01.md.


## 2026-11-01 — Telegram official-account Business connection (review/deployment gate)

- Owner-confirmed real provider test showed Messenger/Instagram/WhatsApp and Telegram bot received replies; Supabase confirmed new processed inbound across all four but **no Telegram business-message events**, only channel=bot normal messages. Root cause: prior implementation normalized Telegram `message` only, never `business_message`.
- Preferred Telegram customer entry point is **currently confirmed by owner as** `@ishinaillab` (corrected from prior typo `@ishinaiilab` on 2026-11-01). The **existing** Telegram bot remains the automation identity and private transport; it must be connected to the actual user via Telegram Business **Secretary Mode / Chatbots** before it can reply as the official account.
- Implemented validated `business_message` webhook handling, owner-username/right verification through Telegram `getBusinessConnection` on ingress **and** egress, 24-hour private customer reply window, business-scoped conversation partitioning, echo/bot suppression, durable outbound `business_connection_id`, and non-destructive allowed_updates inspector/reconciliation CLI. Regular bot chats are unchanged.
- Evidence: 77/77 disposable Node24/Postgres17 test files, **548/548 tests**, ESLint/TypeScript/build passed; see `docs/TELEGRAM_BUSINESS_2026-11-01.md`.
- **Acceptance remains gated on Telegram authorization, not bot-token possession:** read-only private `getMe` and `getWebhookInfo` verification, owner enabling Secretary Mode if absent and explicitly connecting bot to `@ishinaiilab` under Settings > Telegram Business > Chatbots with reply rights and chosen private-chat scope, and authorized new tester message directed to **official account**. Never call Telegram user-account methods using a bot token, avoid user-session impersonation and do not claim end-to-end official account delivery before a genuine `business_message` and reply are observed.
- Do not submit Meta App Review; owner hold #169 still applies. Do not modify premium WordPress plugins, or replace Hostinger's masked environment variable set.

## 2026-11-01 — Phase 2 Meta production hardening: private Graph ownership preflight and bounded decoding

- Phase 2 follows successful one-time Instagram OAuth refresh and cleanup PR #201, and begins from clean production main `228e8aaad086f8f771a69c7701f5f6f525e6bbd3`. Scope: read-only token ownership/proof compatibility, Messenger and Instagram signed interactive event handling, account isolation, retries, limits, and controlled tester-canary verification. Do NOT submit Meta App Review (issue #169 owner hold) or enable proactive WhatsApp templates.
- Introduced a private, explicitly invoked `src/observability/meta-graph-proof-cli.ts` using the production site's normal environment to run `MetaGraphTokenPreflight`. The output is limited to bounded channel statuses; it does not show credentials/IDs, send messages, refresh tokens, change app settings, or enable global `META_GRAPH_PROOF_ENABLED`.
- `src/security/meta-graph-preflight.ts` now stream-bounds JSON read size to 16 KiB even with missing/untrusted `Content-Length`, cancels oversized responses and fails closed. Regression test added for oversized chunk without Content-Length.
- Test from exact isolated Phase2 checkout with `scripts/test-docker.ps1`: **536/536 tests, 76/76 files**, lint/typecheck/build passed in Node.js 24/PostgreSQL 17 disposable Docker lab.
- Meta's current Graph rate-limiting documentation and Cloud API error-code reference confirm that rate-limit errors (including 80006, 613, 130429 and 131056) can arrive as HTTP 400 with a provider numeric code. The Meta send adapter now treats documented Graph/WhatsApp rate-limit codes as retryable and honors Retry-After; seven regression scenarios cover 400 responses, while permanent invalid token/permission errors remain nonretryable. No sending is performed by the tests.
- Release only after green GitHub CI; then run one private Hostinger Node24 cron invocation of the read-only preflight CLI and remove cron. Treat `wrong_app`, `invalid_token`, `inspection_unavailable`, or `proof_unavailable` as release **holds**, not permission to turn on Meta Require App Secret. Preserve Instagram Login separate app token handling and default-off Graph proof setting until issuer/owner is actually proven.

## 2026-11-01 — Instagram live OAuth renewal proved and private CLI cleanup (PR #201)

- **VERIFIED LIVE SUCCESS**, not a mock: Hostinger private cron UID `ZVp13fB8RX`, scheduled once for `2026-11-01 03:12 UTC` (11:12 Manila), produced `Instagram one-time renewal proof: succeeded`. The production app ran merged PR #200 commit `0340adf24999a8bb6ebdbdca1d3f9fb27e028b53`; the merged code had no automatic Fastify startup hook or public renewal route.
- Supabase readback showed exactly one managed Instagram subject `28436714725987041` advanced **token_version 1 → 2**, with updated_at `2026-11-01T03:12:03.271556Z` and access_expires_at `2026-12-31T03:12:03.226Z`, versus prior expiry `2026-12-28T23:52:32.169Z`. Professional account `17841438662359631` was the single matching alias, with **0 revocations**. The CLI verifies refreshed Meta identity before storing encrypted credentials.
- The temporary cron was deleted immediately; Hostinger cron list returned `[]`. Public `/health/live` and `/health/ready` both returned healthy JSON after the provider refresh. No token/plaintext, app secret or customer message was emitted.
- Cleanup PR #201 removes the one-time CLI, proof module and tests. Merge and verify the cleanup deployment, preserving the standard Instagram renewal manager's existing seven-day expiry skew and normal maintenance schedule. There is no temporary database schema to drop.
- Private claim at `/home/u328762438/.ishikeit-instagram-renewal-once-20261101.claim` contains only the bounded outcome, and is outside the public webroot. It can be retained temporarily as an at-most-once audit guard; never remove it until no executable one-time renewal code or cron remains. Avoid automatically repeating this test.
- Phase 2 can be reconsidered after verifying the cleanup release's deployed SHA and production health. The regular 8:15 AM Instagram Renewal Watch remains useful for future lifecycle monitoring.


## 2026-11-01 — Private one-time Instagram OAuth refresh via explicit Hostinger Node.js cron (PR #200)

- **No production HTTP startup hook or public route.** The isolated CLI is `dist/observability/instagram-once-runner.js`, executed only once through Hostinger's private Node.js cron with `--env-file` under `hbuilds/config/.env`. The regular Fastify server and automatic seven-day-before-expiry refresh policy remain untouched.
- Owner-authorized grant has fixed subject `28436714725987041`, expected Instagram Professional ID `17841438662359631`, token version 1, original expiry `2026-12-28T23:52:32.169Z`, and a minimum age of 24 hours. Exact identity, alias, version, stored expiry, nonrevocation, Meta revalidation, and encrypted persistence are mandatory for success.
- The CLI uses the existing PostgreSQL account advisory lock and attempts an atomic private `O_EXCL` claim at `/home/u328762438/.ishikeit-instagram-renewal-once-20261101.claim` **before** any Meta refresh request. If the private directory is unwritable or claim exists, it does not call Meta. The claim remains after failures, preventing accidental retries across cron invocations/deploys. Never expose keys, token plaintext, database URL or raw provider errors.
- Hostinger's documented command structure is `/opt/alt/alt-nodejs24/root/bin/node --env-file=/home/u328762438/domains/apps.ishinaillab.com/hbuilds/config/.env /home/u328762438/domains/apps.ishinaillab.com/hbuilds/current/nodejs/dist/observability/instagram-once-runner.js`. Schedule once in **UTC**, confirm its command length does not exceed 255, observe via private cron output and Supabase read-only credential metadata. Delete cron schedule after the controlled run.
- Old SQL claim-table migration and test have been removed from the feature branch; **do not run any temporary DB DDL**. GitHub PR #200 has a separate one-shot CLI; Node24/PostgreSQL17 disposable Docker CI must pass. After exact provider/DB result is verified, release cleanup removing the CLI, proof module and its tests. Preserve production rollback anchor `release-backup/pre-instagram-one-time-2026-11-01`; do not begin Phase 2 before live success and cleanup.


## 2026-10-30 — Instagram reaction webhook message-ID correlation (release gated)

- Meta's [Instagram webhook examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples) show `reaction.mid` identifying the original message plus `action=react|unreact` and optional reaction/emoji. Ishikeit's existing normalization recognized `message.reaction` but omitted the canonical `providerMessageId`, limiting UI/audit linkage to the reacted-to message.
- The narrowed change keeps reactions **non-reply** messaging events and preserves a validated, bounded original `reaction.mid` in `providerMessageId`; structured `meta.reaction` data is included for provider-neutral display. Full original item data is preserved. It deliberately does **not** assign a synthetic provider event ID because repeated reaction cycles on the same message must remain separate; the existing payload hash handles retry deduplication including actor/action/timestamp.
- Tests check unchanged redelivery identity, distinct react and unreact events, isolation by reacting actor, rejection of malformed/missing mids and direct-handler AI non-dispatch. No customer messages, synthetic provider webhooks, subscriptions, credentials, DB schema changes, historical replays, App Review, security toggle or WhatsApp reminder sends.
- GitHub CI, PostgreSQL tests, exact Hostinger commit and live health checks must pass before claiming deployed source correctness; no real organic reaction was sent by the assistant.

## 2026-10-30 — Instagram deletion webhook reply-safety correction (release gated)

- Meta's current [Instagram webhook examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples) specify `message.is_deleted=true` when an Instagram user deletes a message. Source review found that the existing normalizer classified this as `message.received`, potentially allowing an unwanted automated reply to a deleted message. This is a code-level risk; no live incident was established.
- The correction produces a separate `message.deleted` tombstone event for Instagram, retaining the provider's original `mid` for UI/audit correlation and a `delete:<mid>` idempotency identity. It exposes no deleted text/attachments in normalized `content`; original provider metadata remains in `data` for existing audit/storage compatibility. Echo/self flags cannot reclassify a deletion as a customer turn. Messenger and normal Instagram messages remain unchanged.
- A defense-in-depth guard also prevents *historically misclassified* `message.received` events with `data.message.is_deleted=true` from invoking the AI if encountered in normal processing; the change does not replay or edit stored history. Regression tests cover webhook deletion, redelivery deduplication, flag precedence and direct handler non-dispatch.
- No additional Meta webhook test sends, customer messaging, subscription writes, credential rotations, Meta App Review submission, unapproved WhatsApp reminders, historical replays or global security-toggle changes. GitHub CI, exact Hostinger SHA and independent health verification must pass before closure.

## 2026-10-30 — Instagram message-edit webhook normalization (verification gated)

- Official Meta [Instagram webhook examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples) document `message_edit` with `mid`, `text`, and `num_edit`. The production normalizer previously fell through to a generic `unknown` event, losing canonical original-message and revision correlation.
- A narrow code correction classifies authenticated Instagram edits as non-reply `message.edited`, preserves the original provider message ID, retains source edit metadata as structured content and data, and keys revisions as `edit:<mid>:<num_edit>` when both bounded fields are valid. Without a usable revision ID, full-event hashing remains the fallback rather than inventing an ID.
- Direct invocations of the message handler now fail closed on events it cannot handle, so an edit, delivery receipt or echo cannot accidentally generate an AI reply. Unit tests cover edit deduplication, distinct revisions, incomplete metadata and AI non-dispatch. No new webhook subscriptions, test deliveries, customer sends or historic replay.
- Source-level tests, GitHub CI, Hostinger exact deployment SHA and live/ready endpoints remain release gates. Existing Meta App Review #169, old tester OAuth #176, WhatsApp template/consent, signer proof and security-toggle holds are unchanged.

## October 30, 2026: latest verified restart checkpoint

Read [ISHIKEIT_CONTINUATION_2026-10-30.md](./ISHIKEIT_CONTINUATION_2026-10-30.md) before older notes. Baseline Hostinger deployment: 4678312bf47821ad13933445d31e708897887d3b (PR #183). Current open issues #176 (legacy Instagram OAuth) and #169 (intentional App Review hold). Live and ready endpoints HTTP 200. Recheck this snapshot in a new chat; it contains the full continuation prompt and current owner holds.

## 2026-10-30 — Provider-rejected Instagram OAuth token fail-closed send guard

- Existing legacy Instagram tester grant persists in Supabase and has a future cached expiry, but its real Meta Graph `GET /me` returns HTTP 400, code 190/subcode 0. A separate managed Instagram token reconciles correctly. Do not infer that the legacy account can be retired from absent inbound history; real owner consent required to reauthorize or expressly retire (#176).
- Prior `InstagramAccessTokenManager` returned that invalid-but-unexpired token to send callers based solely on cached expiry. New bounded **process-local only** safety guard accepts an exact token that Meta itself rejected with code 190 during startup reconciliation, stores only its SHA256 fingerprint in memory, and subsequently refuses to return that unchanged credential with `retryable=false`. The guard is scoped by OAuth subject, applies across its professional alias, and never returns another account's managed token as fallback.
- An owner-approved OAuth reauthorization that replaces the durable credential changes the token fingerprint; the next durable read automatically clears the in-memory guard without a process restart. There are no DB/schema writes, revocations, token rotations, secrets in logs, customer sends or webhook changes.
- Guard is set **only** after actual Meta `InstagramOAuthRequestError.providerCode === "190"` for the exact token, not network errors, 429s or unverified assumptions; independently managed studio token is not affected.
- Regression tests: current code190 token fails despite future expiry; no refresh or secret in exception; other account works; account alias is correctly fenced; owner reauthorization token replacement clears the fence. CI, exact Hostinger deployed SHA and health are separate gates.
- Separate holds unchanged: Meta App Review #169 remains NO_SUBMISSION; template reminders pending approval and opt-in; Instagram signer identity monitor active; outbound duplicate-send issue #159 closed with real disposable PostgreSQL integration proof, no replays.


## 2026-10-29 — Operator-only Meta unknown-outcome reconciliation SQL integration

- Expanded existing disposable Postgres 17 CI suite with the real `PostgresMetaUnknownReconciler` SQL: create an ambiguous provider outcome by arming a send and allowing its lease to expire; verify the operator list returns one sanitized unreviewed case; record an evidence-backed reviewed_do_not_resend attestation, then confirm repeat attestation is idempotent and changed disposition conflicts.
- Crucially, operator review leaves the outbox dead-letter and durable pre-send fence intact, never publishes/requeues or calls Meta. The test checks no recipient/message data in the public reconciliation response and no claimable Meta jobs after review. No production Supabase data or customer messaging touched.
- Existing safe operator API requires operations Bearer and offers GET cases/POST review only; it has no resend endpoint. Issue #159 accepted only after new CI passes.
- Meta App Review owner hold #169, Instagram tester OAuth code 190/subcode 0 #176, WhatsApp reminder approval/consent and signer-key watch remain unchanged.


## 2026-10-29 — Disposable PostgreSQL Meta outbox crash/recovery acceptance suite

- Outbound Meta POSTs have no documented provider idempotency guarantee. Existing `PostgresOutboxStore.prepareMetaSend` writes a durable fence before the first network call; duplicate/raced claims must not retry ambiguous deliveries. Existing unit tests asserted SQL and mocked stores but did not execute the queries against PostgreSQL row-lock semantics. Issue #159 acceptance gap.
- Added a **GitHub CI PostgreSQL 17 service** with an isolated `ishikeit_outbox_test` database and `tests/outbox-postgres.integration.test.ts`. The runner rejects any test database URI whose host isn't loopback or whose DB name isn't exactly `ishikeit_outbox_test`. No connection or DDL against production Supabase and no customer messages or provider API calls. No new paid database branch.
- Real SQL integration scenarios: concurrent workers race on a single queued Meta action; pre-POST fence can be acquired once; lease expiry after arming quarantines provider-unknown outcome instead of repeating; next ordered conversation action can resume once predecessor is quarantined; only explicit nonambiguous HTTP 429 may clear fence and retry; late completion of quarantined action fails closed. Assertions inspect attempts and durable state.
- CI job tests against actual PostgreSQL rather than mocked query strings; ordinary `npm test` skips this suite without the isolated env var. No production changes except deployed source/test package when PR merged (CI service independent).
- Preserve global Meta App Review hold #169, Graph code-190 old Instagram tester authorization #176, no obsolete-credential rotation or historical replay, no WhatsApp unapproved reminder dispatch.


## 2026-10-29 — Instagram self-messaging event-safety correction

- Official Meta Instagram self-messaging guide describes Instagram events with `is_self=true` on the messaging item and/or message, and echo events with `message.is_echo=true`, `message.is_self=true`. Reference: https://developers.facebook.com/documentation/instagram-platform/self-messaging
- Root bug: legacy `meta-normalizer` distinguished `message.echo` solely via `message.is_echo`; an Instagram self-originated event with `is_self=true` but no echo flag could become `message.received`, pass `MessageReceivedHandler`, and provoke an automated response to the business's own account. No production event of that kind was observed in historical aggregate; this is a verified code-level risk, not a claimed incident.
- Correction: classify `is_self` without echo as `message.self`, preserve true echoes as `message.echo`, attach `selfOriginated=true` to those events, and preserve ordinary customer `message.received`. Defensive checks in `MessageReceivedHandler.canHandle/handle` reject old persisted self-originated messages even if marked received. This does not delete or replay events or suppress legitimate customer messages.
- Tests: both item and message level self flags, self+echo, ordinary customer message, and handler non-dispatch for previously misclassified records.
- Existing security and release controls unchanged: signed webhooks, Instagram managed token, OAuth error 190 requiring actual consent (#176), App Review hold (#169), outbound ambiguity fences (#159), WhatsApp reminder approval and consent holds.


## 2026-10-29 — Modern Meta sticker and Instagram post-share webhook normalization

- Meta Jun 1, 2026 Messenger webhook reference requires recognizing type=sticker; after Aug 30, 2026 the dual image representation was retired. See https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/messages
- Meta Apr 2026 replaces legacy share with ig_post for Instagram post shares, with metadata including media ID, URL and caption. https://developers.facebook.com/documentation/instagram-platform/webhooks/new
- Current normalization change: sticker with URL becomes image plus preserved structured metadata (sticker_id alone is NOT treated as a media attachment ID). Modern ig_post, post, ig_reel, reel and legacy share expose bounded text titles for conversation handling, preserving exact structured metadata and avoiding a second duplicate title when share+ig_post both appear. No share link is interpreted as downloadable media.
- Regression cases cover sticker URL and ID-only, Instagram title length, dual legacy/current post shares, and reel shares. No customer messages or provider tests were sent; require CI and deployment verification.
- Continued hold: Instagram legacy OAuth code 190/subcode 0, no credential rotation or App Review, no historical message replay, and post-PR177 Instagram signer watch remains active.


## 2026-10-29 — Instagram legacy OAuth code 190 diagnostic update

- Hostinger runtime still reports Meta Graph HTTP 400/code 190 during stored legacy Instagram OAuth account resolution, while managed Instagram token/fields reconciliation succeeds. Supabase aggregates: one stored Instagram OAuth credential with a future expiry, one alias, no explicit revocation. Future expiry does NOT override Meta rejection; do not silently replace or retire either credential.
- Meta official access-token debug guidance distinguishes subcodes (e.g. 460 invalidated, 463 expired); prior `InstagramOAuthClient` discarded the optional numeric `error_subcode` and logged generic `provider_rejected`. Branch PR for allowlisted subcode diagnostics & `reauthorization_required` category, preserving secret/PII-free logs and no OAuth changes; regression tests for both documented subcodes and malformed values. Wait for CI, Hostinger deployed SHA/readback and provider-supplied subcode before narrowing cause.
- Still requires account-owner OAuth consent if old tester grant must be reauthorized, or explicit retirement authorization if confirmed obsolete. Healthy managed Instagram app must not be modified as workaround. App Review hold #169 and no unsolicited customer sends preserved.
- Instagram webhook signer-category probe is deployed under PR #177; the Meta-authorized sample passed HMAC but Hostinger omitted older structured signer field. Watch is now configured to detect `signer=` category only after PR #177 deployment SHA 774a0d2406ca999b204c6fca68408b3aa2275863. No repeat Meta sample without explicit approval.


## 2026-10-29 — Meta-authorized Instagram webhook sample authenticated in production

- Explicit owner approval for one Meta Developer Tool test on Ishikeit app 1042452472116584 topic `instagram` field `messages`; Meta MCP returned `success=true` / sample enqueued. One sample only, no further Meta sends authorized.
- Hostinger production at 2026-10-29T14:43:48.755Z received the webhook; at 14:43:48.757Z logged `Instagram webhook signature verified` after raw-byte HMAC and Instagram envelope verification, and at 14:43:48.758Z logged completed HTTP request. Production deployment at that time was 75cf1b1d77ed81f7f80c888113849372bf7bc1c3 (PR #175).
- Read-only Supabase showed 0 new Instagram inbound rows after the sample. This proves webhook HMAC acceptance but not a real customer-message persistence path. Hostinger's runtime-log connector exposes only timestamp/level/message and discarded structured signer metadata; the HMAC-accepted signing key for the sample is not retrospectively available.
- Follow-up low-risk observability patch appends only `signer=meta_app|instagram_product|both` (one category) to the authenticated Instagram log **message string** to survive Hostinger normalization, plus regression test verifying both categories, no secrets. No credential or Meta setting changes, no customer sends, no second sample. Observe future organic events to distinguish signer.
- Existing holds continue: Meta App Review #169 NOT submitted; don't rotate credentials, blanket enable Require App Secret, send WhatsApp reminders without approval/opt-in, or replay historical dead letters. Instagram legacy OAuth tester Graph 190 tracked in #176; separate managed account is healthy.


## 2026-10-29 — Instagram product signing credential boundary and Unified Login discovery

- Confirmed owner-supplied Instagram product App ID 2316046942582053 differs from main Meta App 1042452472116584. Meta DevTools lists the main Ishikeit app and its instagram/page/WhatsApp webhook subscriptions; Instagram product ID is not independently managed as a separate Meta app through this MCP. Hostinger env has BOTH main and Instagram OAuth product secrets (masked; not read/altered).
- Root code gap: shared `POST /ishikeit/webhooks/meta` previously verified all HMAC signatures with only main `META_APP_SECRET`; it never used configured `META_INSTAGRAM_OAUTH_APP_SECRET` for Instagram webhooks. Official Meta docs require raw-byte X-Hub-Signature-256 checks, but published docs do not unambiguously distinguish the signing credential for different Instagram-login paths. Do not claim proven live signing identity yet.
- Corrected bounded verification: `object=instagram` accepts HMAC from either configured Meta main or Instagram-specific product secret; `object=page` and `object=whatsapp_business_account` still MUST match main secret. Fail closed, parse only after valid HMAC, no raw body/secret/signature logs, INFO identity-only signer label on accepted Instagram events. No env or Meta settings changed. Tests + documented source evidence in `docs/META_INSTAGRAM_WEBHOOK_SIGNING_AND_UNIFIED_LOGIN_2026-10-29.md`.
- Local lint/typecheck/458 Vitest tests across 64 files/build PASSED. GitHub CI, exact Hostinger deployed SHA, and *real signed Instagram event* remain separate operational gates.
- Owner's current developer-dashboard notice recommends Instagram Unified Login over legacy Instagram Login for new features. Meta's publicly retrievable migration guide is dated 2024 and addresses Facebook Login → Instagram Login rather than Unified Login. Do not invent a blind migration; maintain responding IG accounts, account mapping, current OAuth and webhook subscriptions until an actual current product contract is validated and a reversible cutover is prepared.
- **OWNER HOLD #169:** NO Meta App Review submission, no global Require App Secret, no automatic template reminders or dead-letter replays. Preserve proven Messenger/WhatsApp token proof compatible result from 2026-10-29 13:31:35Z.


## 2026-10-29 — Messenger Page-token signed Graph verification correction (PR #174)

- Owner-assisted real read-only production diagnostics: both Meta credentials debugged as issued by Ishikeit app 1042452472116584, valid; Messenger Page token assigned to Ishi Nail Lab Page ID 1152841001256379 with pages_messaging/pages_manage_metadata/pages_show_list. WhatsApp System User had management/messaging permissions and owner-confirmed app/WhatsApp asset assignments.
- Authenticated production GET /ops/meta/graph-proof-preflight returned WhatsApp proof_compatible, Messenger proof_unavailable, and graphProofFlagUnchanged=true. Messenger GET /me?fields=id and GET /1152841001256379?fields=id both returned Graph HTTP 400/code 100, but read-only GET /1152841001256379/subscribed_apps?limit=100 returned HTTP 200 and listed Ishikeit; do not infer token revocation or grant missing permissions from Graph 100 alone.
- PR #174 switches only Messenger Page-token preflight's signed Graph canary to a validated, token-debugger-derived Page ID with /{page-id}/subscribed_apps, requiring the originating app's listing. WhatsApp signed /me branch stays unchanged. Invalid type/Page ID/missing subscription fails closed. Dedicated operational bearer remains mandatory, no secrets returned or sent to ChatGPT.
- Local eslint, typecheck, 455 Vitest tests/64 suites, build PASSED. GitHub CI, exact Hostinger deployed SHA and the owner-authenticated live signed Messenger preflight are **still required** before issue #158 can be closed.
- **OWNER HOLD #169 UNCHANGED:** no Meta App Review submission, no blanket Require App Secret, do not enable META_GRAPH_PROOF_ENABLED until both channel checks pass and compatible production callers are established; no proactive WhatsApp reminders, no dead-letter replay.


## 2026-10-29 — Meta Graph Send API response JSON byte cap

- Bounded Send API acknowledgment/error JSON to 64 KiB before parsing, even with missing/wrong Content-Length, canceling oversized streams; no raw provider body logging. General memory-safety improvement, not a Meta-imposed response maximum.
- Existing channel-specific ID validation and armed outbox fence classify missing/malformed/oversized successful 2xx responses as ambiguous and quarantine for manual reconciliation, without automatic retry.
- Local full rerun: 454 tests / 64 suites, lint, typecheck and build passed; first broad test run had transient resource-contention failures before clean rerun. Docs/META_GRAPH_JSON_RESPONSE_LIMIT_2026-10-29.md.
- **OWNER HOLD #169: DO NOT submit Meta App Review**, enable proactive WhatsApp reminders, change Meta-wide Require App Secret, expose/rewrite masked secrets or replay historical dead letters.


## 2026-10-29 — Meta successful HTTP 2xx with no ID: quarantine, not false success

- Real code defect: MetaSender previously returned an empty result on HTTP 200/202 send responses without a documented, nonblank provider message ID. Outbox would incorrectly mark a Meta POST published without a correlatable provider ID.
- Fixed channel-specific success parsing in src/channels/meta-send.ts: Messenger requires message_id; Instagram accepts message_id or preexisting valid Instagram id, WhatsApp ordinary and template require messages[0].id. Missing/blank/wrong-shape IDs throw ambiguous retryable typed failures, which the existing durable Meta send fence dead-letters for manual reconciliation instead of replaying.
- Source: docs/META_SUCCESS_ACKNOWLEDGMENT_QUARANTINE_2026-10-29.md, official Meta Messenger/Instagram/WhatsApp response contracts, tests/meta-send.test.ts. Local npm run check: **452 tests across 64 suites, lint/typecheck/build passed**. Never claim provider delivery from HTTP 2xx alone.
- **OWNER HOLD #169 UNCHANGED: do not submit Meta App Review or Advanced Access without completion of full official-standards audit and explicit separate owner authorization.** Keep live Graph proof default OFF, Meta Require App Secret OFF, proactive WhatsApp reminders OFF, and historical dead letters unreplayed.


## 2026-10-29 — OWNER HOLD: Ishikeit Meta App Review / Advanced Access MUST NOT be submitted

- The owner explicitly instructed: **do not submit Ishikeit for Meta review until a comprehensive implementation and live verification audit proves current Meta messaging conforms to Meta's latest official standards and best practices**. Do not treat Meta's `can_submit=true` as permission to submit. Even after tests pass, obtain a separate explicit owner authorization before any submission.
- Hold issue: [#169](https://github.com/ishinaillab/ishikeit/issues/169). Scope and gated, source-backed matrix: `docs/META_APP_REVIEW_HOLD_AND_STANDARD_ACCESS_AUDIT_2026-10-29.md`.
- Important source discovery: Meta's official Instagram App Review development scenarios say **Standard Access for a business owned/managed by the app owner does not require App Review**; external third-party businesses typically require Advanced Access and review. Ishikeit appears owned-business-only today, but confirm actual permission/feature/asset requirements before deciding whether ANY Instagram App Review is needed. The Instagram rule must not be generalized to Messenger and WhatsApp.
- Current provider status: App Review `NO_SUBMISSION`, no requested privileges, unverified app contact email; Meta developer v26.0 latest/version no listed deprecations; app-level webhook subscriptions present. Unverified P0/P1 items include Meta-product-specific live signing app identity, actual Page/WhatsApp token issuer and signed Graph GET compatibility, fresh authorized Instagram/Messenger interaction/ownership canaries, older Instagram tester code 190, and WhatsApp proactive template PENDING with 0 opt-ins.
- Preserve default-off `META_GRAPH_PROOF_ENABLED`, Meta-wide `Require App Secret` OFF, WhatsApp template dispatcher OFF, no unapproved customer sends, no historical dead-letter replay and no masked Hostinger secret replacements.


## 2026-10-29 — Verified Meta production gate checkpoint after PRs #166/#167

- Ishikeit app functional deployment 0be6203b9bcad958527101a544880716dc0f583c, DB main 1b3cbef7ed838038cfb435953f239f34a931a835; Hostinger build completed, public health/live and ready HTTP 200, full local 450 tests/64 suites, CI passed.
- #159: private operator-only unknown-outcome listing and immutable review ledger deployed, no sends/replay; synthetic DB tests and cleanup verified, zero current queues/unknown reviews; strong individual RBAC/provider evidence still pending.
- #158: read-only Graph token issuer and HMAC proof preflight deployed, unauthenticated GET returns 401; actual production token checks NOT run because OPS token values remain masked. Global Meta Require App Secret and optional app proof flag OFF.
- Meta App Review NO_SUBMISSION (though can_submit=true), no privileges reported, contact email unverified. App legal URLs returned HTTP 200. Managed Instagram healthy, older tester Graph 190 remains; do not alter account credentials without proper OAuth reauthorization.
- WhatsApp appointment template PENDING and zero purpose-specific recipient opt-ins, reminders DISABLED. Full source-bounded follow-up and operational guardrails: docs/META_PLATFORM_GATE_CHECKPOINT_2026-10-29.md.


## 2026-10-29 — Read-only Meta token-app and signed Graph proof preflight

- App main baseline prior to PR: 223df3000eb9a64b26fc904925fa9a59bc58abe2, durable operator reconciliation successfully deployed. Operator preflight implemented in separate branch feat/meta-graph-proof-readonly-preflight-20261029, using only the existing OPS_METRICS_TOKEN auth.
- Strict two-stage, HTTPS graph.facebook.com, timeout-limited read-only validation per configured Messenger and WhatsApp token: Meta /debug_token checks originating app and validity; after both pass, appsecret_proof-signed GET /me checks proof compatibility. No token, URL, HMAC, provider identity or raw error leaks into operator output.
- Existing META_GRAPH_PROOF_ENABLED stays default OFF; Meta global Require App Secret stays OFF; no user/customer sends, subscription writes, token refresh or Instagram Login proof substitution. No Hostinger env replacement.
- Local lint, TypeScript, all 450 tests across 64 suites and build passed. Need GitHub CI, Hostinger exact revision, then authenticated private operator preflight on production tokens; a successful mocked test cannot close token ownership issue #158.
- Remaining Meta App Review NO_SUBMISSION and WhatsApp appointment template PENDING/0 opt-ins unchanged. See docs/META_GRAPH_PROOF_READONLY_PREFLIGHT_2026-10-29.md.


## 2026-10-29 — Meta unknown-outcome operator reconciliation (#159 continuation)

- Implemented separate operator-only, **non-sending** GET and POST reconciliation routes, backed by private RLS-protected `public.meta_outbound_reconciliations` with exact Supabase migration `20261029092718_meta_outbound_unknown_reconciliations` (ishikeit-db PR #13). Migration applied and table RLS/client grants verified before app release.
- GET yields bounded metadata and unresolved/reviewed counts; POST stores an immutable human attestation with enumerated disposition/evidence and hashed operator tag. Neither endpoint resets dead letters, creates actions, contacts Meta, or sends messages. No raw recipients/customer content/provider error text in results.
- Fail-closed operational bearer auth, strict body and UUID validation, duplicate idempotence, 409 conflict, safe 404 and 503; existing Meta outbox fence remains untouched. See `docs/META_UNKNOWN_OUTCOME_OPERATOR_RUNBOOK_2026-10-29.md`.
- Local source lint, TypeScript check, focused API/store tests and all 447 tests across 63 suites plus production build passed at this checkpoint. GitHub CI and exact deployment must still be read back separately before declaring this version live.
- Open issues #159 (operator identity/RBAC, provider cross-verification) and #158 (real token/app proof canaries) remain; Instagram App Review and WhatsApp pending template/consent gates remain unchanged.


## 2026-10-29 — Verified Meta durable outbox production release (supersedes pending-state notes)

- App PR #164 MERGED and Hostinger build COMPLETED at exact SHA 58be7eb746117428f35af6fe8f064ca8dcb20e69; direct HTTPS live/ready/build HTTP 200. Local 443/443 tests, ESLint/typecheck/build and GitHub Node/PHP/context checks passed.
- DB PRs #11/#12 merged; Supabase applied migration 20261029090102_meta_ambiguous_send_fence. Readback: column/index present, RLS enabled, no anon/authenticated outbox grants. A one-transaction synthetic lease-crash recovery canary passed and cleaned all test rows. No customer send or existing queue row was modified by testing.
- Postrelease queue: 0 pending, 0 unresolved armed, 0 new dead letters (inspected one-hour window). Hostinger startup: managed Instagram owner and Messenger Page subscription reconciliation succeeded; separate tester OAuth Graph 190 warning remains unrelated.
- Meta Require App Secret false, App Review NO_SUBMISSION, contact email unverified. WhatsApp template ishi_appointment_reminder_v1 still PENDING; 0 active opt-in records, so reminders stay disabled. Token-app ownership and manual unknown-outcome reconciliation are remaining issues #158/#159. Full bounded evidence: docs/META_OUTBOUND_PRODUCTION_VERIFICATION_2026-10-29.md.


## 2026-10-29 — Durable Meta send fence; DB dependency (pending PRs)

- Continued from user-supplied three Deep Research reports and the earlier ambiguous Meta network-failure quarantine fix in Ishikeit PR #164. Verified current production Supabase outbox had 0 pending, 0 leased and 0 pending Meta actions at preflight. Source baseline remains application main 02695ac and DB main 741ef24 until merge/deployment readback.
- App PR #164 now includes durable crash/lease-loss protection: before supported Messenger/WhatsApp message or approved-template send, the current lease-holder must atomically persist an outbox send-start fence. No provider request occurs if it cannot be committed. Claimed rows exclude already fenced sends. A bounded SKIP LOCKED recovery marks expired armed sends as provider_outcome_unknown dead letters with an attempt record; these are NEVER auto-replayed. HTTP 429 explicit refusal retries clear the fence; no-response/HTTP 5xx remain quarantined.
- Canonical DB migration initially tracked in ishinaillab/ishikeit-db PR #11 and reconciled to the exact applied Supabase version by PR #12, 20261029090102_meta_ambiguous_send_fence.sql, adds nullable outbox.meta_send_started_at and a partial recovery index; preserves outbox RLS and client-role restrictions. It must be applied BEFORE app PR #164 is merged/deployed because new app database readiness checks that column. The former application ignores this additive column.
- Locally verified ESLint, TypeScript, 443 tests across 62 suites and build at this checkpoint. PR-specific CI, production migration/readback, safe synthetic lease-recovery validation and Hostinger exact deployed SHA must be checked separately before declaring production complete.
- Keep current customer traffic, historical 43 dead letters, Meta webhook signing, Graph proof flag, WhatsApp template/consent and LatePoint scheduling safety holds untouched. Unknown outcome quarantine prioritizes avoiding duplicate sends over guaranteed reply delivery. Manual reconciliation remains necessary; never claim exactly-once provider delivery.
- Runbook: docs/META_DURABLE_SEND_FENCE_2026-10-29.md. No customer test sends or production flags were toggled in the coding phase.


## 2026-10-29 — Three Meta Deep Research reports reconciled; ambiguous-send safety (PR #164)

- Received and reviewed three user-supplied reports: *Meta Platform Deep Research and Ishikeit Technical Audit*, *Executive Summary*, and *Ishikeit Meta Security Module Integration and Production Rollout Plan*. Their target architecture largely reinforces the existing provider-neutral inbox/outbox, signed ingress, product adapters, policy gates and staging strategy. Do not mistake report proposals for missing features without source-level verification.
- GitHub `main` at review start: `02695ac979890ad9f4c531615b76e7d103557915`. Local D-only Windows app and DB repositories were clean. GitHub PR #163 has already integrated the default-OFF Meta Graph `appsecret_proof` for eligible Messenger/WhatsApp Graph requests; no Meta-wide enforcement or live token verification was claimed.
- **Confirmed #159 bug:** `src/channels/meta-send.ts` classifies no-response Graph POST failures as `ambiguous=true`, but `src/workers/outbox-worker.ts` previously treated retryability alone as grounds for automatic retry. That could duplicate a customer message already accepted by Meta.
- PR #164 changes the worker to send such Meta `messaging/message.send` and `message.template.send` failures into the existing durable dead-letter state with safe `provider_outcome_unknown` classification and explicit manual reconciliation. Definite 429 throttling continues retrying, other-provider behavior remains unchanged. No historic dead letters are requeued. This is a conservative **partial** safety fix, not proof of exactly-once delivery.
- Remaining #159 risk: crash/lease loss between Meta accepting a POST and durable completion may allow reclaim without knowing the previous result. Durable pre-send fencing, expiration recovery policy, reconciliation and lease-loss/restart regression tests remain required. Do not close #159 based on PR #164 alone.
- Local validation on isolated `fix/meta-ambiguous-send-quarantine-20261029`: ESLint, TypeScript typecheck, **438 Vitest tests/61 files**, and production build passed. GitHub CI and postmerge Hostinger revision/health/queue readback remain separate gates; no provider sends, credentials or app settings changed by this work.
- Other research gaps remain subject to evidence: live Instagram product-specific signing-secret proof, Page/WABA token app ownership for #158, rate-limit/error policy, bounded Conversations API reconciliation, exact App Review scope readback, WhatsApp template approval and real opt-in/booking state. The appointment-reminder dispatcher stays OFF. See `docs/META_DEEP_RESEARCH_RECONCILIATION_2026-10-29.md` for the prioritized source-bounded matrix.
- The Windows Git push for this branch returned HTTP 403 because it presented account `elanakkuku`, not authorized `ishinaillab`. Do not overwrite Windows credentials or bypass permission checks. The already-authorized GitHub connector created PR #164 directly from the same verified file contents. Local branch commit `dab1918` is not the remote branch's three-commit SHA.
 

## 2026-10-26 — TikTok read-only activation preflight (newest, default-off)

- Continued from the October 26 authoritative checkpoint on branch
  checkpoint/operational-review-2026-10-24, reconciled against latest main
  (47a6f2ce0c809061ee6d69e3a701820d0d183c95).
- PR #71 (Comment-to-Message) and PR #76 (Automatic Messages read client)
  are merged. Neither establishes TikTok Business Messaging-specific app
  approval or fresh account-level messaging consent.
- Added local-only operational preflight
  scripts/probe-tiktok-messaging-preflight.mjs, with seven mock tests and a
  Node24 CI test step. It calls only Ishikeit GET routes, never TikTok
  provider endpoints, OAuth start, webhook reconcile, provider sends, or DB
  writes. It returns sanitized metadata, not account identity or secrets.
- Subsequent **authenticated** TikTok developer-app Authorization readback
  in the authorized Windows Chrome session confirmed an approved scope change
  for ishikeit. The displayed permission categories included Accounts and
  Marketing tooling, but searches found zero Business Messaging category or
  business/message/ API routes. This does not prove a separate grant is
  impossible, only that it was **not established** by the approved scope page.
  Stored OAuth scopes remain organic/Accounts-oriented. No TikTok app settings,
  OAuth consents, webhook subscriptions, or messages were modified.
- Hostinger secrets remain masked; no changes to the 51-key environment set,
  live integrations or the 43 historical dead letters. Next gate: verify
  product approval and scopes with TikTok, then obtain account owner consent.
- Procedure: docs/TIKTOK_APPROVAL_ACTIVATION_2026-10-25.md.

Updated: 2026-10-02

## Canonical project

Application repository:

- `ishinaillab/ishikeit`
- canonical branch: `main`
- production domain: `https://apps.ishinaillab.com`

Database/schema repository:

- `ishinaillab/ishikeit-db`
- canonical branch: `main`

Canonical Meta webhook route:

- `GET /ishikeit/webhooks/meta`
- `POST /ishikeit/webhooks/meta`

Do not create new platform-specific durable cores. New providers and capabilities must plug into the canonical event/action architecture through adapters.

## Production deployment

Hostinger is connected to:

- repository: `ishinaillab/ishikeit`
- branch: `main`
- Node.js: 24
- app type: Fastify
- build script: `build`
- entry file: `dist/processes/http.js`
- package manager: npm

Verified application-code revision used for Telegram production activation:

```text
dbb69c079b59dd2daff5f1fab2fd2ba594426faf
```

That revision completed GitHub Actions successfully and was rebuilt on Hostinger during the Telegram production cutover. It contains the provider-neutral Telegram messaging adapter in addition to the previously deployed video-interpreter architecture and Instagram routing observability. Production keeps video interpretation disabled until a verified paid Gemini credential is configured.

Hostinger's official MCP is authenticated on the authorized desktop through OAuth and can inspect builds, runtime logs, Node.js settings, and environment-variable key state without exposing stored values.

## Current production runtime state

The processor and dispatcher are live.

Verified `GET /health/capabilities` state:

```json
{
  "service": "ishikeit",
  "architecture": "event-action-v1",
  "canonicalEventSchema": 2,
  "actionSchema": 1,
  "operationalMetricsSchema": 2,
  "wordpressBridgeApiSchema": 3,
  "wordpressBridgeStorageSchema": "1.1.1",
  "runtime": {
    "processorEnabled": true,
    "actionDispatchEnabled": true,
    "processorCutoverAt": "2026-09-30T10:31:25.208Z",
    "processorCanaryPartitionCount": 0,
    "videoInterpreterProvider": "none"
  }
}
```

Also verified:

- `GET /health/live` → HTTP 200
- `GET /health/ready` → HTTP 200

The full-rollout cutover is intentionally retained across ordinary restarts. Do not move it forward just because the process restarts; doing so would discard recoverable post-launch backlog.

`videoInterpreterProvider=none` is intentional in the current production environment. The new video interpreter must remain opt-in until a paid Gemini API project/key is available and a real provider-backed video smoke test succeeds.

## Production environment controls

Production now contains the runtime keys required for:

- PostgreSQL
- Meta webhook authentication
- Messenger access token
- Instagram access token
- WhatsApp access token
- WordPress AI bridge URL and credential
- AI bridge/file/media timeout controls
- processor enablement
- action dispatcher enablement
- Meta outbound compatibility flag
- Meta outbound request timeout
- Telegram bot credential and webhook secret
- Telegram outbound request timeout

Raw values are secret and must stay in Hostinger/runtime secret storage. The local production recovery `.env` also contains the complete production key set; temporary one-off credential handoff files must be cleared after promotion.

Current control state:

```text
PROCESSOR_ENABLED=true
ACTION_DISPATCH_ENABLED=true
META_OUTBOUND_ENABLED=false
PROCESSOR_CANARY_PARTITION_KEYS=<unset>
PROCESSOR_CUTOVER_AT=2026-09-30T10:31:25.208Z
```

`META_OUTBOUND_ENABLED` remains only a backward-compatible alias. New configuration should use `ACTION_DISPATCH_ENABLED`.

## Meta app

Current app:

- name: Ishikeit
- app ID: `1042452472116584`
- category: Messaging
- status: published/live
- Graph API target: `v26.0`

Current app-level webhook subscriptions are exactly:

- `page` → `messages`
- `instagram` → `messages`, `standby`, `messaging_handover`
- `whatsapp_business_account` → `messages`

Callback:

```text
https://apps.ishinaillab.com/ishikeit/webhooks/meta
```

Instagram professional account:

```text
17841438662359631
```

WhatsApp production identifiers:

- Business ID: `1030506726679124`
- WABA: `4663054720683021`
- phone-number ID: `1416383858214802`

App Review status is currently `NO_SUBMISSION`, with no Advanced Access privileges granted. Meta currently reports `can_submit=true`, Business Verification passes, the privacy-policy requirement passes, and compliance has no open required actions or violations.

The current Instagram Messaging webhook documentation establishes the decisive public-user boundary: to receive webhook notifications that include data owned or managed by people who do not have a role on the app, the app must be approved through App Review. Without that approval, messaging webhook delivery is role-limited. This matches the production evidence: the controlled/role account path works, while the fresh ordinary non-role account message produced no outbound API activity because no normal customer message reached Ishikeit's send path.

For the Instagram API with Instagram Login architecture, the App Review package should request `instagram_business_basic` together with its dependent messaging permission `instagram_business_manage_messages`. Do not redesign the processor or outbound adapter to work around this access boundary.

## Durable ingress

The production Meta ingress path is:

1. enforce request-size limit
2. preserve exact raw request bytes
3. verify `X-Hub-Signature-256` using the Meta App Secret
4. parse only after signature verification
5. normalize provider events into the canonical event schema
6. derive provider-local deduplication and partition identities
7. transactionally persist `inbound_events` plus `inbound.event.accepted`
8. ACK only after durable commit

AI calls, media downloads, profile lookups, and provider outbound calls never run before the webhook ACK.

Reliability model:

- at-least-once transport
- deterministic inbound deduplication
- durable inbox/outbox
- lease-based workers
- bounded retry/backoff
- dead-letter handling
- ordering per partition
- lease renewal during long-running handler/media work
- duplicate provider delivery is expected and safe

Raw webhook bytes are transient and are not permanently stored.

## Canonical event architecture

Core routing fields are provider-neutral:

- provider
- channel
- capability
- account ID
- event type
- provider event/message identity
- actor/identity
- timestamps
- portable content

Portable content supports:

- text
- image
- video
- audio
- document
- structured data

Provider-native details remain available in canonical `data` so future adapters do not need to force every provider into Meta-specific shapes.

A future Telegram webhook must emit the same canonical event contract rather than adding Telegram assumptions to the durable processor.

## Durable inbound processor

`InboundProcessorWorker` consumes:

```text
inbound.event.accepted
```

The worker:

1. claims with a bounded lease
2. loads the persisted canonical event
3. applies production cutover/canary guards
4. records processing state
5. routes through `EventHandlerRegistry`
6. runs the selected handler outside the DB transaction
7. transactionally persists generated actions and marks the source event processed
8. completes the accepted-event queue record
9. retries transient failures
10. dead-letters permanent/exhausted failures

The first handler intentionally accepts only:

```text
capability=messaging
eventType=message.received
```

Delivery statuses, echoes, ads events, lead events, and future administrative events are not interpreted as customer chat.

## WordPress AI Engine bridge

The active private bridge is the WordPress plugin:

```text
Ishi AI Bridge
```

Current bridge/runtime contract:

- plugin version: `0.3.0`
- bridge API schema: `3`
- storage schema: `1.1.1`
- authenticated audio API ready: `true`
- optional machine-readable handoff reason: supported

Current WordPress REST base:

```text
https://www.ishinaillab.com/wp-json/ishi-ai/v1
```

The bridge is responsible for:

- dedicated bearer authentication
- durable AI-turn idempotency
- request-fingerprint conflict protection
- durable file-upload idempotency
- idempotent audio transcription through AI Engine's dedicated transcription API
- conversation continuity via AI Engine chat ID
- server-side AI Engine calls
- typed reply-part validation
- protected health endpoint
- no-store/private REST responses

Verified behaviors:

- valid bridge credential → authenticated health succeeds
- missing credential → HTTP 401
- wrong credential → HTTP 401
- REST responses are not cached by LiteSpeed
- repeating the exact same turn returns the same durable result
- reusing one turn ID with a different request is rejected
- controlled file upload succeeded and replayed idempotently
- controlled speech audio transcription succeeded through `/transcribe`
- bridge health reports `aiEngineReady`, `fileApiReady`, and `audioApiReady`

Provider tokens and provider webhook authentication do not live in this WordPress bridge.

## Generic action architecture

Handlers enqueue:

```text
topic = action.dispatch
```

with a generic envelope containing:

- schema version
- stable idempotency key
- provider
- capability
- operation
- ordering key
- target
- body

The worker resolves:

```text
provider / capability / operation
```

through `ActionDispatcher`.

Current concrete adapters:

```text
meta / messaging / message.send
telegram / messaging / message.send
```

Future examples may include:

```text
telegram / messaging / message.send
meta / marketing / campaign.create
meta / marketing / campaign.update
meta / leads / lead.read
meta / leads / lead.update
```

Provider-specific authentication, API limits, response parsing, retry classification, policy windows, and approval requirements stay inside provider adapters.

## Rich outbound messaging

The Meta messaging adapter currently supports portable outbound parts:

- text
- image
- video
- audio
- document

Messenger/Instagram map portable media to attachment payloads.

WhatsApp maps portable media to Cloud API media payloads.

Media handling is adapter-based and runs only after durable ingress. Meta media fetching uses HTTPS-only validation, host allowlisting, manual redirect validation, bounded redirects, request timeouts, and byte-size ceilings.

## Database state

The production PostgreSQL schema includes the provider-neutral processor migrations.

Important current properties:

- fixed three-channel DB constraint removed
- `provider` and `capability` stored separately
- `partition_key` persisted on `inbound_events`
- processing errors tracked on inbound events
- durable `processing_outcome` values: `handled`, `handoff`, `ignored`, `rollout_skipped`
- optional machine-readable `handoff_reason` stored only for handoff outcomes
- historical processed rows were deliberately not backfilled and remain outcome `unknown` in metrics
- route/partition indexes present
- historical pending accepted events were sealed before processor rollout
- readiness fails if required processor schema is absent

The persisted ingress partition key is reused by processing and action ordering. Provider-specific partition logic is not recomputed inside the generic processor.

## Production rollout proof

A staged production rollout was completed on 2026-09-30.

### Stage 1 — code and environment, workers disabled

Verified:

- latest main build deployed
- production environment expanded with processor/bridge/WhatsApp configuration
- `PROCESSOR_ENABLED=false`
- `ACTION_DISPATCH_ENABLED=false`
- health remained green

### Stage 2 — canary processor only

Canary allowlist contained the three already-controlled Messenger, Instagram, and WhatsApp test conversation partitions.

A fresh cutover was set and:

```text
PROCESSOR_ENABLED=true
ACTION_DISPATCH_ENABLED=false
```

Three correctly signed controlled Meta webhook messages were injected through the real production ingress, one for each channel.

Result for all three:

- webhook returned HTTP 200 accepted
- event persisted
- canonical partition matched the expected canary partition
- source event reached `processed`
- one durable `action.dispatch` text action was created
- no action was sent while dispatcher remained disabled

### Stage 3 — canary dispatcher

Dispatcher was enabled while canary protection remained active:

```text
PROCESSOR_ENABLED=true
ACTION_DISPATCH_ENABLED=true
```

All three queued actions were accepted by their provider API and stored a provider resource ID.

Additional provider-side proof included:

- Instagram message echo webhook received
- WhatsApp `delivery.sent` webhook received
- WhatsApp `delivery.delivered` webhook received
- Messenger production conversation continued through the canary partition

No canary action was dead-lettered.

### Stage 4 — full rollout

A new full-rollout cutover was set:

```text
2026-09-30T10:31:25.208Z
```

Canary filtering was removed and both workers stayed enabled.

A controlled post-cutover Messenger smoke event then verified:

- ingress accepted
- event processed once
- no inbound processing error
- outbound action published
- provider resource ID persisted
- no retry
- no dead letter

At the post-rollout DB audit:

- pending `action.dispatch`: 0
- dead-lettered `action.dispatch`: 0
- pending `inbound.event.accepted`: 0
- recent inbound events with `last_error`: 0

At the post-rollout Hostinger runtime-log audit:

- 179 runtime entries in the inspected one-hour window
- warning/error count: 0
- processor and outbound publish messages present

## Handoff and processing-outcome observability

The handoff observability rollout completed on 2026-09-30.

Deployed application revision:

```text
9d0fdd747e222ded771c56f47ade0229dd9a96ca
```

Deployed WordPress bridge:

```text
Ishi AI Bridge 0.3.0
```

Current contracts:

- operational metrics schema: `2`
- WordPress bridge API schema: `3`
- WordPress bridge storage schema: `1.1.1`

The processor now persists one durable outcome for newly completed inbound events: `handled`, `handoff`, `ignored`, or `rollout_skipped`.

Handoff reasons are constrained low-cardinality machine codes. Free-form customer text must not be stored as a handoff reason or emitted into operational metrics. Missing or invalid reasons normalize to `unspecified`.

The protected `/ops/metrics` endpoint reports inbound outcome counts, historical processed rows with no recorded outcome as `unknown`, handoff totals and reason groups, queue state, and publish/retry/dead-letter attempts. No historical outcome was guessed or backfilled.

Production verification:

- bridge 0.3.0 authenticated health returned HTTP 200
- AI, file, and audio bridge APIs all reported ready
- Node `/health/live` and `/health/ready` returned HTTP 200
- `/health/capabilities` reports metrics schema 2 and bridge API schema 3
- one correctly signed controlled Messenger smoke event was accepted and processed on attempt 1
- that event persisted `processing_outcome=handled`
- one outbound action published, with zero dead letters
- post-smoke protected metrics showed one new handled outcome while older rows remained unknown
- Hostinger one-hour runtime-log audit returned 96 lines with zero WARN/ERROR and contained processor/outbound activity

A live human-handoff event was intentionally not forced in production. The handoff persistence/reason path is covered by repository tests, and the WordPress bridge handoff contract remains opt-in through the existing filters.

## Instagram routing/access diagnostics

Instagram routing observability rolled out on 2026-10-01 in deployed revision:

```text
14e1bd30bbe699992bf2c8479f3cf6e6571ceaa5
```

The Meta normalizer now treats conversation-routing signals as a separate canonical capability:

- `capability=routing`
- standby message/read/delivery/postback events normalize as `standby.*`
- conversation-control notifications normalize as `handover.pass`, `handover.take`, or `handover.request`
- routing events contain no portable AI content
- `MessageReceivedHandler` explicitly does not claim routing events
- unhandled routing events are durably completed with `processing_outcome=ignored`

Production verification:

- GitHub PR #21 CI passed
- local validation passed with 14 test files and 80 tests
- Hostinger built revision `14e1bd30...` successfully
- `/health/live`, `/health/ready`, and `/health/capabilities` returned HTTP 200 after deployment
- Meta's `messaging_handover` synthetic webhook produced a durable `routing / handover.pass` event and was processed as `ignored`
- a controlled correctly signed documented standby payload produced a durable `routing / standby.message` event and was processed as `ignored`
- no AI reply or outbound action was generated for either routing probe

The current Instagram subscription includes `messages`, `standby`, and `messaging_handover`. Do not remove these routing fields without first deciding how routing diagnostics will be preserved.

External-account diagnosis:

- `povnailstudio.ph` has durable inbound Instagram events and successfully published reply actions
- `povnailstudio.com.ph` has no durable inbound Instagram event in the inspected production history, so its failure occurs before AI processing or outbound dispatch
- following status was not the differentiator for the working account
- Meta app compliance was previously verified clean, but a fresh authenticated App Review requirements read on 2026-10-01 now reports `business_verification_passes=false`; reconcile this current dashboard state before submission
- App Review still reports `can_submit=true`, current status `NO_SUBMISSION`, and no Advanced Access privileges

Do not add Conversation Routing write/control APIs merely because routing webhooks are observable. Meta's current Conversation Routing documentation is tied to the Messenger/Page-linked architecture and requires a linked Facebook Page with Pages Messaging. Ishikeit's Instagram outbound path currently uses the newer Instagram Login host `graph.instagram.com`. Keep routing control read-only/observational until the correct authorization model for this app is proven.

## Meta App Review live recheck — 2026-10-01

A fresh authenticated Meta developer-tool read for app `1042452472116584` reports:

- submission status: `NO_SUBMISSION`
- `can_submit=true`
- requested/granted Advanced Access privileges: none
- current App Review requirement snapshot: `business_verification_passes=false`

The Business Verification result conflicts with the earlier verified project state that reported it passing. Treat the current authenticated result as the active blocker and reconcile it in Meta App Dashboard before submitting. Do not infer that the earlier passing state is still valid.

Meta's current Instagram API with Instagram Login review guidance confirms that the intended Advanced Access request remains `instagram_business_basic` plus the dependent `instagram_business_manage_messages` permission, and that the review evidence must demonstrate the real login/authorization and messaging flow. Do not fabricate reviewer evidence.

## Telegram adapter implementation — merged 2026-10-01

The first non-Meta messaging adapter was squash-merged by GitHub PR #24 into `main` as:

```text
85a92e3a53bb5b41661ccae5a0f51d731dcaf56f
```

It adds Telegram through the existing provider-neutral boundaries without changing the durable processor or database schema.

Implemented boundaries:

- authenticated `POST /ishikeit/webhooks/telegram` ingress using Telegram's secret-token header
- Bot API `update_id` deduplication and per-chat durable partitioning
- portable text/image/video/audio/document normalization
- provider `file_id` resolution through `getFile` after webhook ACK
- `telegram / messaging / message.send` action adapter
- Telegram-local send limits, throttling retry guidance, and delivery-ambiguity classification
- bot-token/account consistency enforcement
- runtime credential redaction and paired token/secret configuration
- focused unit/integration tests for normalization, ingress authentication, media resolution, send behavior, environment validation, and the action adapter

Validation on PR #24 and merged `main`:

- the first PR CI run correctly failed only on four ESLint `no-base-to-string` assertions in the newly added tests
- those test assertions were corrected without changing runtime behavior
- the final PR-head CI passed Node, PHP lint, and context-continuity
- merged-main CI run #93 also passed Node, PHP lint, and context-continuity
- `npm run check` passed lint, typecheck, tests, and build
- 18 test files passed
- 96 tests passed
- no Telegram credential, provider webhook, or production activation was performed as part of the merge

Telegram production activation completed on 2026-10-01.

Production bot:

- name: `Ishi Nail Lab`
- username: `@ishinailbot`
- bot ID: `8985271003`
- webhook: `https://apps.ishinaillab.com/ishikeit/webhooks/telegram`

Activation controls and provider verification:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_OUTBOUND_REQUEST_TIMEOUT_MS` are present in Hostinger production
- the webhook rejects requests without the Telegram secret-token header with HTTP 401
- initial `setWebhook` used `allowed_updates=["message"]` and `drop_pending_updates=true`
- post-registration and post-canary `getWebhookInfo` both reported the expected URL, `pending_update_count=0`, no last error, and only `message` updates
- `GET /health/ready` returned `{"status":"ready"}`

Controlled human-originated canary proof:

- exact Telegram inbound event persisted once as `provider=telegram`, `channel=bot`, `capability=messaging`, `event_type=message.received`
- source inbound event ID: `1d608d83-85c7-450a-bf42-7d33dd0773e1`
- provider inbound message ID: `14`
- event processed on attempt 1 with `last_error=NULL`
- exactly one `telegram / messaging / message.send` action was created
- action published on attempt 1
- Telegram returned provider message ID `15`
- outbound attempt duration was 682 ms
- recent `action.dispatch` audit showed 0 pending and 0 dead-lettered actions

Telegram is therefore production-active.

Hostinger operational guardrails proven during this cutover:

- `hosting_nodejs_replace-environment-variables` is a **full replacement**, not a patch. Never reconstruct values from `hosting_nodejs_list-environment-variables`; its values are masked/non-reusable. Build the full desired set from a trusted secret source.
- For a manual `hosting_nodejs_start-build` of this repository through Hostinger MCP, use repository-root output (`root_directory="."`, `output_directory="."`) with entry `dist/processes/http.js`. Using `output_directory="dist"` publishes the contents of `dist` as the runtime root and makes `dist/processes/http.js` unavailable.
- Hostinger normalizes repository-root `root_directory="."` to `null` in returned build metadata; that is expected.
- The production readiness body is `{"status":"ready"}`; do not gate on a nonexistent `ready:true` field.

The temporary Telegram credential handoff file was cleared after the credential pair was promoted into the existing local production recovery `.env`. Secrets remain excluded from Git.

## TikTok Business Messaging adapter — implementation milestone 2026-10-02

TikTok for Business Business Messaging is implemented through the existing provider-neutral event/action boundaries. The original messaging adapter required no schema change; the later production OAuth lifecycle adds the dedicated OAuth migration documented below.

Implemented runtime boundary:

- optional authenticated `POST /ishikeit/webhooks/tiktok`
- raw-body `TikTok-Signature` HMAC-SHA256 verification before JSON parsing
- bounded signature timestamp age to reduce replay risk
- canonical route: `provider=tiktok`, `channel=business`, `capability=messaging`
- `im_receive_msg` -> `message.received`
- `im_send_msg` -> `message.sent` so send echoes do not re-enter the AI conversation handler
- deterministic event deduplication and per-conversation durable partitioning
- signed events for another authorized Business Account are acknowledged as ignored without persistence
- inbound text/image/video/share-post/structured message normalization
- inbound image/video provider-media resolver after durable webhook ACK
- `tiktok / messaging / message.send` action adapter
- generic TikTok outbound intentionally restricted to text in this milestone
- target Business Account validation
- provider-specific transport/rate-limit failure classification
- TikTok signature/app-secret/OAuth-secret log redaction
- HTTP request serialization strips query strings, preventing OAuth callback state/auth codes from entering request logs
- TikTok OAuth application settings must be configured as one complete protected set; Business Account activation is a separate post-authorization step

Configuration contract after the OAuth-lifecycle hardening:

```text
TIKTOK_BUSINESS_APP_ID
TIKTOK_BUSINESS_APP_SECRET
TIKTOK_BUSINESS_AUTHORIZATION_URL
TIKTOK_BUSINESS_REDIRECT_URI=https://apps.ishinaillab.com/ishikeit/oauth/tiktok/callback/
OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64
TIKTOK_BUSINESS_ID
TIKTOK_BUSINESS_API_VERSION=v1.3
TIKTOK_WEBHOOK_MAX_AGE_SECONDS=300
TIKTOK_OAUTH_STATE_TTL_SECONDS=600
TIKTOK_TOKEN_REFRESH_SKEW_SECONDS=300
TIKTOK_OAUTH_REQUEST_TIMEOUT_MS=10000
TIKTOK_OUTBOUND_REQUEST_TIMEOUT_MS=10000
```

`TIKTOK_BUSINESS_ACCESS_TOKEN` is deliberately no longer a production environment variable. TikTok Business Account access tokens are short-lived and are now obtained/refreshed through the durable OAuth flow.

Current official TikTok API for Business documentation treats Business Messaging, Marketing, Organic, and other API product families separately. Keep that separation in Ishikeit. The current Marketing Ad account management review is not a substitute for Business Messaging access. Automatic messages, templates, Comment-to-Message, image upload/send, conversation unlock, lead operations, Organic API actions, Marketing API actions, and future TikTok surfaces must be explicit operations/capabilities rather than hidden behind generic conversational `message.send`.

### TikTok OAuth/token lifecycle hardening — 2026-10-02

The static-access-token design was replaced before production activation because TikTok Business Account access tokens are short-lived. The app now implements the provider's account-holder OAuth lifecycle rather than requiring a daily manual token replacement.

Implemented:

- protected `POST /ops/tiktok/oauth/start` returns a TikTok authorization URL carrying a cryptographically random one-time state
- only the SHA-256 state hash, exact redirect URI, expiry, provider, and consumed timestamp are stored
- public `GET /ishikeit/oauth/tiktok/callback/` atomically consumes state before exchanging the authorization code
- authorization-code exchange uses `tt_user/oauth2/token/`
- refresh uses `tt_user/oauth2/refresh_token/`
- protected `GET /ops/tiktok/oauth/status` returns safe account/scope/expiry metadata only
- OAuth access/refresh tokens are AES-256-GCM encrypted in the application before PostgreSQL storage
- the encryption key is a dedicated 32-byte server secret and is never stored in PostgreSQL
- ciphertext AAD binds each token to provider, Business Account ID, and access/refresh token kind
- access tokens refresh before expiry; replacement refresh credentials are persisted when returned
- concurrent requests in one process share one in-flight refresh operation
- refresh is also serialized across application processes with a PostgreSQL advisory lock; a waiting process re-reads the durable credential after acquiring the lock and skips provider refresh when another process already renewed it
- missing/expired refresh credentials require Business Account reauthorization and are classified non-retryable; transient OAuth network/rate-limit/server failures remain retryable
- TikTok sender/media calls obtain tokens dynamically; pre-send token failures are retryable but not delivery-ambiguous
- logger redaction covers OAuth encryption key plus access/refresh token fields
- application startup fails if TikTok OAuth is configured while the OAuth schema is absent; once `TIKTOK_BUSINESS_ID` is set, startup/readiness also require a matching decryptable durable credential with a usable refresh token

Database migration in `ishinaillab/ishikeit-db`:

```text
supabase/migrations/20261002020000_oauth_credentials.sql
```

It adds RLS-protected `oauth_credentials` and `oauth_authorization_states` tables, revokes `anon`/`authenticated`, enforces encrypted-token IV/tag shape and all-or-none refresh-token fields, and indexes active state expiry. The migration was first executed against production inside an explicit transaction and rolled back; that dry-run verified both tables could be created successfully. GitHub PR #5 in `ishinaillab/ishikeit-db` was then squash-merged as `952cd7894230f9ed69397922a7c3da2fa47f1777`, the exact merged migration was permanently applied to production, both tables were verified with RLS enabled, and `anon`/`authenticated` were verified to have no SELECT privilege. Because the SQL was applied directly after the Supabase CLI hit a local Windows spawn failure, the remote Supabase migration ledger was explicitly repaired and read back as version `20261002020000`, name `oauth_credentials`, with 9 recorded statements.

Latest local application validation:

- lint: passed
- typecheck: passed
- test files: 26 passed
- tests: 132 passed
- build: passed

Repository validation for the original base-adapter milestone:

- lint: passed
- typecheck: passed
- test files: 23 passed
- tests: 120 passed
- build: passed
- `git diff --check`: passed

Merge/deployment verification:

- GitHub PR #27 squash-merged to `main`
- merged revision: `933c79a3b04a7a932844c64455ae11e3234607b1`
- PR CI passed Node, PHP lint, and context-continuity
- merged-main CI passed
- Hostinger automatic build `01a0f879-11ab-71bf-9d2f-7416638948c5` completed for the merged revision
- post-deploy `GET /health/ready` returned `{"status":"ready"}`
- post-deploy runtime audit reported 31 entries and 0 WARN/ERROR
- existing Telegram webhook remained protected: unauthenticated POST returned HTTP 401
- TikTok webhook returned HTTP 404 after deployment because no TikTok credential set is configured; this is the intended inactive/configuration-gated state
- post-deploy processor/outbound activity remained present with no runtime error

OAuth-lifecycle merge/deployment verification:

- GitHub PR #29 squash-merged to `main`
- merged revision: `135d6856f10517ce9ff7eb658e9e4db175b3cb41`
- the tested branch tree and merged `main` tree were verified identical
- merged-main GitHub Actions CI run `36914140091` completed successfully
- Hostinger automatic build `01a0f8ed-aee7-711d-a25e-e2436b574d2c` completed for `135d6856f10517ce9ff7eb658e9e4db175b3cb41`
- post-deploy `GET /health/ready` returned `{"status":"ready"}`
- fresh Hostinger runtime audit reported 36 log entries, 0 WARN/ERROR, and the inbound AI processor enabled after deploy
- `POST /ishikeit/webhooks/tiktok` returned HTTP 404 because no TikTok provider configuration is present
- `GET /ops/tiktok/oauth/status` returned HTTP 404 because no TikTok OAuth application configuration is present
- the trusted local production recovery `.env` contains no `TIKTOK_*` or `OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64` values, so TikTok remains intentionally inactive

Current TikTok API-version compatibility check — 2026-10-02:

- TikTok's current API for Business documentation announces a general v2.0 release and explains that endpoints without material contract changes may require only a version-path change
- Business Messaging and TikTok-account OAuth are not yet usable on v2.0 at the live API edge
- no-credential probe of `/open_api/v1.3/tt_user/oauth2/token/` returned TikTok code `40002` (`client_id` missing), proving the v1.3 OAuth route is active
- the same probe against `/open_api/v2.0/tt_user/oauth2/token/` returned HTTP 404
- no-token probe of `/open_api/v1.3/business/message/send/` returned TikTok code `40104` (access token empty), proving the v1.3 Business Messaging route is active
- the same probe against `/open_api/v2.0/business/message/send/` returned HTTP 403 / TikTok code `40006` (`no schema found`)
- therefore keep `TIKTOK_BUSINESS_API_VERSION=v1.3` for Business Messaging/OAuth until TikTok exposes those provider contracts on v2.0; do not mechanically migrate these paths merely because the general API documentation has a v2.0 section

TikTok is **not production-active yet**. No real TikTok credential has been added to Hostinger and no TikTok Business Messaging webhook has been registered. Before activation:

1. create/use the real TikTok for Business developer app
2. obtain Business Messaging API access and complete TikTok's applicable data-security/privacy review
3. configure the TikTok OAuth application settings in the trusted production secret source: app ID, app secret, TikTok-generated authorization URL, exact HTTPS redirect URI, operational bearer token, and the dedicated OAuth encryption key
4. deploy the OAuth lifecycle code while leaving `TIKTOK_BUSINESS_ID` unset so TikTok messaging remains inactive
5. call the protected `POST /ops/tiktok/oauth/start`, complete Business Account authorization in TikTok, and verify `GET /ops/tiktok/oauth/status` reports the authorized `open_id`, scopes, and refresh availability without exposing tokens
6. set `TIKTOK_BUSINESS_ID` to that verified `open_id`, restart/redeploy, and verify the TikTok webhook/sender/media boundaries become active for only that account
7. verify the Business Account's messaging capability/limits through TikTok's supported API
8. register the Business Messaging webhook to `https://apps.ishinaillab.com/ishikeit/webhooks/tiktok`
9. verify signed webhook delivery and durable-before-ACK persistence
10. run one controlled human-originated direct-message canary through webhook -> PostgreSQL -> AI bridge -> `action.dispatch` -> TikTok reply
11. audit token refresh behavior, provider resource identity, attempts, pending queue, dead letters, and runtime warnings/errors before calling TikTok production-active

Do not claim TikTok production activation until those provider-backed checks have succeeded.

## 2026-10-02 canonical website/domain migration checkpoint

The production WordPress site has been migrated from `povnailstudio.com` to the canonical website:

```text
https://www.ishinaillab.com
```

This was a runtime/hosting migration outside the Ishikeit application repository, so this section is the durable handoff for future sessions.

### WordPress canonical state

Verified after cutover:

- WordPress `home` = `https://www.ishinaillab.com`
- WordPress `siteurl` = `https://www.ishinaillab.com`
- no `WP_HOME` or `WP_SITEURL` constants override the database values
- the new apex `https://ishinaillab.com` performs one 301 to `https://www.ishinaillab.com` while preserving path and query
- `www.ishinaillab.com` is the only canonical website hostname and does not redirect away
- homepage returns HTTP 200 with canonical `https://www.ishinaillab.com/`
- `/nail-appointment-reservation/` returns HTTP 200
- `/my-dashboard/` returns HTTP 200
- `/shop/` returns HTTP 200
- `/my-account/` redirects to the login flow on the new canonical hostname
- `/studio-policies/`, `/privacy-policy/`, and `/meta-data-deletion/` return HTTP 200
- `/wp-json/` returns HTTP 200
- `/appointment/` is not the real booking-page slug; its earlier 404 was not a migration failure

The one-shot serialization-safe migration helper:

- dry-run before cutover: 213 distinct stored values would change, 0 errors
- execute: 402 database rows updated, 0 errors
- post-migration dry-run: 0 URL-shaped `povnailstudio.com` values remaining, 0 errors
- intentionally did **not** rewrite WordPress GUIDs
- intentionally preserved old-domain email/login/history identities and physical filesystem paths
- flushed rewrite rules, WordPress object cache, Elementor file cache, and LiteSpeed purge hooks after execution
- was deactivated and removed after the cutover

Rollback:

- 19 database rollback tables with prefix `zdm1002_` remain temporarily in the production database
- exact row-count parity was verified for the URL-bearing source/backup tables before cutover
- do not drop those rollback tables until the new domain has remained stable through the next operational window

### Hostinger/origin state

The shared CloudLinux WordPress document root is still physically under the historical Hostinger website path:

```text
/home/u328762438/domains/povnailstudio.com/public_html
```

Current hosting facts:

- `ishinaillab.com` is attached to that existing WordPress vhost as a parked hostname
- Hostinger ZeroSSL is active and valid for both `ishinaillab.com` and `www.ishinaillab.com`
- the certificate chain and SANs were independently validated against the Hostinger origin
- `apps.ishinaillab.com` remains the separate Ishikeit Node.js application and was not moved
- the shared-hosting MCP surface does not expose the Hostinger primary-domain change operation; Hostinger exposes the equivalent API only for Agency Plan websites
- the Hostinger internal primary website label/path therefore still references `povnailstudio.com`
- do **not** claim that the old domain is fully detached from the Hostinger vhost yet

A manual Hostinger **Change domain** operation was deliberately deferred because Hostinger documents that changing a shared-hosting domain can remove Hostinger-managed email data and website backups, and the available MCP surface does not provide a file-level shared-hosting backup/archive operation. Public detachment was completed at DNS instead. Before changing the internal Hostinger primary-domain label later, create/verify a full file-level rollback and re-check the current Hostinger behavior.

### Cloudflare and old-domain detachment

For `ishinaillab.com`:

- apex and `www` are proxied through Cloudflare after origin SSL was issued
- the apex redirect is a single 301 to `https://www.ishinaillab.com`
- path and query are preserved
- no redirect rule is applied to `www.ishinaillab.com`

For `povnailstudio.com`:

- public web A/AAAA/CNAME records for the apex were removed
- public web A/AAAA/CNAME records for `www` were removed
- the old Cloudflare redirect rule was disabled/removed
- 1.1.1.1 and 8.8.8.8 both returned no old-domain web A/AAAA/CNAME records after the change
- Zoho MX records were preserved
- SPF, Zoho verification, and Facebook domain-verification TXT records were preserved
- local resolver/browser caches may temporarily retain a historical old-domain response until TTL/cache expiry; do not treat that as authoritative if public resolvers are clean

The intended state is: the old domain no longer routes public web traffic to WordPress and does not intentionally redirect users to the new site, while unrelated mail and verification records remain intact.

### Ishikeit / WordPress bridge continuity

The WordPress AI bridge canonical base is now:

```text
https://www.ishinaillab.com/wp-json/ishi-ai/v1
```

Repository examples and the local recovery `.env` must use that canonical hostname.

Verified during the migration:

- production `WORDPRESS_AI_BRIDGE_URL` was later found to be stale at the retired `povnailstudio.com` bridge hostname during the 2026-10-02 incident diagnosis and was corrected to `https://www.ishinaillab.com/wp-json/ishi-ai/v1` while preserving the complete Hostinger environment key set
- the local recovery `C:\\Users\\MBDS\\Downloads\\.env` was also corrected to the same canonical `www` bridge hostname
- the legacy/direct `AI_Engine` connector in this ChatGPT session became unavailable after the site-domain migration
- the separate Easy MCP WordPress connector remained available enough to verify installed plugins after migration
- if a future session needs the direct `AI_Engine` connector, refresh/reconnect its endpoint against the new canonical WordPress URL rather than reverting WordPress

Do not infer an Ishikeit production outage from the ChatGPT connector failure: the live Ishikeit environment itself did not contain the old domain when audited.

### Meta verification/app-review consequence

The earlier Meta business verification for **ISHI NAIL SERVICES** was rejected because the submitted website `https://ishinaillab.com/` redirected to a different website/domain.

That condition has been removed. For the next Meta verification attempt, submit the direct canonical URL:

```text
https://www.ishinaillab.com/
```

It serves the site directly with HTTP 200 and avoids Meta's rejection reason for a submitted URL that redirects to another website.

This domain fix is separate from the existing Meta App Review work for Instagram permissions. Continue to reconcile the fresh Business Verification discrepancy before the Instagram permission submission and do not fabricate reviewer evidence.

### TikTok onboarding state

TikTok code/runtime status remains as documented above:

- base Business Messaging adapter is implemented and deployed
- durable encrypted OAuth/token-refresh lifecycle is implemented and deployed
- `ishikeit-db` OAuth migration is applied in production and synchronized with the Supabase migration ledger
- Business Messaging and TikTok account OAuth remain on provider API `v1.3`; the live `v2.0` paths were previously verified unusable for these endpoints
- TikTok is still **not production-active**

Provider-side progress as of this checkpoint:

- the TikTok developer application is currently under review for the separate Marketing **Ad account management** scope; this does not grant Business Messaging API access
- wait for that approval before supplying real TikTok credentials to Ishikeit
- a secured local handoff file `C:\\Users\\MBDS\\Downloads\\ishikeit-tiktok-app.env` exists; it contains the generated OAuth encryption key and placeholders for the TikTok app values
- do not paste the TikTok app secret into chat

Registered/intended redirect URLs:

```text
TikTok account holder:
https://apps.ishinaillab.com/ishikeit/oauth/tiktok/callback/

Advertiser:
https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/
```

Important: the account-holder OAuth callback is implemented. The advertiser callback was supplied for the TikTok application form but the corresponding advertiser/Marketing-API OAuth route must be implemented and verified **before** performing any advertiser authorization.

After TikTok account-scope approval:

1. fill the secured local handoff file with the approved app ID, app secret, and TikTok-generated account-holder authorization URL
2. validate those values locally without printing them
3. add the complete OAuth app settings to the trusted Hostinger environment while leaving `TIKTOK_BUSINESS_ID` unset
4. complete Business Account authorization and verify the returned `open_id`, scopes, token expiry, and refresh availability
5. set `TIKTOK_BUSINESS_ID` only after the verified `open_id` is known
6. register/verify the Business Messaging webhook and run a real human-originated end-to-end canary before declaring TikTok production-active

### Canonical repository checkpoint before this continuity update

- `ishinaillab/ishikeit` main: `28ab3323c259c3154988315aaf32e174441952b9`
- `ishinaillab/ishikeit-db` main: `952cd7894230f9ed69397922a7c3da2fa47f1777`
- Telegram remains production-active and was not changed by the website-domain migration
- Meta/Telegram/TikTok provider architecture remains provider-neutral; do not redesign the core because of the website hostname change

### Continuity checkpoint persistence/deployment verification

The migration/context checkpoint above was persisted by GitHub PR #32 and then verified in the deployed environment:

- PR #32, **Record canonical website migration checkpoint**, squash-merged as `3c1abb4820fb8870fac026ad022983f8ff67b933`
- merged-main CI run `36960211692` passed `node`, `php-lint`, and `context-continuity`
- Hostinger automatic build `01a0faa6-abfe-734f-ae0a-761a99904322` completed for `3c1abb4820fb8870fac026ad022983f8ff67b933`
- `https://apps.ishinaillab.com/health/ready` returned `{"status":"ready"}`
- public `https://ishinaillab.com/` returned one Cloudflare HTTP 301 to `https://www.ishinaillab.com/`
- public `https://www.ishinaillab.com/` returned HTTP 200
- public `https://www.ishinaillab.com/nail-appointment-reservation/` returned HTTP 200
- public `https://www.ishinaillab.com/wp-json/` returned HTTP 200

These are post-merge/post-deploy checks. The remaining unresolved items are operational/provider-side, not a pending website cutover.

## Context engineering and durable continuity

Durable project context is change-coupled rather than primarily timer-coupled.

Primary rule:

- every pull request that changes a context-sensitive execution boundary must update `docs/CONTINUATION.md` in the same pull request
- context-sensitive boundaries currently include application source, migrations, WordPress bridge code, environment-contract examples, package manifests/lockfile, TypeScript/ESLint configuration, and GitHub workflows
- CI checks this rule through the `context-continuity` job on pull requests and on every push to `main`
- pull requests may use a deliberate `context-not-required` label only when a maintainer has determined that the change has no durable project-context impact
- a direct push to `main` has no label bypass: if it changes a context-sensitive boundary without updating `docs/CONTINUATION.md`, the event-driven main-branch CI run fails and the missing context must be corrected immediately
- secrets, raw customer payloads, access tokens, database URLs, and other sensitive values must never be copied into the continuation document

This makes repository changes themselves the primary context-capture event. Runtime/configuration work performed outside Git still needs an immediate continuation update in the same operational task whenever it materially changes the verified project state.

The repository's `main` branch is currently not protected, so the CI check is not yet a hard pre-merge policy gate. Normal pull-request work receives the check before merge; direct pushes are detected immediately after the push. Repository administration should eventually require the relevant CI checks through branch protection or a ruleset when an administrative write surface is available.

A daily Ishikeit context integrity sweep exists only as a safety net for missed or externally applied changes. It is not the source of truth and should not be used as a substitute for change-coupled documentation. If a native agent event-trigger surface becomes available for GitHub/configuration changes, prefer it over increasing polling frequency.

## Security posture

Current important controls:

- TLS/HTTPS
- exact raw-body Meta HMAC validation
- timing-safe signature comparison
- dedicated high-entropy webhook verify token
- dedicated private WordPress bridge credential
- server-side provider credentials only
- no provider tokens in Git
- logger secret redaction
- private/no-store bridge endpoints
- SSRF-hardened media resolution
- bounded media sizes/timeouts
- durable idempotency at ingress, AI turn, file upload, and action enqueue
- explicit rollout cutover
- provider-neutral canary partition guard
- processor and dispatcher independently disableable

Do not add provider access tokens, bridge tokens, app secrets, DB URLs, or raw customer message bodies to committed documentation.

## Current operational rollback controls

Stop new AI processing while continuing durable webhook ingestion:

```text
PROCESSOR_ENABLED=false
```

Stop provider-side actions:

```text
ACTION_DISPATCH_ENABLED=false
```

If only dispatch is disabled, generated actions remain durable. Inspect pending actions before re-enabling if a rollback lasted long enough that replies may have become stale.

Do not move the full-rollout cutover forward during an ordinary outage unless intentionally discarding the backlog.

## Real media validation

Controlled provider-backed media validation completed on 2026-09-30.

The original resolver-only validation used temporary WhatsApp Cloud API media objects and the production Ishikeit media resolver without sending customer-facing messages. Those resolver-probe objects were deleted after verification.

Verified byte-for-byte resolver paths:

- image: PNG
- document: plain text
- audio: MP3
- video: MP4

The resolver suite verifies Meta-host allowlisting, redirect revalidation, declared and actual byte ceilings, WhatsApp metadata lookup, authenticated download, safe filename derivation, and retry classification.

A later end-to-end production matrix validated the durable processor and dispatcher on deployed revision `b8562e557ba81739c5d51e7caaacff4e5b070c83`:

- image: valid PNG was resolved, uploaded to AI Engine, processed on attempt 1, and generated a published Meta reply
- document: plain-text document was resolved, uploaded to AI Engine, and processed on attempt 1
- audio: speech-bearing MP3 was resolved, sent to the authenticated `/transcribe` bridge route, transcribed by AI Engine, processed on attempt 1, and generated a published Meta reply with a provider resource ID
- video: MP4 was received as canonical portable media and processed on attempt 1, but is intentionally not sent into the current chatbot file-input path; the AI turn receives an explicit `unprocessedMediaKinds=[video]` safeguard so it must not claim to have inspected the video

A provider-neutral video interpretation capability is now implemented and deployed in revision `fd3e4c048275922c3ebe7f89380caa856b52f933`. The first concrete interpreter is an opt-in Gemini adapter using the Gemini Files API plus the stable Interactions v1 API with `store=false`, static video processing, bounded timeouts, supported-MIME validation, resumable upload URL validation, and best-effort temporary-file deletion.

Production intentionally remains at `VIDEO_INTERPRETER_PROVIDER=none` because no verified paid Gemini credential is configured. Therefore the live behavior is still the safe no-inspection path: video transport/receipt and outbound video messaging work, but the chatbot must not claim to have inspected inbound video until the interpreter is explicitly enabled and validated.

Activation requirements:

- use a paid Gemini API Cloud project/key so customer prompts/files are not used to improve Google's products under the current service terms
- set `VIDEO_INTERPRETER_PROVIDER=gemini` and `GEMINI_API_KEY` in server-side secret storage
- keep the key out of Git and documentation
- run a real provider-backed video smoke test before declaring inbound video understanding live
- verify `/health/capabilities` reports `videoInterpreterProvider=gemini` only after successful activation

The end-to-end matrix's temporary provider media cleanup was not independently verified after the execution safety layer blocked a new cleanup helper. Do not state that those later matrix objects were deleted.

Post-matrix operational metrics at `2026-09-30T14:32:15.641Z` showed:

- inbound received: 38
- inbound processed: 38
- current inbound failures: 0
- pending `action.dispatch`: 0
- pending `inbound.event.accepted`: 0
- pending legacy `meta.message.send`: 0
- published attempts in the 60-minute window: 49
- retries: 0
- dead letters: 0

Latest full repository validation:

- lint: passed
- typecheck: passed
- test files: 23 passed
- tests: 120 passed
- build: passed
- `git diff --check`: passed

GitHub PR #21 CI passed before squash merge. Hostinger then built `14e1bd30bbe699992bf2c8479f3cf6e6571ceaa5` successfully. Post-deploy `/health/live`, `/health/ready`, and `/health/capabilities` all returned HTTP 200. Routing probes confirmed handover and standby events are stored durably and ignored by the AI handler.

## Resolved messaging incident and Meta recheck - 2026-10-02

A production messaging incident occurred after the WordPress domain migration. Diagnosis established two migration-sensitive dependencies:

- Ishikeit's production `WORDPRESS_AI_BRIDGE_URL` was found pointing at the retired `povnailstudio.com` WordPress hostname and was corrected to the canonical bridge base `https://www.ishinaillab.com/wp-json/ishi-ai/v1` while preserving the complete Hostinger environment key set.
- After the bridge hostname was corrected, Ishikeit reached WordPress but affected turns returned HTTP 502. The confirmed root cause was the token used by the AI Engine <-> LatePoint connection: it had originally been issued for `povnailstudio.com` and no longer matched the migrated site. The token/domain binding was corrected outside Ishikeit, and the messaging problem is now resolved.

Do not attribute this incident to a defect in Ishikeit's provider-neutral ingress, processor, or dispatcher. The durable queues remained bounded; affected historical customer turns that exhausted retries remain audit history and must not be blindly replayed after a long delay because that could send stale replies.

Post-incident PostgreSQL audit found no currently pending outbox records. Historical incident dead letters were retained for audit, and the temporary Hostinger diagnostic cron jobs used during investigation were removed.

The direct ChatGPT `AI_Engine` connector is a separate convenience integration and may still need to be refreshed against the new canonical site if it is used in a future session. Do not use its connection state as proof of Ishikeit production health.

A fresh authenticated Meta app-state read on 2026-10-02 for app `1042452472116584` now reports:

- App Review submission status: `NO_SUBMISSION`
- `can_submit=true`
- privacy-policy requirement: passes
- Business Verification: **passes**
- Advanced Access privileges: none granted
- compliance: `compliant`
- required compliance actions: none
- open violations: none

This supersedes the 2026-10-01 transient App Review requirement snapshot that reported `business_verification_passes=false`. Business Verification is no longer the active Meta blocker. The remaining Meta work is to prepare and submit the real Instagram Login App Review package for `instagram_business_basic` and `instagram_business_manage_messages` with authentic reviewer evidence.

## Instagram Login OAuth lifecycle - implementation milestone 2026-10-02

A fresh authenticated Meta recheck reports Business Verification passing, App Review status `NO_SUBMISSION`, `can_submit=true`, no Advanced Access grants, and clean compliance. Current Meta documentation confirms the observed production boundary: Standard Access delivers Instagram messaging webhooks only for people with an app role; Advanced Access is required for ordinary customers.

To make the real App Review flow externally testable, Ishikeit now implements Instagram API with Instagram Login OAuth on the existing durable OAuth subsystem:

- public review/login entry point: `GET /ishikeit/oauth/instagram/login/`
- exact callback route: `GET /ishikeit/oauth/instagram/callback/`
- protected operational start/status endpoints
- 32-byte random OAuth state with only its SHA-256 hash persisted
- atomic one-time state consumption before code exchange
- server-side authorization-code exchange at `api.instagram.com/oauth/access_token`
- server-side exchange to a 60-day long-lived token at `graph.instagram.com/access_token`
- long-lived token refresh through `graph.instagram.com/refresh_access_token`
- encrypted durable storage in the already-deployed `oauth_credentials` tables
- account-scoped token selection for outbound Instagram sends
- long-lived-token refresh under process-local deduplication plus PostgreSQL advisory locking
- current static `META_INSTAGRAM_ACCESS_TOKEN` remains the production-account fallback until Ishi's own account is deliberately migrated
- product-specific Instagram App Secret is added to logger redaction
- current review scopes are fixed to `instagram_business_basic` and `instagram_business_manage_messages`

Configuration contract:

```text
META_INSTAGRAM_OAUTH_APP_ID=<Instagram product App ID>
META_INSTAGRAM_OAUTH_APP_SECRET=<Instagram product App Secret>
META_INSTAGRAM_OAUTH_REDIRECT_URI=https://apps.ishinaillab.com/ishikeit/oauth/instagram/callback/
META_INSTAGRAM_OAUTH_STATE_TTL_SECONDS=600
META_INSTAGRAM_TOKEN_REFRESH_SKEW_SECONDS=604800
META_INSTAGRAM_OAUTH_REQUEST_TIMEOUT_MS=10000
OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64=<existing 32-byte base64 OAuth encryption key>
```

The Instagram product App ID/App Secret are the values under Meta App Dashboard -> Instagram -> API setup with Instagram login -> Set up Instagram business login. They are not the general Meta App ID/App Secret. Do not paste the product secret into chat or commit it. A secured local handoff file `C:\\Users\\MBDS\\Downloads\\ishikeit-instagram-app.env` now exists outside the repository. It reuses the already-validated 32-byte OAuth encryption key from the TikTok handoff and contains placeholders only for the Instagram product App ID and App Secret.

The OAuth code is deployed but the feature is intentionally **not production-active yet**. The product-specific Instagram credentials and redirect registration have not been supplied to the Hostinger environment in this checkpoint, and no public website login button has been published yet. Before App Review submission:

1. securely configure the product-specific Instagram App ID/secret and the exact redirect URI
2. deploy this OAuth lifecycle while preserving the current static production Instagram token
3. verify the public login route redirects only to Instagram and the callback completes with one-time state
4. authorize a controlled Instagram professional account and verify protected OAuth status returns only account/scope/expiry metadata
5. run a controlled message through webhook -> durable event -> AI -> `action.dispatch` -> Instagram reply using that account's OAuth credential
6. add a visible website/reviewer login link to the public login route
7. record the real Meta screencast showing authorization, messaging, handling, API send, and receipt; do not fabricate evidence
8. submit App Review for `instagram_business_basic` and `instagram_business_manage_messages`
9. after approval, repeat the ordinary non-role customer DM test before declaring public Instagram messaging complete

Existing production evidence already includes successful Instagram `message.send` actions with provider message IDs, including a published send on 2026-10-01. Use that as supporting API-call evidence, but the App Review screencast must still show the actual current authorization and messaging flow.

Focused local validation for this implementation passed 42/42 tests across OAuth exchange/state, token refresh, Meta sender credential selection, HTTP review routes, and environment validation, followed by a clean TypeScript typecheck. The full repository gate then passed lint, typecheck, all 150 tests, and the production TypeScript build.

## Instagram Login OAuth merge/deployment verification - 2026-10-02

The Instagram Login OAuth lifecycle described above was squash-merged through GitHub PR #35 into `main` as:

```text
1520df5c91485383228ba246b8e76db31d35eb7c
```

Validation and deployment evidence:

- all PR checks passed: `context-continuity`, `php-lint`, and `node`
- local full gate passed lint, typecheck, 28 test files / 150 tests, and production build
- Hostinger Node.js build `01a0fb2f-7c98-7378-bae7-70b72a18f6dd` completed from exact merge SHA `1520df5c91485383228ba246b8e76db31d35eb7c`
- post-deploy `/health/ready` returned HTTP 200 with `{"status":"ready"}`
- `/health/capabilities` still reported the production processor and action dispatcher enabled, zero processor canary partitions, and video interpretation disabled
- fresh runtime audit after deploy reported 7 log entries and 0 WARN/ERROR
- `/ishikeit/oauth/instagram/login/` returned HTTP 404 as expected because the product-specific Instagram OAuth environment is intentionally not configured yet
- the live Hostinger environment key set remained unchanged from the trusted recovery set except that the intentionally empty `PROCESSOR_CANARY_PARTITION_KEYS` key is omitted server-side; no Instagram OAuth product keys were added
- post-deploy PostgreSQL audit found no pending outbox items, no dead letters in the preceding 30 minutes, and no failed inbound events in the preceding 30 minutes

Therefore the OAuth **code is deployed**, but the Instagram OAuth **feature remains intentionally inactive/configuration-gated**. Current production Instagram messaging continues to use the established static Ishi token path. Do not mark the OAuth feature active until the secured product-specific Instagram App ID/App Secret are supplied, the redirect URI is registered, and a real authorization/canary succeeds.

## Instagram review activation checkpoint - 2026-10-02

The secured Instagram handoff now contains non-placeholder product credentials. The values themselves must remain outside Git/chat.

The local promotion helper `C:\\Users\\MBDS\\Downloads\\hostinger-mcp-client\\activate_instagram_oauth_env.mjs` validated and promoted the Instagram OAuth configuration to Hostinger while preserving the existing production environment. The live environment now includes the seven configuration keys required by the deployed Instagram OAuth lifecycle.

Post-activation verification:

- `GET /health/ready` returned HTTP 200 with `{"status":"ready"}`
- `GET /ishikeit/oauth/instagram/login/` returned HTTP 302
- redirect host is `www.instagram.com`
- redirect path is `/oauth/authorize`
- redirect `client_id` matches the product Instagram App ID in the secured handoff
- redirect URI is exactly `https://apps.ishinaillab.com/ishikeit/oauth/instagram/callback/`
- response type is `code`
- requested scope is exactly `instagram_business_basic,instagram_business_manage_messages`
- cryptographically random OAuth state is present
- protected `GET /ops/instagram/oauth/status` returned HTTP 200 with `{"authorized":false}`

The feature is therefore **configured and externally launchable, but no Instagram Professional account has completed authorization yet**. Do not mark the Instagram OAuth rollout complete until a real controlled account finishes consent, the durable OAuth status shows that account authorized with the intended granted scopes, and a controlled customer-DM canary succeeds.

A submission-ready review package now lives at `docs/meta-instagram-app-review.md`. It reconciles Meta's access-level guidance: Standard Access can serve an owned/managed professional account, but customer messaging webhooks include data from ordinary people without app roles; Meta's current webhook guidance requires App Review / Advanced Access for those notifications.

## Instagram OAuth callback and data-lifecycle hardening - 2026-10-02

The first interactive Instagram authorization reached Ishikeit's callback with both `state` and `code`, but the durable authorization-state row remained unconsumed. After the initial hardening deployment, later controlled attempts did consume the matching one-time state but still stored no Instagram OAuth credential. The active failure is therefore post-state-validation: short-token exchange, long-token exchange, or credential persistence. The OAuth implementation was reconciled against current Meta Business Login documentation before retrying authorization.

Current implementation changes:

- Business Login starts at `https://www.instagram.com/oauth/authorize`, which is the endpoint specified by Meta’s current Business Login for Instagram guide. The token exchange remains `https://api.instagram.com/oauth/access_token`.
- Authorization requests include `force_reauth=true`, preserve exact redirect URI matching, and retain cryptographically random one-time CSRF state.
- Callback failures log only a short SHA-256 state fingerprint plus state/code lengths; raw state, authorization code, and tokens remain secret.
- stage-aware diagnostics classify failures as `short_token_exchange`, `long_token_exchange`, or `credential_persistence`; provider failures expose only safe HTTP/provider codes and a normalized reason such as `redirect_uri_mismatch` or `client_secret_invalid`, never raw credentials or authorization codes.
- a post-deploy controlled authorization produced `stage=short_token_exchange class=InstagramOAuthRequestError retryable=false` with no HTTP/provider error fields. Because request transport failures are retryable and provider rejections include an HTTP status/reason, this isolates the failure to validation of a nominally successful short-token payload.
- the short-token JSON parser now preserves a bare numeric `user_id` as its exact decimal string before normal JSON parsing. This prevents precision loss for Instagram IDs beyond JavaScript's safe integer range while remaining compatible with Meta's documented quoted numeric-string response. Missing token/user-id fields now emit separate safe diagnostic reasons.
- dedicated Meta signed-request verification uses HMAC-SHA256 plus timing-safe comparison.
- deauthorization callback: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/deauthorize/`
- data-deletion callback: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/data-deletion/`
- human-readable deletion status route: `/ishikeit/privacy/data-deletion/status/:confirmationCode`
- deauthorization creates a durable revocation tombstone and deletes the encrypted Instagram OAuth credential.
- successful reauthorization atomically clears the revocation tombstone.
- a revoked/deleted account cannot silently fall back to the legacy static Instagram token; static fallback remains available only for accounts that have never entered the durable OAuth lifecycle.
- a verified data-deletion request durably records status, revokes the OAuth credential, and removes matching Instagram inbound events, outbound actions, and related delivery-attempt rows before returning Meta's required status URL and confirmation code.

Database migration:

`supabase/migrations/20261002090000_instagram_data_lifecycle.sql`

It adds RLS-protected `oauth_revocations` and `oauth_data_deletion_requests` tables and revokes access from `anon` and `authenticated`. Database PR #6 was squash-merged as `506f17228cc58d50bc26d066ca4dc4924adfd231`; the exact migration was then applied to the linked production Supabase project. `supabase migration list` now shows `20261002090000` synchronized locally and remotely, and linked schema lint reports no errors.

Application validation after the hardening change:

- lint: passed
- typecheck: passed
- test files: 29 passed
- tests: 156 passed
- production build: passed
- `git diff --check`: passed

After the stage-diagnostic revision is merged and deployed, run one fresh controlled Instagram authorization from the production login route. Immediately inspect the callback log for its safe stage/reason classification and the database for state consumption plus OAuth credential persistence before attempting the customer-DM canary.

## Instagram OAuth activation and routing-identity reconciliation - 2026-10-03

A controlled Instagram Professional account authorization now completes successfully. The durable credential is AES-256-GCM encrypted at rest, includes `instagram_business_basic` and `instagram_business_manage_messages`, has the expected approximately 60-day expiry, and has no revocation tombstone. The successful callback produced no warning/error logs. Meta's app-level Instagram webhook subscription is enabled for `messages`, `standby`, and `messaging_handover`; Meta's current Instagram Login webhook flow additionally requires each authorized Professional account to enable those fields through `POST /me/subscribed_apps`, which is now part of OAuth onboarding and startup reconciliation.

The successful flow exposed an important identity distinction that must be preserved:

- Business Login's token exchange returns an app-scoped OAuth subject ID.
- Instagram messaging webhooks and the `/<IG_ID>/messages` endpoint route by the Instagram Professional account ID.
- These IDs are not interchangeable and must not be used as a single credential key.

The application now keeps the encrypted credential under its OAuth subject ID and resolves provider-routing IDs through a durable alias. The token manager is alias-aware, refresh locks remain keyed to the credential identity, revocation through either identity resolves to the same credential, and data deletion removes retained Instagram rows for both the OAuth subject and all known routing aliases. Startup reconciliation calls Instagram `/me?fields=user_id` for already-authorized credentials so the successful production authorization does not need to be repeated.

Canary findings:

- the alias-aware OAuth send path reached Meta successfully; a send to the known first-party `@ishinaillab` conversation was rejected only by the 24-hour messaging-window rule (`HTTP 403`, Graph subcode `2534022`), proving the OAuth token and Professional-account routing identity were accepted.
- the retired static `META_INSTAGRAM_ACCESS_TOKEN` path is no longer usable. Both direct probes and a real production outbox action returned Graph code `100` (`Unsupported request - method type: post`). Do not use that static credential as evidence for current Instagram functionality.
- when an Instagram OAuth token provider is configured, `MetaSender` now uses it exclusively. An unmapped account fails locally instead of falling back to the retired static token; the static token remains available only for deployments where OAuth routing is not configured at all.
- PR #44 merged as `8274c59839ce60e871bea977d8ecb73707aaca89` and Hostinger deployed that exact SHA successfully. `/health/ready` returned 200 and startup again logged successful Instagram OAuth routing/webhook reconciliation.
- a post-deploy send to the known first-party `@ishinaillab` conversation reached Meta through the mapped OAuth credential and returned only the expected expired-window rejection: HTTP 403, Graph `10:2534022`, `This message is sent outside of allowed window.` This is positive evidence that the OAuth token and Professional-account routing ID are accepted.
- a post-deploy unmapped-account outbox canary (`4d8c7862-15a2-8ccc-af0f-f7f6af7f14a0`) dead-lettered locally with `No Meta access token is configured for instagram`, with no HTTP status and no provider code. This proves the retired static token was not used and no Meta request was made for the unmapped account.
- the only post-deploy ERROR log during this verification window is the intentionally generated unmapped-account dead-letter above; no unexpected runtime warnings/errors were observed.
- Meta's dashboard webhook-test control only validates app-level delivery setup; it does not replace the required account-level `subscribed_apps` enablement for a newly OAuth-authorized Instagram Professional account.
- OAuth completion now enables exactly the active app-level Instagram fields: `messages`, `standby`, and `messaging_handover`. Startup reconciliation repeats the call idempotently with a current/refreshed OAuth token, so already-authorized accounts are repaired automatically.
- the exact account-level subscription call was exercised against the already-authorized production credential before merge and Meta returned success for all three fields; no token value was logged or exposed.

Database migration:

`supabase/migrations/20261003020000_oauth_account_aliases.sql`

It adds the RLS-protected `oauth_account_aliases` table without coupling alias lifetime to credential lifetime, so a revocation can continue blocking legacy static-token fallback. Database commit `94babed` is on `ishikeit-db/main`, and the linked Supabase CLI applied the migration after a dry run confirmed it was the only pending migration.

Application validation for the alias change:

- lint: passed
- typecheck: passed
- test files: 29 passed
- tests: 158 passed
- production build: passed
- `git diff --check`: passed

Current account-level webhook-subscription validation:

- lint: passed
- typecheck: passed
- test files: 29 passed
- tests: 159 passed
- production build: passed
- focused live Meta subscription call: passed for `messages`, `standby`, and `messaging_handover`

Instagram OAuth routing, account-level webhook subscription, OAuth-only token selection, and production verification are complete. The public reviewer page is published at `https://www.ishinaillab.com/instagram-connect-review/` and names the live authorized account `@povnailstudio.ph`. Meta currently reports `can_submit=true`, `NO_SUBMISSION`, Business Verification passing, and no Advanced Access grants. The remaining App Review artifact is the real end-to-end screencast required by Meta; do not fabricate it or reauthorize merely to recreate aliases/subscriptions.

## Current next work

The durable messaging processor is now a production system, not a scaffold. Operational metrics, audio transcription adaptation, durable handoff/outcome observability, Telegram, the TikTok adapter, and the TikTok OAuth lifecycle are already implemented; do not redo those phases.

Immediate continuity tasks after the website-domain migration:

1. if direct `AI_Engine` connector tools are needed, refresh/reconnect that ChatGPT connector against `https://www.ishinaillab.com`; do not revert WordPress to the old domain to restore a stale connector
2. Instagram OAuth is configured, authorized, encrypted, alias-aware, OAuth-only for configured accounts, and deployed. The reviewer page is public and the submission package is current. Record the required real screencast, upload it with the reviewer instructions, then submit `instagram_business_basic` and `instagram_business_manage_messages` for Advanced Access
3. keep the current Marketing **Ad account management** app review separate from the Business Messaging access/security/privacy review; Business Messaging account-holder OAuth activation starts only after TikTok grants the required messaging access
4. keep the `zdm1002_*` WordPress rollback tables until the new canonical site has remained stable through the next operational window
5. do not change Hostinger's internal shared-hosting primary-domain label from `povnailstudio.com` until a complete file-level rollback/archive has been created and the current Hostinger change-domain side effects have been re-verified; public old-domain web DNS is already detached

Continue building on the adapter/registry boundaries rather than redesigning the core. Recommended product sequence after those operational tasks:

6. complete TikTok for Business provider-backed activation: authorize the target Business Account, prove token refresh, configure the webhook, verify account capability/limits, and run a controlled human-originated end-to-end canary before declaring TikTok production-active
7. complete Meta App Review by recording the required real screencast, adding the submission-ready permission descriptions and reviewer instructions from `docs/meta-instagram-app-review.md`, then submit `instagram_business_basic` and `instagram_business_manage_messages`
8. the screencast must show the public Connect Instagram page, real authorization, a customer-initiated DM, Ishikeit processing/reply, and receipt in Instagram; do not fabricate review evidence
9. after approval, repeat the fresh ordinary non-role account DM test and verify normal `message.received` ingestion plus successful reply before declaring Instagram public-user messaging production-complete
10. do not add Conversation Routing write/control APIs to the current `graph.instagram.com` path until Meta's supported authorization model for this specific app setup is proven
11. activate and perform a real provider-backed video interpretation smoke test only after a paid Gemini API project/key is securely configured; until then retain the verified no-inspection safeguard
12. add Meta lead-management capability as a separate capability/operation family
13. add Meta Marketing API operations behind their own authorization/policy layer
14. implement and verify TikTok advertiser OAuth before performing any advertiser authorization, then add TikTok Marketing operations behind their own authorization/policy layer
15. add TikTok automatic messaging, image upload/send, Comment-to-Message, Organic, Leads, and other future operations only as separate typed capabilities after the base TikTok Business Messaging path is provider-verified
16. version and test each future provider adapter and media-capability contract independently

Marketing API, lead management, and future providers must not be routed through the conversational message handler merely because they originate from Meta or TikTok.


## Authoritative latest checkpoint — 2026-10-03 18:50 Asia/Manila

This section is the current continuation source of truth. If any earlier Instagram checkpoint conflicts with this section, use this section.

### Ishikeit repositories and production

- App repository: `ishinaillab/ishikeit`.
- Database repository: `ishinaillab/ishikeit-db`.
- Retired `/ishinaillab/ishi` must not be used unless the user explicitly reintroduces it.
- Last code-bearing application revision in current `main` ancestry: `02b451ceacea67ccaf7eca6f78bf2450c318c1df` from PR #46, **Finalize Instagram App Review package**. Later documentation-only checkpoint commits do not change application behavior.
- Hostinger build for `02b451c` completed successfully on 2026-10-03.
- Production app URL: `https://apps.ishinaillab.com/`.
- Production readiness endpoint: `GET /health/ready` returns 200.
- Current database `main`: `94babed`, including `oauth_account_aliases`.
- Supabase migration `20261003020000_oauth_account_aliases.sql` is applied.

### Instagram OAuth and routing — complete

- Instagram Business Login uses `https://www.instagram.com/oauth/authorize`.
- Short token exchange uses `https://api.instagram.com/oauth/access_token`.
- Long-lived/refresh flow uses `https://graph.instagram.com/access_token` and `/refresh_access_token`.
- OAuth callback state is one-time, durable, and SHA-256 stored.
- Large bare numeric `user_id` values are preserved losslessly.
- The controlled Professional account is authorized successfully.
- Authorized account handle: **@povnailstudio.ph**.
- Professional account ID: `17841437646366614`.
- OAuth subject/credential account ID is stored separately and linked by durable account alias; do not collapse these identities.
- OAuth token is encrypted at rest with AES-256-GCM and has the expected ~60-day lifetime.
- Required scopes are present: `instagram_business_basic`, `instagram_business_manage_messages`.
- Account-level webhook subscriptions are reconciled automatically for `messages`, `standby`, and `messaging_handover`.
- When the OAuth provider is configured, Instagram outbound sends are OAuth-only. The retired static Instagram token is not a fallback for unmapped accounts.
- Revocation/data-deletion lifecycle is durable and alias-aware.
- Deauthorize callback: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/deauthorize/`.
- Data deletion callback: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/data-deletion/`.

### Instagram App Review — final gate

- Meta app ID: `1042452472116584`.
- App name: **Ishikeit**.
- App mode: live.
- Business Verification: passes.
- Privacy Policy requirement: passes.
- Meta reports `can_submit=true`.
- Submission status: `NO_SUBMISSION`.
- Advanced Access grants: none yet.
- Public reviewer page is live: `https://www.ishinaillab.com/instagram-connect-review/`.
- WordPress page ID: `21471`, title **Connect Instagram**.
- The reviewer page contains the production Connect Instagram button, permission explanations, concrete reviewer test steps, the live account handle, messaging behavior, and Privacy Policy link.
- Submission-ready copy is maintained in `docs/meta-instagram-app-review.md`.
- Production database contains historical successful published Instagram `message.send` actions, including successful sends on 2026-10-01, satisfying the successful-API-call evidence requirement.
- Standard Access is insufficient for ordinary production customers because Meta documents that Standard Access testing is limited to people with app roles; Advanced Access is required for real non-role customers.
- Remaining mandatory review artifact: a **real, uninterrupted screencast** showing public reviewer page -> Connect Instagram -> real authorization -> successful callback -> customer-initiated DM -> Ishikeit processing -> API reply visible in the same Instagram conversation.
- Do not fabricate, synthesize, or mock the screencast.
- Meta currently shows the contact email `admin@ishinaillab.com` as present but not verified. This is not blocking `can_submit=true`, but verify it if Meta prompts during the final checklist.
- Final Meta Submit has not been performed. Do not claim the app is under review until the dashboard shows a real submission.

### Current validation state

- Local full release gate on current app code: lint passed.
- Typecheck passed.
- Test files: 29 passed.
- Tests: 159 passed.
- Production build passed.
- `git diff --check` passed.
- Public reviewer page: HTTP 200.
- `/health/ready`: HTTP 200.
- Production Instagram login route: HTTP 302 to Instagram with exact callback, fresh state, `force_reauth=true`, and scopes `instagram_business_basic,instagram_business_manage_messages`.

### Other project continuity

- TikTok adapter and OAuth lifecycle are implemented; Business Messaging production activation remains blocked on TikTok's dedicated Business Messaging access/security/privacy review plus real Business Account authorization.
- Secure TikTok handoff remains `C:\Users\MBDS\Downloads\ishikeit-tiktok-app.env`.
- Keep `zdm1002_*` WordPress rollback tables for now.
- Do not change Hostinger's internal shared-hosting primary-domain label from `povnailstudio.com` until rollback/archive implications are reverified.
- Public canonical website remains `https://www.ishinaillab.com/`.
- Direct ChatGPT Easy MCP may still have stale connector/session behavior after the domain migration; do not revert the site domain to fix that. WPVibe is the working WordPress connector.
- Keep building future Meta Leads, Meta Marketing API, TikTok Marketing, and other providers as separate capability/operation families on the existing adapter/registry architecture.


### Instagram managed-account token regression repair — 2026-10-03

Root cause confirmed from production data and Git history:

- Instagram inbound webhooks and AI processing continued to work.
- New replies for webhook Professional account `17841438662359631` were dead-lettered locally before any Meta API request because PR #44 removed the managed-account token fallback whenever an OAuth provider was configured.
- The only durable OAuth alias currently stored belongs to a different Professional account, so the sender had no credential for the webhook account.
- The previous managed token in `META_INSTAGRAM_ACCESS_TOKEN` had been the working send path in the earlier build, but the currently configured value is no longer valid at Meta and must not be treated as usable merely because it exists.

Repair in PR #49:

- Added `InstagramAccessTokenRouter`.
- Durable OAuth remains first priority.
- A configured App Dashboard / managed-account token is now eligible only after Meta `/me` resolves its Professional account ID and that ID exactly matches the outbound webhook account ID.
- A revoked durable OAuth credential still fails closed and does not fall through to the managed token.
- Startup reconciliation now iterates all stored Instagram OAuth credentials instead of only `latest("instagram")`, preserving multi-account behavior.
- OAuth credential storage, revocation, deletion, and refresh semantics are unchanged.

Validation:

- focused Instagram token-routing and Meta sender tests: 18/18 passed.
- full local gate: lint passed, typecheck passed, 29 test files / 162 tests passed, production build passed, `git diff --check` passed.
- Meta's current Instagram API guidance supports App Dashboard access tokens for owned/managed Professional accounts and requires the sending token to be requested by the Professional account that can send messages.
- Production still needs a fresh valid managed-account token for the actual business Professional account before the repaired fallback can send; the old configured managed token currently fails Meta `/me` validation with Graph code 100.


### Instagram managed-token startup validation — 2026-10-03 late evening

Additional production diagnosis after PR #49:

- PR #49 merged as `4c38e646a285d4def7b7225f7904286f326e5277`.
- Hostinger build `01a10240-8b96-7248-bf4d-370dcd00025c` completed for that exact merge SHA.
- Both configured Instagram tester identities are reaching Ishikeit as distinct `message.received` events.
- Both tester reply actions target the same business Professional account `17841438662359631` and both were dead-lettered locally before a Meta HTTP response under the pre-fix deployment. This proves the tester roles/inbound webhook path are not the shared failure.
- A current App Dashboard screenshot captured 2026-10-03 13:08:56Z shows **Instagram -> API setup with Instagram login -> 2. Generate access tokens** with only the **Add account** button and no Professional account assigned.
- The locally archived IG token from the original working build was tested without exposing it and is expired/invalid (Meta Graph code 190). It was not promoted to production, and the local env was restored from backup.
- The current production managed token also fails Meta identity validation, so no valid business-account managed token is presently available.
- Meta's current Send API documentation states that sending requires an access token requested by the Instagram Professional account that can send the message, and lists App Dashboard as a supported token source.

Hardening added after PR #49:

- `InstagramAccessTokenRouter.managedAccountId()` exposes safe cached identity validation for the configured managed token.
- HTTP startup now validates the managed token and reconciles `messages`, `standby`, and `messaging_handover` subscriptions immediately when the token is valid.
- Invalid/wrong-account managed tokens produce an explicit startup warning instead of being discovered only after a customer message.
- full local gate: lint passed, typecheck passed, 29 test files / 163 tests passed, build passed, `git diff --check` passed.

Remaining external step is account-owner consent in Meta's dashboard: assign the actual business Professional account `ishinaillab` under **2. Generate access tokens**, complete any Instagram account confirmation Meta requires, and generate its token. This action is not exposed by the connected Meta DevTools API and requires the Instagram account owner's interactive Meta/Instagram session. Once that token exists, Ishikeit can validate the account ID, install it in Hostinger, reconcile subscriptions, and replay/verify the tester reply path.


## Authoritative transfer checkpoint — 2026-10-03 23:58 Asia/Manila

This section supersedes earlier intermediate Instagram-debugging notes where they conflict. It is the continuation source of truth for the next chat.

### User-confirmed operational state

- The user explicitly confirms that all currently used messaging platforms are working.
- Instagram is confirmed recovered: both **povnailstudio.com.ph** and **povnailstudio.ph** receive replies from **ishinaillab**.
- Do not treat the earlier Instagram dead-letter state as current; those rows are historical regression evidence only.

### Independent live database verification at transfer

Recent durable production evidence confirms successful outbound publishing:

- Instagram:
  - multiple new `published` outbox attempts after the regression repair;
  - both tester recipient identities have successful published replies;
  - latest verified published Instagram reply at approximately `2026-10-03T15:50:37Z`;
  - earlier dead-letter rows before recovery remain in history and should not be interpreted as current failure.
- WhatsApp:
  - recent inbound traffic exists;
  - recent outbound actions are published successfully.
- Messenger:
  - recent inbound traffic exists;
  - recent outbound actions are published successfully.
- Telegram:
  - recent inbound traffic exists;
  - recent outbound action is published successfully.
- The live 24-hour query showed recent inbound activity for Meta WhatsApp, Meta Instagram, Meta Messenger, and Telegram.
- The live 24-hour query showed published outbound actions for WhatsApp, Instagram, Messenger, and Telegram/bot.

TikTok remains a separate provider-activation track unless a later checkpoint records completed TikTok scope approval and a live provider-backed canary. Do not infer TikTok production activation merely from the user statement that the active messaging stack is working.

### Instagram regression — root cause and final repair

The regression was factual and code-induced:

- inbound Instagram webhooks continued to arrive;
- AI processing continued to produce replies;
- outbound reply actions were dead-lettered locally before any Meta HTTP request;
- both configured testers were reaching the same business Professional account;
- tester roles were therefore not the shared failure;
- PR #44 had made Instagram outbound OAuth-only whenever an OAuth provider existed, which removed the original managed-account/App-Dashboard token path for the actual business account.

The repaired design is intentionally not a blind fallback:

- PR #49, **Fix Instagram managed-account token regression**, merged as:
  - `4c38e646a285d4def7b7225f7904286f326e5277`
- It added `InstagramAccessTokenRouter`.
- Durable OAuth credentials remain first priority.
- A configured App Dashboard / managed token may be used only after Meta `/me` resolves the Professional account ID and that ID exactly matches the outbound/webhook account ID.
- Revoked durable OAuth credentials still fail closed and do not silently fall through.
- Startup OAuth reconciliation now iterates all stored Instagram OAuth credentials rather than only `latest("instagram")`, preserving multi-account support.
- This restored the original supported managed-account path without allowing a token for one Instagram Professional account to impersonate another.

Production evidence after this repair confirms both Instagram tester identities now receive successful published replies from **ishinaillab**.

### Instagram startup hardening after the repair

PR #50, **Validate managed Instagram token at startup**, is on app `main`:

- current app repository `main` code-bearing revision:
  - `2129601`
- PR #50 adds:
  - safe managed-token identity validation at startup;
  - immediate webhook-subscription reconciliation when the managed token is valid;
  - explicit warning when a managed token is invalid or belongs to the wrong Professional account;
  - `InstagramAccessTokenRouter.managedAccountId()`;
  - regression coverage;
  - full local gate at that revision: lint, typecheck, 29 test files / 163 tests, build, and `git diff --check` passed.

Important deployment distinction at transfer time:

- latest Hostinger build verified by the Hostinger build API:
  - build UUID `01a10240-8b96-7248-bf4d-370dcd00025c`
  - state: completed
  - deployed commit: `4c38e646a285d4def7b7225f7904286f326e5277` (PR #49)
- therefore production behavior is currently proven working on PR #49;
- PR #50 exists on `main` but was not shown as the latest deployed Hostinger build in the final transfer check;
- do not claim PR #50 is live until a later deployment check shows `2129601` or a descendant deployed.

### Instagram account identities and credential model

Current business reply account:

- business Professional account: **ishinaillab**
- webhook/outbound Professional account ID used by live reply actions:
  - `17841438662359631`

Earlier OAuth credential context:

- a durable Instagram OAuth credential was previously created for **povnailstudio.ph**;
- its Professional account ID is distinct from the business account;
- do not treat that credential as the business credential for **ishinaillab**;
- that earlier credential remains useful as historical/test OAuth coverage but is not the identity used to send replies as **ishinaillab**.

Working business send path after the regression repair:

- Ishikeit resolves the sender Professional account;
- the managed/App-Dashboard token is accepted only when its Meta `/me` identity matches `17841438662359631`;
- successful published replies after PR #49 prove the current business-token routing works for the actual **ishinaillab** account.

### Instagram App Review state

The integration itself is operational again, but App Review remains a separate unfinished track.

Meta app:

- App ID: `1042452472116584`
- App name: **Ishikeit**
- app mode: live
- Business Verification: passing
- Privacy Policy requirement: passing
- latest known review status:
  - `can_submit=true`
  - `NO_SUBMISSION`
  - no Advanced Access grants yet

Requested permissions remain only:

- `instagram_business_basic`
- `instagram_business_manage_messages`

Reviewer assets:

- public reviewer page:
  - `https://www.ishinaillab.com/instagram-connect-review/`
- WordPress page ID:
  - `21471`
- final review copy:
  - `docs/meta-instagram-app-review.md`

The next App Review work is still:

1. record the real uninterrupted screencast;
2. upload the screencast with the prepared permission explanations and reviewer steps;
3. submit the two permissions for Advanced Access;
4. after approval, run an ordinary non-role customer DM test before declaring public-user Instagram messaging review-complete.

Do not fabricate or synthesize review evidence.

### Ishikeit repository state

App repository:

- `github.com/ishinaillab/ishikeit`
- current `origin/main` at transfer:
  - `2129601` — **Validate managed Instagram token at startup (#50)**
- important recent ancestry:
  - `4c38e64` — Fix Instagram managed-account token regression (#49)
  - `b2bbd07` — Clarify saved production revision wording (#48)
  - `092e84d` — Save latest Ishikeit continuation checkpoint (#47)
  - `02b451c` — Finalize Instagram App Review package (#46)
  - `ce25903` — Record final Instagram OAuth routing verification (#45)
  - `8274c59` — Require OAuth-only Instagram routing when configured (#44)
  - `8a2f395` — Enable Instagram account webhook subscriptions (#43)

Database repository:

- `github.com/ishinaillab/ishikeit-db`
- current `main`:
  - `94babed` — Add OAuth account aliases
- key migrations already applied include:
  - foundation
  - extensible processor
  - persisted partition keys
  - operational attempts
  - durable processing outcomes
  - OAuth credentials
  - Instagram data lifecycle
  - OAuth account aliases
- current alias migration:
  - `20261003020000_oauth_account_aliases.sql`
- do not redesign or remove the alias model; it is necessary because OAuth subject IDs and Professional account IDs are not interchangeable.

### Current architecture

Do not redesign the core.

Current production architecture remains:

- authenticated provider webhook ingress
- Canonical Event Schema 2
- durable PostgreSQL/Supabase inbound queue
- provider-neutral processor
- WordPress AI bridge / AI Engine as the conversational brain
- durable generic action/outbox model
- provider-specific outbound adapters
- durable retry/dead-letter/attempt observability
- account/provider partitioning
- media-capable event/action contracts

Keep future capabilities isolated behind provider/capability boundaries:

- conversational messaging
- Meta Leads
- Meta Marketing API
- TikTok Marketing
- future platforms

Marketing/lead-management operations must not be routed through the conversational message handler simply because they come from Meta or TikTok.

### WordPress / AI bridge stack — verified live at transfer

Live WordPress site:

- canonical site: `https://www.ishinaillab.com/`

Directly relevant active plugins verified by live `wp plugin list`:

- **Ishi AI Bridge** — active, version `0.3.0`
  - current Ishikeit WordPress bridge family;
  - production bridge endpoint remains `https://www.ishinaillab.com/wp-json/ishi-ai/v1`.
- **Ishi Social AI Gateway** — active, version `1.1.1`
  - an audit-copy duplicate is installed but inactive;
  - do not confuse this older gateway surface with the current Ishikeit bridge route.
- **AI Engine (Pro)** — active, version `3.8.0`
  - update `3.8.3` is available;
  - do not update during messaging stabilization without deliberate compatibility review.
- **AI Provider for OpenAI** — active, version `1.2.0`.
- **Easy MCP AI - Connector for Claude, ChatGPT & SEO Data** — active, version `2.0.1`.
- **WPVibe** — active, version `1.20.0`
  - update `1.20.1` is available;
  - WPVibe is the working WordPress connector in the current environment.

Legacy/auxiliary plugin state relevant to continuity:

- **Ishi Domain Migration Helper** — inactive, version `1.1.0`.
- **Ishi RAG Query Normalizer** — inactive, version `0.4.2`.
- inactive Ishi Social AI Gateway audit copy exists at version `1.1.1`.

### Locked/custom plugins that must remain untouched unless the user explicitly authorizes changes

Verified active versions:

- **Ishi LatePoint Agent Portal** — `0.7.3`
- **Ishi LatePoint Instant** — `1.9.0`
- **Ishi Elementor Fix** — `4.3.0`

Preserve the previously established locked-plugin rule. Do not modify these merely because work continues on Ishikeit.

Other relevant live scheduling stack:

- LatePoint — active, `5.7.3`
- LatePoint Pro Features — active, `1.7.0`
- WooCommerce Payments integration for LatePoint — active

### Domain / hosting continuity

- public canonical domain remains:
  - `https://www.ishinaillab.com/`
- production Ishikeit Node service remains:
  - `https://apps.ishinaillab.com/`
- Hostinger Node application:
  - Fastify
  - npm
  - build: `npm run build`
  - entry: `dist/processes/http.js`
- health endpoints remain:
  - `/health/live`
  - `/health/ready`

Do not change Hostinger's internal shared-hosting primary-domain label from `povnailstudio.com` until rollback/archive implications are reverified.

Keep the `zdm1002_*` WordPress rollback tables for now.

### Provider status at transfer

Messenger:

- working;
- recent inbound and published outbound production activity verified.

Instagram:

- working after PR #49 regression repair;
- both **povnailstudio.com.ph** and **povnailstudio.ph** receive replies from **ishinaillab**;
- recent durable published outbox evidence exists for both tester recipient identities;
- historical dead letters from the regression remain only as audit history.

WhatsApp:

- working;
- recent inbound and published outbound production activity verified.

Telegram:

- working;
- recent inbound and published outbound activity verified.

TikTok:

- adapter and durable OAuth lifecycle remain implemented;
- Business Messaging activation depends on TikTok's dedicated Business Messaging access/security/privacy review and Business Account authorization; the currently pending Marketing Ad account management review is a separate track;
- no fresh TikTok production canary was independently captured in this transfer check;
- continue from the latest TikTok permission/review state rather than reimplementing the adapter.

### Next-chat start point

Do not reopen the Instagram regression diagnosis. It is resolved in production.

Start the next chat from these priorities:

1. verify whether PR #50 / `2129601` has been deployed; if not, deploy/verify it before further Instagram changes;
2. continue Instagram App Review from the real screencast/final submission step;
3. continue TikTok activation only from the latest permission-review state;
4. preserve the working Messenger, Instagram, WhatsApp, and Telegram paths while adding new capability families;
5. keep provider-neutral architecture and current durable queue/outbox semantics;
6. do not reintroduce the retired `/ishinaillab/ishi` project.

This checkpoint is authoritative until a later explicit transfer checkpoint supersedes it.


### Post-transfer deployment readback — final correction

This section supersedes the deployment distinction inside the immediately preceding transfer checkpoint.

After PR #51 merged, Hostinger completed two newer builds:

- `01a10267-7d32-70e3-9ae4-61ae7424e7d1`
  - completed
  - commit `21296010cb3b89570556a936fe2a63636e2422e6` (PR #50)
- `01a1028e-5c9d-7210-852f-01a231d34743`
  - completed
  - commit `10d00803e00307416b5cc8549906d825c19fc174` (PR #51)

Therefore the current deployed production revision at transfer is:

- `10d00803e00307416b5cc8549906d825c19fc174`

This means the PR #50 startup-hardening logic is now live in production.

Post-deploy health verification:

- `GET https://apps.ishinaillab.com/health/live` -> `{"status":"ok"}`
- `GET https://apps.ishinaillab.com/health/ready` -> `{"status":"ready"}`

Current working messaging status remains unchanged after deployment:

- Messenger working
- Instagram working
- WhatsApp working
- Telegram working
- both **povnailstudio.com.ph** and **povnailstudio.ph** receive replies from **ishinaillab**

Use this post-transfer section as the final deployment source of truth for the next chat.


### TikTok Marketing OAuth foundation — deployed; provider authorization not yet configured

Implementation/deployment state:

- database migration source branch was: `ishinaillab/ishikeit-db:feature/nullable-oauth-access-expiry`;
- database PR #7 merged as `c879024a971688bb019aebe7551020b9287f1735`;
- application PR #53 merged as `07e11245b9a51544c52e0015b9d867eaf106b7b6`;
- deployment-marker PR #54 merged as `062cf52d0bca62916c36c9324ccf493e315c5bd1`;
- production `GET /health/capabilities` now returns `tiktokMarketingOAuthSchema: 1`, proving the Hostinger runtime includes the TikTok Marketing OAuth foundation;
- at the same production readback, `/health/ready` remained `ready`, and both processor/action-dispatch runtime flags remained enabled.

Database dependency is now satisfied in production:

- database PR #7 merged as `c879024a971688bb019aebe7551020b9287f1735`;
- linked Supabase project: `ishikeit-db` / `vhmrliqemkfxblzsoyaz`;
- linked `supabase db lint --level error --fail-on error`: no schema errors;
- dry-run before apply listed exactly `20261004010000_nullable_oauth_access_expiry.sql`;
- live `supabase db push --linked --skip-vault` applied that migration successfully;
- linked migration history now records `20261004010000` on both local and remote sides.

Approved boundary:

- TikTok Business Messaging remains on the existing `tiktok` OAuth namespace and `tt_user` token/refresh lifecycle.
- TikTok Marketing advertiser authorization uses the distinct durable credential namespace `tiktok-marketing`.
- Both authorization families reuse the same TikTok API for Business developer app ID/secret.
- Marketing-specific authorization URL and redirect URI are independently configurable from the Business Messaging account-holder OAuth URLs.
- production advertiser callback is fixed to:
  - `https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/`
- protected operational routes are:
  - `POST /ops/tiktok/marketing/oauth/start`
  - `GET /ops/tiktok/marketing/oauth/status`
- the callback requires TikTok's documented `auth_code`; an auxiliary `code` query parameter is not used as the authorization code.
- Marketing credentials are stored encrypted, one row per verified advertiser ID.
- Marketing credentials may have no `access_expires_at`; the accompanying database migration changes only `oauth_credentials.access_expires_at` from required to nullable.
- existing Instagram and TikTok Business Messaging token managers still require a real access expiry and fail closed when it is missing.
- Marketing authorization status exposes advertiser IDs only and never tokens/secrets.
- Marketing authorization does not gate `/health/ready`; only the existing OAuth store readiness applies when the feature is configured.
- no TikTok Marketing action adapter or mutation operation is implemented in this milestone.
- campaign, ad-group, ad, creative, budget, bid, audience, lead, and delivery-changing calls remain explicitly out of scope.

The database migration now applied in production is:

- `supabase/migrations/20261004010000_nullable_oauth_access_expiry.sql`

Production readback after deployment:

- `GET /health/live` -> HTTP 200;
- `GET /health/ready` -> HTTP 200 / `ready`;
- Meta webhook negative-path probe -> HTTP 401, confirming the existing Meta ingress route remains registered/protected;
- Telegram webhook negative-path probe -> HTTP 401, confirming the existing Telegram ingress route remains registered/protected;
- `GET /ops/instagram/oauth/status` without bearer auth -> HTTP 401 with Bearer challenge, preserving the existing protected Instagram OAuth surface;
- `GET /ops/tiktok/oauth/status` -> HTTP 404 because TikTok Business Messaging OAuth remains unconfigured;
- `GET /ops/tiktok/marketing/oauth/status` -> HTTP 404 because TikTok Marketing OAuth runtime variables remain unset;
- TikTok webhook negative-path probe -> HTTP 404 for the same unconfigured TikTok runtime state.

Secure local handoff status:

- `C:\\Users\\MBDS\\Downloads\\ishikeit-tiktok-app.env` now contains the new Marketing OAuth variable placeholders/callback settings;
- `TIKTOK_BUSINESS_APP_ID`, `TIKTOK_BUSINESS_APP_SECRET`, `TIKTOK_BUSINESS_AUTHORIZATION_URL`, and `TIKTOK_MARKETING_AUTHORIZATION_URL` remain unpopulated placeholders;
- no secret values are stored in repository documentation.

Next TikTok steps:

1. populate the shared TikTok app ID/secret and the provider-generated authorization URL(s) in the secure local handoff / production environment;
2. configure `TIKTOK_MARKETING_AUTHORIZATION_URL` and the registered advertiser callback;
3. verify the protected Marketing start/status routes become available;
4. complete a real advertiser authorization;
5. verify encrypted `tiktok-marketing` advertiser credentials and perform a read-only provider-backed proof;
6. do not enable Marketing mutations because none are implemented.


### TikTok Marketing live access verification — deployed

Credential-independent implementation work continued while the TikTok developer app is under review.

PR #56 was squash-merged to `main` as `ae499489ee5df17105474db3e0bd608f9ea9c6b6` and deployed by Hostinger while the TikTok developer app remains under review.

Deployed behavior:

- protected read-only `GET /ops/tiktok/marketing/oauth/verify`;
- reuses the stored encrypted `tiktok-marketing` access token;
- calls only the existing advertiser-discovery operation already covered by **Ad account management**;
- returns authorized advertiser IDs, stored advertiser IDs, and non-mutating drift diagnostics;
- never returns access tokens, scopes, advertiser names, or provider error text;
- returns `409 not_authorized` when no durable Marketing credential exists;
- returns generic `503 verification_unavailable` for provider/transport verification failure;
- performs no automatic credential deletion/reconciliation and no Marketing mutation;
- bumps `tiktokMarketingOAuthSchema` from 1 to 2.

Production readback after PR #56:

- `/health/capabilities` now reports `tiktokMarketingOAuthSchema: 2`;
- `/health/live` remains HTTP 200 / `ok`;
- `/health/ready` remains HTTP 200 / `ready`;
- processor and action-dispatch runtime flags remain enabled;
- `/ops/tiktok/marketing/oauth/status` remains HTTP 404 while Marketing environment variables are intentionally unset;
- `/ops/tiktok/marketing/oauth/verify` likewise remains HTTP 404 until the approved TikTok app credentials and authorization URL are configured.

TikTok API-version resolution while the app is under review:

- the current portal permission inventory labels **Ad account management** as API v2.0, but that catalog label does not by itself define the OAuth transport base path;
- TikTok's current official `tiktok-business-api-sdk` `main` branch still maps advertiser token exchange to `POST /open_api/v1.3/oauth2/access_token/` and advertiser discovery to `GET /open_api/v1.3/oauth2/advertiser/get/`;
- Ishikeit's tests already pin those exact advertiser-OAuth paths;
- therefore keep `TIKTOK_BUSINESS_API_VERSION=v1.3` for the currently implemented OAuth flows and do not switch them to `v2.0` merely because the Scope of permission UI displays v2.0;
- revisit this only when TikTok publishes an authoritative v2.0 advertiser-auth endpoint contract or the approved app exposes a documented replacement.


### TikTok Marketing Ad Account Management proof — deployed

Credential-independent work continued while the TikTok developer app is under review.

PR #59 was squash-merged to `main` as `06621aa3a2b864380976011b4601f89e8b1872a7` and deployed by Hostinger.

Implemented boundary:

- dedicated `src/marketing/tiktok-advertiser.ts` module, separate from OAuth and messaging;
- official read-only `GET /open_api/v1.3/advertiser/info/` Account Management call;
- repeated `advertiser_ids` query parameters matching TikTok's official SDK;
- `Access-Token` authentication only; no app secret or authorization-code material is sent to this endpoint;
- provider response is reduced to advertiser IDs only;
- durable credentials are grouped by access token so multiple independent advertiser grants can be verified correctly;
- protected `GET /ops/tiktok/marketing/advertisers/verify`;
- `409 not_authorized` when no Marketing credential exists;
- generic `503 advertiser_verification_unavailable` for provider/transport failures;
- no advertiser/account mutation and no automatic credential reconciliation;
- new runtime capability marker `tiktokMarketingAdvertiserSchema: 1`;
- activation remains behind the existing complete TikTok Marketing OAuth configuration gate, so production stays unchanged while the app is under review.

Verification evidence so far:

- provider/service focused suite: 8/8 passed after the retry-classification RED→GREEN check;
- HTTP + provider focused suite: 26/26 passed;
- process composition typecheck passed;
- full repository gate passed: lint, typecheck, 32 test files / 202 tests, and build;
- `git diff --check` passed;
- messaging-isolation scan found no `tiktok-marketing`/advertiser-capability crossover into adapters/channels/media/dispatch;
- Marketing mutation scan found no advertiser/campaign/ad-group/ad write endpoint in `src/marketing`;
- changed-line scan found no secret-like literal additions.

Final verification and production readback:

- PR #59 Node 24 CI passed `npm run check`;
- PHP lint and context-continuity CI jobs passed;
- production `/health/capabilities` now reports `tiktokMarketingAdvertiserSchema: 1` alongside `tiktokMarketingOAuthSchema: 2`;
- `/health/live` remains HTTP 200 / `ok`;
- `/health/ready` remains HTTP 200 / `ready`;
- processor and action-dispatch runtime flags remain enabled;
- `/ops/tiktok/marketing/advertisers/verify` remains HTTP 404 while the TikTok app is under review and Marketing environment variables are unset;
- `/ops/tiktok/marketing/oauth/status` and `/ops/tiktok/marketing/oauth/verify` likewise remain HTTP 404 in that intentionally inactive state.

The next TikTok activation gate is provider approval plus the real App ID, App Secret, and generated Advertiser authorization URL. After those values are configured, run OAuth authorization first, then both read-only verification routes.


### TikTok Marketing safe advertiser summaries — deployed

Credential-independent development continued while the TikTok developer app is under review.

PR #61 was squash-merged to `main` as `7f69e991b1160fa9c477cb0aa4c84a23988da896` and deployed by Hostinger.

Implemented boundary:

- extends the existing read-only TikTok Account Management client with `getAdvertiserAccounts()`;
- requests only `advertiser_id`, `name`, `status`, `currency`, `timezone`, and `country`;
- drops sensitive provider fields including email, phone, address, license data, and balance;
- groups durable advertiser credentials by access-token grant and queries only the advertiser IDs belonging to that grant;
- filters out provider rows for advertiser IDs not represented by the durable grant;
- adds protected `GET /ops/tiktok/marketing/advertisers`;
- returns `409 not_authorized` before durable advertiser authorization and generic `503 advertiser_list_unavailable` on provider failure;
- bumps `tiktokMarketingAdvertiserSchema` from 1 to 2;
- adds no new TikTok permission, no database migration, and no Marketing mutation.

Version ruling:

- TikTok's current v2.0 guide states that endpoints whose only change is the URL version can be omitted from the v2.0 reference;
- TikTok's current official SDK and TikTok for Business MCP registry still expose advertiser OAuth and advertiser-info operations at v1.3;
- keep Ishikeit's API version configuration explicit and leave the current production value at v1.3 until endpoint-specific v2.0 behavior is verified rather than inferring a migration from the portal label or documentation omission.

TDD evidence so far:

- safe advertiser client/service RED: missing `getAdvertiserAccounts()` / `listAccounts()`;
- safe advertiser client/service GREEN: 11/11 focused tests;
- HTTP RED: missing summary route plus expected advertiser schema bump;
- HTTP + advertiser GREEN: 32/32 focused tests.

Verification completed before PR:

- full repository gate passed: lint, typecheck, 32 test files / 207 tests, and build;
- `git diff --check` passed;
- messaging-isolation scan found no advertiser-summary crossover into adapters/channels/media/dispatch;
- Marketing mutation scan found no advertiser/campaign/ad-group/ad write endpoint in `src/marketing`;
- changed-source scan found no flow of sensitive advertiser fields such as email, phone, address, license data, or balance;
- changed-line scan found no secret-like literal additions.

Final CI and production readback:

- PR #61 Node 24 CI passed along with PHP lint and context continuity before merge;
- production `/health/capabilities` now reports `tiktokMarketingAdvertiserSchema: 2` alongside `tiktokMarketingOAuthSchema: 2`;
- production `/health/live` remains HTTP 200 / `ok`;
- production `/health/ready` remains HTTP 200 / `ready`;
- processor and action-dispatch runtime flags remain enabled;
- `/ops/tiktok/marketing/advertisers` remains HTTP 404 while the TikTok app is under review and Marketing environment variables are intentionally unset;
- `/ops/tiktok/marketing/advertisers/verify`, `/ops/tiktok/marketing/oauth/status`, and `/ops/tiktok/marketing/oauth/verify` likewise remain HTTP 404 in that intentionally inactive state.

After TikTok approval and production configuration, complete advertiser OAuth first, then use the safe account-summary route plus both verification routes for the provider-backed activation proof.


### TikTok Business Messaging capability + history reads — deployed

Credential-independent Business Messaging work continued while provider access/approval remains external.

PR #63 was squash-merged to `main` as `392e00da35ecf70ffa57c27560c04ad9aeddf479` and deployed by Hostinger.

Implemented boundary:

- new `src/messaging/tiktok-business-read.ts`, separate from TikTok send, OAuth, Marketing, and dispatcher code;
- `GET /open_api/v1.3/business/message/capabilities/get/` for conversation-scoped `IMAGE_SEND` capability;
- `GET /open_api/v1.3/business/message/conversation/list/` with explicit `SINGLE|STRANGER`, page limit 1–100, and cursor support;
- `GET /open_api/v1.3/business/message/content/list/` for conversation message history;
- dynamic access-token acquisition through the existing `TikTokAccessTokenManager`, including refresh behavior;
- plus-sign conversation IDs are encoded safely through URL query encoding;
- read-only operational routes:
  - `GET /ops/tiktok/messaging/capabilities`
  - `GET /ops/tiktok/messaging/conversations`
  - `GET /ops/tiktok/messaging/conversations/:conversationId/messages`
- all routes require the existing ops bearer token and use `private, no-store`;
- invalid input -> 400 `invalid_request`;
- reauthorization-required durable token state -> 409 `not_authorized`;
- provider/transport failure -> generic 503 `messaging_read_unavailable`;
- capability marker: `tiktokBusinessMessagingReadSchema: 1`;
- no new environment variable, database migration, provider permission, messaging send behavior, or dispatcher operation.

Privacy minimization:

- conversation reads discard referral/ad metadata;
- message reads discard TikTok usernames, participant IDs, participant display names, profile images, provider media IDs, and the provider participants collection;
- retained message fields are limited to message/conversation ID, timestamp, type, source, sender/recipient role, automatic-message type, text content when present, and referenced-message ID.

Provider contract evidence:

- current TikTok Business Messaging API index lists Send message, Get conversations, Get messages, Upload image, Download media, and Check capability as first-class Direct Messages operations;
- endpoint/parameter shapes were cross-checked against the current Go SDK implementation that maps these operations to `/open_api/v1.3/business/message/capabilities/get/`, `conversation/list/`, and `content/list/`;
- `IMAGE_SEND` is currently the documented capability type and requires conversation ID/type;
- conversation types are `SINGLE` and `STRANGER`.

TDD evidence so far:

- provider-client RED: module missing;
- provider-client GREEN: 7/7 focused tests;
- HTTP RED: five expected missing-boundary failures while all existing HTTP tests remained green;
- HTTP + provider GREEN: 32/32 focused tests;
- process composition typecheck passed.

Onboarding state correction:

- the TikTok app currently under review is the separate Marketing **Ad account management** review;
- Business Messaging production activation still requires TikTok's dedicated Business Messaging access/security/privacy review, account-holder authorization, webhook registration, capability proof, and a human-originated live canary;
- do not refer to the current blocker as a TikTok Accounts permission-scope review.

Verification completed before PR:

- full repository gate passed: lint, typecheck, 33 test files / 218 tests, and build;
- `git diff --check` passed;
- new messaging module contains no Business Messaging send/upload/automatic-message/unlock mutation endpoint;
- dispatcher/adapters/workers contain no read-client registration or crossover;
- changed production-source scan found no flow of provider profile image, display name, sender/recipient username, participants collection, referral metadata, or media ID into the new safe read response;
- changed-line scan found no secret-like literal additions.

Final CI and production readback:

- PR #63 Node 24 CI passed along with PHP lint and context continuity before merge;
- production `/health/capabilities` now reports `tiktokBusinessMessagingReadSchema: 1`, with `tiktokMarketingOAuthSchema: 2` and `tiktokMarketingAdvertiserSchema: 2` unchanged;
- production `/health/live` remains HTTP 200 / `ok`;
- production `/health/ready` remains HTTP 200 / `ready`;
- processor and action-dispatch runtime flags remain enabled;
- `/ops/tiktok/messaging/capabilities`, `/ops/tiktok/messaging/conversations`, and `/ops/tiktok/messaging/conversations/:conversationId/messages` remain HTTP 404 while Business Messaging OAuth/account activation is intentionally unconfigured.

After TikTok grants Business Messaging access and the Business Account is authorized, activate `TIKTOK_BUSINESS_ID`, then use these read routes for capability proof, conversation inspection, message-history validation, and later webhook-gap reconciliation.


### TikTok Business Messaging webhook reconciliation — deployed

Credential-independent Business Messaging work continued while TikTok provider access remains external.

PR #65 was squash-merged to `main` as `1deaa08908696dfe6439eac737aea291c8a42d66` and deployed by Hostinger.

Implemented boundary:

- new `src/messaging/tiktok-webhook-config.ts`, separate from inbound verification, outbound sending, Business Account OAuth, Marketing, and dispatcher code;
- provider status read for the developer-app `DIRECT_MESSAGE` webhook subscription;
- provider create/update for that single subscription only;
- expected callback is independently configured through `TIKTOK_BUSINESS_WEBHOOK_CALLBACK_URL`;
- production example is `https://apps.ishinaillab.com/ishikeit/webhooks/tiktok`;
- webhook management requires shared TikTok app credentials and the existing ops bearer credential but does not require `TIKTOK_BUSINESS_ID` or completed account-holder OAuth;
- protected operational routes:
  - `GET /ops/tiktok/messaging/webhook/status`
  - `POST /ops/tiktok/messaging/webhook/reconcile`
- status reports configured state, actual callback, expected callback, and drift only;
- reconcile is idempotent: no write when current state already matches, otherwise create/update then provider read-back;
- reconcile never deletes provider webhook state automatically;
- provider errors map to generic 503 responses and never expose App Secret/provider response text;
- capability marker: `tiktokBusinessMessagingWebhookSchema: 1`;
- readiness behavior is unchanged; webhook drift does not make `/health/ready` fail.

Provider contract evidence:

- current official TikTok Business Messaging API index lists Create, Get, and Delete Business Messaging Webhook configuration as first-class webhook operations;
- TikTok's current model is one subscription per event type per developer app, and `DIRECT_MESSAGE` covers the Business Messaging `im_*` event family for all businesses that authorize the app;
- endpoint/request shapes were cross-checked against a current generated TikTok Business API OpenAPI mirror mapping create/update, list, and delete to `/open_api/v1.3/business/webhook/update/`, `list/`, and `delete/`;
- this milestone intentionally implements only status + create/update reconcile; delete remains unsupported to avoid destructive automatic recovery.

TDD evidence so far:

- webhook client/service RED: module missing;
- webhook client/service GREEN: 8/8 focused tests;
- env RED: callback variable/dependencies/safety validation absent;
- env GREEN: 20/20 env tests;
- HTTP RED: four expected missing-boundary failures while all existing HTTP tests remained green;
- webhook + env + HTTP GREEN: 56/56 focused tests.

Verification completed before PR:

- full repository gate passed: lint, typecheck, 34 test files / 232 tests, and build;
- `git diff --check` passed;
- source scan found no `business/webhook/delete/` path or delete controller;
- dispatcher/adapters/workers contain no webhook-control registration or crossover;
- webhook module contains no unrelated Business Messaging send/upload/automatic-message/unlock/comment-to-message mutation;
- changed production-source scan found no App Secret logging or secret-bearing operational response flow;
- changed-line scan found no secret-like literal additions.

Final CI and production readback:

- PR #65 Node 24 CI passed along with PHP lint and context continuity before merge;
- production `/health/capabilities` now reports `tiktokBusinessMessagingWebhookSchema: 1`;
- `tiktokBusinessMessagingReadSchema: 1`, `tiktokMarketingOAuthSchema: 2`, and `tiktokMarketingAdvertiserSchema: 2` remain unchanged;
- production `/health/live` remains HTTP 200 / `ok`;
- production `/health/ready` remains HTTP 200 / `ready`;
- processor and action-dispatch runtime flags remain enabled;
- `/ops/tiktok/messaging/webhook/status` and `POST /ops/tiktok/messaging/webhook/reconcile` remain HTTP 404 because `TIKTOK_BUSINESS_WEBHOOK_CALLBACK_URL` is intentionally unset while Business Messaging provider activation is still pending;
- existing TikTok Business Messaging read routes also remain HTTP 404 while Business Account OAuth/account activation is unconfigured.

After TikTok grants Business Messaging access, configure `TIKTOK_BUSINESS_WEBHOOK_CALLBACK_URL=https://apps.ishinaillab.com/ishikeit/webhooks/tiktok`, verify the status route becomes protected/available, run one explicit reconcile, confirm provider read-back convergence, then continue Business Account OAuth and live canary activation.


### TikTok Business Messaging outbound image upload/send — deployed

Credential-independent Business Messaging work continued while TikTok provider access remains external.

PR #67, including the stacked capability-preflight work from PR #68, was squash-merged to `main` as `74e658b8e51806efa3861e85a564178c6db8910c` and deployed by Hostinger.

Implemented boundary:

- extends the existing `tiktok / messaging / message.send` adapter to accept portable `kind=image` content in addition to text;
- provider flow is `HTTPS image source -> POST /open_api/v1.3/business/message/media/upload/ -> media_id -> POST /open_api/v1.3/business/message/send/`;
- upload request uses multipart form fields `business_id`, `file`, and `media_type=IMAGE`;
- send request uses `recipient_type=CONVERSATION`, the conversation ID, `message_type=IMAGE`, and `image.media_id`;
- supported provider formats are JPG/JPEG and PNG only;
- provider image-size ceiling is enforced at 3 MB before and after download;
- only portable `source.kind=url` is accepted for outbound image upload in this milestone;
- source URL must be safe HTTPS with no URL credentials, no localhost/private IP literal, and redirects constrained to the original host with a three-redirect ceiling;
- TikTok image captions are rejected rather than silently dropped;
- image messages with `replyTo` are rejected because TikTok referenced-message replies are text-only;
- video, audio, document, and structured outbound content remain unsupported by the TikTok generic sender;
- no database migration or new environment variable;
- deployed capability marker after automatic preflight integration: `tiktokBusinessMessagingImageSendSchema: 2`.

Failure semantics:

- OAuth/token acquisition failure occurs before provider upload/send and remains non-ambiguous;
- image-source download failure and provider media-upload failure are never delivery-ambiguous because no message has been submitted;
- transient download/upload failures remain retryable;
- only transport failure after the final message-send request begins is delivery-ambiguous, matching existing TikTok text-send semantics;
- provider throttling codes `40100` and `51065` remain retryable.

Capability-preflight baseline in PR #67:

- TikTok documents `IMAGE_SEND` capability checks using both `conversation_id` and `conversation_type`;
- allowed conversation types are `STRANGER` and `SINGLE`;
- TikTok message webhooks and Ishikeit's current portable reply action do not carry `conversation_type`;
- PR #67 intentionally did not guess the type and left automatic preflight to the next stacked milestone.

Provider contract evidence:

- current official TikTok Business Messaging API index lists Send a message, Upload an image, Download media, and Check capability as first-class Direct Messages operations;
- the current generated Go SDK maps image upload to `/open_api/v1.3/business/message/media/upload/` and send to `/open_api/v1.3/business/message/send/`;
- upload accepts multipart `business_id`, `file`, and `media_type=IMAGE`, supports JPG/PNG, and limits files to 3 MB;
- uploaded `media_id` values are documented as valid for 30 days;
- the send schema uses `message_type=IMAGE` plus `image.media_id` and does not allow a text+image payload.

TDD evidence so far:

- sender RED: existing text-only rejection caused the three intended new image-behavior failures while nine existing sender tests remained green;
- sender GREEN: 12/12 focused sender tests;
- dispatcher image integration: 3/3 adapter tests green;
- runtime marker RED: only `tiktokBusinessMessagingImageSendSchema: 1` was missing while all other HTTP and adapter tests stayed green;
- sender + adapter + HTTP GREEN: 43/43 focused tests.

Verification completed before PR:

- full repository gate passed: lint, typecheck, 34 test files / 238 tests, and build;
- `git diff --check` passed;
- changed-source scan found no TikTok video/audio/document send expansion and no video media-upload path;
- outbound image source scope remains `source.kind=url` only;
- no new environment/configuration variable was introduced;
- the existing TikTok adapter Business Account target guard remains intact;
- changed-line scan found no secret-like literal additions.

Final CI and production readback:

- PR #68 was merged into PR #67's feature branch as `0207eeee177efb6122545ca56fe603e1ac505cf1`;
- the exact combined PR #67 head passed Node 24 CI, PHP lint, and context continuity;
- PR #67 was squash-merged to `main` as `74e658b8e51806efa3861e85a564178c6db8910c`;
- production `/health/capabilities` now reports `tiktokBusinessMessagingImageSendSchema: 2`;
- `tiktokBusinessMessagingReadSchema: 1`, `tiktokBusinessMessagingWebhookSchema: 1`, `tiktokMarketingOAuthSchema: 2`, and `tiktokMarketingAdvertiserSchema: 2` remain unchanged;
- production `/health/live` remains HTTP 200 / `ok`;
- production `/health/ready` remains HTTP 200 / `ready`;
- processor and action-dispatch runtime flags remain enabled;
- TikTok Business Messaging capability/conversation/webhook/OAuth ops routes remain HTTP 404 while Business Messaging provider credentials/account activation are intentionally unset.

The image sender is now production-deployed but dormant until TikTok Business Messaging access, app/account authorization, and runtime configuration are completed.


### TikTok Business Messaging automatic IMAGE_SEND preflight — deployed with PR #67

This work was developed as PR #68 on `feature/tiktok-image-capability-preflight`, then merged into PR #67 before the production merge.

Implemented boundary:

- extends `TikTokBusinessMessagingReadController` with `resolveConversationType(conversationId)`;
- provider-backed resolver searches both TikTok conversation categories instead of guessing state:
  - `SINGLE`: the business has previously responded;
  - `STRANGER`: the user messaged the business before the business has accepted/responded;
- the resolver fetches both type lists in parallel at TikTok's maximum page size of 100;
- pagination continues for active categories until the conversation is found or both categories are exhausted;
- pagination is bounded to 100 rounds and rejects missing/repeated cursors so a provider pagination loop cannot become unbounded;
- if TikTok returns the same conversation in both type lists, resolution fails closed as inconsistent provider state;
- an unresolved conversation fails as a retryable Business Messaging read error rather than being assigned a guessed type;
- outbound image flow is now:
  `local image validation -> resolve conversation type -> IMAGE_SEND capability check -> access token -> safe image download -> media upload -> message send`;
- a valid image send requires a capability resolver; missing resolver fails non-retryably before provider media I/O;
- `IMAGE_SEND=false` fails non-retryably before image download;
- transient resolver/capability read failures are retryable but never delivery-ambiguous;
- authorization/validation failures remain non-retryable;
- text sends remain independent of the resolver;
- production composition injects the already-existing `TikTokBusinessMessagingReadClient` into `TikTokBusinessSender`; no second provider client, credential, database table, or environment setting is introduced;
- runtime marker advances from `tiktokBusinessMessagingImageSendSchema: 1` to `tiktokBusinessMessagingImageSendSchema: 2`.

Provider-contract basis:

- TikTok's conversation-list request requires a caller-selected `conversation_type` and supports `limit` 1–100 plus cursor pagination;
- TikTok defines `STRANGER` as a conversation where the user has messaged the Business Account but the business has not yet accepted/responded;
- TikTok defines `SINGLE` as a one-to-one conversation where the business has previously responded;
- TikTok's `IMAGE_SEND` capability check requires both the exact conversation ID and one of those two conversation types.

TDD evidence:

- resolver RED: 3 intended failures because `resolveConversationType` did not exist; all 7 prior read-client tests remained green;
- resolver GREEN: 10/10 read-client tests, including cross-type resolution, cursor pagination, and safe unresolved-state failure;
- sender RED: 4 intended preflight failures while 11 prior sender behaviors remained green;
- sender GREEN: 15/15 sender tests;
- adapter RED: image dispatch correctly failed closed without a resolver while text/account-guard tests remained green;
- focused integration after wiring: 56/56 across read client, sender, adapter, and HTTP;
- focused typecheck passed after requiring the read client in the production sender-composition guard and completing HTTP controller doubles.

Verification completed before stacked PR:

- full repository gate passed: lint, typecheck, 34 test files / 244 tests, and build;
- stacked `git diff --check` passed after documentation normalization;
- stacked diff contains no Supabase/database migration and no environment/configuration change;
- sender diff contains no hard-coded `SINGLE` or `STRANGER` fallback;
- source ordering confirms capability preflight occurs before image download and media upload;
- stacked source diff introduces no additional Business Messaging mutation endpoint;
- changed-line scan found no secret-like literal additions.

Deployment state: included in PR #67 and live in production under `tiktokBusinessMessagingImageSendSchema: 2`.

### October 11 security maintenance — source-map-js dependency advisory (PR #72)

Production Hostinger's Node.js dependency scanner identified CVE-2026-93749 / GHSA-68fv-2mgg-jv7q in transitive `source-map-js@1.2.1`, a **development-only** lockfile dependency (`dev: true`). The vendor/GitHub-reviewed patched minimum is **1.2.2**. This is an indexed source-map offset denial-of-service advisory; its presence in the development toolchain does **not** independently prove runtime exploitability in the Fastify app.

PR [#72](https://github.com/ishinaillab/ishikeit/pull/72), branch `fix/source-map-js-cve-2026-93749`, changes only `package-lock.json` at `node_modules/source-map-js` from 1.2.1 to 1.2.2, including npm registry tarball URL and integrity checksum. No source code, WordPress bridge, runtime config, production environment variables, Supabase migration, provider behavior or app feature marker is modified.

Pre-PR validation on isolated Windows Git worktree (Node 26, not production Node 24): version assertion RED on 1.2.1 and GREEN on 1.2.2; `npm ci --ignore-scripts` succeeded; `npm audit` transitioned from 1 high advisory to **zero reported vulnerabilities**; `npm run check` succeeded with lint, typecheck, 34 test files / **244 passing tests**, and build; `git diff --check` passed. GitHub Actions Node 24 CI job and PHP lint both **passed** on PR #72 first run; the context-continuity job failed **only** because this documentation update was initially absent. This paragraph supplies that required durable context. Re-run all checks and require green before merge.

**Deployment completed and independently verified:** PR #72 passed all GitHub CI gates and squash-merged to `main` as `3d4cbddc34c6cb497bd0c80dd3c506801e1d55b5`. Hostinger's build `01a12b17-972d-70ca-94c1-91ecca8dacac` completed on Node 24 for that exact commit. Post-deploy `/health/live`, `/health/ready`, and `/health/capabilities` all returned HTTP 200; messaging processor and dispatcher remained enabled, and existing capability markers were unchanged. A fresh authenticated Hostinger Node vulnerability scan returned `[]` versus the one-high finding before the update. This is closure of that detected dev-dependency finding, not a guarantee of zero undiscovered vulnerabilities. No live messaging canary was sent. Preserve all messaging integrations and WordPress security guards.

### October 11 PHT evening — live WordPress ThemeREX CVE exposure and mitigation readback

This WordPress investigation is maintained in the separate **non-deploy** checkpoint branch `checkpoint/hostinger-wordpress-security-2026-10-11`; the full and current evidence is [docs/FULL_PROJECT_HANDOFF_2026-10-11.md](https://github.com/ishinaillab/ishikeit/blob/checkpoint/hostinger-wordpress-security-2026-10-11/docs/FULL_PROJECT_HANDOFF_2026-10-11.md). **Do not deploy that WordPress-security documentation branch to the Fastify application**. This paragraph intentionally records status and does not change WordPress files, plugin versions, credentials, database, Cloudflare or Ishikeit runtime behavior.

- Current authenticated WordPress plugin inventory: ThemeREX Addons **2.46.0 active** with two official **OPEN** findings: **CVE-2026-102797** (SSRF, CVSS 6.4) and **CVE-2026-102798** (stored XSS, CVSS 6.5); Patchstack says both need **2.47.0+**, both Contributor-level, and published advisories do **not disclose an exact affected route/function or a verified vendor patch diff**. Previous custom 2.46.0 PHP hardening plus seven MU guards are *compensating controls*, **not proof of CVE closure**. No trusted 2.47.0 package or updater offer has been verified; do not request the lost ThemeForest account, bypass a license, substitute an untrusted ZIP, or falsify plugin version metadata.
- Fresh **aggregate production accounts**: one administrator, six `latepoint_customer`, one `latepoint_agent`, **zero Contributor/Author/Editor/shop_manager**. A guarded CLI-only **staging** role audit confirms LatePoint customer and agent roles do not have `edit_posts`, `edit_theme_options`, `manage_options`; the agent role still has `upload_files` (stage role-definition evidence, not an independent production capabilities snapshot). This reduces immediate Contributor attack surface but does not fix the CVEs or prove no privilege escalation.
- Authenticated current WordPress plugin updater offers Elementor Pro 4.3.1 (`package_available=true`, installed 4.3.0-beta3) and LatePoint Pro Features 1.7.3 (`package_available=false`, installed 1.7.0); no ThemeREX 2.47.0 update. Do not update protected Ishi Elementor Fix 4.3.0, Ishi LatePoint Agent Portal 0.7.3 or Ishi LatePoint Instant 1.9.0. Preserve bookings, Woo checkout, dashboard and Ishikeit.
- Fresh Cloudflare ruleset readback confirmed three active upload/backup exposure block rules and an enabled Free Managed Ruleset entry. These **do not constitute a named SSRF/XSS virtual patch**. No WAF rules changed.
- Stage retains a separate restored DB, origin `Require all denied`, outbound messaging/email kill switch, and tested rollback safeguards. Latest CLI-only role audit script self-deleted and its one-shot Hostinger cron was deleted; independent recheck found **no cron jobs** and no test helper in the stage document root. All production and staging plugins, themes, databases and customers were untouched during this read-only/ephemeral diagnostic continuation.
- **Critical release gates still open:** an independently encrypted **off-host** WordPress backup with tested restore; authentic ThemeREX 2.47+ package **or** an equivalent completely tested migration; exploit-specific regression evidence; authenticated Elementor/booking/payment/dashboard tests. Anonymous six-page/171-asset smoke from earlier checkpoint was green but is not transaction UAT. Do not claim these gates completed without evidence.

### 2026-10-24 — npm dependency advisory remediation (lockfile-only review branch)

Security review on canonical `ishinaillab/ishikeit` `main` found 5 advisories (2 high, 2 moderate, 1 low) in npm locked dependencies. `npm audit fix --ignore-scripts` updated only `package-lock.json`, keeping existing `package.json` dependency ranges and application source unchanged.

Verified patched resolved versions: Fastify 5.12.7, Zod 4.6.7, Vitest 4.1.12, `@vitest/mocker` 4.1.12, Vite 8.3.5. `npm audit --json` reported 0 vulnerabilities. Full `npm run check` on Node 24.22.1 succeeded: lint, typecheck, 34 test files / 244 tests, and production TypeScript build. This is intentionally separated from the bridge diagnostics PR #74.

Security branch `fix/dependency-audit-20261024` is proposed only; no running Hostinger application, provider account, Supabase table, or WordPress installation was changed as part of this dependency audit. Review CI and deploy through the established audited release workflow.

### 2026-10-24 — WordPress AI Bridge diagnostic error-code classification (proposed, not deployed)

October 20 production forensics: the `/wp-json/ishi-ai/v1/turn` path showed HTTP 502, 522 and 525 responses. The WordPress bridge *itself* returns JSON HTTP 502 on AI Engine exceptions, invalid AI results and empty chatbot replies; `edgeResponseStatus=502` and `originResponseStatus=502` alone do not prove a hosting gateway outage. Cloudflare also showed non-bridge origin connection/TLS errors. Do not conflate the two classes without origin logs. The published 2026-10-24 operational review is stored on the separate `checkpoint/operational-review-2026-10-24` branch.

This proposed app-only diagnostic change:
- In `src/brain/wordpress.ts`, on a failed HTTP bridge response, validate the JSON response's `code` against `^ishi_ai_bridge_[a-z0-9_]{1,64}$` before adding it to the `ProcessingFailure` message. Ignore arbitrary codes, body text, URLs, tokens and provider messages.
- Preserve existing HTTP status, retryability and Retry-After behavior. Do not parse non-JSON HTML Cloudflare error pages.
- Add unit tests covering genuine `ishi_ai_bridge_ai_failed` 502 and arbitrary/private upstream data redaction.
- No customer messages are sent, no dead letters are replayed, no WordPress plugin, database, or Hostinger production settings are modified in this PR. Before deploying, confirm Node 24 CI, idempotency/retry regression coverage and build.
- Authenticated `GET /ishi-ai/v1/health` uses a separate bearer token; an ordinary WordPress admin/application password is not that token.
- Remaining gates: Hostinger/PHP-FPM historical logs, authenticated bridge canary, production SHA, test-account end-to-end messaging, TikTok provider approval. TikTok Comment-to-Message remains gated and unmerged in draft PR #71.

### October 24 — Compiled build identity for Hostinger deployment provenance (review branch)

The public `/health/live`, `/health/ready`, and `/health/capabilities` endpoints establish service health and runtime features but **do not identify which GitHub commit Hostinger is running**. Hostinger's official Node.js deployment guidance identifies the authoritative build history under **hPanel → Node.js website → Deployments**, with the active compiled files typically under `hbuilds/current/nodejs`: https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/ .

Review branch `feature/runtime-build-identity-20261024` adds a noncached `GET /health/build` returning a nonsecret SHA-256 of the deployed *compiled JavaScript* and an optional source revision (only when the build environment explicitly provides a valid 40-character `SOURCE_COMMIT_SHA` or `GITHUB_SHA`). The digest is computed once on startup from a sorted list of compiled `.js` files, normalizing line endings. It deliberately never reads `.env`, credentials, customer messages, database rows, npm files, or source map files. A null artifact digest means unavailable and must never be interpreted as a verified deployment. A non-null digest can be compared with the exact same independently built artifact; it is not by itself an attestation of the GitHub commit SHA or evidence of which Hostinger deployment ID is live.

The release must still verify Hostinger's successful build revision in hPanel and compare live build fingerprint with a known Git revision build. No WordPress, Cloudflare, external provider, database, or customer configuration changes are included. Keep this as a separate reviewed change; do not claim it is already deployed merely because GitHub CI is green.


### October 24 — Deployment artifact digest in GitHub CI

After review and squash-merge of [PR #77](https://github.com/ishinaillab/ishikeit/pull/77) to `main` as `61d2c61abce13faef293520d1a417cd9c1564a5e`, Hostinger's `GET https://apps.ishinaillab.com/health/build` initially returned 404, then became available with a non-null `artifactSha256` and `sourceRevision:null`. This establishes rollout of the diagnostic endpoint, but not yet byte-for-byte parity with GitHub's compiled artifact. The live digest observed on 2026-10-24 PHT was `33e993774075a73bfc48be2ba1495f820ad9653e3793e2f8e829d5ca0c7c18a8`. Public liveness and readiness remained healthy.

To make artifact verification reproducible, review branch `ops/artifact-fingerprint-ci-20261024` adds a Node 24 CI step after `npm run check` that loads `dist/observability/build-identity.js`, fails if the SHA-256 is unavailable, and prints only `ISHIKEIT_ARTIFACT_SHA256=<64 lowercase hex>`. No credentials, source files, customer data or app settings are included in this output. Compare the CI result to the *fresh* public `/health/build` response; only an exact match supports compiled-JavaScript parity, and this is still not a substitute for Hostinger's deployment log or confirmation of its Git commit SHA. Build reproducibility may be affected by platform/toolchain differences, so a mismatch is diagnostic evidence, not proof of tampering. This workflow change does not touch runtime code or enable TikTok features.

### TikTok Business Messaging Comment-to-Message — implementation branch

Credential-independent Business Messaging work continued on `feature/tiktok-comment-to-message` / draft PR #71. Production remains unchanged.

Provider contract used by this milestone:

- TikTok's current Business Messaging documentation lists Comment-to-Message as a first-class Direct Messages capability with separate enable/disable and status operations;
- the v1.3 provider contract uses `/open_api/v1.3/business/message/direct_reply/get/` and `/open_api/v1.3/business/message/direct_reply/update/` with `direct_reply_type=COMMENT_TO_MESSAGE`;
- enabled accounts can receive the `im_receive_high_intent_comment` webhook event containing the comment identifier/text and a stable user identifier;
- a private comment reply is submitted through the existing Business Messaging send endpoint using `direct_reply.reply_type=COMMENT_REPLY` and `comment_reply.comment_id`, rather than a conversation recipient;
- this milestone intentionally keeps Comment-to-Message direct replies text-only and treats provider eligibility/policy rejection as a provider failure rather than bypassing TikTok controls.

Implemented boundary:

- adds a TikTok Comment-to-Message client/controller with provider status read, enable/disable update, desired-state comparison, explicit reconcile, and post-update read-back verification;
- adds optional `TIKTOK_COMMENT_TO_MESSAGE_ENABLED`; when unset, Ishikeit does not expose the Comment-to-Message management service and does not mutate provider configuration;
- management requires the existing Business Account OAuth credential, `TIKTOK_BUSINESS_ID`, and protected ops bearer authentication;
- protected routes are `GET /ops/tiktok/messaging/comment-to-message/status` and `POST /ops/tiktok/messaging/comment-to-message/reconcile`;
- normalizes `im_receive_high_intent_comment` into canonical `messaging / comment.high_intent.received` events with stable comment-event deduplication and user-scoped partition ordering;
- routes those events through the existing WordPress AI turn boundary rather than a TikTok-only AI pipeline;
- emits a distinct provider action `tiktok / messaging / comment_to_message.reply` so TikTok direct-reply semantics do not pollute generic `message.send`;
- the TikTok action adapter sends one text reply through the provider's `direct_reply` payload and rejects non-text output or cross-account targets;
- generic TikTok conversation text/image messaging remains unchanged;
- no database migration and no provider activation are part of this branch.

Safety and activation:

- the feature is dormant by default because `TIKTOK_COMMENT_TO_MESSAGE_ENABLED` is optional and intentionally absent from the active production configuration;
- the high-intent-comment handler and `comment_to_message.reply` adapter are registered only when the desired state is explicitly `true`; `false` keeps execution off while still allowing the protected control plane to reconcile TikTok's provider setting to disabled;
- no startup auto-reconcile was added; provider mutation occurs only through the authenticated reconcile operation after an operator deliberately configures desired state;
- TikTok remains the source of truth for account, geography, age, comment-window, prior-reply, and conversation eligibility; Ishikeit does not attempt to bypass provider restrictions;
- production activation still depends on TikTok Business Messaging approval, Business Account authorization/eligibility, explicit environment configuration, provider status read-back, and a controlled live canary.

TDD evidence:

- the first PR commit (`627db1aa7440ed5850f86424a7433b1785d63a8c`) contained only the new Comment-to-Message tests and produced the expected failing CI run before production implementation;
- implementation then added the provider control plane, high-intent webhook normalization, direct-reply sender/adapter, AI event handler, protected ops routes, environment validation, runtime capability marker, and process wiring.

Verification state at this checkpoint:

- the initial test-only commit produced the expected RED CI result before production implementation;
- strict test-fixture lint findings and the exact runtime-contract regression exposed during implementation were corrected without weakening repository checks;
- Node 24 CI is green through the full `npm run check` gate: lint, typecheck, 35 test files / 252 tests, and build;
- PHP lint is green;
- context-continuity is green after this durable checkpoint update;
- the feature remains credential-independent in CI; live TikTok provider eligibility, status read-back, high-intent-comment ingress, and direct-reply canary are intentionally unverified until Business Messaging access and the Business Account are activated;
- draft PR #71 remains unmerged and undeployed.


### 2026-10-24 — TikTok automatic messages read-only foundation (stacked branch)

After refreshing Comment-to-Message PR #71 with latest `main`, new stacked branch `feature/tiktok-automatic-messages-read-20261024` adds a **dormant, unregistered** client `src/messaging/tiktok-automatic-message-read.ts` and isolated mock-based tests. There are no new HTTP routes, environment flags, outgoing business messages, DB migrations, or TikTok provider settings writes.

The read client is explicitly scoped to TikTok's **Business Messaging** `business/message/auto_message/get/` API, not Ads Manager's distinct `creative/auto_message` advertising template API. It accepts an existing authorized business ID and one access-token source, requests an automatic-message type, and returns only identifier/status/review metadata. It never logs/returns configured welcome text or private content. It rejects mismatched business IDs, malformed replies, unrecognized message types, missing authorization and invalid review states; provider errors retain sanitized codes but not body text.

Provider documentation:
- TikTok Business Messaging API v1.3 docs enumerate automatic-message create/update/status/get/delete/sort; private data/security review and approved API access required.
- Official update contract: https://business-api.tiktok.com/portal/docs/update-the-automatic-message-for-a-business-account/v1.3
- Official onboarding: https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3
- `has_advanced_access=true` or Verified Business Account and adult account owner requirements must be confirmed; TikTok automatic-message moderation/status `REVIEWING` must be respected.
- Until the exact `get` endpoint contract has been independently live-verified for the authorized business account, treat provider fields/request compatibility as mock-tested only and never activate automatic mutations on the strength of this code.

**Gates:** Parent Comment-to-Message PR #71 remains draft/unmerged. This stacked branch must remain draft and must not deploy before parent approval, compatible API access, authorized test-account canaries and post-approval readbacks. Next build phases: capability readback; provider-native create/update/enable/delete/sort with explicit desired-state and moderation-aware control plane; welcome/suggested-question/chat-prompt/follower variation validations; conversation unlock; reconciliation/backfill. Keep each phase feature gated and provider-neutral.


#### October 24 retrieval-contract discrepancy and fail-closed correction

Provider-integration cross-check uncovered conflicting generated API descriptions of `/business/message/auto_message/get/`: a Go SDK defines a GET request with encoded query parameters, whereas a separate schema-generated catalog labels the same path POST with JSON request parameters. The official TikTok documentation *identifies the endpoint*, but an independently accessible authoritative method table for the GET operation was not confirmed. Do **not** assume that green mock tests establish the live provider's request method.

Therefore `TikTokAutoMessageReader` now requires an explicit `transport: "GET_QUERY" | "POST_JSON"` on construction and rejects missing/unknown transport instead of guessing. Both branches call only the account-level `auto_message/get/` retrieval endpoint, never a provider mutation path; the POST variant carries parameters in JSON rather than the URL. Neither transport is configured or instantiated in the app's running HTTP process. This is an internal compatibility gate, **not** provider approval or proof either form works.

References (method conflict to verify with approved account): https://pkg.go.dev/github.com/bububa/tiktok-business/model/business/message and https://mosaic.openpromo.app/reference/tiktok/endpoints/business-messaging/ . TikTok official landing page: https://business-api.tiktok.com/portal/docs/get-the-automatic-messages-for-a-business-account/v1.3 . Require authorized provider-specific readback and update the integration notes with exact verified request/response before registering live routes or automated settings changes.
### October 24 — WordPress AI Bridge: classify future upstream exceptions without disclosing them (review branch)

Cloudflare historical GraphQL analytics for `/wp-json/ishi-ai/v1/turn` on 2026-10-20 UTC reported 47 origin-generated 502s (edge 502/origin 502), 2 edge 525s (origin 0), 1 edge 522 (origin 0), and 2 successes. Failures peaked at 14:00 UTC (42 of the 47 origin 502 responses). Supabase `public.inbound_events` failed rows on Oct20 show six Telegram, two WhatsApp and one Messenger with `last_error` mentioning HTTP 502, plus one WhatsApp 522. `outbox_attempts` labels these attempts `processing_failure`, including retry/dead-letter events. These are attempt counts, not unique customer messages.

Verified active production `Ishi AI Bridge` plugin v0.3.0 `includes/class-ai.php`: `simpleChatbotQuery` exceptions cause `ishi_ai_bridge_ai_failed`, HTTP 502, while logging only a generic marker and hashed reference. Successful AI Engine chatbot calls occurred later on Oct20 and on Oct23; the root exception from the failed Oct20 calls was not preserved in the currently accessible WordPress log. Thus the precise upstream root cause is unknown, although the origin PHP bridge / AI Engine chain is implicated.

On dedicated review branch `fix/ai-bridge-safe-failure-categories-20261024`, plugin version prepared as 0.3.1 (storage schema still 1.1.1). It never records provider exception messages, arbitrary classes, API keys, request bodies, or customer input; it maps bounded throwable messages to fixed enums `rate_limit`, `quota`, `authentication`, `timeout`, `transport`, `upstream`, `runtime`, or `other`, preserving old HTTP status and error codes, hashed reference, auth, retries, claims, and storage semantics. Applies to AI query, file upload, and transcription catch blocks. New `tests/php/ishi-ai-bridge-diagnostics.php` runs independently of WordPress/providers: verifies category mapping, sanitized logs even with fake credentials/messages, successful reply contract, and media error behavior. CI PHP job now executes this PHP test after lint.

This is **future observability only**; it does not retroactively reveal Oct20's exception or repair an unknown underlying AI Engine configuration/availability problem. No live WordPress plugin upgrade or customer messaging test executed by merely committing the branch. Before a production plugin deployment: green PHP + Node CI, test-account bridge health and canary with dedicated bearer token, backup/rollback, then verify plugin v0.3.1 and no customer regression. Never activate / disable plugins or alter AI Engine settings solely based on inconclusive historical codes. Historical 43 dead letters remain unreplayed.


### October 24 — fast-uri transitive advisory closure

After PR #79's WordPress bridge diagnostic change, a fresh `npm audit` disclosed one newly published/reviewed moderate advisory in transitive `fast-uri` (GHSA-w74x-v6f9-j3xg, CVE-2026-110306, URI scheme spoofing via percent-encoded schemes). Four resolved lock entries in Fastify's validators used affected `fast-uri` 3.1.8 or 4.2.1. Official fix versions 3.1.9 and 4.2.3 are available. See https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg and https://github.com/fastify/fast-uri/releases/tag/v4.2.3 .

Security-only branch `fix/fast-uri-security-20261024` changes ONLY `package-lock.json` (four transitive versions/integrity references: 12 added/12 removed lines), leaving `package.json` and application source unchanged. Official `npm audit fix --package-lock-only --ignore-scripts` produced `npm audit: 0 vulnerabilities`. Isolated Node 24 validation passed full `npm run check` with **35 test files / 250 tests**, lint/typecheck/build green, and `npm ls fast-uri` confirms 3.1.9 and 4.2.3 only. Review/merge this patch separately before refreshing the default-off outage recovery PR #80. Changes in the lockfile alone are not proof the live Hostinger runtime has installed them: check deployment artifact/installed packages after deployment; do not alter WordPress credentials or messaging state.


### October 24 — Runtime confirmation of installed npm patches

Security PR #81 patched `fast-uri` in `package-lock.json` to 3.1.9 (three nested locations) and 4.2.3 (root). Compilation SHA-256 parity across Hostinger and CI does not attest the *installed* `node_modules` tree, nor that Hostinger ran `npm ci` after the lockfile update.

Diagnostic PR `ops/installed-fast-uri-provenance-20261024` adds `installedFastUriSha256` to the existing noncached `GET /health/build` response. The fingerprint reads only `name` and `version` from four expected *installed* `fast-uri/package.json` paths under the app's runtime `node_modules`, sorted by a fixed list and NUL-delimited before SHA-256. It never reads `package-lock.json` to infer installation, nor any .env/key, customer message, database, runtime env variable, package file content beyond the fixed metadata. Missing paths, changed npm hoist layout or unexpected metadata produce `null` with no startup/health failure; the response exposes only a hash, not package versions or full directory paths. This fingerprints metadata **not dependency executable bytes or provenance**.

CI Node 24 step after `npm ci --ignore-scripts` and `npm run check` explicitly validates that all four installed paths have patched `fast-uri` 3.1.9/4.2.3, fails if missing, and logs only `ISHIKEIT_INSTALLED_FAST_URI_SHA256=<digest>`. Comparing it against a fresh live `/health/build.installedFastUriSha256` establishes installed package-name/version metadata parity for those four paths; it does **not** verify npm package code integrity or a specific Hostinger hPanel deployment ID/commit SHA. An absent/mismatched live digest is an unverified result; investigate Hostinger installation, do not claim patched runtime. This release makes no WordPress plugin, TikTok, OAuth, database or customer messaging changes.


### October 24 — reproducible Ishi AI Bridge plugin bundles (non-deploying)

The canonical source contains WordPress plugin `ishi-ai-bridge` v0.3.1 with sanitized exception categories, validated by PHP lint and mock provider-free PHP tests (PR #79), while the **active WordPress site still reports v0.3.0**. Production plugin ZIP replacement is not yet available through a verified controlled installer: WPVibe's CLI emulator supports WordPress.org slug installs and updates, WordPress.com lists no authorized sites, and Ishi Local Agent connections are intermittently unavailable. The bridge `/health` correctly rejects WP admin credentials with 401 unless its independent bearer is supplied; never bypass authentication.

Review branch `ops/ishi-ai-bridge-reproducible-bundles-20261024` adds `.github/workflows/ishi-ai-bridge-release.yml`, triggered on changes to plugin source/workflow, and manually dispatchable. After PHP lint and the secret-free exception test it creates two version-stamped WordPress-installable ZIPs using `git archive` from an **allowlist of seven PHP source files**, plus a SHA256 manifest and a warning/rollback README. HEAD bundle is `ishi-ai-bridge-0.3.1.zip`. Baseline rollback bundle is `ishi-ai-bridge-0.3.0-repository-baseline-rollback.zip` built from canonical historical commit `b8a2a482d10e59d54d7aa04bc216e148bb7c826c`. This historical source is **not yet verified byte-for-byte against current production plugin files**; validate an independent production backup/restore path before replacing the plugin. Artifact uploads use official Node24 `actions/upload-artifact@v7`, retention 90 days, with contents limited to two ZIPs, SHA256SUMS.txt, ROLLBACK_README.txt.

The workflow NEVER uploads code to WordPress, changes live configuration, invokes AI, or sends messages. The generated bundle is a release candidate, not a deployment. Next: confirm review CI artifacts and checksums; find a supported authenticated custom-plugin update + backup/rollback channel; deploy only with QA, and run an authorized test-account AI Bridge bearer canary with zero real-customer sends. Keep outage retry PR #80 and TikTok draft PR #71/#76 inactive.


### October 24 — private WordPress AI Bridge health-only canary

Active WordPress `Ishi AI Bridge` v0.3.0 already implements bearer-authenticated `GET /wp-json/ishi-ai/v1/health`; the response has fixed booleans `tokenReady`, `aiEngineReady`, `fileApiReady`, `audioApiReady`, `ok`, versions and an internal botId. A WP admin WordPress REST credential alone returns HTTP 401 because a **separate dedicated bridge bearer token is required**; do NOT bypass authentication. The current session lacks a supported authenticated Hostinger terminal or bearer access: Ishi Local Agent / Refresh Test both returned internal tool failures, and a connected WordPress.com/Jetpack installer is unavailable. Source packages and rollback candidates from [PR #83](https://github.com/ishinaillab/ishikeit/pull/83) have been validated and built but have NOT been installed.

Review branch `ops/private-wordpress-bridge-probe-20261024` adds `scripts/probe-wordpress-ai-bridge.mjs`, an explicitly read-only health-only probe intended for a trusted authorized runtime, with existing server-side environment `WORDPRESS_AI_BRIDGE_URL` and `ISHI_AI_BRIDGE_TOKEN`. It only permits the exact canonical `https://www.ishinaillab.com/wp-json/ishi-ai/v1` origin/path with no query/fragment, uses bearer-authenticated HTTPS GET `/health` with timeout, redirects disabled and no-store. It never calls /turn, /files, /transcribe, AI providers or customer messaging APIs. Response parsing is capped at 4KiB; outputs only allowlisted booleans, version/schema and coarse status, never botId, tokens, raw exception messages or response bodies. Missing/invalid tokens and noncanonical origins fail before fetch; HTTP and transport errors have sanitized classifications. `scripts/test-probe-wordpress-ai-bridge.mjs` uses mock fetch only, includes unready/fault/secret-leak/excessive body cases, and runs in Node24 CI before package provenance verification.

To use after authorized connection to **Hostinger's existing runtime only**, run `node scripts/probe-wordpress-ai-bridge.mjs` from the app root where the two secret env vars are already provisioned; do not place the token in shell history or chat. Expected `ok:true`, `aiEngineReady:true`, `tokenReady:true`, `schemaVersion:1.1.1` before a separate authorized test-account /turn canary. This script is not proof of a successful AI generation, does not repair historical Oct20 errors, and must not be called against real customer messages. The WordPress plugin v0.3.1 deployment and PR #80 delayed-reply rollout remain gated by verified backup, custom-plugin installer and handoff policy.


### October 24 — Hostinger/WordPress v0.3.1 deployment route clarified; still gated

Official Hostinger help confirms hPanel Websites → Dashboard → Backups → **Create Backup** supports on-demand full hosting-files/database snapshots for eligible Business-or-higher plans; actual Ishikeit hosting tier and successful current snapshot unverified. Existing automatic Hostinger backups may exist independently of UpdraftPlus's manual setting; do **not** conflate the two. Hostinger File Manager supports archive/ZIP upload and extraction. WordPress Admin → Plugins → Add New → Upload Plugin → existing-plugin **Replace current with uploaded** is a legitimate custom-plugin ZIP update route even without SSH, but it requires an interactive signed-in WordPress browser session, absent in these connected content APIs. Source: https://www.hostinger.com/support/2298928-how-to-create-backups-at-hostinger/ ; https://www.hostinger.com/support/5981435-how-to-download-backups-at-hostinger/ ; https://wordpress.org/documentation/article/manage-plugins/ .

[docs/WORDPRESS_AI_BRIDGE_RELEASE_RUNBOOK.md](WORDPRESS_AI_BRIDGE_RELEASE_RUNBOOK.md) now provides exact approved backup/current-plugin-file verification, SHA256 release ZIP, WordPress admin upload, dedicated-bearer GET-only health probe, authorized provider tester canary, and *plugin-only* rollback steps. It explicitly forbids restoring an old WordPress database without protecting intervening LatePoint bookings/WooCommerce orders and forbids deploying to production without current successful backup and supported interactive installer. This is documentation only; no production plugin upload or rollback occurred.

---

## 2026-10-26 — fail-closed TikTok message-history isolation

- Building on latest `main` (47a6f2ce0c809061ee6d69e3a701820d0d183c95);
  PRs #71/#76 are merged, and TikTok Business Messaging is still inactive.
- Detected a cross-conversation isolation gap in the dormant TikTok history
  read adapter: returned message conversation IDs were not checked against
  the requested conversation. Verified a failing regression test first.
- Reject the **entire** message-history response on a mismatch, including
  partially malformed foreign items. Error metadata does not expose
  private conversation IDs, texts, or credentials.
- Preserve valid same-conversation and empty history behavior; no database
  migrations, OAuth, webhook, provider writes, replay, or runtime startup edits.
- See docs/TIKTOK_HISTORY_ISOLATION_2026-10-26.md for regression proof and
  explicit activation/production safeguards. PR #93 remains separate
  and unmerged; do not accidentally bundle its working-tree changes.

---

## 2026-10-27 — opt-in read-only TikTok Messaging API live probe

- New draft PR #95 based on unchanged main, independent of PRs #93 (local
  authorization preflight) and #94 (conversation-history isolation).
- Existing encrypted TikTok owner OAuth credential can be used for one
  **operator-invoked** GET of the official Business Messaging conversation
  list (SINGLE, limit 1), without setting TIKTOK_BUSINESS_ID.
- New protected route /ops/tiktok/messaging/availability-probe is registered
  with existing OAuth and OPS_METRICS_TOKEN, but never called during startup.
  It returns only sanitized acceptance/rejection/prerequisite statuses and
  bounded numeric provider codes, not token or conversation contents.
- No OAuth refresh, messages sent, webhook writes, account activation,
  database changes, dead-letter replay, or new environment variables.
- Node 24 full checks: 39 test files / 281 tests, lint/typecheck/build
  passed; production npm audit found zero vulnerabilities.
- **Live provider check is not yet performed.** Windows environment lacks the
  existing OPS_METRICS_TOKEN and Hostinger masks it. Requires reviewed CI,
  controlled deployment, then one call from an existing authorized ops
  environment without exposing credentials. Denial must not be bypassed.
- Operational guide: docs/TIKTOK_MESSAGING_LIVE_PROBE_2026-10-27.md

## TikTok stored-account OAuth refresh repair (2026-10-27)

- The protected messaging availability probe previously returned `access_token_expired` because it did not refresh credentials. A single TikTok OAuth credential was verified in the store, with a refresh token available, while production `TIKTOK_BUSINESS_ID` remains unset.
- Branch `fix/tiktok-refresh-from-stored-account` adds optional locked refresh through the existing `TikTokAccessTokenManager`, using the **single stored credential's account ID**. The protected probe may now persist refreshed OAuth credentials; it must never be described as strictly read-only. It still does not enable messaging, send messages, or change webhooks.
- Do not replace Hostinger's full environment variable set merely to add `TIKTOK_BUSINESS_ID`. Do not enable outbound TikTok messaging until the provider confirms entitlement and account mapping.
- Verify CI, merge/deploy, protected probe result, and provider authorization independently. If the provider rejects the probe, keep TikTok messaging disabled.

## TikTok provider rejection diagnostics (2026-10-27)

- Refreshed TikTok OAuth succeeded; the protected messaging availability probe returned `provider_rejected` with TikTok numeric code `40000`.
- The probe now returns a narrowly categorized provider error (`permission`, `scope`, `account`, `parameter`, `authentication`, `other`) derived from TikTok's response message without returning raw message, identifiers, or tokens. Use this to distinguish missing access from request formatting; do not enable outbound on any rejected result.

## TikTok provider-API redirect hardening (2026-10-27)

- Security audit identified default HTTP redirect following on fixed-host TikTok credential-bearing requests (owner OAuth, Business Messaging reads/sends, webhook configuration, Comment-to-Message, automatic-message reads, Marketing OAuth, advertiser reads and media API calls). Hardened each to `redirect: "error"` so a redirected host cannot receive sensitive custom headers, OAuth payloads or messages. Existing deliberately manual untrusted-media redirects remain unchanged.
- Added request-option regression assertions and updated stale probe documentation. See `docs/TIKTOK_STANDARDS_SECURITY_REVIEW_2026-10-27.md` for current official v1.3 Business Messaging prerequisites and activation gates. TikTok Marketing/Reporting v2.0 documentation does not justify changing the Messaging API version.
- The live Messaging API error category `scope` is an **inferred message classification**, not proof of specific approved or missing permissions. Existing owner token contains no explicit Messaging scope. Keep `TIKTOK_BUSINESS_ID` and TikTok outbound disabled until separate Messaging API approval, owner reauthorization and eligible-account verification are confirmed.

## TikTok parked pending Business Messaging API approval (2026-10-27)

- Owner is submitting TikTok Messaging API application for `ishikeit`. TikTok development is paused at the external approval/owner-consent gate while Messenger, Instagram and WhatsApp development continues. The exact current technical and operational TikTok state, merged PR #100, deployed commit `0558f4a`, live diagnostic result, authorization scope caveat, safeguards, and ordered post-approval checklist are recorded in **`docs/TIKTOK_APPROVAL_WAIT_HANDOFF_2026-10-27.md`**. Read that checkpoint and reconcile it against live `main`/production when TikTok approval arrives.
- Do not activate TikTok outbound, set `TIKTOK_BUSINESS_ID`, alter TikTok webhooks or replay historical messages during the wait. Preserve all working channels and secret-bearing configuration.

## Meta Messenger / Instagram / WhatsApp outbound redirect hardening (2026-10-27)

- Meta Graph outbound `message.send` requests now use `redirect: "error"`, preventing automatic forwarding of bearer tokens and message payloads if Graph responds with a redirect. Regression assertions cover Messenger and Instagram; shared Meta sender applies to WhatsApp as well.
- Verified with local `npm run check` (lint, typecheck, 284 tests and build) before publishing the branch. This does **not** implement the still-required platform-specific customer-service window guard, delivery-state lifecycle, WhatsApp template support, handover coordination or Advanced Access approval. Preserve working Meta and TikTok routes; do not enable policy-gated features without tests.

## Meta standard 24-hour reply window guard (2026-10-27)

- Automated replies generated from signed Messenger, Instagram and WhatsApp inbound messages now carry the provider's original `occurredAt` timestamp as `customerMessageAt` in the durable action. The Meta dispatch adapter re-checks age immediately before each send/retry, rather than only when the AI first responds.
- Standard reply policy is **fail closed**: no timestamp, malformed timestamp, timestamps more than five minutes in the future, and customer messages at least 23h55m old all produce a permanent no-send failure. The five-minute margin is deliberately conservative to avoid sending at the provider's 24h boundary. Legacy queued Meta actions without the new field will be dead-lettered rather than sent. This is an operational tradeoff; inspect old queues before deploying, and do not replay dead letters automatically.
- This policy covers standard replies only. It does **not** grant HUMAN_AGENT tags, extended Instagram windows, outbound marketing, WhatsApp templates or opt-in. No templates are sent, no provider settings changed. Existing Telegram/TikTok message action schemas are unchanged.
- Regression tests cover boundary conditions, fail-closed Meta adapter and durable timestamp propagation. Validate full CI and inspect production queue state before release.

## Meta pre-AI expired-window guard (2026-10-27)

- In addition to the mandatory dispatch-time 24h guard, `MessageReceivedHandler` now ignores Meta messages whose provider timestamp is missing, implausibly future, or outside the conservative standard customer-service reply window. This prevents unnecessary AI processing and futile outbound dead letters for delayed/replayed webhook events. Non-Meta providers are unaffected. Existing dispatch-time check remains the final authority for queued retries.
- Regression tests include stale and untimestamped Meta messages and deterministic clock control. Do not interpret this as permission to send WhatsApp template messages or Messenger HUMAN_AGENT tagged messages.

## Explicit WhatsApp template dispatch capability (2026-10-27)

- Added an explicit `meta/messaging/message.template.send` action adapter, registered only when a WhatsApp access token is configured **and** `META_WHATSAPP_TEMPLATE_DISPATCH_ENABLED=true`. The flag defaults to false and is not set in production. It validates WhatsApp-only target, numeric phone-number ID and E.164-style recipient digits, template name, language code, and up to ten text body parameters. The Graph request uses `type: template` with `template.name`, `template.language.code`, optional `components` and `redirect: "error"`. Provider rejection is sanitized; retry semantics match Meta standard sender.
- Ordinary AI replies still use `message.send` and remain subject to the 24h standard reply guard. The AI does **not** generate template actions. Template sends require an explicitly enqueued action and must have separate consent/opt-in, approved template, correct template parameter mapping and account ownership verification upstream. No scheduled reminder automation or automatic outbound campaign is enabled by this change. Do not turn on the flag until an upstream consent/opt-in gate, approved template inventory and account-specific recipient authorization are implemented and tested.
- Tests cover template wire shape, redirect rejection, invalid targets and names. Do not send `hello_world` to customers as a booking reminder; create and obtain approval for real booking templates first.

## Meta delivery event metrics (2026-10-27)

- Protected operational metrics now aggregate Meta signed-webhook `delivery.sent`, `delivery.delivered`, `delivery.read` and `delivery.failed` events by Messenger, Instagram and WhatsApp channel in the selected time window. Uses the existing durable `inbound_events` table and returns counts only, never customer IDs or message contents. This reports **observed events**, not unique recipients, delivery rates or guaranteed per-message lifecycle; some platforms do not emit every status.
- Outbox already persists the provider's message ID in published action `payload.delivery.providerResourceId`. A future delivery lifecycle projection can correlate status events to outbound actions using provider, channel, account ID and provider message ID. Do not interpret a successful Graph HTTP response as customer delivery.

## Meta delivery lifecycle reconciliation (2026-10-28)

- Focus remains **Messenger, Instagram, WhatsApp only**. TikTok Business Messaging stays parked pending provider approval; do not touch or activate its pipeline, OAuth, webhooks or production flags.
- Messenger webhook `delivery.mids` can name multiple outbound message IDs. Normalization now emits a separate, deduplicated `delivery.delivered` event for each message ID (bounded to 100 IDs per callback). This allows matching Messenger receipts to an outbox provider message ID instead of leaving every batch uncorrelated; callbacks without `mids` retain their legacy summary event.
- Protected operational metrics `delivery.outboundLifecycle` now joins published Meta `message.send` and `message.template.send` outbox actions to the latest matching durable delivery receipt by **Meta channel + exact account ID + exact provider message ID**. Counts are grouped by channel and status, including `unconfirmed` for provider-accepted sends lacking a matching receipt. Correlation never uses customer text or cross-account fallback.
- `unconfirmed` is not an assertion of failed delivery: Messenger/Instagram webhook availability differs by account, permissions and message type. The metric cohorts outgoing actions published in the selected window and examines all recorded receipts. Do not equate successful Graph HTTP acceptance with delivered/read.
- No new table, replay, webhook changes, queued sends, TikTok edits or Meta permission mutations. CI and production deployment must be verified independently. Follow-up: design scalable per-conversation handover ownership, explicit WhatsApp opt-in template approval and real tester-originated canaries.

## Instagram OAuth-only routing hardening (2026-10-28)

- **Meta messaging scope only:** Messenger, Instagram and WhatsApp development continues. The separate TikTok messaging approval gate is unchanged.
- Fixed a mismatch between the documented Instagram OAuth-only production rule and the router implementation: when a durable Instagram OAuth provider is configured, an unmapped account now returns no credential rather than falling back to the legacy App Dashboard managed token. Existing OAuth revocation failures remain fail-closed, and explicit managed-token-only installations still support the one validated account.
- Startup reconciliation of the managed-token webhook subscription is skipped while the OAuth provider is configured. Durable OAuth account aliases and subscription reconciliation remain active. This reduces risk of stale token use or unintended account subscriptions.
- Production evidence before release: one unexpired Instagram OAuth credential and one Professional-account alias in `ishikeit-db`; no customer message was sent by this change. Run CI, deploy, and verify health before treating the fix as active. Advanced Access/App Review remains an external Meta approval requirement.

## Durable Meta AI-to-human handoff (2026-10-28)

- Work is **only** on Facebook Messenger, Instagram and WhatsApp. Separate TikTok Messaging API approval remains pending, and no TikTok route, OAuth, flag, schema or webhook is changed by this feature.
- New private `public.meta_handoff_blocks` table (migration `migrations/0003_meta_human_handoff.sql`) retains only the **SHA-256 conversation partition key**, normalized handoff reason and open/released timestamps. RLS is enabled, and `anon`/`authenticated` grants are revoked. No customer message bodies or raw Meta identities are added to the table.
- When the AI requests human handoff on a Meta `message.received` event, the handoff block is atomically persisted together with the inbound processing outcome. Subsequent messages in the same provider/channel/account/customer conversation are ignored by the AI until an operator explicitly releases the block. The existing dispatch-time 24-hour Meta messaging guard remains in force after release; release cannot authorize out-of-window replies. No historical handoffs or dead letters are replayed.
- Protected release operation `POST /ops/meta/handoff/release` requires the existing `OPS_METRICS_TOKEN` bearer and strict JSON body `{"channel":"instagram|messenger|whatsapp","accountId":"...","identityId":"..."}`. It derives the exact conversation hash internally; the client does not supply arbitrary partition keys. Response is `released` or `not_active`. **Release only after a human operator has finished handling the conversation**; no automatic reopening timer or external thread-control takeover is assumed. Normal Meta Handover Protocol `pass_thread_control` callbacks indicate ownership changes and are NOT mistaken for an explicit AI-to-human block.
- **Deployment order is mandatory:** merge reviewed tests; apply migration 0003 to active `ishikeit-db` using Supabase migration tooling; verify table/RLS; then deploy GitHub main via Hostinger and prove `/health/ready` and `/health/live`. Database readiness now depends on the table. Never deploy before migration, or clear unprocessed events to make health look ready.
- Protected bearer must exist for operational release; its presence in production was confirmed by key name without reading its masked value. Test unauthorized, malformed and successful releases before staff use. Do not insert any fake customer handoffs into production.

## WhatsApp interactive reply normalization (2026-10-28)

- Meta WhatsApp inbound customer `interactive.button_reply`, `interactive.list_reply` and legacy `button` events now carry their user-visible selected button/list title as a provider-neutral text content part, while retaining the original structured Meta payload. This makes an actual customer button tap readable to the existing WordPress AI Bridge without fabricating a new message or re-sending prior content.
- The change does **not** create outbound marketing, install templates, send prompts, change WhatsApp account config or bypass the 24-hour standard response guard. No TikTok functionality was changed.
- Regression tests cover all three reply formats and preserve durable webhook deduplication by `wamid`.

## Meta precise message read receipts (2026-10-28)

- Instagram `messaging_seen` / `read.mid` and any supported `read.mids` payload now persist exact per-message `delivery.read` events for account-isolated correlation with published actions. Duplicate callback retries deduplicate by message ID and webhook watermark. Messenger `read.watermark` without a specific message ID remains an aggregate event and is **not** falsely linked to an outbound message.
- App-level subscriptions seen in Meta DevTools: Page `messages` only, Instagram `messages`, `standby`, `messaging_handover`, and WhatsApp `messages`. Subscribing to additional Page `message_deliveries`, `message_reads` or Instagram `messaging_seen` needs review of app/account permissions and an explicit Meta webhook-subscription change; this code change does not alter provider subscriptions.
- Scope remains only Messenger, Instagram and WhatsApp. No TikTok approval/activation change.

## Meta human-handoff final dispatch guard (2026-10-28)

- Messenger, Instagram and WhatsApp `message.send` actions now query the durable Meta handoff block at the **final outbound dispatch boundary**, using the same hashed conversation ordering key used at inbound ingest. A reply queued earlier cannot be dispatched after an AI-to-human handoff is recorded. A blocked send is a permanent no-send disposition; the system does not retry or replay it later.
- The earlier pre-AI suppression and the 24h customer-service-window gate are unchanged. Non-Meta providers, explicit WhatsApp template actions and native Meta Handover Protocol ownership are not implicitly authorized or modified.
- Tests cover both an active handoff (no provider request) and a normal eligible conversation. Production's private `meta_handoff_blocks` table was created and verified with RLS and no anon/authenticated reads before this change.

## Meta Messenger/Instagram postbacks as guarded customer turns (2026-10-28)

- A real user-initiated Messenger/Instagram `postback` webhook now normalizes the visible button title to a provider-neutral text content part while keeping the full structured `meta.postback` payload for future deterministic routing. Canonical event remains `message.postback`, not a fabricated ordinary DM. Retries deduplicate against the original callback.
- `MessageReceivedHandler` accepts only Meta Messenger/Instagram postbacks (not unrelated providers). The standard 24h response-window check, private durable AI-to-human handoff block, idempotent outbox and send-time policy remain mandatory. AI-requested human handoff from a postback is now persisted atomically as for a customer DM.
- Note: app-level Page `messaging_postbacks` and Instagram `messaging_postbacks` subscriptions are not yet confirmed; this change prepares safe support but does not change Meta app permissions or subscriptions. Do not claim live postbacks unless a fresh tester interaction is observed end-to-end.
- TikTok Messaging API remains parked pending approval; this PR contains no TikTok work.

## Instagram OAuth startup reconciliation diagnostics (2026-10-28)

- Production Hostinger runtime logs showed recurring **Instagram OAuth account routing or webhook subscription reconciliation failed** after otherwise healthy deployments. The old warning did not expose stage/status because Hostinger's API returns message strings only. Do **not** conclude that Instagram outgoing DMs are broken without a fresh tester canary.
- Startup reconciliation now identifies credential lookup, professional account resolution, alias persistence or account-level webhook subscription as the failure stage. Warning messages contain only sanitized error class, numeric HTTP status, bounded provider code, allowlisted provider reason and retryability. No account IDs, token-bearing URLs, raw provider response or confidential credentials are logged in the message.
- Instagram OAuth client requests reject HTTP redirects. The startup reconcile path no longer silently falls back to a stale listed token if the active credential manager returns no authorized token. This preserves strict OAuth-only routing, previous successful client message handling and all other channel settings.
- **Next diagnostic step after CI and deployment:** inspect Hostinger runtime warning **stage/status/reason**, compare to current encrypted Instagram credential expiry and scopes, and resolve the specific account authorization/webhook cause without indiscriminate token rotation. App Review advanced permission and real reviewer screencast remain external gates. TikTok remains parked.

## Instagram production owner routing restoration (2026-10-28)

- **IMPORTANT corrective finding:** actual Supabase read-only join shows 53 Instagram inbound customer messages on one Professional account, but that account matches neither the sole stored Instagram OAuth credential nor its alias. The only stored Instagram OAuth token reports an apparent expiration of December 1 but startup Graph `/me?fields=user_id` returns HTTP 400 / Graph error **190**. A future local expiry timestamp does not prove the token remains valid with Meta. See official Meta access-token troubleshooting: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging/.
- Production retains a configured `META_INSTAGRAM_ACCESS_TOKEN` for a separately managed App Dashboard Instagram Professional account. **Superseding the October 28 OAuth-only assumption:** outgoing routing now gives precedence to a valid exact-account OAuth token; only if the specific account has no OAuth credential may it fall back to a managed token whose Professional-account identity is independently resolved through Meta and equals the webhook account ID. Revoked OAuth grants continue to throw; a managed token is never used for another account. No global/static token fallback is permitted.
- Startup reconciliation again independently validates and subscribes the exact managed Professional account even while a separate tester OAuth grant exists. Log messages include stage/error class/status/code but no access token or account IDs. Inspect post-deploy warning/success to prove whether the managed token is still valid. Do **not** claim customer replies have been restored from unit tests alone; require fresh tester-originated end-to-end proof.
- The unrelated stored Instagram OAuth token returning error 190 may require owner-initiated reauthorization; never forge a token or blindly relabel a tester account alias as the studio's business account. Reviewer material must reflect the real account authorization. This PR affects only Instagram; Messenger/WhatsApp and parked TikTok are preserved.

## Instagram verified owner-to-inbound identity confirmation (2026-10-28)

- PR #115 deployed and Hostinger runtime reported the **managed Instagram Professional account token and webhook subscription reconciled successfully**; separate tester OAuth credential still fails Graph `/me` with HTTP 400, Graph code 190. The managed-token success alone does not prove it is the same account receiving signed customer DMs.
- Added read-only startup comparison of the independently Meta-validated managed Professional account ID with the `inbound_events` account ID from previously signed Instagram customer DMs. Only boolean `historical_signed_inbound_account_match=true|false|unavailable` is logged, without raw account IDs, tokens, message contents or customer identities. A DB failure in the optional check cannot turn an otherwise successful webhook subscription into a misleading failure.
- Next: inspect exact live match status after CI and deployment. If `true`, strict verified-owner routing should cover the actual business inbox; if `false`, an owner-initiated Instagram Business Login for the right account or a correct managed token is required. Do not relabel OAuth aliases or send new customer messages to force a false success.

## Meta native handover and standby ownership safety (2026-10-28)

- Added a provider-specific Meta routing handler for **Messenger and Instagram only**. It handles signed, normalized `standby.*` and `handover.take` notifications as a reason to block Ishikeit AI responses and outbound standard replies in that conversation. An explicit `handover.pass` only releases the native ownership block when `new_owner_app_id` exactly matches configured `META_APP_ID`; unknown or other owners remain blocked. Mere `handover.request` does not grant ownership.
- Reuses the private, RLS-protected `meta_handoff_blocks` table with a separate reason `native_thread_control_other_app`. Native ownership changes **cannot overwrite or automatically release** an active AI-requested human handoff. Customer IDs and message bodies are not stored; the state is keyed by the existing SHA-256 conversation partition. The pre-AI and pre-outbound checks already respect this block.
- Provider callbacks are not fabricated, replayed or manually dispatched. This code does not subscribe new Meta webhook topics. The Instagram `standby` and `messaging_handover` subscriptions exist, while Page `messaging_handovers`/standby subscription still requires verification/authorization before Messenger native ownership can be exercised.
- Tests cover standby, takeover, exact-app pass, unknown/other owners, invalid identity/provider and preservation of manual human handoffs. Verify CI and live readiness before closure. TikTok remains untouched pending Business Messaging API approval.

## Meta shared Graph failure privacy fix (2026-10-28)

- Messenger, Instagram and WhatsApp standard outbound failures no longer copy provider-supplied Graph error descriptions to durable outbox error reasons and operational logs. Errors contain sanitized HTTP status and numeric Graph codes/subcodes while preserving retry and Retry-After handling.
- Test simulates private customer text and an access-token marker in the Graph response and confirms neither is present in the exception message. Explicit WhatsApp template sender already sanitized provider errors.
- This replacement branch is based on latest main after PR #117 became conflict-dirty following parallel Meta work. Scope excludes TikTok and all provider permissions.

## Meta native ownership vs. operator release guard (2026-10-28)

- Fixed a subtle Messenger/Instagram handover authorization gap: the authenticated `/ops/meta/handoff/release` operation can now release **only** AI-requested human handoffs. It may **not** clear `native_thread_control_other_app` blocks owned by Meta Handover Protocol. Only the signed native `handover.pass` event identifying Ishikeit's app as the new owner may release that native block.
- Enforced with an atomic reason-qualified SQL update and an explicit regression test; unknown/released/native blocked conversations return `not_active` without reopening AI replies. No migration or environment mutation required.
- All changes confined to Meta Messenger/Instagram/WhatsApp work. TikTok messaging approval wait remains unchanged.

## Instagram App Review evidence revalidation (2026-10-28)

- Refreshed `docs/meta-instagram-app-review.md` to remove the obsolete assertion that Instagram routing is OAuth-only and that a previously valid OAuth token is currently accepted. Verified production instead uses exact managed Professional-account ownership validation and matching historical signed inbound account ID. The separate tester OAuth grant now returns Graph code 190 (HTTP 400) during account-resolution despite the stored expiry being in the future.
- Meta App Review remains `NO_SUBMISSION`. Do not report Advanced Access approval or send non-role customer DMs without Meta approval. Real reviewer screencast and updated owner consent remain prerequisites; preserve existing credentials and avoid automatic replay. TikTok work is paused separately.

## WhatsApp explicit template sender account and approval hardening (2026-10-28)

- Continued work is restricted to Meta Messenger, Instagram and WhatsApp. TikTok remains parked pending provider Messaging API approval; no TikTok code or runtime flags were changed.
- The **disabled-by-default** WhatsApp approved-template action adapter now requires an exact business phone-number ID (`META_WHATSAPP_TEMPLATE_PHONE_NUMBER_ID`) and a bounded, unique comma-separated allowlist of exact `templateName@languageCode` pairs (`META_WHATSAPP_APPROVED_TEMPLATE_KEYS`). Both must be present with a valid WhatsApp API token before `META_WHATSAPP_TEMPLATE_DISPATCH_ENABLED=true` may parse in production. Invalid/duplicate template keys are rejected. Final dispatch refuses any action whose target account ID or template language is not allowlisted, before making an HTTP request.
- The allowlist is an **additional guard**, not evidence of customer opt-in, appointment consent, current provider approval or campaign authorization. Do **not** enable the template flag until explicit consent evidence and approved utility template inventory are verified; there is no template sender activation or business messaging outreach in this change.
- Existing standard customer replies, signed webhooks and Meta 24h window checks are unchanged. Production Hostinger had no template flag configured in its masked variable-key inventory. Tests include wrong account, wrong template, wrong locale, duplicates and fail-closed configuration.

## WhatsApp template consent evidence and signed STOP opt-out (2026-10-28)

- All new work remains within **Meta WhatsApp**. TikTok Messaging API remains parked pending separate provider approval; its routes, scopes, database records, flags and webhook settings are unchanged.
- Added migration `migrations/0004_meta_whatsapp_template_opt_ins.sql` for a private, RLS-protected appointment-update consent ledger. Every consent row must reference a durable existing inbound event (`source_event_id`); no inference of opt-in from sending an ordinary message and no fake grants. Only an unrevoked, source-backed appointment-update opt-in authorizes this template purpose.
- Consent lookups use a dedicated, per-installation 32-byte `META_WHATSAPP_CONSENT_HASH_KEY_B64` HMAC to derive the recipient key from the exact WhatsApp phone-number ID and destination identity; raw phone numbers/customer message bodies do not go in the consent ledger. The key is required if the disabled-by-default `META_WHATSAPP_TEMPLATE_DISPATCH_ENABLED=true` is later used. Rotating the HMAC key needs a planned rekey or re-consent; never silently rotate it.
- Every explicit `message.template.send` action must now carry `purpose: appointment_updates`, match the exact sending phone, match an allowlisted approved name/language, and pass a **live durable consent check at final dispatch** before the Graph API request. Missing/revoked consent permanently denies sending. This is independent of the existing 24-hour standard reply path.
- On a signed and deduplicated inbound WhatsApp customer `STOP`, `UNSUBSCRIBE`, or `STOP REMINDERS` message, the matching consent is revoked atomically in the same DB transaction as the inbound event, before webhook acknowledgment and before future template sends. Ordinary customer conversations do not grant or revoke consent; only exact opt-out phrases revoke it. No outbound template was sent or enabled.
- **Production release order:** merge only after CI; apply migration 0004 through Supabase to `ishikeit-db`, verify table RLS/grants and no fabricated consent rows; then deploy GitHub main via Hostinger; verify /health/ready, /health/live, queue and no production template flag. Readiness now requires the table. No authentication secrets may be printed or replaced through Hostinger's replace-all masked environment endpoint.
- Outstanding external preconditions before enabling template outreach: real customer consent captured by an authorized flow and bound to signed source events, provider-approved utility templates, exact phone mapping, business messaging policy compliance, and tester canaries. Until that workflow exists, the ledger is empty and the template sender remains disabled.

## Safe Meta long AI reply segmentation (2026-10-28)

- Scope: Messenger, Instagram, WhatsApp only. TikTok Business Messaging remains parked pending API approval; no TikTok code, scopes, webhook or flags changed.
- The shared AI handler now expands overlong **Meta-only** text answers into lossless, grapheme-aligned, deterministic, ordered `message.send` actions before outbox persistence. This respects the existing Meta sender limits: Instagram 1000 UTF-8 bytes, Messenger less than 2000 UTF-16 code units, WhatsApp 4096 UTF-16 code units; it preserves original text and media ordering and maintains the original signed customer-message time on every chunk.
- Each generated chunk receives its own existing stable `inbound-event:reply:index` idempotency key and conversation ordering key. Fail-closed: more than eight actions, or a grapheme too large for an allowed message, triggers a durable `reply_too_long` human handoff, not a truncated or partially queued response. Already existing Meta 24-hour reply and native/human ownership checks continue to apply at each chunk's dispatch. Telegram and TikTok replies are untouched.
- Regression tests cover UTF-8 bytes vs characters, combining graphemes/emoji, text preservation, media order, deterministic idempotency, human handoff and flood limits. CI must succeed before merging. Do not replay historic dead letters automatically.

## WhatsApp explicit STOP acknowledgment without AI (2026-10-28)

- Continued work is **Meta Messenger/Instagram/WhatsApp only**; TikTok Business Messaging remains in the approval-wait hold.
- Unified opt-out parsing for the signed, durable WhatsApp inbound consent-revocation path and the customer reply path. Only exact case-insensitive `STOP`, `UNSUBSCRIBE` and `STOP REMINDERS` customer text messages qualify, not incidental phrases or traffic from other providers.
- The inbound consent ledger still revokes matching active appointment-update opt-ins transactionally before webhook acknowledgment. A fresh, standard-window WhatsApp STOP now gets a single deterministic, functional, **non-promotional** acknowledgement rather than sending the opt-out instruction to generative AI. All actions still flow through the ordinary signed event, durable idempotent outbox, 24-hour customer-service-window guard and human-handoff checks; no response is allowed outside the window. This feature never grants consent or enables WhatsApp templates.
- Tests verify exact intent detection, safe no-AI confirmation, deterministic repeat outputs and the expired response window. Production template-sending remains default-off pending verified consent collection, exact approved template and explicit activation. Never replay previously dead-lettered opt-out messages.

## Meta signed webhook malformed timestamp containment (2026-10-28)

- Messenger, Instagram and WhatsApp inbound timestamp conversion now validates the JavaScript Date range and bounds WhatsApp epoch-seconds strings before calling `toISOString()`. An out-of-range timestamp yields no `occurredAt` instead of throwing and rejecting an entire signed webhook batch. Adjacent valid events are still normalized and durably ingested.
- The existing 24h customer-service guard continues to **fail closed** on missing timestamps: a malformed-timestamp event must not trigger an AI reply or provider send, while valid customer events in the same callback continue normally. No provider webhook subscriptions or customer messages changed.
- Regression tests cover adjacent Messenger and WhatsApp messages with out-of-range timestamps. TikTok remains parked pending its separate messaging approval.

## Explicit, source-backed WhatsApp appointment opt-in (2026-10-28)

- Meta WhatsApp-only change. Normal conversation, generic YES, booking, Instagram/Messenger and unsolicited messages **never** count as appointment reminder opt-in. The only accepted fresh, signed WhatsApp inbound opt-in text is exactly: `I agree to receive WhatsApp appointment reminders from Ishi Nail Lab. Reply STOP REMINDERS to opt out.` (case insensitive). It identifies Ishi Nail Lab, the WhatsApp channel, specific reminder category and opt-out instructions; retain the exact phrase and adjacent disclosure in any future client-facing UI. Consistent with the WhatsApp Business Messaging Policy (September 23, 2026): https://whatsappbusiness.com/policy/.
- The signed, deduplicated inbound event and source ID are persisted before atomically granting HMAC-indexed appointment-update consent in the same transaction; out-of-order older opt-in cannot undo a later STOP/revocation. No plain phone number is added to the consent ledger. A deterministic confirmation is sent only after rereading active consent; otherwise a clear functional failure message is used instead of making a false grant or generative reply. Existing STOP atomic revoke and 24-hour window/Meta human handoff policies remain intact.
- **Production hold:** The Hostinger key inventory has no `META_WHATSAPP_CONSENT_HASH_KEY_B64` and no WhatsApp template enable/allowlist keys. Thus consent collection is currently dormant in production (the consent store cannot be instantiated). Do not use Hostinger's replace-all environment API with masked values or activate templates. Provision the 32-byte HMAC key through a secure, non-destructive credential workflow only after full environment preservation is assured, then verify explicit customer-origin canary; do not generate an opt-in or send a reminder on a customer's behalf. Existing consent ledger migration 0004 remains in place and its RLS must remain enabled.
- No TikTok changes, no historical replay, no new provider permissions. Regression tests cover explicit phrase, signed source linkage, stale replay protection, truthful acknowledgment and no AI response to consent phrases.

## Meta delivery-receipt indexing (2026-10-28)

- New `migrations/0005_meta_delivery_receipt_indexes.sql` adds a targeted partial index for inbound Meta `delivery.sent|delivered|read|failed` rows by channel/account/provider-message ID (and recent receipt time), plus a partial published-outbox time index. They support protected per-message delivery lifecycle correlation, reduce future full scans, and do not index message content or raw customer identity.
- Migration is idempotent and additive. Apply through Supabase migrations before treating it as installed in `ishikeit-db`; inspect index validity and a read-only sample EXPLAIN afterward. No webhook subscriptions, customer messages, consent settings, Meta tokens, or TikTok development are touched.

## Instagram OAuth operational live-check without credential exposure (2026-10-28)

- The existing protected `GET /ops/instagram/oauth/status` reports whether an encrypted credential is stored, not whether Meta still accepts it. A future local expiration is insufficient proof (the tester grant currently fails Graph error 190). Optional `?validate_live=true` now makes one read-only Graph `/me` Professional-account owner check against that exact stored credential, and returns a separate `providerValidation` enum: `valid`, `expired`, `reauthorization_required`, `identity_mismatch`, `unmapped`, `provider_rejected`, or `provider_unavailable`. Default requests remain local-only and do not incur Graph calls. Invalid query options return HTTP 400.
- No tokens, raw Graph provider messages or customer data appear in the response. Credentials are neither modified nor refreshed as a side effect of this diagnostic. `authorized:true` continues to mean a credential is **stored**, while `providerValidation=reauthorization_required` means Meta currently rejects it; reauthorization by the account owner is still required to fix an invalid grant. The separately verified exact-account studio managed token remains operational and is unaffected.
- Use existing operational bearer authentication; do not read or expose Hostinger's masked secrets. Tests include healthy exact owner, wrong account identity, Graph code 190 and no-secret response, and protected HTTP query validation. TikTok remains parked pending its Messaging API approval.

## Canonical Meta Messaging checkpoint — 2026-10-28

- See [Meta Messaging Operational Handoff](META_MESSAGING_OPERATIONAL_HANDOFF_2026-10-28.md) for exact production, permissions, Instagram token-health, WhatsApp consent/template, and human/provider approval gates. Work remains Messenger + Instagram + WhatsApp only. TikTok Messaging API is still awaiting approval and its last canonical checkpoint must be preserved.

## Messenger and Instagram native text quick replies (2026-10-28)

- Added explicit, provider-neutral `quickReplies` choices on the existing durable `message.send` action and Meta sender payload. They are supported only for Messenger and Instagram text responses. Each choice has a readable `title` (1-20 characters) and developer-defined `payload` (1-1000 characters). At most 13 choices are allowed, duplicate payloads rejected, and non-text/WhatsApp use fails permanently before any network request. The Graph request adds the provider-native `message.quick_replies` array using `content_type: text` and preserves Messenger `messaging_type: RESPONSE`.
- This capability does not automatically insert buttons into every AI answer, start a conversation, send marketing, or bypass the 24-hour standard reply window, human handoff or native ownership protections. Only explicitly enqueued, policy-eligible actions may use it. The existing signed inbound webhook already normalizes the customer's quick reply as a normal `message.received` text message while preserving `message.quick_reply` structured payload. No Meta app subscription change required for standard `messages` event.
- Official current references: Messenger https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/quick-replies and Instagram https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies . Regression coverage includes exact Messenger/Instagram wire payloads, limits, unsafe values, no-send WhatsApp/media, expired customer window and human handoff. TikTok remains on its independent approval-wait checkpoint.

## WhatsApp native interactive reply buttons (2026-10-28)

- Existing provider-neutral `quickReplies` choices now support WhatsApp **only** as customer-service-window `interactive` `type:button` messages. The shared Meta sender renders `interactive.body.text` and 1–3 `action.buttons` with `type:reply` and `{id: payload, title}`. The incoming button response is already normalized from signed WhatsApp webhooks to the selected text and structured selection ID.
- Strict provider-specific guards: a text prompt of at most 1024 UTF-16 code units, no more than 3 reply buttons, unique case-insensitive labels (1–20 characters), button ID of at most 256 characters, and unique IDs. Malformed input/media replies fail permanently before Graph, and redirect policy remains `error`.
- Interactive choices are **only** included in an explicitly queued `message.send` action with the existing signed customer timestamp, 24-hour response-window limit and durable human handoff checks. No reply buttons are automatically added to generative AI responses; no template, campaign, opt-in or business-initiated messaging feature is enabled.
- Official Cloud API reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages . Regression tests cover exact Graph wire shape, reply context, malformed/duplicate/beyond-limit buttons, handoff and standard-window expiry. TikTok remains unaffected pending messaging approval.

## WhatsApp native interactive list menus (2026-10-28)

- Explicit provider-neutral `interactiveList` input on the existing durable `message.send` action now supports WhatsApp `type:interactive` / `type:list` messages with a body prompt, one list-opening button, and titled row sections. It allows customers to select among up to ten options spanning at most ten sections. Exactly one button text (1-20 chars), section title (1-24), row ID (1-200), row title (1-24), optional row description (1-72). Every row ID is unique across the entire list, never merely within a section. The original signed `interactive.list_reply` inbound event is already mapped to selected text and retained structured row ID.
- Only WhatsApp text actions may carry `interactiveList`; it cannot be combined with `quickReplies` or media. Invalid requests are permanently blocked **before** Graph API. The Meta standard 24-hour customer reply window, durable human/native handoff gating, account credential routing, rate/error rules and outbox idempotency remain mandatory and unchanged. No automatic outbound menu, template, marketing message or unsolicited outreach was activated.
- Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages . Tests cover exact Cloud API payload, row uniqueness and total bounds across sections, channel restrictions, multiple interactive modes, expired window, and no-send behavior. TikTok remains separate pending its Messaging API approval.

## Native Meta thread ownership correctness and out-of-order safety (2026-10-29)

- Scope is strictly Facebook Messenger and Instagram native thread control plus shared Meta human handoff. **TikTok Messaging API remains in approval-wait hold.**
- Fixed a handover semantic bug: a signed `take_thread_control` callback is not automatically "someone else took control." Both `pass_thread_control` and `take_thread_control` contain a `new_owner_app_id`; Ishikeit may regard itself as current owner only when that exact field matches Meta app `1042452472116584`. Missing or other owner means block. Signed standby remains block-only.
- New migration `migrations/0006_meta_native_routing_ownership.sql` creates a separate, RLS-enabled, no-anon/no-authenticated-grants provider-native ownership table keyed by the same hashed per-conversation partition. An AI-to-human handoff and native other-app ownership can **coexist**; releasing a human handoff never overrides native ownership, and regaining native ownership never releases an AI/human escalation.
- Native ownership updates use signed provider event timestamps with a monotonic conditional UPSERT. Older callbacks cannot undo newer ownership. Equal-time conflict selects `other_app` for safety. Missing provider times use signed-ingress time, conservatively. Pre-migration active legacy native blocks are backfilled as `other_app`, then the old native rows are released within the same migration transaction. No customer text or raw account identities are stored.
- **Migration-first release:** merge only after CI passes; apply migration 0006 to the existing Supabase `ishikeit-db`, verify RLS/grants and readiness, then deploy Hostinger main; validate public /health/live and /health/ready and no new queued sends/dead letters. Production migration currently has no legacy native handoff rows, per read-only preflight.
- Tests cover correct owner semantics for both handover callbacks, missing timestamp conservatism, SQL monotonic guard, two independent overlapping restrictions and no unauthorized operator release.

## WhatsApp interactive-list 1024-character provider limit (2026-10-29)

- Fixed an actual sender validation gap: WhatsApp Cloud API list messages permit at most **1024 characters in `interactive.body.text`**, not the 4096-character regular WhatsApp text limit. Ishikeit now rejects list prompts exceeding 1024 UTF-16 code units before contacting Meta; 1024 is accepted. Existing strict section/row validation, 24h standard customer-service guard, human/native ownership blocking, credential handling and durable idempotency remain intact.
- Confirmed from Meta's own WhatsApp Node.js SDK InteractiveObject reference: https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/InteractiveObject/ . Tests cover the precise boundary and zero provider calls on invalid prompts.
- Messenger, Instagram, WhatsApp only; TikTok Messaging remains pending approval and unchanged.

## Signed WhatsApp STOP-first tombstone and clock-skew safety (2026-10-29)

- Scope is **Meta WhatsApp only**; TikTok Business Messaging remains on its separate approval-wait checkpoint.
- Fixed an important revocation race: a signed customer STOP/UNSUBSCRIBE/STOP REMINDERS previously only updated an existing consent row. When a STOP arrived **before** any stored opt-in, no revocation evidence remained; a delayed older customer opt-in could subsequently grant appointment reminders. New additive `migrations/0007_meta_whatsapp_opt_out_tombstones.sql` creates a private HMAC-keyed, RLS-enabled, no-anon/no-authenticated-grants source-backed STOP tombstone for each recipient and appointment-update purpose. Every STOP stores its original signed durable inbound source event even if there is no prior opt-in.
- The final WhatsApp approved-template consent gate compares the latest signed STOP timestamp with the opt-in timestamp. Stale/replayed older opt-ins cannot authorize a send, including concurrency between inbound consent events. An actually later, fresh customer-authorized opt-in can supersede the older STOP after appropriate timing. Upserts remain idempotent and signed-source-linked.
- The permitted five-minute provider clock skew previously could store a future opt-in timestamp and cause a prompt STOP to fail the existing database `revoked_at >= consented_at` constraint. New opt-in writes clamp future consent times to server now; STOP records use the later of server now or signed provider event time and ensure existing revocations obey the constraint. This is conservative and deliberately favors suppressing reminders over unauthorized sends.
- The new STOP lookup never stores plaintext phone numbers or customer message bodies. Consent remains HMAC-keyed to exact WhatsApp phone-number ID and recipient; the final `message.template.send` adapter still checks exact approved account, template, purpose and active consent.
- **Migration-before-deploy:** Merge only with green Node/PHP/context CI, apply migration 0007 to production `ishikeit-db`, verify RLS, grants, FK, and startup readiness, then build/deploy main and verify HTTP health and outbox. The current production WhatsApp consent HMAC key is absent and template sending is OFF; do not change secrets through Hostinger's replace-all masked environment API or send a reminder without genuine customer consent.

## Canonical verified Meta Messaging handoff — 2026-10-29

- Resume Facebook Messenger, Instagram and WhatsApp work from [Verified Meta Messaging Production Continuation](META_MESSAGING_VERIFIED_CONTINUATION_2026-10-29.md). It reconciles current main/Hostinger/Supabase, PRs #134–#136, native ownership, WhatsApp STOP tombstones, fresh real WhatsApp delivery/read evidence, and explicit external authorization gates.
- TikTok Business Messaging remains **ON HOLD** pending separate provider API approval; use the previously saved TikTok checkpoint when it is actually approved. Do not merge its pending development into Meta work.

## New-chat Meta messaging handoff reverified — 2026-10-29 00:45 PHT

- Before resuming **Facebook Messenger, Instagram, WhatsApp** development, read [META_MESSAGING_VERIFIED_CONTINUATION_2026-10-29.md](META_MESSAGING_VERIFIED_CONTINUATION_2026-10-29.md), especially its **New-chat transition: refreshed live evidence** section. It updates production source revision to the completed Hostinger **PR #137** documentation checkpoint, includes exact live health, private Supabase aggregate queue/handoff/consent status, Meta App Review and webhook readback, and remaining engineering/owner-controlled steps.
- **TikTok Messaging stays on hold** pending separate API product approval; its own saved checkpoint remains untouched. Do not resume TikTok source work from this Meta continuation request.
- This change is documentation-only and intentionally makes no new Meta webhook, OAuth, messaging, database, Hostinger environment or TikTok mutations. Refresh live state and current `main` before acting in the next chat.


## 2026-10-29 — Meta operational dead-letter metrics and WhatsApp evidence indexes

- Source change PR #139 (read-only monitoring and schema indexes; **not** new customer messaging): `PostgresOperationalMetrics.queue[]` now reports `deadLetterTotal` and `deadLettersInWindow` per existing durable outbox topic, alongside `pending` and `oldestPendingMs`. Historical failures remain retained and cannot be interpreted as fresh failures. The SQL uses the supplied window parameter and stores no customer content in the metrics response.
- An independent production Supabase query at development time returned **0 pending**, **43 historical dead letters** (32 `inbound.event.accepted`, 11 `action.dispatch`) and **0 within 60 minutes**. The historical causes were AI bridge 502/415, earlier missing Instagram token, Graph 100 and related transient bridge faults. **Do not replay historical dead letters** automatically.
- Two private `source_event_id` foreign keys in WhatsApp appointment-consent/STOP tables were missing covering indexes. Safe, idempotent `migrations/0008_meta_whatsapp_source_event_fk_indexes.sql` was applied to production via Supabase as migration version `20261028205639` (`meta_whatsapp_source_event_fk_indexes`); both indexes verified in `pg_indexes`, and the Supabase performance advisor no longer reports unindexed foreign keys. New indexes may temporarily be listed as unused until real consent-related queries exercise them. RLS and public-client grants were not altered.
- Meta developer tools still report app `1042452472116584`: Live, `NO_SUBMISSION`, no Advanced Access listed, contact email unverified. Meta's Instagram own-managed-business Standard Access documentation and its Messaging webhook non-role delivery requirements have different scope: **do not claim public webhook reachability or mandatory App Review without a real authorized account-specific canary/provider determination**. Updated `docs/meta-instagram-app-review.md` with the conditional decision path; an existing invalid tester OAuth credential (Graph 190) is not the independently working managed studio account.
- Missing additional Page and Instagram receipt/postback webhook fields and the proposed `ishi_appointment_reminder_v1` WhatsApp utility template were inspected in provider tools; **they are confirmation-required external changes and were not applied**. Do not falsely mark these subscribed/approved. Opt-in and template dispatch remain default-off until secure consent-key provisioning, actual approved utility template, and genuine customer consent. Preserve TikTok Messaging's separate approval hold.
- Validation: local `npm run check` on Node 26 completed lint, typecheck, **364 tests**, and build. GitHub CI runs Node 24 and must succeed before merge/deployment. The additional live production SQL and Meta provider readbacks are separate from unit tests. Do not infer protected /ops/metrics authenticated response was tested unless checked with a legitimate ops credential.


## 2026-10-29 — Meta delivery receipt monotonicity and interactive regression coverage

- Fixed the protected operational Meta outbound lifecycle query to rank exact-message provider receipt evidence by irreversible observed progress rather than most recent arrival/timestamp. `delivery.read` outranks `delivery.delivered`, which outranks `delivery.failed`, which outranks `delivery.sent`. Failures still outrank only `sent` for an otherwise undeliverable message; a proven read/delivery never regresses to sent/failed due to callback reordering. Provider timestamps and ingestion times break ties only at equal progress levels. This changes **reporting only**; no sending, consent or event storage changes.
- Before the patch, an independent read-only Supabase CTE with a read receipt followed by delivered and sent returned `delivery.sent` with the former ordering; the corrected ordering returned `delivery.read`. SQL query now documents why priority comes before receipt timestamps.
- Added regression assertions covering the SQL priority order and normalizer tests for Instagram customer postbacks and durable WhatsApp delivery-failure callbacks. Local `npm run check` passed 366 tests, lint, typecheck and build. GitHub CI on Node 24 and Hostinger completed deployment must be separately verified before claiming production rollout.
- All earlier Meta provider gates remain unchanged: no new Messenger/Instagram webhook fields enabled without provider confirmation, no WhatsApp appointment template submitted or active, no fabricated consent, no replacement of invalid tester OAuth credential. Follow the existing Meta App Review access/ownership validation before claiming non-role sender coverage. TikTok Business Messaging remains out of scope.


## Provider-authorized Meta updates — 2026-10-29 (verified readback)

User explicitly approved the recommended Meta provider configuration changes on October 29, 2026. Changes applied through the connected Meta developer and WhatsApp business tools (not through local mock requests):

- **Meta app `1042452472116584`, Page/Messenger:** app-level `page` webhook topic now includes `messages`, `message_deliveries`, `message_reads`, `messaging_postbacks`, and `messaging_handovers`. The four new fields were confirmed through provider `update_fields` success and a separate `list_subscriptions` read.
- **Instagram:** app-level `instagram` webhook topic now includes `messages`, `standby`, `messaging_handover`, `messaging_seen`, `messaging_postbacks`. The latter two fields were added and independently read back. These are **app-level subscriptions**; their presence alone does not prove actual account-level routing or real non-role public sender delivery. Preserve the managed studio owner token identity, and do not confuse the separate failed tester OAuth account (Graph 190) with the owner token.
- **WhatsApp Ishi Nail Lab:** confirmed business identity, the production Philippine phone number still registered, and the correct linked messaging account; submitted `ishi_appointment_reminder_v1` (`en_US`, non-promotional `UTILITY`) to Meta. Provider template ID **`1674861800945394`**; **status `PENDING` at last readback**, with no rejection reason. Header: `Appointment reminder`; body: `Hi {{1}}, this is Ishi Nail Lab. Your appointment is scheduled on {{2}} at {{3}}. Reply to this chat if you need assistance with your booking.`; footer: `Reply STOP REMINDERS to opt out`. The three body fields are customer name, date and local time; supplied provider examples are placeholders only, not real appointments. Manager link: https://business.facebook.com/wa/manage/message-templates/?waba_id=4663054720683021&business_id=1030506726679124 .
- **WhatsApp proactive sending remains deliberately disabled**, notwithstanding submission. Never add this template to a production dispatch allowlist or set `META_WHATSAPP_TEMPLATE_DISPATCH_ENABLED=true` until the exact language/category is actually approved, the private consent HMAC key is safely provisioned, legitimate customer consent exists, and a vetted appointment source schedules each message. No outbound template message was sent; no artificial opt-in or STOP evidence was inserted.
- After subscription changes: producer deployment `a1c4901505687b648c4fce6cf3d7ce0b93c229a1` remained completed, and DB outbox showed **0 pending** and **0 new dead letters within 24 hours**. Production logs contained only the prior tester OAuth Graph 190 warning among logged warnings. `App Review` still reports `NO_SUBMISSION`; own-managed-business Standard Access versus unrelated-user webhook access needs exact provider-specific and genuine customer-originated verification before public readiness claims. Contact-email verification and any real screencast/reviewer-account requirements are not done by submitting a WhatsApp template.
- Existing unit and CI coverage (366 tests at PR #140) verifies normalization and dispatch guards, **not** delivery of newly subscribed provider events in live customer threads. Perform authorized genuine Messenger/Instagram postback/read receipt, native handover and Instagram non-role canaries before claiming operational validation. No TikTok API permissions, callbacks or messaging state were modified.

### 2026-10-29 — Instagram account-level subscription follow-through

- After adding `messaging_seen` and `messaging_postbacks` to the Meta developer app-level Instagram fields, a separate gap was discovered: `INSTAGRAM_WEBHOOK_FIELDS` still requested only `messages,standby,messaging_handover` on `POST https://graph.instagram.com/{version}/me/subscribed_apps`. This prevented claiming the owner Professional account had reconciled the newly enabled fields.
- Expanded the canonical subscribed-field array to `messages,standby,messaging_handover,messaging_seen,messaging_postbacks`, preserving existing three. It is used by both managed Professional-account reconciliation and valid stored Instagram OAuth accounts. **Do not force or delete stale tester OAuth credentials**; the studio's verified managed token is separately reconciled.
- Updated the OAuth HTTP regression to assert the exact five-field request and bearer-only auth (no token query). Local `npm run check`: lint/typecheck/build and 366 tests passed; GitHub CI and production Hostinger startup provider reconciliation **must be checked separately after deployment**. Provider success and a real authorized seen/postback callback are distinct verifications; neither should be claimed based on unit tests alone.


### 2026-10-29 — guarded Messenger Page webhook field reconciliation

- Official Meta Messenger Webhooks documentation requires **both app-level Page fields and the installed Page's own `/{page-id}/subscribed_apps` fields**. Previously only the app-level `page` webhook subscription had been expanded to `messages,message_deliveries,message_reads,messaging_postbacks,messaging_handovers`.
- Added `MessengerPageSubscriptionClient` for an **idempotent guarded** startup read/upgrade: resolve the configured Page access token identity using `GET /me?fields=id` via Bearer header, require an exact Page ID matching already signed `meta/messenger/message.received` database records, and read current `/{page-id}/subscribed_apps` for the exact Ishikeit Meta app `1042452472116584`. **No action if unknown Page/app, permission failure or identity mismatch**; existing subscriptions from other apps/pages are untouched. On missing approved fields, preserve already configured fields and POST only the union; perform a second GET readback, reject if not fully applied. No token, Page ID or provider error body appears in logs.
- Reconciliation is optional when a Page token isn't configured, runs after DB readiness, logs sanitized warnings but does not prevent serving healthy traffic on provider API failures, and never sends a message. Added 5 mocked Graph coverage tests and a signed Page identity DB guard test. Local Node environment `npm run check` passed lint, typecheck, build and **372 tests**. **Provider permission success, actual Page subscription status, GitHub CI and Hostinger runtime remain to be verified following deployment**; do not infer from mock tests.
- No new WhatsApp template dispatch, synthetic consent, OAuth reset, TikTok changes, or proactive customer messages. Existing Meta App Review access and real customer-originated canary requirements remain.


### 2026-10-29 — Messenger Page identity preflight diagnostic

- The guarded new `MessengerPageSubscriptionClient` was deployed at app SHA `b469fe55af07ba4065d55a4a639e6e1e540fdd14`. Hostinger startup reported `Messenger Page webhook field reconciliation failed: identity_resolution http_status=400` after attempting `GET /me?fields=id` using the existing Page token. **No Page-subscription write took place**, because identity resolution is the first gate. Instagram managed account reconciliation continued to succeed; the independent historic Instagram OAuth tester still produces Graph 190.
- To distinguish an invalid Meta token (code 190), missing permissions (code 200) or incorrect Graph method/parameters (code 100) **without exposing confidential provider error bodies**, the next patch records *only* the numeric Graph code and error subcode alongside the already redacted HTTP status/stage. This is diagnostics-only and leaves all validation, Page identity guards and outbound sends unchanged.
- Current verified historical Messenger dispatch evidence: 36 published `action.dispatch` Meta Messenger actions, most recent 2026-10-28 06:38 UTC, with zero historical Messenger dead letters at review. This does not prove that the Page token remains valid at the time of the new read call. A follow-up live deployment/readback is required before diagnosing the exact cause or changing credentials.


### 2026-10-29 — Messenger Page Graph 100 investigation and signed Page identity fallback

- The sanitized production diagnostic for the `GET /v26.0/me?fields=id` preflight was `identity_resolution http_status=400 provider_code=graph:100`, **not** token-revocation code 190. An unrelated stale Instagram OAuth tester still fails code 190. No Messenger Page subscription was changed by that failed identity preflight.
- Read-only production DB grouping of signed `meta/messenger/message.received` events found **two distinct account labels**: one numeric production Page with 47 events and 3 within the last 7 days (latest 2026-10-28 06:38 UTC), and one historical non-numeric `ishikeit-test-page` fixture from 2026-09-29. The code must never pick Page identities from arbitrary webhooks or simply assume all account labels are production.
- Updated Messenger Page preflight to obtain the **sole numeric Page ID observed in signed events within the last 30 days**, and require exact signed-inbound match again before any write. Avoids Graph `/me` alias, which generated error 100 in this environment; instead directly GET the known Page's `/{page-id}/subscribed_apps` with its configured Page token, requiring the exact existing Ishikeit app installation. Only then add missing fields while preserving all existing ones and read back. If zero/multiple numeric recent Pages or if the provider rejects GET, fail closed and log only HTTP status/numeric Graph code; no Page writes or customer messages.
- Unit and mock coverage updated for exact Page path, uniqueness, zero writes for mismatches and private error logging; local `npm run check` passed **373 tests** plus lint/typecheck/build. The **live provider outcome remains unconfirmed** until a subsequent CI-tested deployment and Hostinger startup logs/readback; do not claim that Page field subscriptions were updated merely from a mock test.


## 2026-10-29 — Provider-approved Meta webhook closure: verified live state

The user explicitly approved all recommended Messenger, Instagram and WhatsApp provider configuration changes. Final readbacks and independent production evidence are:

- **Messenger:** Meta app `1042452472116584` `page` webhook topic has five fields: `messages`, `message_deliveries`, `message_reads`, `messaging_postbacks`, `messaging_handovers`. The **Page-level** subscription was also successfully upgraded in production after PR #145: Hostinger startup reported `Messenger verified Page webhook subscription reconciled; changed=true` at approximately **2026-10-28 21:46:50 UTC**. This was a real Graph API POST followed by a GET readback of all required fields, not a mock. An earlier `GET /me` Page-token alias returned Graph error code 100, so the final client now uses a uniquely resolved **recent numeric signed inbound Messenger Page** (30-day window), verifies exact signed inbound coverage and the installed app at `/{page-id}/subscribed_apps`, and fails closed when ambiguity/provider error occurs. It does not expose Page IDs or tokens in operational logs.
- **Instagram:** App-level `instagram` webhook topic has `messages`, `standby`, `messaging_handover`, `messaging_seen`, and `messaging_postbacks`; live startup after PR #142 successfully reconciled all five fields for the verified managed studio Professional account (`historical_signed_inbound_account_match=true`). A **separate** historical OAuth tester token still returns Graph code **190** and must not be confused with the working studio owner token; no credential deletion or fabrication occurred.
- **WhatsApp:** Confirmed the correct Ishi Nail Lab registered Philippine number and Messaging Account. Submitted `ishi_appointment_reminder_v1` / `en_US` as a `UTILITY` template under provider ID `1674861800945394`; latest provider status **PENDING** with `rejected_reason=NONE`. Do not enable proactive template dispatch or claim approval. An independent conditional automation named **Ishikeit WhatsApp Template Review** (task ID `6ae26b15df748191ac5f799823f57ffc`) checks every 4 hours and notifies only on actionable approval/rejection/category changes, without sending or updating customer data.
- **Production:** Application PRs #140–#145 merged. Latest production code revision `d9cc103c85177d033ca1857682864bd4f24cb09a` completed Hostinger deployment. All four public health endpoints returned HTTP 200, processor and dispatcher enabled, app `main` matches deployed revision, **373 local tests** passed and PR #145 GitHub Node/continuity/PHP CI passed. Production durable outbox: **0 pending** and **0 dead-lettered within previous 24 hours**. Local source mirror fast-forwarded cleanly to `main`.
- **Not proven by provider config alone:** customer-originated non-app-role Instagram DM delivery, live Page/Instagram postback/seen/reads and handover callbacks require genuine authorized external test users. Meta App Review still `NO_SUBMISSION`, owner contact email / real reviewer screencast needs separately verified product-specific eligibility. WhatsApp proactive reminder sends must remain disabled until exact approved Utility template, properly managed HMAC consent key, real signed opt-ins and a verified appointment schedule source exist. No TikTok Messaging development or customer sends occurred during these changes.

The previous dated checkpoint sections documenting missing fields and failed Page alias preflights remain historical evidence; **this entry supersedes them for current state**. Read new live provider/runtime state again before making future changes.


### 2026-10-29 — independent real-production Meta validation

- Completed a new **read-only first-party provider, Hostinger, Supabase and production HTTPS audit**, plus a fresh full `npm run check` (373 tests, 55 suites, lint/typecheck/build PASS). Detailed reproducible sanitized evidence and limitations: `docs/META_LIVE_VALIDATION_2026-10-29.md`.
- Since last deployed webhooks, **3 Messenger signed inbound messages** were all handled, exactly **3 same-account/recipient dispatches published within two minutes**, and **3 exact-ID delivery callbacks** matched outbound provider IDs. Three **watermark-only** read callbacks also processed but cannot be attributed to individual messages; do not mark each outbound action as read from these aggregates.
- Live negative-auth probes passed: operational metrics unauthorized=401, invalid Meta webhook verify token=403, unsigned empty webhook POST=401; health/ready=200. Database recent processing/backlog clean; inbound and action idempotency duplicate groups zero; sensitive private tables RLS enabled and no anon/auth direct grant. Security/performance advisor INFO notices were examined; no blanket RLS policies or speculative index deletions.
- Instagram and WhatsApp retain historical signed messaging evidence; **no fresh Instagram postback/seen or production native handover canary** and no new WhatsApp post-deploy canary. No provider-sample webhook sends or customer messages manufactured. WhatsApp Utility template still PENDING and active opt-ins = 0, so proactive template sending remains off.
- Meta App Review NO_SUBMISSION and unverified app contact email remain; separated prior Graph 190 tester issue from working studio owner. Do not claim full public non-role coverage without the relevant real-world permissions and proof. No TikTok development or customer data changes.


### 2026-10-29 — Meta interactive webhook postback and handover safety coverage

- Added a **real-shaped signed HMAC HTTP integration harness** using Fastify injection and a deterministic in-memory deduplicating inbound store, followed by the actual MessageReceivedHandler with a mocked WordPress brain. Exercises both Page/Messenger and Instagram customer postbacks through a real signed webhook path, exact reply recipient/account and 24-hour customer timestamp, redelivery with changed metadata (still duplicate), Instagram `messaging_seen` exact-mid receipt, native `pass_thread_control` non-AI routing, self-originated Instagram postback no-AI guard, and invalid-signature no-ingress behavior. The harness uses local-only synthetic payloads; **it is not a claim of live provider webhook delivery** and never reaches customer accounts.
- Improved `src/channels/meta-normalizer.ts` to preserve the bounded provider `postback.mid` as `providerMessageId` and stable `postback:<mid>` provider event id, ensuring repeated delivery with different timestamps/auxiliary metadata cannot generate duplicate AI responses. Meta Instagram owner `is_self=true` postbacks are stored as `message.self_postback`, not automatically answered; normal customer postbacks remain `message.postback`.
- Local `npm run check` passed **378 tests in 56 files** plus ESLint, typecheck and TypeScript build. Provider permissions, external review, real non-role sender canaries, and approval/consent for WhatsApp appointment templates remain separately gated. No raw tokens, consent rows, provider messages, DB migrations or TikTok changes.


### 2026-10-29 — LatePoint→WhatsApp reminder candidate groundwork (default-off)

- Official LatePoint docs confirm `latepoint_booking_created`, `latepoint_booking_updated`, and deletion hooks, and the separate built-in `LatePoint > Automation > Workflows` scheduled reminder facility. The user's installed premium extensions remain untouched. Before emitting any production booking events, verify the current site's actual hook payload and timezone handling: https://latepoint.com/docs/list-of-latepoint-hooks-actions-and-filters/ and https://latepoint.com/docs/how-to-create-appointment-reminders/ .
- Added a **strict pure, non-sending candidate planner**, `src/appointments/latepoint-reminder-candidate.ts`, with 10 tests. It validates numeric booking IDs, only `approved` status (not pending/cancelled/no-show/completed), explicit offset-bearing booking times, **Asia/Manila** studio timezone, canonical Philippine mobile recipients, bounded 90-day horizon, scheduled reminders strictly before current time, exact 24h or 2h lead, stable SHA-256 versioned booking/time idempotency, and exact `ishi_appointment_reminder_v1@en_US` template parameter formatting. Reschedule yields a new candidate key and requires the eventual scheduler to revoke old jobs.
- The returned candidate explicitly declares mandatory rechecks of the **latest LatePoint booking**, **durable signed WhatsApp opt-in**, and **provider-approved template**. It does **not** send, persist a reminder, collect phone numbers from WordPress, start a cron process or enable `META_WHATSAPP_TEMPLATE_DISPATCH_ENABLED`. Future implementation must authenticate WordPress-originated booking notifications, safely reconcile cancellations and rebookings, avoid duplicate LatePoint-native reminders, retain suppression on STOP, and recheck real consent and approval immediately before sending.
- Local full `npm run check` passed **388 tests across 57 files**, lint, typecheck and build. This is safe development of the next dependency while Meta's exact template remains PENDING and there are zero active customer reminder opt-ins. No change to Meta/TikTok provider settings or current client communications.


#### Independent live WordPress / LatePoint discovery — critical duplicate-send guard

Read-only WordPress plugin inventory on 2026-10-29 shows **LatePoint 5.7.5**, **LatePoint Pro Features 1.7.3** and **LatePoint Addon - Whatsapp by Meta 1.1.0** already installed. The official LatePoint docs confirm the WhatsApp add-on sends Meta-approved template notifications **directly from LatePoint workflows**, with workflow execution offset and its own scheduled-job processor: https://latepoint.com/docs/sending-whatsapp-messages-in-latepoint/ . The **WordPress site timezone is already `Asia/Manila`**. WordPress Cron already schedules `latepoint_process_scheduled_jobs` every **300 seconds**; at the readback it was not overdue and `DISABLE_WP_CRON` was false.
- **Do not activate a parallel Ishikeit reminder scheduler** or enable native LatePoint WhatsApp workflow without first inspecting current LatePoint workflows / approved templates / customer consent and choosing **one single canonical sender**. Otherwise a native workflow and Ishikeit action dispatcher could duplicate the same customer notification.
- The pure candidate planner remains non-sending and intentionally unbound to WordPress. The native LatePoint 5-minute scheduler is live infrastructure but **its existence does not establish that any WhatsApp reminder workflow or its token is configured**, nor does it prove an approved template or any opt-in. No premium plugins were updated, changed or invoked to send messages.


### 2026-10-29 — live LatePoint workflow audit, booking lifecycle bridge (default-off)

- **Read-only production WordPress SQL audit** on `www.ishinaillab.com` found `wp_latepoint_processes` has **0 workflows** and `wp_latepoint_process_jobs` has **0 scheduled jobs**; configured WordPress timezone is Asia/Manila. Aggregated existing bookings: 4 approved, 1 cancelled, all past, all with UTC starts. Installed and active: LatePoint 5.7.5, WhatsApp by Meta 1.1.0, Pro Features 1.7.3. The active scheduled `latepoint_process_scheduled_jobs` WP-Cron event alone does **not** imply any WhatsApp reminder workflow. No plugin versions or workflow settings were modified.
- Implemented `src/appointments/latepoint-booking-ingress.ts` and optional HMAC-authenticated `POST /ishikeit/webhooks/latepoint`, **not registered unless an independent 32+ byte `LATEPOINT_BOOKING_WEBHOOK_SECRET` exists**. Strict source/status/timestamp/body verification, replay window, no PII, per-booking dedup; persists safe booking lifecycle records into existing durable inbound + outbox pipeline. Does **not** generate reminders or messaging actions. Added signed route tests and WordPress hook producer package `wordpress/ishi-latepoint-booking-bridge/ishi-latepoint-booking-bridge.php` disabled by default pending matching secret setup. No privileged LatePoint add-on changes.
- Detailed live audit, producer/receiver protocol, safety gates, activation/rollback and remaining external prerequisites: `docs/LATEPOINT_BOOKING_INTEGRATION_2026-10-29.md`.
- **Important operational constraint:** Hostinger's Node.js environment variable read API returns current secret values as masked `********`; its write API replaces the **entire** set of 51 variables. Never use read-and-replace for one key, because it could destroy production Meta/Instagram/WhatsApp/TikTok credentials. Independent shared secret not activated through this dangerous API. Template approval and genuine WhatsApp reminder consent are also pending.


### 2026-10-29 follow-up: verified Hostinger TUS WordPress deployment

- Official Hostinger MCP verified the actual hosting account and WordPress installation (account `u328762438`; installation `30956320`), then generated the authenticated TUS upload URL. Authorized Ishi Local Agent sent the exact tested bridge PHP via POST 201/PATCH 204 into the plugin directory, created inactive with AI Engine first.
- Readback via WordPress returned normalized source matching GitHub; plugin **Ishi LatePoint Booking Bridge v0.1.0 is active**. Its **event-delivery feature remains OFF** because independent `ISHI_LATEPOINT_BRIDGE_ENABLED` / `ISHI_LATEPOINT_BRIDGE_SECRET` are not configured; Node still lacks `LATEPOINT_BOOKING_WEBHOOK_SECRET`. These are distinct from plugin activation.
- No bridge WP-Cron jobs; public WordPress HTTP 200, Hostinger WordPress installation valid, Ishikeit live and ready HTTP 200, missing-secret webhook HTTP 404, outbox 0 pending and 0 newly dead. Meta WhatsApp utility template **PENDING**. Do not send reminders.
- **Remaining security blocker, not Hostinger connection failure:** official Node env API lists 51 variable names but masks every real value and writes by entire-set replacement. Do not attempt masked round-trip. Use an independently secure per-variable configuration path before enabling the integration; never reuse an existing messaging secret.

### 2026-10-29 — Secure P-256 LatePoint event signing, PR #152

- Live website has **Ishi LatePoint Booking Bridge v0.1.0** installed and active but its event-delivery feature remains **disabled** and its Node route returns 404; no sender/reminder jobs have been enabled. Retain this until a verified two-sided activation. Version 0.2.0 is proposed in PR #152; it must not be misreported as deployed.
- **Why the design changed:** Official Hostinger MCP exposes all Node environment values as masked and only allows full-set replacement (51 existing entries). Do **not** write back masked values, reuse existing messaging tokens, or overwrite the whole environment to add a shared key. Version 0.2.0 instead uses an EC P-256/SHA-256 signing key generated inside WordPress upon plugin activation. The private PEM stays in the parent directory of public_html under exclusive file creation and owner-only permissions. Only its public key is stored in WordPress option `ishi_latepoint_bridge_public_key_v1`.
- P-256 payload format: UTF-8 `ishi-latepoint-booking-v2\n<unix-timestamp>\n<raw-json-body>`, OpenSSL ECDSA SHA-256 DER signature encoded as base64url in `X-Ishi-Latepoint-Signature-P256`; required timestamp in `X-Ishi-Latepoint-Timestamp`. Node verifier checks curve, strict canonical base64url, timestamp ±300s, signature, source and strict booking schema before durable, idempotent ingestion. Legacy HMAC remains for existing compatibility tests but must not be activated in the public production route.
- WordPress `ishi_latepoint_bridge_enabled` MUST equal string `1` to emit any booking events; default is off. Never interpret plugin active as bridge enabled. No reminders are sent by the booking lifecycle handler; Meta template approval, opt-in and durable reminder scheduling remain separate gates.
- Operational sequence: run GitHub Node/PHP lint CI, install/activate v0.2.0 on production without enabling events, verify `ishi_latepoint_bridge_key_status_v1=ready`, read **only the public key**, pin it in Node source, verify HTTP 401 without signature and HTTP 422 for signed malformed payload, then enable WordPress lifecycle emission after test. Do not read, export, log or upload the private key.
- Preserve premium plugin update holds; do not modify LatePoint Pro Features, Elementor Pro, native WhatsApp workflows, or existing Meta/Telegram/TikTok credentials.

### 2026-10-29 — WordPress signing key provisioned; production verifier pinned (PR #153)

- Official Hostinger MCP and authorized local file upload replaced the **inactive** WordPress bridge with CI-tested `ishi-latepoint-booking-bridge` **v0.2.0**. WordPress plugin was then activated, provisioning status `ishi_latepoint_bridge_key_status_v1=ready` and a 177-character public PEM in option `ishi_latepoint_bridge_public_key_v1`. The **private key PEM was not retrieved, exposed, logged or committed**; it stays outside WordPress public_html. `ishi_latepoint_bridge_enabled` is **unset/false**, so the producer cannot send booking events yet.
- New `src/appointments/latepoint-public-key.ts` contains only the public verifier read from the live WordPress option, and `src/processes/http.ts` selects P-256 verification unconditionally for production; this avoids all Hostinger environment-variable changes and prevents downgrade to HMAC even if an obsolete HMAC env var exists.
- Deploy and verify this pin before changing the WordPress feature switch. Confirm `/health/live`, `/health/ready`, `/health/build` are 200, unsigned `POST /ishikeit/webhooks/latepoint` is **401** (registered, securely closed), no unexpected outbox actions or new dead letters; confirm exact current public key matches repository pin. A real controlled booking lifecycle event is the final functional proof. **WhatsApp reminder sends remain OFF** pending provider template approval, purpose-specific consent, and booking-state recheck.

### 2026-10-29 — Live P-256 LatePoint event ingress enabled and canary accepted

- WordPress `Ishi LatePoint Booking Bridge v0.2.0` is now **installed, active, and event delivery ON** (`ishi_latepoint_bridge_enabled='1'`). The WordPress-only EC P-256 private key was provisioned outside public_html and **never exposed or exported**; `ishi_latepoint_bridge_key_status_v1='ready'`. Ishikeit production commit `f9adf32591cb6df913060d2aece2b02897f3295a` pins the matching PUBLIC verifier, checks signature and strictly validates PII-free booking lifecycle JSON. Hostinger's 51 existing Node environment variables were never replaced.
- Actual production live test: signed, synthetic, customer-free **deleted-booking tombstone** using reserved nonreal ID `999999999999999991`, dispatched from the WordPress plugin's own scheduler/dispatcher after enabling; Supabase `inbound_events` recorded `provider=latepoint, channel=bookings, event_type=booking.changed, status=processed, processing_outcome=ignored, lifecycle_change=deleted`. No booking was created, deleted or altered in the actual LatePoint database. No customer data was used. No messages/reminders were dispatched. Producer's scheduled test job was removed; 0 bridge jobs remained. One-shot Code Engine canary snippet #66 was deleted and verified absent.
- Final checks: WordPress plugin reports v0.2.0 active; WordPress key status ready and opt-in switch '1'; live Node `/health/live`, `/health/ready`, `/health/build`, `/health/capabilities` each 200, unsigned booking webhook HTTP 401, production runtime built from the pinned-public-key commit. Outbox 0 pending, 0 recent dead letters, 0 messaging actions generated for the test, no new bridge Cron jobs.
- **Important scope:** This confirms authenticated ingress, normalization, dedup infrastructure and safe processing of a controlled signed canary, not that a real customer booking event or automatic reminder scheduler has been independently exercised. There is still no handler creating WhatsApp reminder jobs from booking events. WhatsApp template approval, explicit active opt-in, current-state booking check, cancellation/version invalidation, durable scheduler and final real booking validation remain required before ANY proactive template reminder messages.
- If needing emergency rollback of booking ingress only: set WordPress option `ishi_latepoint_bridge_enabled` to string '0' (not deactivate the main Meta channels); Node's signed endpoint can stay enabled because it rejects unsigned input.

### 2026-10-29 — Private, non-sending LatePoint reminder deadline scheduler (PR #155)

- Signed ECDSA P-256 booking events remain the only source of PII-free booking changes; production WordPress bridge v0.2.0 is still enabled. The scheduled clock cannot dispatch Meta or generate outbox messaging actions.
- New Supabase project migration `20261029022318_latepoint_private_reminder_schedule` (version from the live migration registry; source in `ishinaillab/ishikeit-db`) creates RLS-protected `latepoint_booking_states` and `latepoint_reminder_slots`; client roles have no table grants. No recipient details/tokens are stored.
- `PostgresInboundStore` atomically projects only new verified LatePoint inbound events in the same DB transaction. Per-booking advisory lock + timestamp ordering guards against stale cancellations and reschedules; equal-time conflicting revisions quarantine both slots; approved bookings within 90 days schedule 24h/2h slots; all other statuses invalidate. One-minute background clock suppresses expired deadlines with SKIP LOCKED, never sends or catches up.
- **External holds:** Meta template `ishi_appointment_reminder_v1` is still `PENDING`; WhatsApp purpose-specific consent ledger has zero opt-ins; fresh authoritative booking/recipient recheck and gated sender do not yet exist. Do not enable WhatsApp reminder action generation under these conditions. This PR completes the durable scheduling *foundation*, NOT customer delivery.
- Review `docs/LATEPOINT_DURABLE_REMINDERS_2026-10-29.md`. No premium LatePoint add-ons, WordPress theme, Meta provider credentials or Hostinger masked Node environment values are to be modified.


## 2026-10-29 live deployment and controlled canary verification

- App commit `4ff2b1bf87fcf3d68d6097417e1c915b38c4f855` auto-deployed on `apps.ishinaillab.com`, verified Hostinger build `completed`, /health/live, /health/ready and /health/build HTTP 200, unsigned booking webhook HTTP 401. Startup logs confirm the non-sending deadline reconciliation clock is enabled, with no fatal startup errors.
- App PR #155 and DB PR #10 were merged; GitHub Actions Node lint/typecheck/build (415 tests), PHP lint and context continuity all passed. Applied Supabase migration `20261029022318_latepoint_private_reminder_schedule`, both tables with RLS enabled, anonymous and authenticated SELECT privileges false.
- One synthetic, never-persisted LatePoint booking object (reserved test ID `999999999999999992`, not a real customer) triggered the existing WordPress v0.2.0 P-256 plugin's `created` callback and authenticated dispatcher. Inbound atomic projection created **both** `scheduled` deadlines (24h and 2h). Follow-up synthetic `cancelled` update invalidated both slots with `due_at=NULL`. Database confirmed two inbound source events (one approved, one cancelled), final `conflict=false`, `status=cancelled`; zero Meta outbound actions.
- All one-shot temporary WordPress PHP canary snippets (IDs 67, 68 and cleanup snippet 69) were deleted; all three auxiliary test options were deleted; the synthetic booking state was deleted by exact ID, which cascaded its two test slots. Signed inbound audit history is intentionally retained.
- Final queue audit: 0 pending jobs, 0 new dead letters; WordPress bridge remains active with key status ready and event feature ON. No live customer booking events have yet arrived, and no approved WhatsApp template or purpose opt-ins exist. The exact Meta template is `PENDING`; no outbound reminder sender was enabled.
- Both canonical GitHub main branches and Windows repos are synchronized to the merged app/DB revisions; the premerge uncommitted local draft files were preserved in `D:\\projects\\openai\\project-files\\code-snapshots\\ishikeit-scheduler-premerge-20261029` before synchronization.

## 2026-10-29 Meta standards hardening — source-verified checkpoint

- Implemented bounded streaming for Meta media downloads, replacing full-response buffering before size enforcement; oversized streams are cancelled, stream errors are classified retryable, and redirect/TLS/Bearer controls are preserved.
- Removed untrusted Meta Graph error text from Instagram OAuth exceptions while retaining structured HTTP status, provider code and bounded diagnostic reason.
- Added four targeted regression tests; local `npm run check` passed lint, typecheck, all tests and build. This is source-level evidence only until GitHub CI and deployment readback complete.
- Full rationale, Meta official reference links, prioritized app-secret-proof / ambiguous-send retry / permission / WhatsApp consent follow-ups: `docs/META_STANDARDS_ENGINEERING_REVIEW_2026-10-29.md`. The two separate Deep Research reports are not present in this workspace and should be cross-checked when attached.
- No live customer sends, consent changes, provider subscription edits, WordPress changes, database migrations or Hostinger environment replacements were made in this hardening patch.

## 2026-10-29 Meta Graph proof integration (default-off)

- Implemented Meta-recommended `appsecret_proof = HMAC-SHA256(access_token, app_secret)` in `src/channels/meta-graph-proof.ts`, restricted to HTTPS `graph.facebook.com`, preserving existing query parameters and never forwarding proof to CDN downloads.
- Wired optional `META_GRAPH_PROOF_ENABLED` (default false) into Messenger Page sending and Page subscription GET/POST, WhatsApp ordinary and template sending, and WhatsApp Graph media metadata. Instagram Login and its distinct app credentials remain excluded.
- Production activation requires independent Meta token-to-app ownership verification and authorized read-only proof readbacks. Do not enable Meta's app-wide Require App Secret setting or change masked Hostinger environment values until compatibility is established.
- Local lint, typecheck, 434 tests (Vitest bounded concurrency) and build passed. PR #160 is the release review; `docs/META_GRAPH_PROOF_ROLLOUT_2026-10-29.md` documents staged enablement and rollback. No customer sends, consent, database, WordPress or Meta settings were changed.
- GitHub issue #158 tracks outstanding live token ownership/activation; #159 tracks the separate ambiguous outbound retry risk. The two Deep Research reports are not yet attached and must be cross-checked when provided.

### 2026-10-30 — Guarded healthy-account Instagram OAuth promotion (code-only; no owner OAuth performed)

- Production currently routes the independently Graph-validated managed Instagram token to Ishi Nail Lab Professional account `17841438662359631` and has 103 historical signed IG events on that account. The separately stored legacy tester grant aliases Professional account `17841437646366614` with Meta Graph code 190/subcode 0, zero matching inbound, and no verified current username. It has **not** been revoked, retired or deleted. Issue #176 retains the owner's conditional retirement authorization.
- Meta official [Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) requires genuine owner login consent; the basic and manage-messages scopes must actually be granted. The current [refresh endpoint](https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token) renews valid, 24-hour-old long-lived Instagram tokens for another approximately 60 days. An environment-managed token is **not** automatically refreshed by the durable OAuth refresh manager, so migration remains operationally necessary but must be owner-authorized.
- New own-business promotion guard: when the managed studio token is configured, **every new Instagram OAuth callback** independently resolves that managed token's Professional account identity using Meta Graph `/me` and fails closed if it differs from the newly authenticated Professional account. Missing permissions, provider rejection, and unavailable managed token also fail before any durable new grant/alias. No tester/other account may silently steal the healthy studio account's routing.
- After required scopes, account matching and the provider webhook subscription succeed, the new long-lived token and Instagram Professional account alias are written **atomically** in one PostgreSQL transaction. A conflicting existing alias cannot silently be remapped to a different OAuth subject. Database changes are never made on failed identity/scope/provider-subscription checks. No schema migration required.
- The guarded owner-consented OAuth flow is implemented in the existing OPS-authenticated `/ops/instagram/oauth/start` + Instagram redirect/callback, but **not executed** here; Meta authenticating the owner is required. The original managed token remains configured as a fallback only for its independently verified owner until safe cutover. Actual durable grant provisioning, renewal, owner identity verification, live signed delivery and retiring the code-190 legacy grant remain pending distinct proofs and explicit conditions.
- No live test webhook, external Meta subscription change, user message, old-token replay, App Review submission, Hostinger environment rewrite, or production database credential modification was authorized by this code-only release. The owner HOLD #169 remains unchanged.

### 2026-10-30 — User-authorized studio Instagram OAuth and live signed reply proof

- The business owner completed the official Business Login in the browser. New **encrypted** OAuth subject `28436714725987041` maps exclusively to the studio Professional account `17841438662359631`; permission list exactly `instagram_business_basic` and `instagram_business_manage_messages`, token version 1, long-lived expiration 2026-12-28 23:52:32 UTC. The old subject `38592712153705667` maps to different Professional ID `17841437646366614` (historically documented as old tester `@povnailstudio.ph`) and is independently rejected by Meta Graph code 190/subcode 0. No old credential retirement was done during OAuth.
- After a controlled Hostinger restart, actual production logged new Instagram OAuth account ID resolution and account webhook subscription reconciliation successful twice, while old token failed separately. Live/ready/build each HTTP 200. New studio credential is selected by OAuth-first routing; managed token remains a strictly account-validated fallback.
- Fresh owner-authorized tester DM arrived 2026-10-30 00:27:47 UTC, processed with `processing_outcome=handled`. One Instagram `action.dispatch` sent through the provider and published 00:28:01 UTC on studio ID `17841438662359631`; a real Meta `message.echo` returned at 00:28:01 UTC followed by `delivery.read` 00:28:02 UTC. Runtime logs show distinct successful `signer=instagram_product` and `signer=meta_app` X-Hub verification for these organic events. No duplicate send or pending/unresolved new action. The former tester ID has **zero** historical signed IG inbound and **zero** outbound actions attributed to it, while the studio owns live traffic.
- Remaining durability gap: `InstagramAccessTokenManager` uses expiry-based refresh within 7 days of expiry, but without a proactive timer a studio inactive for 60 days could miss that refresh window. This release adds a **non-sending 6-hour maintenance** pass, only for a currently unexpired, required-scopes, one-to-one alias with independently verified historical signed inbound. It invokes existing advisory-lock-protected encrypted-token renewal only in the 7-day window; no legacy tester refresh and no external sends. On actual refresh, newly issued token must resolve via Graph `/me` to the durable Professional account alias **before** the replacement token can commit. Errors only log aggregate counts.
- New long-lived grant is less than 24 hours old on Oct 30; per Meta's official refresh documentation, it cannot yet be refreshed. Unit/CI tests for the refresh branch are not a live refresh proof. Legacy retirement remains conditional on replacement resilience and all owner-authorized safety gates; don't force refresh prematurely, don't change masked Hostinger env values, don't enable Meta App Review #169 or send unsolicited DMs.

### 2026-10-30 — Production Hostinger shutdown/startup coordination

- Live Hostinger logs identified a startup race during the new OAuth maintenance deployment: SIGTERM arrived at 00:38:47.050Z while Meta reconciliation was in flight; background workers then started at 00:38:47.191Z after the shared PostgreSQL pool began closing. Repeated worker iteration errors followed, while another instance remained ready.
- Fix tracks the asynchronous startup promise, waits for it before shutdown closes shared resources, and prevents worker or timer startup after SIGTERM, including signals during server.listen.
- New owner-authorized encrypted studio Instagram grant had already passed Meta Graph reconciliation and fresh signed DM/response/echo/read-receipt proof. Retire old tester only after production lifecycle fix passes CI and fresh runtime readback confirms no ongoing errors; preserve credentials and zero queued sends throughout.

### 2026-10-30 — Instagram OAuth renewal alerting and one-time verification

- Permanent 6-hour Instagram OAuth maintenance remains scoped to the owner-authorized studio Professional account `17841438662359631` and durable encrypted subject `28436714725987041`; no legacy tester credential remains.
- Any failed eligible maintenance pass is now logged at WARN using **aggregate counts only**, so production monitors can alert without exposing tokens, ciphertext or customer IDs. Successful due renewal passes remain INFO.
- The existing Instagram signing proof automation (now fulfilled) is reused for a daily conditional renewal watch starting Oct 31, 2026 08:15 Asia/Manila. The studio long-lived token was issued Oct 30 07:52 local, and Meta prohibits refreshing it before it is at least 24 hours old. The automation must fail closed if no secure server-side execution path exists. After an actual controlled one-time renewal with independent provider/account/expiry verification, any temporary test infrastructure and the test instructions in the automation prompt must be removed; permanent scheduled maintenance and renewal-failure monitoring stay enabled. No temporary test code or early refresh was deployed as part of this change.


### 2026-10-30 — Phase 1 isolated Docker integration lab verified

- Owner approved Phase 1 local integration testing using installed Windows Docker Desktop. Local Agent successfully connected to Docker Desktop Linux engine v29.9.2, Compose v5.6.1. The isolated development worktree is `D:\projects\openai\ishikeit\phase1-docker-20261030` starting at app main SHA `ee2285188f559df81dd715b5cc2bacedc8b5d1ea`. Existing user worktrees/main remain untouched.
- Added `compose.test.yaml`, `scripts/test-docker.ps1`, and `docs/PHASE1_DOCKER_TEST_LAB_2026-10-30.md` with Node 24 and PostgreSQL 17. The test DB is never port-published; the code is mounted read-only and whitelisted copies run in the container filesystem. No production .env, credentials, WhatsApp/Instagram endpoints or customers enter the stack. Existing tests' local-only URI guards remain unchanged. The PowerShell wrapper removes named test containers, networks and volumes even when tests fail.
- Initial Docker Node24/PG17 `npm run check` ran successfully after resolving a Docker read-only nested mount issue: **497 tests in 67 files**, including **8 actual PostgreSQL integration tests**, plus ESLint, TypeScript and production build. Real-world provider traffic and app deployment not exercised by this isolated baseline. Final PowerShell runner was rerun successfully after escaping Compose variable interpolation and source allowlisting: 497/497 tests passed again; final `RUNNER_EXIT=0`; zero named project containers, volumes, or networks remained. A temporary nested-volume mount failure and a Compose shell-variable interpolation failure were corrected; abandoned draft test volumes were individually verified and removed.
- Approved future architecture: Phase 3 private unified inbox at `apps.ishinaillab.com`; Phase 4 custom WordPress bridge must be fully rebranded to **LatePoint Addon - Ishikeit Automation** with safe option/key/event migration (GitHub #192). Neither phase is activated by this Phase 1 test-only change.

### 2026-10-30 — PostgreSQL idle-connection resilience (Phase 1)

- Source review identified that `PostgresDatabase` constructed `pg.Pool` without an idle-client `error` listener. The official node-postgres Pool documentation says a lost idle PostgreSQL connection emits `error` and with no listener can terminate the entire Node process during failover/network interruption. This is distinct from rejecting an in-flight query, which must not be automatically retried when a send may have occurred.
- Added a Pool-level idle-error listener that catches and removes the failed connection through the library's normal behavior, emits only validated 5-character SQLSTATE (or null), and isolates failures of the optional diagnostic callback. Production HTTP process logs a safe WARN without database URI, SQL, error body or credentials. It does not retry Meta sends or change transaction semantics.
- Added two true PostgreSQL17 integration tests under strict localhost/test-DB guard: terminate one idle backend with `pg_terminate_backend` and verify SQLSTATE warning plus a new backend ID/recovery even when the monitoring callback throws; then repeat without a callback to prove no unhandled idle-client crash. GitHub PostgreSQL CI job now runs them in addition to existing outbox/OAuth integration cases.
- Verified on Windows Docker Desktop using the self-cleaning Phase1 PowerShell runner: **499/499 tests in 68 files, including 10 real PostgreSQL tests, ESLint, typecheck and build all PASS**. Final runner exit 0, and no dedicated test project containers, volumes or network remained. This is source-and-disposable-DB evidence; no production database failure was induced and runtime deployment is separate.


### 2026-10-30 — Protected Phase 1 operational alert summary (PR #193; staged)

- Reused the existing authenticated read-only operational metrics snapshot to expose `GET /ops/metrics/alerts?window=60` behind the **same operator bearer** as `/ops/metrics`, response `Cache-Control: private, no-store`; input window 5–1440 minutes; failure gives 503 without exposing raw SQL or provider data. This is an aggregate read-only route, NOT an external alert sender or dashboard UI.
- Pure `evaluateOperationalAlerts` classifies current inbound processing failures (warning >=1, critical >=5), known-topic pending queue lag (warning >=5 minutes, critical >=15 minutes), and recent dead letters (warning >=1, critical >=5), suppressing queue lag when its worker is explicitly disabled. Only known queue names, counts and bounded lag are returned; no customer identities, text, access tokens or raw errors.
- Endpoint + classifier tests verify authentication 401, bad window 400, authorized warning 200, secret exclusion, threshold rules and unknown-topic exclusion. These are **not worker heartbeats** and an empty queue does not establish actual worker liveness. Durable heartbeat, independently authenticated notification delivery and production monitoring are separate follow-up milestones.
- Final local Windows Docker Desktop run on Node 24 / PostgreSQL 17: **505/505 tests, 69 test files, including 10 genuine PostgreSQL integration tests**, plus ESLint, typecheck and build PASS. Runner returned 0, with zero disposable Ishikeit test project containers/volumes/network left. PR #193 contains all changes, is subject to four GitHub CI checks, and **must remain unmerged/undeployed for now** to preserve production until deliberate release verification. No live message, provider token or user/booking data was touched.


### 2026-11-01 — Phase 1 verification on relocated D: Docker Desktop

- Owner explicitly requires manual BitLocker unlock for D:. Docker Desktop
  autostart and BitLocker auto-unlock remain **off**. Windows WSL Docker distro
  registration was independently read back under
  `D:\projects\docker\data\DockerDesktopWSL\DockerDesktopWSL\main`.
  Existing older D: disk and both offline recovery backups remain preserved.
- Resumed open held PR #193 from local independent worktree, with GitHub CI
  four jobs passing. Ran its `scripts/test-docker.ps1` on the relocated
  Docker Desktop Engine 29.9.2 / Node.js 24 / PostgreSQL 17:
  505/505 tests passed (69 files), including 10 real Postgres integration tests;
  ESLint, typecheck and build passed, with **zero** test containers, volumes
  and networks left after cleanup.
- Follow-up Phase 1 enhancement implements protected, strictly local-process
  worker-loop diagnostics via `GET /ops/workers/local`. Instrumented inbound
  processor and outbound dispatcher loops without changing send policies or
  retries. Requires `OPS_METRICS_TOKEN`, never exposes messages/tokens,
  explicitly flags `scope=local_process`, records idle/working/stalled/
  long-running states and iteration failures. Instrumentation callback errors
  cannot crash workers. This is **not** distributed liveness or a replacement
  for durable per-instance heartbeats and external alert delivery.
- Final isolated Docker run after adding direct inbound/outbound loop observation tests:
  **513/513 tests passed across 71 files**, including 10 real Postgres
  integration cases; lint, TypeScript, build and zero leftover disposable
  containers/volumes/networks verified.
- **Release hold:** Phase 1 PR #193 remains unmerged, no automatic Hostinger
  production deployment, no changed Meta credentials and no customer sends.


## 2026-11-01 — Issue #194 durable worker monitoring follow-up (under review)

- Phase 1 PR #193 was merged and deployed from main commit `3bce44b806367b7f39891a7f543295c0f43f31d1`, Hostinger build `01a19441-a8f7-721a-bdb5-f303876eeae2` completed. Production health/live, health/ready, health/build returned 200 and unauthorized operations readback returned 401/no-store.
- Separate draft PR #195 proposes instance-aware durable worker heartbeat records in PostgreSQL with no customer identifiers; local in-memory observation remains distinct from cross-process DB evidence. A per-process random identifier and individual worker statuses are written every 15 seconds; only currently observed instances within a 15-minute window are exposed through bearer-protected `/ops/workers/fleet`.
- Stale threshold is provisional 45 seconds (three intervals). Explicitly disabled and cleanly stopped workers are not classified as stale; unexpected process loss remains stale until the observation window expires. The endpoint does not prove expected-replica count, post-lookback process loss, or an independently running watcher.
- This branch is NOT production released. Apply a reviewed additive RLS-protected Supabase migration before deployment; verify app CI + isolated PostgreSQL failure-injection tests. No direct customer/provider messages, live token changes or payment/booking effects. Independent operator alert delivery, subscription/approval, dedup and recovery remain in #194.
- No WordPress premium plugins, provider global policies, Meta App Secret proof rollout, WhatsApp reminder consent, or TikTok messaging approval gates are changed.


## 2026-11-01 — Issue #194 production monitor postdeploy diagnostics

- Phase 1 follow-up PR #195 merged to main `104b6eebcd567c22f24cb042ca09c2692e3e2913`, official Hostinger Node 24 build `01a1946a-0733-71f6-9cc6-2d8524b18f30` completed. Health endpoints responded 200, new private Supabase worker heartbeats began reporting running inbound/outbound processes, no user/customer data queried.
- Production log showed recurring sanitized `operational incident scan unavailable` WARN after startup, despite successful heartbeat writes and working HTTP health. This remains an unresolved incident; do not mark monitoring healthy based on compilation/health alone.
- Follow-up patch adds only explicitly allowlisted monitor step (`metrics`, `fleet`, `evaluate`, `persist`, `deliver`), exception class and syntactically validated SQLSTATE to existing warning logs. Raw SQL errors, secrets, message content and database URLs are never emitted. Review log after controlled deployment and fix the actual root cause, not just silence warnings.
- Separate hourly independent hosted watch was appended to existing enabled WordPress Security Closure automation, preserving original prompt and schedule, because creating another active task exceeded the 5/5 limit. External approved operator webhook remains OFF and cannot be activated without separate destination approval.


## 2026-11-01 — Hostinger log transport does not preserve structured Pino fields

- PR #196 deployed production diagnostic classification from SHA `60028f5ddf4ed32cfa3536ddfdd34f2a7b86ada5`, Hostinger build `01a1946e-342d-7248-90bc-329a1f6ca7de` completed. Hostinger Node runtime log API returns only `timestamp`, `level`, and `message` and discards extra Pino fields. A sanitized warning still appeared but its stage could not be read through the official API.
- This narrow follow-up embeds only fixed literal stage names, hard-allowlisted exception class and five-character sanitized SQLSTATE in the message text. Never include raw DB errors, SQL, request bodies, recipients, credentials, or provider diagnostics. Must use production log readback to identify and fix the incident, not suppress it.


## 2026-11-01 — Issue #194 planned rolling-restart heartbeat supersession

- After initial deployment of PR #195, authorized Supabase aggregate readback confirmed durable inbound/outbound worker heartbeats (2 instances per worker) and protected incident scanner creating `stale_worker` critical counts from superseded instances after repeated Hostinger rolling deployments. This is a classification false-positive risk: old worker rows remain visible for 15 minutes even when replacement process is healthy.
- PR #196 and #197 added safe failure-stage logging through the limited Hostinger runtime-log API; no raw database/SQL/provider error text is emitted. This patch is independent from diagnosing warning sources.
- This follow-up adds immutable `instanceStartedAt` timestamp for each process observation identity, persisted into nullable `process_started_at` on worker heartbeat rows. The additive Supabase migration `20261101001257_ishikeit_worker_process_birth` has been applied. Old rows are left nullable, not backfilled with invented timestamps.
- During read-only fleet classification, a stale record is `superseded` (not incident) only if another healthy instance of the SAME worker type was born strictly AFTER the stale instance's last observation. A previously-existing surviving replica is NOT considered a replacement and cannot silence a genuine same-deployment worker loss. Readback still declares `scope=observed_instances` and does not assert an expected replica count. No new sender or customer traffic.
- PostgreSQL integration tests updated for additive field; unit tests cover both genuine replica loss and rolling replacement. Release only after all CI jobs and production heartbeat/incident readback pass. Protected data remains RLS-on with no client grants.


## 2026-11-01 — Isolate background incident metrics from expensive dashboard queries

- PR #198 deployed worker process-birth supersession release `bd6f086ec05fc5e1c5b98107d84bfc8195438754` (Hostinger build `01a19476-7526-726e-950b-bc711d95bbea`). Independent Supabase readback after deployment showed fresh heartbeats with new `process_started_at`; previously firing `stale_worker` critical incident became `active=false` (recovered).
- Subsequent Hostinger runtime logs intermittently showed `operational incident scan unavailable phase=metrics class=unknown sqlstate=XX000` and an outbound worker iteration error, despite healthy public health routes and heartbeat persistence. Supabase SQL dashboard queries individually succeeded through admin role; this does not prove their combined per-process runtime safety. Reproducing ambiguous XX000 by triggering production DB disruption is forbidden.
- The incident timer previously invoked the expensive SIX-query `PostgresOperationalMetrics.snapshot` every 60sec per process, including receipt correlation LATERAL, percentiles and unrelated dashboard analytics. New `PostgresIncidentMetricsReader` instead uses THREE bounded, lightweight aggregate SELECT queries only for active failed inbound, known queue backlog/recent dead letters and Meta 429 attempt count; no customer identifiers, message bodies or provider sends are read. Full `/ops/metrics` dashboard endpoint remains unchanged. The pure alert evaluator now accepts its minimal required structural input, allowing existing full snapshot callers and minimizing unnecessary production DB pressure.
- Tests assert aggregate classification, input window validation and absence of expensive joins/percentiles. After CI green, deploy via GitHub and verify real Hostinger warning frequency plus PG heartbeat/incident readback before declaring the operational scanner healthy. `XX000` could still indicate an intermittent PostgreSQL backend failure; do NOT claim root cause fully proven if warnings persist.


## Telegram Chat Automation correction and live failure (2026-11-01)
- **Current owner-confirmed official Telegram handle: `@ishinaillab`, not `@ishinaiilab`** (visually similar previous documentation/default error). The actual automation bot remains `@ishinailbot`. Free Chat Automation is supported by Telegram since 2026-05-07; owner connected it from Settings → Chat Automation.
- Owner confirms Chat Automation allows **All private chats except…**, excludes no chats, and permits Read Messages and Reply to Messages. Therefore, additional Premium subscription or broad profile/deletion/stories/gifts permissions are **not** required for automated replies; recommend least privilege.
- On 2026-11-01, exact production SHA `e39a94a572bd369efa5fbdff5eebf1b6d975300d` and masked Hostinger env-key inspection confirmed **`TELEGRAM_BUSINESS_USERNAME` absent** and old code fallback **`ishinaiilab`**. This makes `getBusinessConnection` reject the correctly named owner `@ishinaillab`, and the app acknowledges rejected `business_message` without recording it or replying. This is a deterministic code mismatch given the owner-reported official username; the downstream live send remains to be verified.
- Read-only Supabase/Hostinger evidence before fix: nine direct-bot `message.received` events and nine published direct-bot sends; 37 `edited_business_message` notifications ignored safely (all from bot senders), **zero verified new customer `business_message`** and **zero connected-Business-account outbound sends**. Seeing edits is not a substitute for a real customer-originated message. Existing webhook getMe/allowed-updates had passed earlier checks.
- PR #208 corrects the exact default to `ishinaillab`, updates free Chat Automation guidance, preserves strict owner authorization and adds regression tests (including rejecting the visually similar old typo). Isolated Node24/PostgreSQL17 Docker test suite: **550/550 tests, 77 files, lint/typecheck/build passed** on PR head `b240b5f32d285e3ec552fb331ba27772b0e74b09`. CI failure on first run was solely missing this required durable-context update; this addendum closes that project CI requirement. Complete CI, merge and verify exact Hostinger deployed SHA, then fresh authorized tester-origin `business_message` to the official account with one business-scoped reply. **Never claim end-to-end success until real provider proof.**
- Do not change masked Hostinger env via full-replacement API, do not rotate bot token or alter user Telegram settings as a workaround; current free Chat Automation settings are sufficient. Never bypass owner authorization or increase permission grants.


## Phase 2 provider hardening candidate — 2026-11-01
- After live official Free Chat Automation E2E pass on `@ishinaillab` (Issue #205 closed), user requested rigorous repair of the remaining Phase 2 audit in Issue #207. Work is isolated on branch `fix/phase2-provider-hardening-20261101` under `D:\projects\openai\ishikeit\phase2-provider-hardening-20261101`; canonical local checkout and its seven unpublished edits remain untouched.
- Implemented Telegram durable at-most-once send fence using the existing production `meta_send_started_at` column (no schema change), explicit nonambiguous 429 retry, quarantine after lease expiry/unknown outcome, bot-to-bot loop exclusion, bounded API response and redirect rejection, optional immutable owner ID pin (not yet set in production).
- Implemented signed WhatsApp/Meta webhook request limit up to 3MiB, Instagram comment/mention webhook preservation for both official Meta notification envelope shapes (non-AI), Messenger/Instagram exact customer automation opt-out + durable handoff and one functional confirmation, and an evidence-based account capability registry groundwork. The registry is not an automatic plan-detection system or Phase 3 UI.
- Full technical scope, authoritative references, regression gates, remaining external entitlements and security holds: `docs/PHASE2_PROVIDER_HARDENING_2026-11-01.md`. Reverify actual latest PR, CI, exact Hostinger deployed SHA and test counts before claiming production rollout. Do not enable TikTok Messaging without the separate permission, do not submit owner-held Meta App Review, do not enable WhatsApp reminders with zero verified opt-ins or patch premium WordPress plugins.


## Phase 2 follow-up — suppress opt-out reply dead letters (2026-11-01)
- Review of the deployed #209 code identified a transactional interaction: the Messenger/Instagram explicit automation opt-out queues a confirmation message and records a durable Meta handoff in the same transaction. The Meta outbound adapter correctly checks the handoff and refuses **all** automated sends, including that confirmation; this would produce a dead letter for a legitimate opt-out, although no actual post-deployment opt-out events were recorded when inspected.
- The safe correction ensures explicit opt-out commands (`STOP`, `unsubscribe`, `opt out`, and existing longer phrases) produce **zero** automated outbound actions and a durable `customer_automation_opt_out` handoff. The operator can follow up manually. Outbound handoff enforcement stays strictly fail-closed, with no special-case bypass.
- Fix implementation, regression and Node24/PostgreSQL17 verification should be linked to their actual PR and merge SHA after GitHub CI. Do not report deployed until Hostinger exact-SHA readback.


## Phase 2 minimatch advisory patch candidate — 2026-11-01
- Upstream advisory **GHSA-g3hv-75wg-m249**, patched in minimatch **11.0.1**. Hostinger flagged minimatch **10.2.6**, pulled by ESLint and TypeScript-ESLint development tooling, not the application runtime dependency graph.
- Separate isolated D: worktree `phase2-minimatch-release-20261101` tests an exact `minimatch: 11.0.1` root npm override and generated lockfile, with Node24/PostgreSQL17 full test/compile gate. Do not claim deployment until GitHub CI and Hostinger package readback demonstrate the patched version. No forced broad dependency upgrade and no changes to production tokens, provider configuration or local canonical dirty edits.
- The opt-out atomic handoff correction has been merged in PR #210 SHA `98a4f68cac8fb4b720fc6fe2b0a773b42119177c`; verify its Hostinger deployment independently.


## Instagram webhook read-before-write startup reconcile (2026-11-01)
- Exact deployed pre-fix SHA `df5c015797463378aa978d81638f51fbb4d17ca5` had clean Hostinger npm scan (0 vulnerabilities), healthy /health/live and /health/ready, and 134-135 completed worker heartbeat iterations within ~2 minutes of startup; outbound_dispatcher had one startup error, then recovered. Instagram OAuth and managed-account startup both logged retryable provider 613 from unconditional `POST /me/subscribed_apps`. Meta app-level API usage was healthy (0%, provider connector), subscriptions present for Messenger/Instagram/WhatsApp; true endpoint-level rate-limit state remained unknown.
- New isolated D: worktree `phase2-ig-subscription-audit-20261101` upgrades Instagram account subscription reconciliation to verified-app read-before-write, conditional POST only for missing fields, preserve additional field subscriptions, fail closed on 613/5xx, fallback only on unsupported GET 400/404. Official authority: Meta IGUser subscribed_apps GET and Instagram webhook POST docs. No token, webhook config or provider subscription changed during tests.
- Full isolated Docker Node24/PostgreSQL17 verification: **576/576 tests in 79 suites, lint/typecheck/build pass**. To claim deployed, check PR/CI GitHub main exact SHA, Hostinger exact SHA, runtime logs and live signed inbound separately. Previous seven dirty canonical checkout files remain untouched.


## Hostinger startup ordering fix — 2026-11-01
- Deploy of #212 (`383095f2687257c6ab576dc735c541b4f66fb7be`) passed all tests and builds, but Hostinger logged a startup warning that `listen()` was not called within three seconds. Production eventually did listen and its health checks + workers recovered. The actual code awaited Instagram OAuth, managed account, and Messenger external Graph API reconciliation *before* listen; Meta 613 throttling delayed socket activation.
- New isolated branch `fix/phase2-ig-startup-order-20261101` moves provider subscription reconciliation after successful `server.listen` and after inbound/outbound workers start, running best-effort and fail-closed without blocking liveness. It retains OAuth/schema checks and TikTok durable credential checks before listen. Tests check startup ordering and all established channel behaviors. On provider 613/5xx, don't retry in a loop or change account settings; manual/provider-side throttling may remain.


## Booking-concierge live-message audit and native LatePoint addon (2026-11-01)
- New real channel text tests after 2026-11-01 11:22Z: Messenger 2/2, Instagram 7/7, WhatsApp 8/8, Telegram bot 2/2 handled/published, 0 pending or dead. Need separate after-fix acceptance of booking tool and official Telegram account.
- User asked in WhatsApp/IG to fix repeated rejected 8AM slot, provide fresh exact-time recheck before a signed booking link, never promise invented hold expiry, and identify AI accurately. Owner-facing full original message analysis, primary-source LatePoint findings, tests and implementation: docs/BOOKING_CONCIERGE_2026-11-01.md.
- Website LatePoint 5.7.5 checkout-hold toggle `reserve_slots_during_checkout` currently **off**. LatePoint check-slot-availability + get-available-slots are the official non-PII availability abilities. Old signed link with service_id=0/agent_id=0 rendered HTTP200; Ishi LatePoint Instant 1.9.0 intentionally uses saved service=1/agent=15 fallbacks; need further UI checkout reproduction for user-reported error.
- New versioned source plugin `wordpress/latepoint-addon-ishikeit-automation` defines a WordPress read-only verified-booking-link ability wrapping native LatePoint check and existing Instant URL generation in one server request; no customer bookings/holds created, strict service/agent, declining-times, alternatives and no-fabricated expiry. PHP lint & stub tests; activation, live ability readback, AI Engine active `default` bot instructions and canaries are separate acceptance gates.
