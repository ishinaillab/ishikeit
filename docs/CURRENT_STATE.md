# Ishikeit Current State

Snapshot date: **2026-10-04 08:27 Asia/Manila**

This document is the canonical continuation checkpoint for the current Ishikeit implementation. Use it together with `docs/CONTINUATION.md`, current repository code, current database migrations, and live runtime evidence. When these disagree, prefer the current repository/runtime over historical notes.

## Canonical projects

- Application repository: `ishinaillab/ishikeit`
- Current application `main`: `c2f61ca52d566e84c7a55fa540a550e9c4a39063`
- Database repository: `ishinaillab/ishikeit-db`
- Current database `main`: `c879024a971688bb019aebe7551020b9287f1735`
- Production application: `https://apps.ishinaillab.com`
- Canonical business site / WordPress bridge host: `https://www.ishinaillab.com`
- Retired project path `/ishinaillab/ishi` is not canonical and must not be used unless explicitly requested.

## Production runtime — latest verified state

Latest runtime readback after the TikTok image-send deployment:

- `/health/live` -> `ok`
- `/health/ready` -> `ready`
- durable processor enabled
- action dispatcher enabled
- `tiktokBusinessMessagingReadSchema: 1`
- `tiktokBusinessMessagingWebhookSchema: 1`
- `tiktokBusinessMessagingImageSendSchema: 2`
- `tiktokMarketingOAuthSchema: 2`
- `tiktokMarketingAdvertiserSchema: 2`

TikTok Business Messaging operational routes remain intentionally absent while provider/account activation is not configured.

## Core architecture

Ishikeit remains provider-neutral:

authenticated provider webhook -> canonical event -> durable Supabase/Postgres inbound queue -> processor -> WordPress AI Bridge / AI Engine -> generic durable action/outbox -> provider adapter -> delivery/retry/dead-letter/observability.

The durable action envelope is extensible by string provider/capability/operation values rather than a closed provider enum.

Media is represented by portable content parts and resolved only after durable inbound persistence / webhook acknowledgement.

## Messaging platforms

### Meta: Messenger / Instagram / WhatsApp

Production messaging is working.

Known important Instagram regression is resolved. Both historical tester accounts `povnailstudio.com.ph` and `povnailstudio.ph` receive replies from `ishinaillab`.

Do not reopen the resolved Instagram regression unless new runtime evidence shows a regression.

Meta App Review work is separate from the TikTok work. Current historical review scopes are `instagram_business_basic` and `instagram_business_manage_messages`.

### Telegram

Production active:

- bot: **Ishi Nail Lab**
- username: `@ishinailbot`
- webhook: `https://apps.ishinaillab.com/ishikeit/webhooks/telegram`
- durable human-originated canary previously verified inbound persistence, AI processing, one outbound action, successful provider delivery, persisted provider message ID, zero pending recent actions, and zero recent dead letters.

Preserve the existing Telegram webhook-secret authentication and token rotation sequence.

### TikTok Business Messaging

Implementation is deployed but **not production-active** because provider access/account activation is still pending.

Implemented and deployed:

- authenticated `POST /ishikeit/webhooks/tiktok`
- exact raw-body TikTok HMAC signature verification with replay-age bound
- canonical normalization for text, image, video, share-post, and unknown structured message types
- outbound echo recognition
- inbound TikTok image/video resolution after durable persistence
- generic `tiktok / messaging / message.send`
- outbound text
- outbound JPG/JPEG + PNG image messages
- TikTok image limit enforcement: 3 MB
- safe HTTPS source fetching for outbound image upload
- TikTok media upload -> `media_id` -> image message send
- live provider conversation-type resolution using TikTok `SINGLE` and `STRANGER` lists
- `IMAGE_SEND` capability preflight before image transfer
- read-only operational surfaces:
  - `GET /ops/tiktok/messaging/capabilities`
  - `GET /ops/tiktok/messaging/conversations`
  - `GET /ops/tiktok/messaging/conversations/:conversationId/messages`
- app-level Business Messaging webhook control plane:
  - `GET /ops/tiktok/messaging/webhook/status`
  - `POST /ops/tiktok/messaging/webhook/reconcile`
- Business Account OAuth start/callback/status
- encrypted durable TikTok credentials
- access-token refresh
- process-local + PostgreSQL refresh locking
- refresh-token expiry handling
- readiness gate when `TIKTOK_BUSINESS_ID` is activated
- fail-closed behavior when reauthorization is required.

Webhook reconciliation is intentionally non-destructive: it can create/update the single app-level `DIRECT_MESSAGE` subscription and read it back, but never auto-deletes provider webhook state.

Outbound image capability behavior:

`local validation -> resolve SINGLE/STRANGER -> IMAGE_SEND check -> access token -> safe image download -> media upload -> message send`

No guessed conversation type is permitted.

Business Messaging still requires:

- TikTok Business Messaging API access/security/privacy review
- real Business Account authorization
- real production app/account credentials
- production `TIKTOK_BUSINESS_ID`
- app-level `DIRECT_MESSAGE` webhook reconciliation
- capability verification
- controlled human-originated end-to-end canary
- token-refresh/rotation verification under provider-backed conditions.

### TikTok Business Messaging backlog — next work

Do not start these until continuing from this checkpoint:

1. Comment-to-Message
2. Automatic Messages API
3. welcome message / suggested questions / chat prompts / new-follower message flows
4. conversation unlock
5. conversation/message reconciliation and webhook-gap backfill logic

Keep these as explicit TikTok capabilities rather than hiding them behind generic `message.send`.

### TikTok Marketing

Completely separate from Business Messaging.

Current provider review is the Marketing **Ad account management** scope only. Do not call this the old “TikTok accounts” review.

Implemented and deployed behind configuration:

- separate `tiktok-marketing` credential namespace
- one-time OAuth state
- advertiser authorization callback
- encrypted durable advertiser credentials
- safe authorization status
- live OAuth/grant verification
- read-only advertiser-info proof
- safe advertiser account summaries
- support for multiple independent advertiser grants
- capability markers:
  - `tiktokMarketingOAuthSchema: 2`
  - `tiktokMarketingAdvertiserSchema: 2`

Operational routes when configured:

- `POST /ops/tiktok/marketing/oauth/start`
- `GET /ops/tiktok/marketing/oauth/status`
- `GET /ops/tiktok/marketing/oauth/verify`
- `GET /ops/tiktok/marketing/advertisers/verify`
- `GET /ops/tiktok/marketing/advertisers`
- callback: `/ishikeit/oauth/tiktok/advertiser/callback/`

No Marketing mutation exists for advertiser updates, campaigns, ad groups, ads, creative, budgets, bids, audiences, leads, or delivery.

Current transport version remains configuration-driven with the deployed setting `v1.3`; do not infer a v2.0 migration merely from the portal label or documentation omission.

## Database state

Current `ishikeit-db` main:

`c879024a971688bb019aebe7551020b9287f1735`

Current migration chain includes:

- `20260930005600_foundation.sql`
- `20260930103500_extensible_processor.sql`
- `20260930154000_persist_partition_keys.sql`
- `20260930191500_operational_attempts.sql`
- `20260930224000_durable_processing_outcomes.sql`
- `20261002020000_oauth_credentials.sql`
- `20261002090000_instagram_data_lifecycle.sql`
- `20261003020000_oauth_account_aliases.sql`
- `20261004010000_nullable_oauth_access_expiry.sql`

Important current DB behavior:

- durable inbound events
- generic outbox/actions
- operational attempt/outcome persistence
- OAuth credentials
- OAuth account aliases
- nullable access-token expiry for long-lived provider credentials where applicable
- durable processing/retry/dead-letter support.

The linked Supabase project previously verified for this repository is `ishikeit-db` / ref `vhmrliqemkfxblzsoyaz`.

## WordPress / AI integration

### Canonical plugin: Ishi AI Bridge

Repository path:

`wordpress/ishi-ai-bridge`

Current source version:

- Plugin: **Ishi AI Bridge 0.3.0**
- Bridge schema: **1.1.1**
- REST namespace: `ishi-ai/v1`

Canonical bridge base in `.env.example`:

`https://www.ishinaillab.com/wp-json/ishi-ai/v1`

Private endpoints:

- `POST /turn`
- `POST /files`
- `POST /transcribe`
- `GET /health`

Key guarantees:

- bearer token authentication using stored/defined SHA-256 token hash
- no token is committed to source control
- private REST responses use no-store/no-cache headers
- LiteSpeed cache protection/purge policy
- durable turn idempotency
- file/transcription idempotency
- stale-processing reclaim behavior
- safe request conflict behavior using 409
- bounded file TTL
- AI Engine query/upload/transcription bridge
- reply-part and handoff filters
- health response includes plugin version/schema and AI/file/audio readiness.

Ishikeit's `WordPressBrainClient`:

- uses bridge turn schema version 2
- uploads image/document attachments to the bridge
- transcribes audio through the bridge
- sends video through the configured media interpreter when available
- preserves structured customer content as bounded text context
- uses the durable event/turn identity for idempotent AI processing
- treats 409, 429, and 5xx bridge responses as retryable as appropriate.

The old `Ishi Social AI Gateway` / old `/ishinaillab/ishi` architecture is not the canonical Ishikeit path.

## Protected / associated WordPress plugins

These external plugins remain protected components. They may be inspected, but **must not be modified without explicit user authorization for that task**.

Last confirmed versions:

- **Ishi LatePoint Agent Portal v0.7.3**
- **Ishi LatePoint Instant v1.9.0**
- **Ishi Elementor Fix v4.3.0**

They are not part of the TikTok feature path and must not be changed as collateral work.

Other customer-dashboard/LatePoint work exists in the wider Ishi ecosystem but is not part of the Ishikeit messaging runtime unless explicitly requested.

## Hosting / deployment invariants

Production hosting: Hostinger, Fastify runtime.

Runtime entry:

`dist/processes/http.js`

Build:

`npm run build`

Node target/runtime family: 24.x.

Hostinger environment replacement is **full replacement**, not a patch operation. Never reconstruct or round-trip masked secret values from environment-list output.

Do not expose App Secrets, provider access tokens, refresh tokens, webhook secrets, encryption keys, ops bearer tokens, or database credentials in chat, source, logs, fixtures, or docs.

Merging `main` triggers production deployment; therefore production merge/deploy requires explicit user authorization.

## Current repository status at checkpoint creation

Before creating this documentation checkpoint:

- application `main`: `c2f61ca52d566e84c7a55fa540a550e9c4a39063`
- database `main`: `c879024a971688bb019aebe7551020b9287f1735`
- application open PRs: 0
- latest production deployment healthy
- no unfinished code PR from the TikTok image-send/preflight work.

## Next continuation rule

When the user says **continue** after this checkpoint:

1. read this file and `docs/CONTINUATION.md`;
2. inspect current `main` and live/runtime evidence before making source-specific claims;
3. preserve all currently working Messenger, Instagram, WhatsApp, Telegram, WordPress bridge, and TikTok foundation behavior;
4. do not touch protected WordPress plugins without explicit authorization;
5. continue TikTok Business Messaging at **Comment-to-Message** unless the user chooses a different backlog item;
6. use TDD, current TikTok provider evidence, isolated branches, full repository checks, PR/CI, and explicit production authorization before merging to `main`.
