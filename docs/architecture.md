# Ishikeit production architecture

Status: provider-neutral durable processor is production-active for Meta and Telegram messaging; TikTok Business Messaging is implemented behind provider-access and runtime-configuration gates.

## Design goals

Ishikeit is built around durable **events** and durable **actions**, not around a fixed list of social platforms.

The core must remain stable when a future capability is introduced. Examples include:

- Telegram messaging
- TikTok Business Messaging
- additional Meta messaging surfaces
- Meta Marketing API campaign management
- Meta lead capture/management
- future non-Meta providers
- richer media and structured interactions

Provider-specific semantics belong in adapters. Generic persistence, leasing, retries, idempotency, ordering, and processing must not need a new platform enum for every integration.

## Ingress

The production-active ingress adapters are Meta and Telegram Bot API. A TikTok Business Messaging ingress adapter is also implemented but remains inactive until TikTok grants the required Business Messaging access, the Business Account is authorized, and production credentials are configured.

`GET /ishikeit/webhooks/meta` performs Meta's verification challenge.

`POST /ishikeit/webhooks/meta` follows this order:

1. enforce request size
2. preserve exact request bytes
3. verify `X-Hub-Signature-256` with the Meta App Secret
4. parse and validate the provider envelope
5. normalize provider events into canonical events
6. derive provider-aware deduplication and conversation partition identities
7. transactionally persist the normalized event plus `inbound.event.accepted`
8. return HTTP 200 only after durable commit

AI, media downloads, profile lookups, provider calls, and WordPress requests never run before the webhook ACK.

Telegram uses `POST /ishikeit/webhooks/telegram`. It validates Telegram's secret-token header before JSON parsing, normalizes Bot API updates into the same canonical event contract, derives deterministic update deduplication and per-chat partition identities, and commits through the same durable-before-ACK store.

TikTok uses `POST /ishikeit/webhooks/tiktok` when configured. It verifies the exact raw body using TikTok's `TikTok-Signature` HMAC-SHA256 contract, enforces a bounded signature timestamp age to reduce replay risk, normalizes Business Messaging webhook content into canonical events, partitions by Business Account plus conversation, and commits through the same durable-before-ACK store.

## Canonical events

Canonical events use a CloudEvents-style identity surface:

- `specversion`
- `id`
- `source`
- `type`

and Ishikeit routing fields:

- `provider`
- `channel`
- `capability`
- `accountId`
- `eventType`
- provider event/message IDs
- actor/identity ID
- occurrence and receive times

`data` retains provider-native details for lossless future handling.

Portable message content is separately normalized into typed parts:

- `text`
- `image`
- `video`
- `audio`
- `document`
- `structured`

The canonical event schema therefore does not require future messaging providers to imitate Meta payloads.

## Durable inbound processor

The `InboundProcessorWorker` consumes `inbound.event.accepted`, not webhook requests.

It leases with bounded duration and respects existing outbox partition ordering. For a claimed event it:

1. loads the normalized source event
2. skips events already durably processed
3. records a processing attempt
4. routes the event through an `EventHandlerRegistry`
5. executes the selected handler outside the database transaction
6. transactionally enqueues generated actions and marks the source event processed
7. completes the queue item
8. retries transient failures with bounded exponential backoff
9. dead-letters permanent or exhausted failures

The first handler recognizes only:

```text
capability=messaging
eventType=message.received
```

Other event types are acknowledged with no action until a future handler is registered.

This prevents the messaging AI from accidentally interpreting future lead, ads, billing, delivery, or administrative events as customer chat.

## Brain boundary

The conversational handler depends on the `BrainClient` interface rather than WordPress or AI Engine directly.

The first implementation is `WordPressBrainClient`.

The client:

- receives the canonical event and portable content
- resolves media only after webhook ACK
- uploads resolved files to the private WordPress bridge
- calls the AI turn endpoint with a stable durable `turnId`
- uses the conversation partition as `conversationId`
- receives typed reply parts and a handoff flag

The durable source event ID is the AI turn idempotency identity. WordPress persists completed turn results so a network timeout followed by retry cannot intentionally create a second AI turn.

## Media security

Media resolution is adapter-based.

The Meta resolver currently:

- accepts only HTTPS
- allows only known Meta/Instagram CDN and Graph host families
- uses manual redirects
- validates every redirect destination before following it
- applies a redirect limit
- enforces declared and actual byte-size ceilings
- avoids persisting raw provider media in PostgreSQL

WhatsApp media IDs are resolved through the official Graph Media API only after ingress is committed. Messenger/Instagram attachment URLs are downloaded only through the Meta resolver.

Telegram has a provider-specific `file_id` resolver. TikTok Business Messaging has a provider-media resolver for inbound image/video media IDs: it requests a TikTok download URL only after durable webhook ACK, requires HTTPS, rejects local/private-literal destinations, constrains redirects to the provider-returned host, and enforces request and byte ceilings. Future providers receive their own resolver and credentials.

## WordPress AI bridge

`wordpress/ishi-ai-bridge` is intentionally small and private.

Responsibilities:

- authenticate Ishikeit with a dedicated bridge credential
- provide durable AI-turn idempotency
- provide durable file-upload idempotency
- validate JSON, identifiers, file size/type, and reply-part contracts
- call AI Engine's server-side chatbot API
- preserve conversation continuity through AI Engine `chatId`
- pass uploaded files through AI Engine `fileIds`
- return typed reply parts
- expose a protected health endpoint

Non-responsibilities:

- no Meta signature verification
- no social-provider tokens
- no provider webhook endpoints
- no provider Send API calls
- no queue leasing
- no provider-specific routing

That boundary keeps WordPress replaceable as the current AI brain without coupling the durable integration platform to a CMS.

## Generic action envelope

Handlers do not enqueue `meta.message.send`. They enqueue:

```text
topic = action.dispatch
```

with a generic envelope:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "...",
  "provider": "meta",
  "capability": "messaging",
  "operation": "message.send",
  "orderingKey": "...",
  "target": {},
  "body": {}
}
```

`provider`, `capability`, and `operation` are bounded strings, not a platform enum.

A deterministic UUID-shaped outbox ID is derived from those routing values plus the caller's stable idempotency key. Re-enqueueing the same logical action is a no-op; reusing the same identity for a different payload is rejected.

## Action dispatcher

The `OutboxWorker` is provider-neutral. It validates the generic envelope and asks `ActionDispatcher` to resolve:

```text
provider / capability / operation
```

Registered messaging adapters are:

```text
meta / messaging / message.send
telegram / messaging / message.send
tiktok / messaging / message.send
```

Future examples can be registered without modifying the worker:

```text
meta / marketing / campaign.create
meta / marketing / campaign.update
meta / leads / lead.read
meta / leads / lead.update
```

Each adapter owns provider-specific authentication, request formats, limits, retry classification, response parsing, and policy constraints.

## Meta messaging adapter

The Meta adapter maps portable content to provider payloads.

Current content support:

- text
- image
- video
- audio
- document

Messenger/Instagram use attachment objects. WhatsApp uses Cloud API media objects with `messaging_product=whatsapp`.

Provider policy remains provider-specific. For example, WhatsApp free-form replies are intended for an open customer-service conversation; initiating outside that window requires an approved template and should be modeled as a distinct operation rather than hidden inside generic text send.

Meta does not provide a universal caller-supplied idempotency key for Send API delivery. A transport failure after Meta accepts a request but before Ishikeit receives the response is delivery-ambiguous. Ishikeit therefore provides durable at-least-once execution and records ambiguity rather than claiming exactly-once provider delivery.

## Ordering

All actions generated from a customer conversation use the source event's partition key as `orderingKey`.

The outbox claim query prevents a later action in the same partition from overtaking an earlier unpublished action while still allowing parallel work across independent partitions.

Future non-conversation operations can choose an operation-appropriate ordering key, such as campaign ID or lead ID.

## Database migration safety

The processor migration:

- removes the old three-channel CHECK constraint
- adds `provider`, `capability`, and `last_error`
- backfills existing rows as Meta messaging
- adds a route index
- seals historical pending `inbound.event.accepted` records

The historical sealing step is deliberate. Before the processor existed, inbound acceptance jobs accumulated without a consumer. Running those after deployment could reply to old tests or customers; the migration permanently prevents that.

The application also checks required schema columns during readiness and fails startup if the expected migration is absent.

## Independent rollout gates

Two independent runtime switches remain:

```text
PROCESSOR_ENABLED=false
ACTION_DISPATCH_ENABLED=false
```

This supports staged verification:

1. migrate database
2. deploy WordPress bridge
3. verify bridge authentication/health
4. deploy Ishikeit code with both gates false
5. test processor manually against controlled events
6. enable processor while provider dispatcher remains false if desired
7. verify generated durable actions
8. enable provider dispatch
9. perform controlled end-to-end test
10. monitor retries/dead letters before broad rollout

## Data minimization and logs

Raw webhook bytes exist only long enough to authenticate and parse the request.

PostgreSQL stores normalized events, hashes, durable actions, attempt state, and bounded error metadata. Logs avoid customer message bodies and redact provider/bridge credentials. HTTP request serialization strips query strings before logging so OAuth callback state and authorization codes cannot enter request logs.

## Instagram Login OAuth and Advanced Access

Instagram public-user messaging requires Meta Advanced Access. Standard Access remains role-limited for Instagram messaging webhooks, so the provider access boundary is not worked around in the messaging core.

The Instagram API with Instagram Login authorization lifecycle reuses the same durable OAuth tables and application-level AES-256-GCM encryption used by TikTok. It is configuration-gated and uses the product-specific Instagram App ID and Instagram App Secret, which are distinct from Ishikeit's general Meta app credentials.

The lifecycle exposes:

- public `GET /ishikeit/oauth/instagram/login/`, which creates a cryptographically random one-time state and redirects to Instagram's authorization endpoint
- public `GET /ishikeit/oauth/instagram/callback/`, which requires the returned state and one-time authorization code
- protected `POST /ops/instagram/oauth/start` for operational inspection of the generated authorization URL
- protected `GET /ops/instagram/oauth/status` for token-free authorization/scope/expiry metadata

Only the SHA-256 state hash, provider, exact redirect URI, expiry, and consumption timestamp are persisted before callback. Authorization codes and raw state values are never stored. The callback atomically consumes state before exchanging the code.

The provider exchange follows Meta's current Instagram Login flow: the authorization code is exchanged server-side at `api.instagram.com/oauth/access_token`, the returned short-lived token is exchanged server-side at `graph.instagram.com/access_token` for a long-lived token, and unexpired long-lived tokens are refreshed through `graph.instagram.com/refresh_access_token`. The requested review scopes are `instagram_business_basic` and `instagram_business_manage_messages`.

Durable Instagram credentials are keyed by the Instagram account ID returned by authorization. `InstagramAccessTokenManager` selects the credential by outbound target account, refreshes during the configured final pre-expiry window under the same process-local and PostgreSQL advisory-lock discipline used by the TikTok manager, and requires reauthorization after expiry. For the existing Ishi production account, the current static `META_INSTAGRAM_ACCESS_TOKEN` remains a backward-compatible fallback until that account is deliberately migrated. An OAuth credential for a review/external account takes precedence over the static fallback, so App Review can exercise a real external professional account without replacing the production Ishi token.

OAuth is not considered production-active merely because these routes exist. Activation requires the product-specific Instagram App ID/secret, exact registered HTTPS redirect URI, the shared OAuth encryption key, a real authorization, a verified callback/token exchange, an end-to-end messaging canary for the authorized account, and then Meta App Review/Advanced Access approval. No Instagram product secret is committed to the repository.

## Versioning

Meta Graph API target is configured by `META_GRAPH_API_VERSION`. TikTok Business Messaging's API target is independently configured by `TIKTOK_BUSINESS_API_VERSION`.

Canonical event, action, bridge, and provider adapter contracts are versioned independently. Provider API upgrades are deliberate and tested rather than automatic.


## TikTok Business Messaging adapter

TikTok Business Messaging is implemented as another provider adapter, not as a new durable core. The route is configuration-gated and is not production-active until TikTok grants the required Business Messaging access and a Business Account is authorized.

Ingress verifies the exact raw request body with the `TikTok-Signature` timestamp/signature pair before JSON parsing. The verifier computes HMAC-SHA256 over `timestamp + "." + raw_body` with the configured app secret and rejects signatures outside a bounded replay window. It validates the webhook `client_key`; signed events whose `user_openid` belongs to a different authorized Business Account are acknowledged as ignored without persistence so TikTok does not retry another account's traffic into this single-account deployment. Business Messaging `im_receive_msg` events normalize as `message.received`; `im_send_msg` echoes normalize as `message.sent`, so the conversational handler cannot accidentally answer its own outbound echo. TikTok's privacy-reduced `im_receive_msg_eu` envelope has no conversation/message body and is intentionally persisted as a non-conversational event instead of being guessed into an AI turn. Conversation ID becomes the canonical reply identity and durable ordering partition only when TikTok actually provides it.

Inbound message normalization currently covers text, image, video, share-post, and unknown structured TikTok message types. Image/video provider media IDs are resolved only after webhook ACK by the TikTok media resolver, which requests a provider download URL using the authorized Business Account credential and applies HTTPS, redirect, timeout, and byte-ceiling safeguards before the AI bridge sees bytes.

Outbound registers `tiktok / messaging / message.send`. The generic operation supports portable text and image parts. Text enforces TikTok's 6,000-character limit before network I/O. Image output uses TikTok's documented two-step flow: resolve a safe HTTPS JPG/PNG source, enforce the 3 MB limit, upload it through `/business/message/media/upload/` with `media_type=IMAGE`, then send the returned `media_id` through `/business/message/send/` with `message_type=IMAGE`. Image captions and referenced-message replies are rejected because TikTok image messages cannot combine text/image and referenced-message replies are text-only. Video, audio, document, and structured outbound parts remain unsupported by the TikTok generic adapter.

Outbound image URLs must be HTTPS, contain no URL credentials, reject localhost/private literal destinations, keep redirects on the original host, and are bounded to three redirects and 3 MB. Only `image/jpeg` and `image/png` are accepted. The provider access token is acquired before upload; download/upload failures are retryable when transient but never delivery-ambiguous because no message has been sent. Only transport failure after the final `/business/message/send/` request begins is marked delivery-ambiguous.

TikTok exposes an `IMAGE_SEND` conversation capability check, but that check requires a `conversation_type` of `STRANGER` or `SINGLE`. TikTok message webhooks and Ishikeit's existing portable reply action do not carry that type, so the sender does not guess it. The protected capability route remains available when the type is known; automatic capability-aware send policy requires a future conversation-state tracker. Provider/API failures remain provider-specific, and the adapter rejects actions whose target Business Account differs from its configured account.

### TikTok Business Messaging read boundary

When a real TikTok Business Account is activated, Ishikeit also wires a read-only operational client through the same refreshed access-token provider. The client is not a dispatcher adapter and performs no provider mutation.

- `GET /ops/tiktok/messaging/capabilities?conversation_id=...&conversation_type=SINGLE|STRANGER` calls TikTok's conversation capability endpoint for `IMAGE_SEND`.
- `GET /ops/tiktok/messaging/conversations?conversation_type=SINGLE|STRANGER&limit=...&cursor=...` calls the conversation-list endpoint with TikTok's 1–100 page-size constraint.
- `GET /ops/tiktok/messaging/conversations/:conversationId/messages` calls the message-content listing endpoint.

All three routes require the existing operational bearer token and return `Cache-Control: private, no-store`. They are registered only when `TIKTOK_BUSINESS_ID` is configured and the durable TikTok token manager exists. Invalid input returns 400; a durable reauthorization-required state maps to 409; provider/transport failures map to a generic 503 without returning provider error text.

Conversation responses keep only conversation ID, last-message timestamp, pagination state, and cursor. Message history intentionally drops TikTok usernames, participant identifiers/display names/profile images, referrals, and provider media IDs. It retains message ID, conversation ID, timestamp, message type, source/role metadata, automatic-message type, text content when present, and referenced-message ID. This minimized shape is sufficient for operations and future webhook-gap reconciliation without unnecessarily broadening exposure of TikTok account data.

### TikTok Business Messaging webhook control plane

TikTok Business Messaging webhook configuration is app-level, not per-Business-Account. Ishikeit manages only the `DIRECT_MESSAGE` subscription that delivers `im_*` events to the existing authenticated ingress route.

- expected callback: `https://apps.ishinaillab.com/ishikeit/webhooks/tiktok`
- provider read: `GET /open_api/v1.3/business/webhook/list/` with `app_id`, `secret`, and `event_type=DIRECT_MESSAGE`
- provider reconcile write: `POST /open_api/v1.3/business/webhook/update/` with the same app identity, `DIRECT_MESSAGE`, and expected callback
- operational status: `GET /ops/tiktok/messaging/webhook/status`
- operational reconcile: `POST /ops/tiktok/messaging/webhook/reconcile`

Both operational routes require the existing bearer credential and return `Cache-Control: private, no-store`. They are registered only when the shared TikTok app credentials plus `TIKTOK_BUSINESS_WEBHOOK_CALLBACK_URL` are configured; Business Account OAuth and `TIKTOK_BUSINESS_ID` are not prerequisites because the provider subscription applies to all businesses that authorize the developer app.

Reconcile is intentionally convergent and non-destructive: it reads current provider state, performs no write when the callback already matches, otherwise creates/updates the single `DIRECT_MESSAGE` subscription, and then reads provider state again. It never auto-deletes a webhook subscription. Provider errors are reduced to generic operational 503 responses and logs contain only error class, never App Secret/provider response text.

Webhook configuration drift does not fail `/health/ready`; it is surfaced explicitly through the protected status endpoint. This avoids coupling general service readiness to an external provider-control-plane read while still giving operators a deterministic activation/recovery workflow.

### TikTok OAuth lifecycle

TikTok Business Account authorization is modeled separately from messaging. Static production access tokens are not used because TikTok Business Account access tokens are short-lived.

The OAuth lifecycle uses:

- `POST /ops/tiktok/oauth/start` behind the existing operational bearer credential
- a cryptographically random state value whose SHA-256 hash, expiry, provider, and exact redirect URI are persisted
- `GET /ishikeit/oauth/tiktok/callback/` as the exact HTTPS redirect target
- atomic one-time state consumption before authorization-code exchange
- TikTok's `tt_user/oauth2/token/` authorization-code exchange
- TikTok's `tt_user/oauth2/refresh_token/` refresh flow
- `GET /ops/tiktok/oauth/status` for token-free operational metadata

OAuth access/refresh tokens are encrypted in the application with AES-256-GCM before PostgreSQL storage. Each encrypted value uses a fresh 96-bit IV and authenticated additional data that binds the ciphertext to provider, Business Account ID, and token kind. The AES key is a dedicated 32-byte server secret and is never stored in PostgreSQL. The schema stores token expiry, refresh expiry, scopes, and a monotonically increasing token version.

The `TikTokAccessTokenManager` reads the durable credential by `open_id`, refreshes before the configured expiry skew, persists replacement access/refresh credentials, preserves a refresh token when TikTok omits a replacement, rejects a refresh response for a different Business Account, and requires reauthorization after refresh-token expiry. Concurrent requests in one process share one in-flight refresh. Cross-process refresh is serialized with a PostgreSQL advisory lock keyed to provider/account; after acquiring that lock, the manager re-reads the durable credential and skips the provider refresh when another process already renewed it.

OAuth tables use RLS and revoke `anon`/`authenticated`. Application startup fails when TikTok OAuth is configured but the OAuth schema is absent. Once `TIKTOK_BUSINESS_ID` is set, both startup and `/health/ready` require a matching decryptable durable credential with a usable refresh token. Missing/expired authorization is non-retryable and requires reauthorization; transient OAuth transport, throttling, and server failures remain retryable. The general database readiness path remains unchanged for deployments where TikTok OAuth is not configured.

TikTok portable image messages are deliberately folded into generic `message.send` because image is already a provider-neutral content part; TikTok-specific upload mechanics remain encapsulated inside the adapter. Templates, automatic messages, Comment-to-Message, unlock-conversation operations, leads, Organic API actions, and Marketing API actions are intentionally **not** folded into generic `message.send`. They remain separate typed operations/capabilities so TikTok policy windows, permissions, data handling, and review requirements stay explicit.

Production activation requires TikTok's applicable Business Messaging access/security/privacy review, app OAuth configuration, Business Account authorization, provider webhook configuration pointing to `/ishikeit/webhooks/tiktok`, capability/scope checks, and a controlled human-originated end-to-end canary. No TikTok credential is committed to the repository.


## TikTok Marketing advertiser authorization and Account Management proof

TikTok Marketing advertiser authorization is a separate capability family from TikTok Business Messaging. It reuses the same TikTok API for Business developer app identity but stores credentials under the distinct `tiktok-marketing` namespace, uses the advertiser callback `/ishikeit/oauth/tiktok/advertiser/callback/`, and never routes through `tiktok / messaging / message.send`.

The current Marketing milestone requests only **Ad account management**. Authorization uses the provider's advertiser OAuth flow and stores one encrypted credential row per verified advertiser ID. Access expiry is optional because the current advertiser-token contract does not require Ishikeit to fabricate an expiry value.

Operational access is deliberately split into three read-only surfaces:

- `GET /ops/tiktok/marketing/oauth/verify` re-runs advertiser discovery and verifies the durable OAuth grant is still coherent with stored advertiser IDs.
- `GET /ops/tiktok/marketing/advertisers/verify` calls TikTok Account Management advertiser info with the stored advertiser IDs and `Access-Token` header. This proves the granted **Ad account management** permission itself rather than merely proving the OAuth token can be enumerated.
- `GET /ops/tiktok/marketing/advertisers` returns a safe operational summary for the authorized advertisers.

The advertiser proof requests no optional `fields` parameter and returns only advertiser IDs plus missing-ID diagnostics. The summary endpoint uses an explicit provider-field allowlist: `advertiser_id`, `name`, `status`, `currency`, `timezone`, and `country`. Sensitive fields that the provider can return—such as email, telephone number, address, license data, and balance—are never copied into the summary response. Multiple distinct OAuth grants are queried only for the advertiser IDs stored with each token. None of these operations performs credential reconciliation, deletion, advertiser update, campaign mutation, or another write.

All Marketing operational routes are configuration-gated behind the complete Marketing OAuth setup and the existing operational bearer credential. They remain absent until TikTok approves the app and production Marketing variables are configured. `/health/ready` does not require a completed advertiser authorization.

TikTok's v2.0 guide states that endpoints with only a URL-version change may be omitted from the v2.0 API reference. TikTok's current official SDK and TikTok for Business MCP registry nevertheless still expose these advertiser operations at v1.3. Ishikeit therefore keeps the API version configuration explicit and does not infer a transport migration from either the portal permission label or documentation omission alone.

## Telegram Bot API adapter

Telegram is the first non-Meta messaging adapter and does not introduce a Telegram-specific durable core.

Ingress verifies `X-Telegram-Bot-Api-Secret-Token` before parsing JSON, uses Bot API `update_id` as the provider event identity, and partitions conversations by configured bot account plus reply chat ID. Normal messages can carry portable text, photo, video/animation/video-note, audio/voice, and document content. Non-conversational or edited update families are persisted with non-`message.received` event types, so the generic message handler does not accidentally interpret them as new customer turns.

Outbound registers `telegram / messaging / message.send`. It maps portable text/image/video/audio/document parts to the corresponding Bot API send operations, validates Telegram text and caption limits before network I/O, preserves provider throttling guidance, and marks transport failures as delivery-ambiguous rather than claiming exactly-once delivery. The adapter rejects an action when its target account does not match the configured bot token.

Inbound provider `file_id` media is resolved only after webhook ACK using `getFile`. Downloads are restricted to Telegram's official Bot API file endpoint, redirects and unsafe returned file paths are rejected, and the resolver enforces both Ishikeit's configured media ceiling and Telegram Cloud Bot API's download ceiling.

Activation remains configuration-gated: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` must be configured together. Production is currently active on `@ishinailbot`; the initial `setWebhook` used `allowed_updates=["message"]` and `drop_pending_updates=true`, and post-canary `getWebhookInfo` reported zero pending updates and no delivery error. The controlled canary persisted one Telegram `message.received` event, generated one `telegram / messaging / message.send` action, and published it on the first attempt with a Telegram provider message ID. Future credential rotations must repeat the readiness, webhook, and canary checks before being considered complete.
