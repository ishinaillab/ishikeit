# Ishikeit Meta Messaging Operational Readiness — 2026-10-28

Scope: **Facebook Messenger, Instagram, WhatsApp only**. TikTok Business Messaging is a separate approval-wait item; do not change TikTok code, OAuth, tokens, scopes, webhooks or feature flags while working from this checkpoint.

## Code and production baseline

- GitHub repository: `ishinaillab/ishikeit`, current `main` code checkpoint before this documentation-only commit: `13d26420365d1e74768bc1b4498d5b97b16108e0`.
- Hostinger runtime: `apps.ishinaillab.com`, Node 24 Fastify, account `u328762438`.
- Hostinger build `01a1830e-ed18-716a-9ca2-6a08d5d024b0` completed against commit `13d2642`; HTTP `/health/ready` returned `{"status":"ready"}` and `/health/live` returned `{"status":"ok"}`.
- Last Supabase read-only check against production `ishikeit-db`: **0 pending outbox jobs, 0 new dead letters in 24 hours, 0 active WhatsApp appointment-update consents**. Never automatically replay historic dead letters.
- CI checks (Node lint/typecheck/tests/build, PHP lint, context continuity) passed before merging PRs #127, #128 and #129. Earlier merged Meta fixes #102–#126 are included in main.

## Confirmed new work

1. **#127:** Signed and deduplicated WhatsApp customer message with the *exact* phrase `I agree to receive WhatsApp appointment reminders from Ishi Nail Lab. Reply STOP REMINDERS to opt out.` can atomically grant source-backed appointment-update consent if the independent HMAC consent key is configured. Other messages and generic YES do not grant consent. Signed STOP remains immediate. A deterministic opt-in acknowledgment is sent only after stored consent verification, never from the AI as a fabricated promise. The production HMAC key is NOT configured, so this path currently gives a truthful functional failure response instead of registering consent.
2. **#128:** Idempotent Supabase migration `0005_meta_delivery_receipt_indexes.sql` installed and verified. It provides partial indexes for Meta per-account/message delivery receipt correlation and published dispatch recency. No customer message content is indexed.
3. **#129:** The protected `GET /ops/instagram/oauth/status?validate_live=true` distinguishes stored OAuth credentials from current provider authorization with one on-demand, read-only Graph Professional-owner check. It reports sanitized enum values (including `reauthorization_required` for Graph code 190), no tokens or private provider messages. Without `validate_live=true`, status remains local-only. A stored future expiration is never considered proof of provider validity.

## Current Meta app and permissions

- Meta developer app: **Ishikeit**, ID `1042452472116584`, Live Mode, business verification passes.
- Latest app-level webhook subscriptions: Page `messages`; Instagram `messages`, `standby`, `messaging_handover`; WhatsApp Business Account `messages`.
- App Review status: **NO_SUBMISSION**; can_submit=true; **no Advanced Access grants**. Instagram Advanced Access requires real, owner-authorized reviewer screencast demonstrating Business Login and fresh, eligible tester-originated messaging. The public Instagram reviewer entry URL previously returned HTTP 200. Never fabricate recordings or send a message without provider/user eligibility.
- App contact email **not verified**. The account owner must complete the Meta email verification action.
- Messenger `message_deliveries`, `message_reads`, `messaging_postbacks`, `messaging_handovers`, and Instagram `messaging_seen`/`messaging_postbacks` are candidates for future app-level subscription, subject to exact Meta permissions/eligibility and explicit provider-side confirmation. Code already normalizes supported events but unobserved webhooks cannot be called live without actual subscription and real tests.

## Instagram operational findings

- Production managed Professional-account token independently resolves the correct historically signed business inbound account and the startup webhook subscription reconciles successfully. This verifies owner mapping but is NOT a fresh outbound reply test.
- A distinct tester's encrypted Instagram OAuth credential appears unexpired in the database but Graph `/me` account resolution repeatedly returns HTTP 400 / provider code **190**. It is invalid at the provider, despite the local expiry. User/owner reauthorization is required; never silently relabel aliases, substitute an unrelated token, log credentials, or claim the tester credential has been repaired.
- The new optional protected live validation helps operators see this state without disclosing secrets.

## WhatsApp template status and activation gates

- Ishi Nail Lab's Philippine business WhatsApp number is registered, and its business/Messaging Account is approved. Existing generic test templates are NOT a production appointment-reminder template.
- Proposed **new utility template** `ishi_appointment_reminder_v1` / `en_US`:
  - Header: `Appointment reminder`
  - Body: `Hi {{1}}, this is Ishi Nail Lab. Your appointment is scheduled on {{2}} at {{3}}. Reply to this chat if you need assistance with your booking.`
  - Footer: `Reply STOP REMINDERS to opt out`
  - Example values: `Alex`, `November 3, 2026`, `11:00 AM`.
- WhatsApp Business Tools returned **confirmation_required** for creating the template. No template was submitted. The user must explicitly confirm the exact provider action before `confirm=true` may be called.
- Hostinger environment-key inventory has **no** `META_WHATSAPP_CONSENT_HASH_KEY_B64` and **no** `META_WHATSAPP_TEMPLATE_DISPATCH_ENABLED`. The key is necessary to persist/check consent, and the template dispatch flag defaults off. The Hostinger API offers only full replacement of masked environment keys; NEVER insert placeholder mask values, silently replace all variables, or activate template sends. Secure key provisioning requires a safe single-secret edit/other verified non-destructive workflow.
- Appointments, customer identity and verified consent must be correlated before any business-initiated template send. No reminder automation, historic replay or unsolicited campaign is currently enabled.

## Remaining exact release gates

1. Owner verifies Meta app contact email and supplies a real Instagram App Review screencast; then submit only minimum required Instagram permissions.
2. Owner reauthorizes the invalid **tester** Instagram OAuth grant with Instagram Business Login; preserve working separately managed studio owner token.
3. Customer/provider-approved WhatsApp appointment reminder template creation after exact explicit confirmation; obtain provider approval and retain exact template account/language inventory.
4. Provision one stable, independent 32-byte WhatsApp consent HMAC secret without overwriting existing masked Hostinger environment variables. Then test a genuine, user-initiated, exact-disclosure consent canary and explicit STOP/reopt-in behavior.
5. Review and confirm Meta messaging webhook field subscriptions for Messenger/Instagram delivery/read/postback/ownership events as permitted. Test with fresh role-authorized testers and verify end-to-end receipt without contacting unrelated customers.
6. Before claiming full Messenger/Instagram/WhatsApp completion, demonstrate fresh provider-originated customer message → signed webhook → durable inbound → AI/handoff → outbox → send → provider/user receipt for each active channel, plus policy and rollback checks.

Never infer that previous successful role-account replies prove Advanced Access or current general public availability. Preserve TikTok's separate approval-wait checkpoint and avoid any TikTok operations.
