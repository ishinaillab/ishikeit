# TikTok API for Business approval: Ishikeit activation gates

Date: 2026-10-25 (Asia/Manila). Status: **review branch / NOT ACTIVATED**.

## Evidence boundaries

- The Ishikeit owner reported that TikTok approved the developer app named **ishikeit** for **TikTok Business API**. Treat this as a user-reported external approval, not independent proof of every product/scope being approved.
- TikTok API for Business is a family: Marketing API, Organic/Accounts API, and **Business Messaging API** are not identical grants. Confirm the approved app's precise products/scopes and associated permissions in the authenticated TikTok developer portal.
- As of October 25, Hostinger's masked environment-variable inventory for `apps.ishinaillab.com` contains **no `TIKTOK_*` keys**; previous TikTok messaging read/webhook/image features remain dormant in production. Do not invent values or assume consent.
- The existing TikTok for Business MCP connected for advertising may use a different authorized advertiser/app. Never treat advertising account visibility as proof of Business Messaging scope or Account OAuth.
- A live Instagram v0.3.1 E2E canary passed. Preserve existing Meta and Telegram behavior and the provider-neutral durable processing contracts.

## Activation stages, in strict order

1. **App grant inspection (read-only):** confirm the app identifier, supported product(s), scope(s), status, region, any Business Messaging-specific security/privacy review and restrictions; record non-secret facts only. Distinguish TikTok Accounts/Marketing approvals from Business Messaging access.
2. **Account eligibility and authorization:** use TikTok's official approved Business Account OAuth path; verify the chosen account is eligible (Advanced Access / Verified Business Account where the endpoint demands it), owner-age limits, and exactly granted scopes. Store client ID/secret and refresh tokens only in approved Hostinger/runtime secret storage; never commit, print, or paste into chat.
3. **Safe runtime configuration:** confirm the correctly authorized production site `apps.ishinaillab.com`, current deployment artifact/revision and recovery plan. Configure only those `TIKTOK_*` runtime keys required for the approved capability. Hostinger's environment update endpoint replaces the **entire** environment and restarts Node; **never use masked readback values** to construct a replacement and never attempt a partial blind replace. Require complete existing values through an authorized secure deployment process, otherwise stop and request the required secure setup.
4. **Read-only status:** with approved credentials, verify the dedicated TikTok Business Messaging capabilities, business account, conversation list, webhook status, and supported message types. Do not call advertiser marketing endpoints as substitutes. Preserve idempotency and per-account isolation.
5. **Webhook reconciliation:** explicitly review callback `https://apps.ishinaillab.com/ishikeit/webhooks/tiktok` and event subscription, sign/verify ingestion as documented, then perform idempotent provider read-back. No startup auto-mutation or wholesale deletion.
6. **Human-originated test:** only from an authorized TikTok test account, one inbound text DM -> durable record -> processed -> Meta-independent generic action -> TikTok outbound acceptance -> verified tester receipt. Verify idempotency, rate/eligibility limits and lease/backoff. No synthetic customer replies or historical queue replay.
7. **Comment-to-Message:** draft PR #71 is a separate optional behavior. Validate `im_receive_high_intent_comment` availability, direct-reply scope, native settings status, idempotent reconciliation and controlled provider send. Keep default disabled until independently verified.
8. **Automatic messages:** stacked draft PR #76 provides read-only foundations (welcome, suggested questions, chat prompts, follow-welcome). Confirm Business Messaging-specific `/business/message/auto_message/get/` endpoint, not marketing creative/auto_message; moderated writes require explicit review and provider readback.
9. **Conversation unlock + reconciliation/backfill:** preserve provider eligibility and handoff state, compare history against durable event IDs and never auto-reply to historical imports or replay old dead letters.

## Safe engineering / release requirements

- PR #71: merge current main into isolated review branch; run Node **24** `npm run check`, `npm audit`, PHP lint where available, and GitHub CI before merge to main. A draft PR green locally is **not** live validation.
- PR #76 is stacked on #71, so verify both once #71 is updated; do not independently promote it with unverified OAuth or provider capabilities.
- Do not enable Comment-to-Message, TikTok outbound, automatic-message writes or WordPress outage-recovery retries just because the app received general Business API approval.
- Existing E2E Instagram channel and WordPress AI Bridge v0.3.1 remain protected production baselines.
- No Hostinger secrets, TikTok tokens, Supabase records, provider account settings or production DNS are modified by this document.

## Official sources

- TikTok Business Messaging Getting Started: https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3
- TikTok Automatic Message: https://business-api.tiktok.com/portal/docs/update-the-automatic-message-for-a-business-account/v1.3
- TikTok API for Business overview: https://ads.tiktok.com/resources/help/article/marketing-api
