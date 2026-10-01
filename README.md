# Ishikeit

Ishikeit is Ishi Nail Lab's first-party event and action backend. Meta messaging is the first production provider, and Telegram Bot API support is implemented as the first non-Meta messaging adapter. The core processor remains provider-neutral so additional platforms and capabilities can be added without redesigning the durable processing boundary.

## Architecture

The application is split into five contracts:

1. **Ingress adapters** authenticate provider webhooks and normalize them into canonical events.
2. **Durable inbox/outbox persistence** commits the normalized event and an `inbound.event.accepted` record before the provider webhook is acknowledged.
3. **Event handlers** consume durable events and create provider-neutral action envelopes.
4. **Brain clients** provide conversational/AI decisions. The first brain is a private WordPress AI Engine bridge.
5. **Action adapters** execute provider/capability/operation combinations such as `meta/messaging/message.send`.

The core action envelope contains strings for `provider`, `capability`, and `operation`. Adding Telegram messaging, Meta Marketing API campaign operations, lead-management operations, or another provider therefore means registering new adapters/handlers rather than adding another provider enum to the durable core.

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

The Meta messaging adapter supports text and rich media for Messenger, Instagram Direct, and WhatsApp Cloud API. The Telegram adapter maps the same portable text, image, video, audio, and document parts to Telegram Bot API methods. Provider-specific limits remain inside each adapter.

## Production safety

The production webhook boundary remains:

- `GET /ishikeit/webhooks/meta` — Meta verification challenge
- `POST /ishikeit/webhooks/meta` — signed Meta webhook ingress
- exact raw-body `X-Hub-Signature-256` verification before JSON is trusted
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
WORDPRESS_AI_BRIDGE_URL=https://ishinaillab.com/wp-json/ishi-ai/v1
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

## Telegram activation

Telegram remains configuration-gated. Configure `TELEGRAM_BOT_TOKEN` and a dedicated high-entropy `TELEGRAM_WEBHOOK_SECRET` together, then register this HTTPS webhook with Telegram:

```text
POST https://apps.ishinaillab.com/ishikeit/webhooks/telegram
```

Start with `allowed_updates=["message"]` so the production webhook receives only the update family that the conversational handler intentionally processes. Ishikeit verifies `X-Telegram-Bot-Api-Secret-Token` before parsing the update, persists the canonical event before acknowledging it, and resolves inbound provider `file_id` media only after the webhook ACK through Telegram's `getFile` path. A controlled end-to-end canary is required before Telegram is considered production-active.

Access tokens and bridge credentials are secrets. Keep raw values in hosting/runtime secret storage only and never commit them.
