# Ishikeit — verified continuation checkpoint
**Checkpoint date:** 2026-10-30, Asia/Manila
**Scope:** Ishikeit app, Meta Messenger / Instagram / WhatsApp, provider-neutral architecture, production and Supabase, related WordPress bridge, TikTok/Telegram coordination, engineering safety holds.
**Repository:** https://github.com/ishinaillab/ishikeit
**Database repository:** https://github.com/ishinaillab/ishikeit-db
**Production:** https://apps.ishinaillab.com
**Primary detailed cumulative history:** [docs/CONTINUATION.md](./CONTINUATION.md)
**Instagram security and migration evidence:** [docs/META_INSTAGRAM_WEBHOOK_SIGNING_AND_UNIFIED_LOGIN_2026-10-29.md](./META_INSTAGRAM_WEBHOOK_SIGNING_AND_UNIFIED_LOGIN_2026-10-29.md)

## 1. READ THIS FIRST IN THE NEXT CHAT

The user wants sustained, implementation-first engineering, not instructions that make them operate developer consoles, PowerShell, or Hostinger unnecessarily. Use connected tools (Meta Social Technologies MCP, GitHub, Ishi Local Agent on Windows, Hostinger Official MCP, Supabase, WhatsApp Business Tools, and official provider documentation). Verify the exact live state before changes; cite official documentation; use modern recommended standards; modify code through a branch + PR with tests/CI, merge only after CI, verify Hostinger exact deployed commit SHA, liveness/readiness, and where applicable the real provider outcome. Do not claim code-only changes repair provider revocations or pending approval. Do not repeat the same steps or questions already settled below.

**As of the handoff, there is no user authorization to**:
- submit Meta App Review or Advanced Access (owner HOLD in issue #169);
- turn on Meta dashboard's global Require App Secret or production META_GRAPH_PROOF_ENABLED;
- rotate/revoke/retire either Instagram credential, overwrite masked provider secrets, or bypass account-owner OAuth consent;
- send any further Meta webhook samples, send unsolicited customer messages, or replay historical failed/dead-letter outbound messages;
- dispatch proactive WhatsApp reminders without approved template and valid recipient opt-in;
- make undocumented Unified Login cutovers, change live webhook subscriptions unnecessarily, or perform paid/irreversible infrastructure changes;
- modify held premium WordPress components under the separate WordPress security workstream.

The owner **previously approved exactly ONE** Meta developer Instagram/messages sample on app 1042452472116584. That authorization was consumed, the sample authenticated on 2026-10-29T14:43:48Z, and it is **not** authorization for another sample. Keep the existing signing proof automation active.

## 2. EXACT LATEST VERIFIED PRODUCTION / ENGINEERING STATE

**Hostinger production deployment:** commit `4678312bf47821ad13933445d31e708897887d3b`, completed at `2026-10-29T16:14:20Z` = Oct 30, 00:14 Manila. It is the merged [PR #183](https://github.com/ishinaillab/ishikeit/pull/183), titled *Fence Meta-rejected Instagram OAuth tokens before outbound dispatch*. GitHub PR CI workflow run `40909295909` completed SUCCESS. Independent read-only HTTPS tests returned **HTTP 200** from BOTH `/health/live` and `/health/ready` during this checkpoint. Production main app is Meta Live.

**Open GitHub issues (ONLY TWO, as checked at checkpoint):**
- [#176](https://github.com/ishinaillab/ishikeit/issues/176): failing stored **legacy Instagram tester OAuth grant**. Meta Graph GET /me returns HTTP 400 / OAuthException code 190 / numeric error_subcode 0. **Still unresolved.** Needs the genuine owning account's OAuth consent to reauthorize, or separately approved retirement if proven unused. Cannot infer which subcase from subcode=0. Do not delete or rotate the healthy managed studio account.
- [#169](https://github.com/ishinaillab/ishikeit/issues/169): explicit **NO SUBMISSION** Meta App Review / access release hold. Live Meta app App Review status confirmed `NO_SUBMISSION` on this checkpoint. Do not close or submit without separate owner approval.

**Closed issue:** [#159](https://github.com/ishinaillab/ishikeit/issues/159), Meta outbound duplicate-send safety. Source code, isolated PostgreSQL 17 CI tests and live 0-pending/0-armed/0-unknown case verification backed closure. Outbound delivery semantics are conservative **at-most-once attempts with quarantine** for ambiguous outcomes, *not* a guarantee of exactly-once customer delivery. Never replay historical dead letters.

**Post-deployment live runtime:** current logs at 2026-10-29T16:14Z show repeated safe `legacy OAuth Graph code190 / subcode0` startup diagnostics and successful **separately managed Instagram reconciliation**. No Instagram signer-class log (`signer=meta_app`, `instagram_product`, `both`) observed during the inspected post-release window. A successful code deployment does NOT close #176 or establish which HMAC key signs genuine traffic.

**Latest WhatsApp template check:** WABA `4663054720683021`; template `ishi_appointment_reminder_v1` ID `1674861800945394`, `en_US`, UTILITY, still **PENDING**. Supabase read-only query in this checkpoint found **0 opt-in records, 0 reminder slots**, so no proactive reminder dispatch. Existing template-review automation remains enabled.

**Supabase read-only security baseline:** In preceding verified pass, all 15 tables inspected in `public` had Row Level Security enabled and no anon/authenticated SELECT table privileges. In preceding post-#182 verified check, 0 pending outbox jobs, 0 armed-but-unresolved send fences, 0 recorded ambiguous provider-unknown dead letters. These outbox counts were last successfully queried before this checkpoint and must be refreshed if a current operational claim is needed.

## 3. CRUCIAL META IDENTITIES AND SECURITY CONFIGURATION

- Main Ishikeit Meta app ID **1042452472116584**, Live; webhook topic subscriptions for `instagram`, `page`, and `whatsapp_business_account`.
- Separate Instagram Login **product** App ID **2316046942582053** (provided/confirmed by owner inside Meta's Instagram API setup), with distinct app secret `META_INSTAGRAM_OAUTH_APP_SECRET`. It is not independently returned as a separate managed Meta app by the connected Meta developer-app listing.
- Shared meta webhook: `POST https://apps.ishinaillab.com/ishikeit/webhooks/meta`, exact callback address verified by owner. Do not resurrect old `/ishi/webhooks/meta`.
- Facebook/Meta main app secret `META_APP_SECRET`. Instagram product-specific secret `META_INSTAGRAM_OAUTH_APP_SECRET`. Never display or replace either. Meta webhook `X-Hub-Signature-256` HMAC-SHA256 validation uses **original raw request bytes**.
- Shared handler accepts an authenticated `object=instagram` from main or configured Instagram product secret during migration; `page` and `whatsapp_business_account` must validate using **main app** secret and cannot be authorized by Instagram product secret. Wrong/missing HMAC fails 401. PR #175 fixed signing scope.
- Meta **one-time authorized Instagram/messages webhook sample**, enqueued successfully and authenticated by deployed production at `2026-10-29T14:43:48.757Z`. It did **not** produce a new normal customer inbound row, so prove HMAC acceptance only, not end-to-end client AI response. Hostinger formerly omitted structured Pino signer field.
- PR #177 changed safe log message to `Instagram webhook signature verified: signer=<category>`, where category is one of `meta_app`, `instagram_product`, `both`; no token, raw payload, message or user data. Await an organic event **after PR #177 deployment** to establish the actual signer identity; existing automation handles this.
- Messenger Page ID **1152841001256379**. WABA **4663054720683021**, Meta Business **1030506726679124**, WhatsApp phone-number ID **1416383858214802**. Messenger production Page access token and WhatsApp System User token were verified via Meta `/debug_token` as belonging to main app; WABA System User token has required WhatsApp scopes. Messenger Page token scopes include `pages_messaging`, `pages_show_list`, `pages_manage_metadata`, but not `pages_read_engagement`, so a generic `GET /me` check is not an adequate Page-token preflight.
- PR #174 changed signed Messenger preflight to Page `/{pageId}/subscribed_apps?limit=100`, deriving Page ID from debugger and verifying own app's subscription. Production private GET `/ops/meta/graph-proof-preflight` on `2026-10-29T13:31:35.464Z` returned `status=ok`, **Messenger proof_compatible**, **WhatsApp proof_compatible**, `graphProofFlagUnchanged=true`.
- `META_GRAPH_PROOF_ENABLED` remains OFF; Meta app-wide **Require App Secret** remains OFF. Code includes signing compatibility but full send-path enforcement/toggle is not authorized.
- Graph API release observed `v26.0`; Meta developer-tool checks showed no app-specific deprecation warnings in the preceding pass. Continue version-by-version official documentation reviews; do not mistake older Meta 2024 migration instructions for current Unified Login.

## 4. MOST RECENT IMPLEMENTED WORK (MERGED AND VERIFIED)

Chronology (all links are canonical):
- [PR #174](https://github.com/ishinaillab/ishikeit/pull/174): Page-scoped Messenger `appsecret_proof` preflight using subscriptions; signed Messenger+WhatsApp live proof compatible.
- [PR #175](https://github.com/ishinaillab/ishikeit/pull/175): bounded dual-product-secret Instagram webhook verifier with cross-channel isolation. Lint/typecheck/build/458 tests locally passed.
- [PR #177](https://github.com/ishinaillab/ishikeit/pull/177): safe Instagram signing-key category in Hostinger-visible log message. Do not repeat unauthorized webhook samples to populate it.
- [PR #178](https://github.com/ishinaillab/ishikeit/pull/178): Meta Graph code190 numerical subcode diagnostics and clear `reauthorization_required` classification; live provider code190/subcode0, not a more specific cause.
- [PR #179](https://github.com/ishinaillab/ishikeit/pull/179): current June 2026 Messenger `sticker` attachments and April 2026 Instagram `ig_post` / post/reel share metadata; bounded title, preserve original metadata, dedupe legacy dual share context. Based on official Meta platform changelog.
- [PR #180](https://github.com/ishinaillab/ishikeit/pull/180): Instagram `is_self` without echo must **not** trigger AI customer response; self events classified `message.self`, true echoes remain echoes, historical misclassified events fail closed in handler. Official Meta self-messaging specification.
- [PR #181](https://github.com/ishinaillab/ishikeit/pull/181): isolated PostgreSQL 17 CI integration for concurrent outbox workers, pre-POST durable fencing, crash/lease expiry quarantine, ordering and definite non-ambiguous HTTP 429 retry. Production DB NOT used.
- [PR #182](https://github.com/ishinaillab/ishikeit/pull/182): operator-only unknown-outcome attestation ledger tested on disposable PostgreSQL 17: cannot resend/requeue, repeated identical review idempotent, conflicting review fails, message and recipient data not exposed. All CI green; issue #159 closed.
- **[PR #183](https://github.com/ishinaillab/ishikeit/pull/183): latest, merged and deployed, exact production SHA above.** The old Instagram OAuth token has future cached expiry but Meta itself rejected it with code190; an **in-memory SHA256 fingerprint guard**, marked only after genuine provider code190, refuses further outbound use of that specific legacy grant with `retryable=false`. It is scoped to OAuth subject and professional aliases; no fallback from the healthy independently managed IG token to a different account. If owner reauthorizes and a new stored token is read, its new fingerprint clears the guard without a restart. No token readback, rotation, DB change, or sender swap. Live startup still logs old grant failure; that is expected until genuinely reauthorized/retired.

**CI** includes Node 24 lint/typecheck/Vitest/build, PHP bridge lint, context-continuity guard requiring `docs/CONTINUATION.md` for material code/CI updates, and a disposable PostgreSQL 17 outbox-integration job. Latest #183 PR CI success `40909295909`.

## 5. DATA, HISTORICAL CHANNEL PROOFS AND LIMITATIONS

**Supabase project ID:** `vhmrliqemkfxblzsoyaz` (`ishikeit-db`), PostgreSQL hosted in Southeast Asia; project should be accessed through the installed Supabase connector. NEVER print or store connection-string passwords. Main tables include `inbound_events`, `outbox`, `outbox_attempts`, `oauth_credentials`, `oauth_account_aliases`, `oauth_revocations`, `meta_handoff_blocks`, `meta_native_routing_ownership`, `meta_outbound_reconciliations`, `meta_whatsapp_template_opt_ins`/`opt_outs`, `latepoint_booking_states`, `latepoint_reminder_slots`. Source SQL in `migrations/`; test-only databases strictly isolated from production.
- Historical provider-acknowledged outbound message sends before this checkpoint: **Instagram 37 acknowledged / 11 historical dead-letter**, **Messenger 39 / 0**, **WhatsApp 72 / 0**. These are not current proof of customer delivery.
- Earlier history includes Instagram 53 inbound received + 49 echoes; Messenger 51 inbound; WhatsApp 101 inbound; deliveries/read events and Instagram handover/standby are present. Counts from earlier read-only audit, not freshly re-run at checkpoint. Latest historical IG successful acknowledgment was Oct 25; old IG dead letters dated no later than Oct 3. No historical replay authorized.
- Stored legacy Instagram OAuth: one credential and one alias, with future stored expiration but Meta rejects it with 190/0. No matched historical Instagram inbound rows for that alias in the prior read-only join; cannot conclude safe retirement without owner identity/need verification.
- WhatsApp reminder setup not complete: PENDING template, zero recorded recipient opt-ins, zero booked reminder slots. Continue status watch, do not send.

## 6. OTHER ISHIKEIT PLATFORMS AND INFRASTRUCTURE

**Architecture:** Provider-neutral Fastify Node 24 application on Hostinger `apps.ishinaillab.com`; canonical webhook path `/ishikeit/webhooks/meta`; inbound normalization → durable Supabase event persistence / idempotence → AI processing through Ishi WordPress gateway → durable outbox → provider dispatcher with manual outcome quarantine; human handoff and channel-specific policy enforcement. Ops endpoints include liveness, readiness, protected Graph proof, Meta unknown-outcome reconciliation and Instagram OAuth diagnostics. Do not leak ops bearer `OPS_METRICS_TOKEN`.

**WordPress/AI Engine bridge:** Ishi Nail Lab canonical `https://www.ishinaillab.com`; WordPress Qwery Nails skin, Ishi AI Bridge v0.3.1 and Ishi Social AI Gateway `/wp-json/ishi-social-ai/v1/respond`; AI Engine bot `ishi-chatbot-v3-1`. ThemeREX Addons 2.47.0 baseline; Elementor fix 4.3.0, LatePoint Agent Portal 0.7.3, LatePoint Instant 1.9.0 and Unified Customer Dashboard 1.1.0 were user-locked baselines from separate website/security work. Authorization rewrite and LiteSpeed API exclusions previously applied. Preserve unrelated WordPress security/SEO workstream exclusions.

**TikTok:** Ishikeit TikTok Business API application approved historically; **Messaging API access is a distinct request**, and prior conversations state it was awaiting additional approval. Do not assume messaging is now granted without connector-backed verification. TikTok app's existing integration, webhooks, OAuth/capabilities and business marketing context reside in cumulative CONTINUATION and source; user instructed primary focus on Meta while waiting. Verify current rights before TikTok messaging sends.
**Telegram:** historical inbound/outbound bot tests passed; production activation was pending. Do not claim full public activation without live verification.
**Messaging platforms:** Instagram tester accounts historically `povnailstudio.ph` and `povnailstudio.com.ph` received automated replies; Messenger and WhatsApp also passed historically observed reply paths. These are historical tests, not license to send new messages to third parties.

**Ishi local Windows project path:** `D:\projects\openai\ishikeit\ishikeit` is the latest actual local repo used by MCPs, not the old obsolete C: path. Repository `ishinaillab/ishikeit`; database repository `ishinaillab/ishikeit-db`. Hostinger account/site owner username `u328762438` is established. The connected Hostinger official MCP was previously sometimes pointed at another account: verify returned domain/account, never assume.

## 7. EXISTING AUTOMATION WATCHES

- **Ishikeit Instagram Signing Proof** ID `6ae352c608788191a12365c883f497f2`: enabled as verified on checkpoint; monitor Hostinger production log messages **after PR #177** for actual authenticated `Instagram webhook signature verified: signer=meta_app|instagram_product|both`, report only category/time, then retire watch if its prompt says so. No synthetic additional webhook sends.
- **Ishikeit WhatsApp Template Review** ID `6ae26b15df748191ac5f799823f57ffc`: enabled, checks template approval; do not send while PENDING/without consent.
- **Meta Review Final Step** ID `6abd62fc82f4819186f7f144a0a8dfd5`: enabled, monitoring prerequisites only. **No submission**.
- Historical separate **WordPress Security Closure** task ID `6aca8be031c88191ae8f5cabd17c4446`: user hold on premium components, a different workstream.
- Historic weekly **Ishi Nail Market Brief** task ID `6ab4187c73d081919b1cc7133a18d7f6`: unrelated; do not change.

## 8. RECOMMENDED NEXT ENGINEERING SEQUENCE / ACCEPTANCE GATES

1. Read this checkpoint plus recent top sections of `docs/CONTINUATION.md`, current `main`, open issues, Hostinger deployment, runtime logs, Supabase schema/aggregates, active automations. **New chat must fetch fresh state before trusting this snapshot.**
2. **Legacy Instagram OAuth #176:** determine exact ownership/operational need via authorized account metadata without exposing any credential or user PII; distinguish already healthy managed account from failed legacy tester; preserve PR #183 fail-closed fence. Reauthorize only through genuine owner-approved OAuth, or retire only on separate confirmed authorization. No blind retry, secret rotation, or misrouted fallback.
3. **Instagram signer proof:** a valid test webhook already passed HMAC; monitor next organic authenticated event to learn signer category. Once proven, reduce unnecessary dual-secret acceptance if warranted and safe, while preserving Page/WABA main-app boundary. Do not claim category from old sample.
4. **Unified Login modernization:** owner saw a current Meta dashboard notice that *Unified Login is recommended / only path receiving new Instagram features*; old Instagram Login works but is legacy. Authenticated setup at `https://developers.facebook.com/apps/1042452472116584/instagram-business/Unified-Login-API-Setup/` was inaccessible through public tools; old public migration guide dated 2024 is **Facebook Login → Instagram Login**, not a proven Unified Login recipe. Obtain authoritative current authenticated Unified Login contract from a connected provider/browser tool before planning reversible token, account/IGSID mapping, scopes, callback, subscription and rollback. No speculative migration.
5. **WhatsApp:** keep monitoring template `ishi_appointment_reminder_v1` approval, validate source-backed opt-in, LatePoint lifecycle and timing; leave proactive sends disabled until all provider and consent gates verified.
6. **End-to-end and operations:** read-only checks of event/outbox health, native conversation routing/handoff, receipt mapping and all provider status gates. For further code changes use PR + CI + exact deployment/health evidence. Don't replay historic failed messages or send unsolicited canaries; operator-reviewed reconciliations are non-sending.
7. **Meta App Review:** remain **NO_SUBMISSION** until complete official compliance verification AND owner's separate approval. Keep issue #169 open deliberately.
8. Keep cross-platform TikTok/Telegram and related WordPress status in sight without letting it disrupt the Meta-priority work.

## 9. RESTART PROMPT FOR A FRESH CHAT

> Continue Ishikeit development from the verified 2026-10-30 handoff at `ishinaillab/ishikeit/docs/ISHIKEIT_CONTINUATION_2026-10-30.md` and cumulative `docs/CONTINUATION.md`. Read both from connected GitHub first; verify main SHA, Hostinger deployment, logs, Supabase and Meta official current docs. Current production baseline is `4678312bf47821ad13933445d31e708897887d3b` (PR #183), live/ready HTTP 200. Only open issues #176 (legacy tester OAuth Graph 190/subcode0, real consent required) and #169 (intentional NO_SUBMISSION App Review hold). #159 closed after PostgreSQL CI. Keep protected Instagram signer-identity watch, pending WhatsApp template/zero opt-in holds, and no global Require App Secret/graph proof toggle. Use all appropriate engineering tools to perform safe, standards-backed fixes and verify end-to-end; do not make me perform routine tool operations, do not expose secrets, send unapproved customer messages, replay dead letters, or initiate undocumented Unified Login cutovers. Save all subsequent changes to durable context.
