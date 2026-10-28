# Ishikeit Meta Messaging — Verified Production Continuation (2026-10-29, Manila)

**Scope: Facebook Messenger, Instagram, WhatsApp only.** The TikTok Business Messaging product is still waiting for separate provider approval. Do not change TikTok API scopes, OAuth, webhooks, flags, queues or development checkpoint when resuming this Meta-specific work.

## Source, deployment and CI

- Repository: `ishinaillab/ishikeit`, not retired `ishinaillab/ishi`.
- Source `main`: `73c5e87607707eb7084b606acf433ead2df06f1e` after PR #136.
- Hostinger app: `apps.ishinaillab.com`, Node.js 24 Fastify, account `u328762438`.
- Hostinger build `01a1835c-430e-733b-a2c9-f5044d0f8814` completed at exact source revision `73c5e876...`. Following it, direct HTTPS calls to `/health/ready` returned `{"status":"ready"}`, `/health/live` returned `{"status":"ok"}`, and a deliberately **unsigned** `POST /ishikeit/webhooks/meta` returned HTTP 401. No customer messages were sent by these checks.
- GitHub CI for PRs #134, #135 and #136: Node lint/typecheck/tests/build, PHP lint and context continuity all succeeded before each merge. Do not claim provider delivery merely from CI/build success.
- Latest Supabase queue check: **zero pending** jobs and **zero new dead letters during the preceding 24 hours** for the existing outbound topics. Historical dead letters remain recorded; never bulk replay them.

## Recent completed Meta code

1. PR #134 — provider-native ownership correctness and event ordering. Both Messenger/Instagram signed `pass_thread_control` and `take_thread_control` resolve ownership using the actual `new_owner_app_id`. Signed standby always blocks. New `meta_native_routing_ownership` table separates native owner state from AI-to-human handoffs so both can simultaneously block AI replies. Monotonic conditional UPSERT prevents older callbacks from clearing newer blocks and equal-timestamp conflicts favor `other_app`.
2. PR #135 — WhatsApp interactive list prompts reject more than **1024 characters** before making a Graph request. Regression tests accept 1024 and reject 1025, per Meta's InteractiveObject SDK reference.
3. PR #136 — signed WhatsApp STOP creates a durable, source-event-linked HMAC-recipient opt-out tombstone **even without an earlier opt-in**. Later delayed older opt-in cannot authorize a template send; final consent lookup checks the tombstone. Signed provider clock skew is handled conservatively so a future consent timestamp cannot make an immediate STOP violate the database revocation constraint.

All three changes are on main and deployed. No TikTok source files were modified. Ordinary 24-hour Meta customer-service policy, Graph redirect rejection, encrypted OAuth handling, outbox idempotency, native/human ownership checks and approved-template dispatch gates remain in place.

## Database migrations, verified

- `0006_meta_native_routing_ownership.sql`: applied through Supabase. New native-routing table exists, RLS enabled, anonymous/authenticated SELECT disabled, unique primary key installed. No legacy native blocks existed at preflight; new table had zero rows immediately after migration.
- `0007_meta_whatsapp_opt_out_tombstones.sql`: applied through Supabase. New STOP table exists, RLS enabled, anonymous/authenticated SELECT disabled, signed source-event FK installed and zero synthetic/unauthorized rows. Production PostgreSQL `EXPLAIN` successfully planned the exact new opt-in and STOP UPSERT contracts without executing them.
- Older `0003` human handoff, `0004` private WhatsApp opt-in, and `0005` Meta delivery indexes remain installed. Do not replace or reset production data.

## Current observed Meta channel evidence

- **WhatsApp:** A production read-only check over the preceding two-hour window observed **two** recently processed/handled signed WhatsApp inbound customer messages, **two** subsequently published Meta outbound actions with provider message IDs, and **two** matched provider `delivery.read` events using exact Meta channel, account ID and message ID. This is real production end-to-end delivery/read evidence, not a fabricated sender test. No customer content or identifiers were accessed or copied into this checkpoint.
- **Messenger:** Durable signed inbound messages exist; the most recent `message.received` in the read-only query was 2026-10-28 06:38:21 UTC. A fresh, intentional tester-originated canary is still necessary to claim the latest ownership/interactive features work end-to-end.
- **Instagram:** Durable signed inbound messages exist; the latest `message.received` in the read-only query was 2026-10-25 13:28:54 UTC. Separate studio managed Professional-account token previously passed exact signed inbox-account matching and provider webhook subscription reconciliation. A **separate OAuth tester credential** remains rejected by Meta Graph with HTTP 400/provider code 190 despite the local stored expiry. Fresh consented account-owner authorization is necessary for that tester; do not delete, swap or relabel its credential to hide the warning.

## External release gates that must remain honest

- Meta app ID `1042452472116584`: Live, business verified, but App Review was still `NO_SUBMISSION`, no Advanced Access grants, and app contact email unverified in the latest app-scoped read. The owner must verify email and supply a **real** Instagram Business Login/reply screencast before App Review submission.
- Current app-level Meta webhook fields: Page `messages`; Instagram `messages`, `standby`, `messaging_handover`; WhatsApp Business Account `messages`. Additional Page delivery/read/postback/handover and Instagram seen/postback fields need exact permission verification and Meta's provider-side confirmation workflow before mutation. Normalized support in source does not prove active webhook delivery.
- WhatsApp appointment reminder utility template `ishi_appointment_reminder_v1` has not been created/approved via the provider confirmation workflow. The production `META_WHATSAPP_CONSENT_HASH_KEY_B64` key and template-enable/allowlist settings were absent at last key-only inspection. Template dispatch stays **OFF** and signed opt-in capture dormant. Do not attempt Hostinger's destructive **replace-all masked environment** API with placeholders. A stable 32-byte secret needs a verified non-destructive provision mechanism, then real customer-origin consent and STOP/reopt-in canaries.
- Fresh Messenger and Instagram provider-origin test replies and receipt correlation are still unverified for this newest deployment. No unsolicited customer test messages or fabricated reviewer videos. Do not claim all Meta messaging is complete until these gates are checked.

## Next engineering work

Continue security/reliability inspections and small CI-tested provider-neutral changes strictly within Messenger, Instagram and WhatsApp. Verify any new source change against current main and production runtime. Do not replay historical dead letters. For provider credentials, email verification, Advanced Access, template submissions and webhook configuration changes, respect owner/Meta authorization and explicit confirmation requirements rather than inventing approvals.

The canonical earlier TikTok checkpoint remains `docs/TIKTOK_APPROVAL_WAIT_HANDOFF_2026-10-27.md` unchanged.

## New-chat transition: refreshed live evidence (2026-10-29, approximately 00:45 Asia/Manila)

This section supersedes earlier **source/deployment SHA statements** above but does not alter the product/permission constraints.

### Exact authoritative baseline

- Repository is still **`ishinaillab/ishikeit`**, production branch `main`. GitHub `main` at verification: **`47dc628526d117e2e0ca30f394fef539ce823f96`** (documentation-only PR **#137**).
- Hostinger latest completed build: **`01a18362-9fef-719a-9128-9a2cbd122572`**, with the **same exact** `47dc6285...` commit. Hostinger deployment time: 2026-10-28 **16:41:22 UTC**. Fastify Node 24, `apps.ishinaillab.com`, Hostinger `u328762438`.
- Independently queried HTTPS endpoints: **`/health/live` => `{"status":"ok"}`**; **`/health/ready` => `{"status":"ready"}`**; **`/health/build` => status ok with artifact hash `6b03601bc9a8990cf6314d65e35d4708768c0ddd17dd5d741fdd38ec591ca286`, installed URI hash `f53c17ad469b82b25905639a11a765c3f4af3286d527168288a55dab846605d3`, and `sourceRevision:null`. **Never infer deployed git revision from that null field**: the completed Hostinger build supplies the exact commit.
- Latest Hostinger runtime startup logs: the separately stored Instagram OAuth **tester** credential failed provider account resolution with HTTP **400**, Graph **190**, permanent; independently, the **managed business Professional account token** successfully reconciled its subscription and matched an actual historical signed inbound Instagram account ID. The inbound AI processor and action dispatcher both report enabled. Do not conflate the failed tester OAuth authorization with the currently verified studio inbox; do not assume the studio's managed token confers broader Advanced Access.

### Read-only live account/provider confirmations

- Meta app **Ishikeit**, ID `1042452472116584`: App Review **`NO_SUBMISSION`**, **no Advanced Access privileges listed** (checked again). Owner email verification and real App Review screencast remain unresolved external steps.
- App-level Meta webhook subscriptions read back: **Page: `messages`**; **Instagram: `messages`, `standby`, `messaging_handover`**; **WhatsApp Business Account: `messages`**. All three enabled. Other desired event fields cannot be described as subscribed simply because their normalizers exist. Do not mutate subscriptions without appropriate provider permission and confirmation.
- Production Supabase `ishikeit-db` read-only counts: **0 pending outbox jobs**, **43 historical dead letters**, **0 new dead letters in the previous 24 hours**, **0 active AI-to-human blocks**, **0 active provider-native other-app ownership blocks**, **0 WhatsApp appointment opt-ins**, and **0 WhatsApp STOP tombstones**. Keep historical failures; **never bulk replay** them.
- Production key-name-only inspection: processor and action-dispatch keys, Meta channel credentials, and ops bearer key exist. **`META_WHATSAPP_TEMPLATE_DISPATCH_ENABLED`**, **`META_WHATSAPP_CONSENT_HASH_KEY_B64`**, template allowlist, and approved phone-number configuration are **not set**. Therefore appointment-template dispatch remains **disabled**. Do not inspect/reveal masked secret values or use Hostinger's replace-all environment variables operation with placeholders.
- The private Meta handoff, native ownership and WhatsApp consent/STOP tables are already applied and health-ready per prior section. The current zero-row counts are *not* evidence the features are broken: live consent and handoff actions have not been invented or simulated.

### Priority when a new chat resumes

1. **Start from live state, not from a stale message.** Read this document, `docs/CONTINUATION.md`, `docs/meta-instagram-app-review.md`, and actual current `main`. Reconcile exact Hostinger latest completed build SHA, HTTP health, active flags, Supabase pending jobs/dead letters and Meta app review/webhook fields. Later commits may supersede this snapshot.
2. **Focus exclusively on Messenger, Instagram and WhatsApp.** Meta development can proceed with read-only diagnostics, regression tests, provider-neutral security/reliability improvements and safe PR/CI/builds. The **TikTok Business Messaging API remains awaiting approval** and is **not** part of the active work. Its independent historical checkpoint is `docs/TIKTOK_APPROVAL_WAIT_HANDOFF_2026-10-27.md`; do not implement, activate, merge or deploy pending TikTok features.
3. **Instagram:** preserve verified business Professional-account routing, diagnose the distinct Graph-190 tester OAuth grant *without deleting/overwriting it*, and obtain fresh owner-authorized Business Login only when legitimately available. Update/submit Meta Advanced Access only after real permission checks, verified contact email and real approved reviewer screencast. Studio account `@ishinaillab` is distinct from old tester `@povnailstudio.ph`; do not mix account aliases.
4. **Messenger/Instagram:** page delivery/read/postback and Instagram seen/postback subscriptions must be checked against Meta app permissions and a provider confirmation step; normalizer support exists but a fresh authorized tester-originated message/quick-reply/postback/receipt canary is still required to prove current live behavior. Do not send unsolicited customer messages.
5. **WhatsApp:** existing registered Philippine number and read/delivery evidence are real; interactive buttons and lists and signed STOP/opt-in safety are implemented. Appointment utility template must be approved by Meta, durable customer consent must be genuine, and consent HMAC/config must be provisioned safely before enabling the default-off template adapter. Do not generate synthetic customer consent or switch on template dispatch merely because code exists.
6. **Safeguards:** preserve exact owner/native handoff separation, 24h Meta service-window policy, final dispatch block after human handoff, signed webhook checks, account-isolated delivery correlation, token encryption, queue idempotency and no automatic dead-letter replay. Validate new changes with Node/PHP/context CI, database migration-first where applicable, then real Hostinger deployment and independent HTTP readback.

### Handoff semantics

This document and `docs/CONTINUATION.md` are the **durable source of project context** available to a new conversation. Conversation memory is not an independent substitute for rereading live repository and production evidence. Updates after this snapshot must be read back instead of assuming this snapshot remains current.
