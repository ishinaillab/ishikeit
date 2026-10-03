# Ishikeit

Ishikeit is Ishi Nail Lab's first-party event and action backend. Meta and Telegram messaging are production-active, and TikTok for Business Business Messaging is implemented behind configuration and provider-access gates. The core processor remains provider-neutral so additional platforms and capabilities can be added without redesigning the durable processing boundary.

## Architecture

The application is split into five contracts:

1. **Ingress adapters** authenticate provider webhooks and normalize them into canonical events.
2. **Durable inbox/outbox persistence** commits the normalized event and an `inbound.event.accepted` record before the provider webhook is acknowledged.
3. **Event handlers** consume durable events and create provider-neutral action envelopes.
4. **Brain clients** provide conversational/AI decisions. The first brain is a private WordPress AI Engine bridge.
5. **Action adapters** execute provider/capability/operation combinations such as `meta/messaging/message.send`.

The core action envelope contains strings for `provider`, `capability`, and `operation`. Adding TikTok messaging, Meta Marketing API campaign operations, lead-management operations, or another provider therefore means registering new adapters/handlers rather than adding another provider enum to the durable core.

Canonical events carry CloudEvents-style `specversion`, `id`, `source`, and `type` metadata plus Ishikeit routing fields. Provider-native data stays inside `data`; portable message content is represented as typed parts.

## Rich content

Portable content parts currently include:

- text
- image
- video
- audio
- document
- structured provider/application data

Media is represented by an explicit reference type rather than by arbitrary provider payloads. Provider media resolution happens **after** the webhook ACK. The Meta resolver uses an HTTPS/host allowlist, disables automatic redirects, revalidates each redirect target, and enforces a configured byte limit before content is handed to the AI bridge.

The Meta messaging adapter supports text and rich media for Messenger, Instagram Direct, and WhatsApp Cloud API. The Telegram adapter maps the same portable text, image, video, audio, and document parts to Telegram Bot API methods. The TikTok Business Messaging ingress maps inbound text, image, video, and structured message types to the same portable contract; its initial generic outbound adapter intentionally sends text only, while TikTok image upload/templates/automatic messages remain separate future operations. Provider-specific limits remain inside each adapter.

## Production safety

The production webhook boundary remains:

- `GET /ishikeit/webhooks/meta` — Meta verification challenge
- `POST /ishikeit/webhooks/meta` — signed Meta webhook ingress
- `POST /ishikeit/webhooks/telegram` — Telegram secret-token authenticated ingress when configured
- `POST /ishikeit/webhooks/tiktok` — TikTok HMAC-authenticated Business Messaging ingress when configured
- exact raw-body provider authentication before JSON is trusted
- PostgreSQL durable-before-ACK persistence
- provider-aware normalization and deduplication
- no permanent raw webhook-body archive
- schema-aware liveness/readiness
- startup failure when the deployed database schema is incompatible

Historical `inbound.event.accepted` rows created before the processor existed are sealed by migration before the processor can be enabled. This prevents delayed replies to old tests or customer messages.

## Durable processor

The inbound processor is controlled by:

```text
PROCESSOR_ENABLED=false
WORDPRESS_AI_BRIDGE_URL=https://www.ishinaillab.com/wp-json/ishi-ai/v1
ISHI_AI_BRIDGE_TOKEN=<dedicated-high-entropy-token>
```

When enabled, the worker:

1. leases one `inbound.event.accepted` record while preserving per-conversation ordering
2. loads the normalized source event
3. marks processing attempts
4. resolves media only when required
5. calls the WordPress AI bridge using the durable event ID as the AI-turn idempotency key
6. receives typed reply parts or a human-handoff decision
7. transactionally enqueues one or more `action.dispatch` records and marks the source event processed
8. retries transient failures with bounded exponential backoff
9. dead-letters permanent failures and exhausted retries

The source event and generated actions remain separate durable records.

## Provider action dispatcher

The outbound dispatcher consumes `action.dispatch`. It does not know a fixed list of platforms. An `ActionDispatcher` registry resolves:

```text
provider / capability / operation
```

to a concrete adapter.

Registered messaging adapters are:

```text
meta / messaging / message.send
telegram / messaging / message.send
tiktok / messaging / message.send
```

Additional adapters can be registered later, for example:

```text
meta / marketing / campaign.create
meta / marketing / lead.read
meta / marketing / lead.update
```

without changing the durable envelope or generic worker.

## WordPress AI bridge

The repository includes `wordpress/ishi-ai-bridge`, a small private WordPress plugin that deliberately keeps provider transport concerns out of WordPress.

It exposes authenticated endpoints for:

- `POST /wp-json/ishi-ai/v1/turn`
- `POST /wp-json/ishi-ai/v1/files`
- `GET /wp-json/ishi-ai/v1/health`

The bridge:

- authenticates with a dedicated bearer secret whose SHA-256 hash is stored server-side
- uses a durable idempotency table for AI turns and media uploads
- passes the conversation partition as AI Engine's `chatId`
- passes AI Engine file IDs through its documented `fileIds` path
- validates rich response parts before returning them to Ishikeit
- keeps the AI Engine chatbot ID and file-size ceiling configurable
- sends no social-provider requests itself

The bridge can later add image/video/audio/document reply parts through the `ishi_ai_bridge_reply_parts` filter without changing the Ishikeit processor contract.

## Development

```sh
npm ci
npm run check
```

CI runs Node lint/typecheck/tests/build and PHP syntax checks for the WordPress bridge.

The canonical database migration history lives in `ishinaillab/ishikeit-db`.

## Deployment gates

Keep both execution gates disabled until migrations, bridge deployment, credentials, and controlled end-to-end tests are complete:

```text
PROCESSOR_ENABLED=false
ACTION_DISPATCH_ENABLED=false
```

Production processor activation requires an explicit `PROCESSOR_CUTOVER_AT` timestamp. Events received before that launch boundary are acknowledged without invoking AI or creating actions, preventing delayed replies to historical conversations.

For a canary rollout, set `PROCESSOR_CANARY_PARTITION_KEYS` to one or more hashed conversation partition keys. While the list is non-empty, only those partitions may invoke the AI handler; other claimed events are intentionally acknowledged with no action.

Then enable processing and action dispatch independently. The legacy `META_OUTBOUND_ENABLED` variable remains a compatibility alias during migration, but new deployments should use `ACTION_DISPATCH_ENABLED`.

The required staged procedure is documented in [`docs/production-rollout.md`](docs/production-rollout.md).

## TikTok Business Messaging

TikTok for Business Business Messaging is implemented behind provider-access, OAuth, and Business Account activation gates. It is **not production-active yet**.

Implemented messaging contract:

- `POST /ishikeit/webhooks/tiktok`
- exact raw-body `TikTok-Signature` HMAC-SHA256 verification with a bounded timestamp age
- `provider=tiktok`, `channel=business`, `capability=messaging`
- deterministic provider-event deduplication and per-conversation partitioning
- inbound text, image, video, share-post, and structured-message normalization
- inbound image/video provider-media resolution only after webhook ACK
- `tiktok / messaging / message.send` with generic outbound text replies
- provider-specific throttling/transport failure classification
- Business Account target validation and cross-account webhook isolation

TikTok's Business Account access token is short-lived, so Ishikeit does not use a manually copied production access token. The production OAuth lifecycle is durable:

- `POST /ops/tiktok/oauth/start` is protected by the operational bearer credential and creates a one-time authorization state
- `GET /ishikeit/oauth/tiktok/callback/` validates and consumes that state, exchanges TikTok's authorization code, and never returns tokens to the browser
- `GET /ops/tiktok/oauth/status` exposes only safe account/scope/expiry metadata
- access and refresh tokens are AES-256-GCM encrypted before PostgreSQL storage
- the database stores only a SHA-256 hash of each temporary OAuth state
- TikTok access tokens are refreshed before expiry and replacement refresh credentials are persisted atomically
- concurrent requests in one process share one refresh; cross-process refreshes are serialized with a PostgreSQL advisory lock and a re-read-after-lock avoids duplicate provider refreshes
- sender and media adapters resolve their access token through the refresh-capable token provider at request time
- setting `TIKTOK_BUSINESS_ID` makes startup/readiness require the matching durable credential and a usable refresh token; missing/expired authorization requires reauthorization rather than endless retry

OAuth application configuration requires the TikTok app ID/secret, TikTok-generated Business Account authorization URL, the exact registered HTTPS callback, the operational bearer token, and a dedicated 32-byte encryption key. `TIKTOK_BUSINESS_ID` is set only after successful authorization using TikTok's returned Business Account `open_id`; that setting activates the webhook/sender/media adapter for the authorized account.

TikTok's Business Messaging API remains distinct from its Marketing, Organic, and Lead APIs. Templates, automatic messages, Comment-to-Message, image upload/send, lead operations, and advertising operations should therefore be added as explicit future operations rather than hidden inside generic `message.send`.

Production activation still requires TikTok Business Messaging API access/review, real Business Account authorization, provider webhook configuration pointing to Ishikeit, capability/permission verification, and a controlled human-originated end-to-end canary. No TikTok credentials are committed to this repository.


## TikTok Marketing

TikTok Marketing advertiser authorization is implemented separately from TikTok Business Messaging and remains inactive until the TikTok developer app is approved and production Marketing variables are configured.

Current scope is deliberately limited to **Ad account management**. The runtime provides:

- `POST /ops/tiktok/marketing/oauth/start` — create one-time advertiser authorization state and return the provider authorization URL
- `GET /ishikeit/oauth/tiktok/advertiser/callback/` — consume state and persist encrypted advertiser credentials
- `GET /ops/tiktok/marketing/oauth/status` — safe durable authorization status
- `GET /ops/tiktok/marketing/oauth/verify` — re-check authorized advertiser IDs against durable credentials
- `GET /ops/tiktok/marketing/advertisers/verify` — prove the granted Ad account management permission through TikTok's read-only `/open_api/v1.3/advertiser/info/` endpoint

Marketing credentials use the distinct `tiktok-marketing` namespace. Access tokens are encrypted before database storage, and the Account Management proof returns only advertiser IDs and missing-ID diagnostics. No advertiser update, campaign, ad-group, ad, creative, budget, bid, audience, lead, or delivery mutation is implemented.

The current TikTok portal labels the permission catalog as v2.0, but TikTok's official SDK still maps advertiser OAuth and advertiser-info calls to `/open_api/v1.3/`. Ishikeit therefore keeps `TIKTOK_BUSINESS_API_VERSION=v1.3` for these implemented calls until TikTok publishes an authoritative replacement contract.

## Telegram production

Telegram messaging is production-active through `@ishinailbot` (`Ishi Nail Lab`).

Production webhook:

```text
POST https://apps.ishinaillab.com/ishikeit/webhooks/telegram
```

The runtime requires `TELEGRAM_BOT_TOKEN` and a dedicated high-entropy `TELEGRAM_WEBHOOK_SECRET` together. Ishikeit verifies `X-Telegram-Bot-Api-Secret-Token` before parsing updates, persists the canonical event before acknowledging it, and resolves inbound provider `file_id` media only after webhook ACK through Telegram's `getFile` path.

The initial production registration used `allowed_updates=["message"]` and `drop_pending_updates=true`. A controlled human-originated canary then verified durable ingress, AI processing, one `telegram / messaging / message.send` action, first-attempt provider delivery, a persisted Telegram provider message ID, zero pending recent actions, and zero recent dead letters. Post-canary `getWebhookInfo` reported the expected webhook URL, zero pending updates, and no delivery error.

For future token/webhook rotations, preserve the same safe sequence: update the complete production environment from a trusted secret source, verify readiness, register the webhook with the dedicated secret, inspect `getWebhookInfo`, and run a controlled canary. Hostinger's environment replacement operation is full-replacement; never round-trip masked values returned by its environment-variable listing.

Access tokens and bridge credentials are secrets. Keep raw values in hosting/runtime secret storage only and never commit them.
