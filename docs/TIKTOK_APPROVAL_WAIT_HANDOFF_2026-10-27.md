# Ishikeit TikTok: approval-wait continuation checkpoint

**As of:** 2026-10-27, Asia/Manila. **Status:** TikTok Business Messaging API application being submitted by the owner; **awaiting TikTok approval**. This is the canonical re-entry note for resuming TikTok after work on Messenger, Instagram and WhatsApp. Never interpret the approval of the broader API for Business app as separate Messaging API entitlement.

## Repository, infrastructure and verified deployment

- Canonical repository: `ishinaillab/ishikeit` (`main`), not retired `ishinaillab/ishi`. Database: Supabase `ishikeit-db`; runtime: Fastify / Node.js 24 on Hostinger account `u328762438`, `https://apps.ishinaillab.com`. Canonical webhook namespace `/ishikeit/webhooks/`.
- Latest merged security release: **PR #100**, squash commit **`0558f4a0561d369249d4f5beb54cf38955a822e7`**. Hostinger build UUID `01a17c28-d526-7199-a4e9-0a7dc7410b1e` returned **completed** and identified that exact commit.
- PR #100 GitHub CI: **node**, **php-lint** and **context-continuity** all passed on final branch commit `b1ef146287539dc54f094cef21d869bde7f6e444`.
- After deploy, `GET /health/ready` returned `{"status":"ready"}` and `GET /health/live` returned `{"status":"ok"}` from the Windows Ishi Local Agent.
- The deployment rejects HTTP redirects on credential-bearing TikTok API calls (owner OAuth, Marketing OAuth, Business Messaging read/send, Comment-to-Message, webhook configuration, automatic-message reads, advertiser reads, media API). Untrusted image retrieval already uses explicit manual redirect handling. Regression assertions added. No TikTok dispatch activation or secret changes.
- Other recent TikTok work includes provider-error diagnostic PR #99, read-only availability probe, token refresh under credential-store lock, and exact-conversation history isolation. See linked source docs below.

## Exact authorization state and interpretation

- The owner reported TikTok API for Business developer-app approval; **Business Messaging product entitlement and Messaging-specific OAuth scopes remain unverified/unapproved**.
- Exactly one encrypted TikTok owner OAuth credential was observed in the operational store. The access token expired on 2026-10-27 but was subsequently **refreshed and persisted** via the protected probe; refresh token had future expiry. The protected OAuth status showed **15 Accounts/organic-oriented scopes** with **no explicit Business Messaging scope**.
- One controlled `GET /ops/tiktok/messaging/availability-probe` using the existing stored owner credential yielded **`provider_rejected`**, TikTok numeric code **`40000`**, with diagnostic **`providerErrorCategory: "scope"`**. That category is inferred from the provider message, **not an authoritative proof of any particular missing permission**. Do not retry repeatedly or treat it as proof of full account eligibility.
- TikTok outbound dispatch, Comment-to-Message and Business Messaging reader routes remain gated because `TIKTOK_BUSINESS_ID` is unset. Do not fill it with app ID, username or advertiser ID.
- Production Hostinger environment includes TikTok app ID/secret, owner OAuth redirect, Marketing OAuth, webhook callback and encryption key, but the official connector's environment write operation replaces the **entire** masked set. Never replace a single key with placeholders, or expose secrets to chat.
- No TikTok private conversations were exported. No messages were sent, webhooks altered, old dead letters replayed or history backfilled during the diagnostic/hardening work.

## Resume only after approval

1. Read TikTok's approval email and developer portal entitlement for the **ishikeit** app. Record approved product, exact scope strings, review conditions, permitted account types, rate limits and any webhook restrictions. Check the latest official Business Messaging **v1.3** endpoint documentation; do not conflate Marketing/Reporting v2.0 with Messaging.
2. Validate intended TikTok Business Account eligibility (Advanced Access or Verified Business Account and region/age rules), the authorized owner and exact `open_id` / business account binding. Check actual `/business/get/` account metadata if approved.
3. Perform **fresh owner OAuth consent** for TikTok-approved Messaging scopes using the existing secured callback; confirm stored scopes and token expiry without exposing tokens. Keep refresh under DB lock, rotation persisted, and errors sanitized.
4. Use the protected read-only account capabilities, webhook status and one bounded conversation-list probe to establish actual permission. Verify response shape, account identity and provider limits. Do not enable outbound merely because a probe succeeds.
5. Reconcile the exact approved signed-webhook subscription only after readback, with correct callback `https://apps.ishinaillab.com/ishikeit/webhooks/tiktok`, verification and idempotency. Safely configure the authorized `TIKTOK_BUSINESS_ID` without replacing the masked Hostinger environment set.
6. Run **one new tester-originated DM** and trace TikTok signed webhook -> durable `inbound_events` -> AI Bridge -> `outbox` -> provider acceptance -> human-verified tester receipt. Avoid automatic replay of historical dead letters; confirm no regression in Messenger, Instagram, WhatsApp.
7. Separately enable and validate Comment-to-Message (provider eligibility and separate feature flag), then account-level automatic-message reads and TikTok-reviewed welcome/suggested questions/chat prompts/new-follower flows. Keep the dormant automatic-message reader unregistered until TikTok's actual GET/POST contract is verified. Build conversation-unlock rules and bounded, non-replying history reconciliation after the live DM canary.

## Protected architectural baseline

- Provider-neutral inbound/outbound queues and action dispatcher, deduplication and safe retries; never use marketing ad creative automatic messages as account-level Business Messaging.
- TikTok history isolation rejects cross-conversation records before exposing any text. Preserve per-account authorization and no cross-tenant leakage.
- Preserve working Instagram, Messenger and WhatsApp channels, the Ishi AI Bridge WordPress plugin **v0.3.1**, Supabase data and existing webhook routes. Telegram remains separately staged.
- When resuming, first reconcile live `main`, current `docs/CONTINUATION.md`, Hostinger deployed revision and current TikTok provider approval; do not rely on this checkpoint if newer facts supersede it.

## Durable references

- `docs/CONTINUATION.md`
- `docs/TIKTOK_STANDARDS_SECURITY_REVIEW_2026-10-27.md`
- `docs/TIKTOK_APPROVAL_ACTIVATION_2026-10-25.md`
- `docs/TIKTOK_MESSAGING_LIVE_PROBE_2026-10-27.md`
- `docs/TIKTOK_HISTORY_ISOLATION_2026-10-26.md`
- `docs/superpowers/plans/2026-10-04-tiktok-marketing-oauth.md`

Official starting reference: https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3
