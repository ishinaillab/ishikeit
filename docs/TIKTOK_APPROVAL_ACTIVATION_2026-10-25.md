# Ishikeit TikTok API activation checkpoint

**Checked:** 2026-10-26 (Asia/Manila). **Production:** foundation deployed; TikTok Business Messaging **not activated**.

## Verified code and runtime release

- The owner reports the developer app **ishikeit** received TikTok **API for Business** approval. This claim does not by itself establish separate access to TikTok **Business Messaging API** or approved message-handling scopes.
- [PR #71](https://github.com/ishinaillab/ishikeit/pull/71), TikTok Comment-to-Message foundation, is **merged** into `main`; Hostinger's completed Node.js 24 build revision was `f7ad4759afa087b3fdb716208e51efe939014e18`. GitHub CI passed Node, PHP lint, and context-continuity. Its behavior is **default-off**.
- [PR #76](https://github.com/ishinaillab/ishikeit/pull/76), TikTok automatic-message **read-only** foundation, is also **merged** into `main`; Hostinger successfully built commit `b0877d74fef5e35d8dab788be8845663e8627c3f`. The client is deliberately **not registered on live routes**. GitHub CI for the feature head `fd2d76fc71afff1c29f5a24af8a9708e0cf8695d` passed all Node/PHP/context jobs, including 37 test files / 271 tests. No provider settings writes.
- At the latest post-build read, `https://apps.ishinaillab.com/health/ready` returned `{"status":"ready"}`, and the existing outbox held **0 pending records / 43 historical dead letters**. Do not replay historical records.
- Production Hostinger account `u328762438`, Node app `apps.ishinaillab.com`. The official Hostinger read-only environment inventory now returns **51 configured keys**, all values masked; **15 named `TIKTOK_*` settings** include TikTok app ID/secret, OAuth authorization and redirect URLs, webhook callback URL, Marketing auth/redirect URLs, API version and timeouts. Contrary to the older Oct 25 checkpoint, app-level TikTok keys **are present now**.
- **Missing:** `TIKTOK_BUSINESS_ID` and `TIKTOK_COMMENT_TO_MESSAGE_ENABLED`. Thus the Comment-to-Message activation gate is unset, and the Business Messaging conversation-read routes remain unregistered. Do not set these blindly.

## Verified TikTok account authorization evidence

- `public.oauth_authorization_states` has one completed/consumed TikTok OAuth state, and `public.oauth_credentials` has one TikTok record with future access/refresh expirations. Encrypted token bytes and account IDs were **not read or exposed**.
- The token's **stored scope names** are Accounts/organic-oriented: profile/user information, account type, publishing, comment listing/management, video insights, and other insights. **No explicit Business Messaging scope is present**. This means existing OAuth is real, but does not prove Business Messaging entitlement. Do not assume generic API for Business approval includes the higher-privacy Business Messaging product.
- TikTok advertising-account API independently found an Ishi Nail Lab `TT_USER` identity with `available_status: AVAILABLE` and `can_manage_message: true`. This is **advertising identity eligibility evidence only**, not consent for Ishikeit's developer app to read or send private chats.
- Public unauthenticated GET status codes (no secret or response bodies accessed): `/ops/tiktok/oauth/status` => **401** (registered, protected); `/ops/tiktok/messaging/webhook/status` => **401** (registered, protected); `/ops/tiktok/messaging/capabilities` => **404** (Business Account/reader not activated).
- TikTok-for-Business MCP ad-account token is a **separate** authorization channel. Never use a Marketing `creative/auto_message` endpoint to implement Business Messaging account-level automatic messages.

## Remaining external gates (perform in order)

1. Inspect the **ishikeit** developer app's approved products, Business Messaging API access, security/privacy review and precise grants in the TikTok developer dashboard. If only Accounts/Marketing was approved, apply for Business Messaging access rather than trying to bypass it.
2. Under the **approved app**, obtain actual TikTok Business Account owner OAuth consent and validate the granted permissions plus appropriate entitlement (Advanced Access or Verified Business Account, relevant age/region restrictions). The prior token may need fresh consent with the newly approved product permissions. Keep all tokens encrypted and out of chat/source control.
3. Verify the intended Business Account open ID/account mapping; configure `TIKTOK_BUSINESS_ID` securely only after proven entitlement and owner authorization. The Hostinger MCP env-replacement endpoint does an **entire-set replacement and Node restart** and masks all existing values. **Never send masked placeholders or update one variable by replacing all 51 secrets with unknown values.** Use a supported authenticated UI or secure full-state manager instead.
4. Use the existing protected status routes for **read-only** TikTok business capabilities and webhook subscription checks. Confirm exact allowed webhook events and callback `https://apps.ishinaillab.com/ishikeit/webhooks/tiktok`; only then perform an explicitly reviewed idempotent webhook reconciliation with provider readback.
5. Test one new human-originated TikTok Direct Message from an authorized tester and trace signed webhook → durable inbox → AI Bridge → outbound provider acceptance → confirmed tester inbox receipt; leave all historical dead letters untouched.
6. For Comment-to-Message, verify provider-specific eligibility and direct-reply setting before setting the separate `TIKTOK_COMMENT_TO_MESSAGE_ENABLED` flag. Keep disabled until its own native comment event and provider reply canary pass.
7. For Automatic Messages, validate the provider-approved account-level `/open_api/v1.3/business/message/auto_message/get/` **HTTP method and shape** with a read-only request before instantiating the dormant reader. Conflicting third-party descriptions require real-account or authoritative official documentation proof. Moderated writes need a separate review.
8. After messaging authorization, implement gated conversation-unlock lifecycle and history-gap reconciliation that never send automated replies to old imported events.

## Protected baselines

Existing Instagram end-to-end messenger canary passed with human-verified tester receipt following Ishi AI Bridge **v0.3.1**. Preserve Messenger, Instagram, WhatsApp, Telegram, WordPress, LatePoint, WooCommerce and Supabase data. Maintain provider-neutral event/action queues and idempotency.

## Official references

- Business Messaging API onboarding: https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3
- TikTok automatic messages, privacy checks and Business Account Advanced Access requirement: https://business-api.tiktok.com/portal/docs/update-the-automatic-message-for-a-business-account/v1.3
- Accounts API overview (distinct product family): https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3
