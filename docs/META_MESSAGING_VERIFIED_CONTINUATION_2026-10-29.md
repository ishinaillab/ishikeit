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
