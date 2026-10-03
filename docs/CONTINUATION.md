# Ishikeit continuation handoff

Updated: 2026-10-02

## Canonical project

Application repository:

- `ishinaillab/ishikeit`
- canonical branch: `main`
- production domain: `https://apps.ishinaillab.com`

Database/schema repository:

- `ishinaillab/ishikeit-db`
- canonical branch: `main`

Canonical Meta webhook route:

- `GET /ishikeit/webhooks/meta`
- `POST /ishikeit/webhooks/meta`

Do not create new platform-specific durable cores. New providers and capabilities must plug into the canonical event/action architecture through adapters.

## Production deployment

Hostinger is connected to:

- repository: `ishinaillab/ishikeit`
- branch: `main`
- Node.js: 24
- app type: Fastify
- build script: `build`
- entry file: `dist/processes/http.js`
- package manager: npm

Verified application-code revision used for Telegram production activation:

```text
dbb69c079b59dd2daff5f1fab2fd2ba594426faf
```

That revision completed GitHub Actions successfully and was rebuilt on Hostinger during the Telegram production cutover. It contains the provider-neutral Telegram messaging adapter in addition to the previously deployed video-interpreter architecture and Instagram routing observability. Production keeps video interpretation disabled until a verified paid Gemini credential is configured.

Hostinger's official MCP is authenticated on the authorized desktop through OAuth and can inspect builds, runtime logs, Node.js settings, and environment-variable key state without exposing stored values.

## Current production runtime state

The processor and dispatcher are live.

Verified `GET /health/capabilities` state:

```json
{
  "service": "ishikeit",
  "architecture": "event-action-v1",
  "canonicalEventSchema": 2,
  "actionSchema": 1,
  "operationalMetricsSchema": 2,
  "wordpressBridgeApiSchema": 3,
  "wordpressBridgeStorageSchema": "1.1.1",
  "runtime": {
    "processorEnabled": true,
    "actionDispatchEnabled": true,
    "processorCutoverAt": "2026-09-30T10:31:25.208Z",
    "processorCanaryPartitionCount": 0,
    "videoInterpreterProvider": "none"
  }
}
```

Also verified:

- `GET /health/live` → HTTP 200
- `GET /health/ready` → HTTP 200

The full-rollout cutover is intentionally retained across ordinary restarts. Do not move it forward just because the process restarts; doing so would discard recoverable post-launch backlog.

`videoInterpreterProvider=none` is intentional in the current production environment. The new video interpreter must remain opt-in until a paid Gemini API project/key is available and a real provider-backed video smoke test succeeds.

## Production environment controls

Production now contains the runtime keys required for:

- PostgreSQL
- Meta webhook authentication
- Messenger access token
- Instagram access token
- WhatsApp access token
- WordPress AI bridge URL and credential
- AI bridge/file/media timeout controls
- processor enablement
- action dispatcher enablement
- Meta outbound compatibility flag
- Meta outbound request timeout
- Telegram bot credential and webhook secret
- Telegram outbound request timeout

Raw values are secret and must stay in Hostinger/runtime secret storage. The local production recovery `.env` also contains the complete production key set; temporary one-off credential handoff files must be cleared after promotion.

Current control state:

```text
PROCESSOR_ENABLED=true
ACTION_DISPATCH_ENABLED=true
META_OUTBOUND_ENABLED=false
PROCESSOR_CANARY_PARTITION_KEYS=<unset>
PROCESSOR_CUTOVER_AT=2026-09-30T10:31:25.208Z
```

`META_OUTBOUND_ENABLED` remains only a backward-compatible alias. New configuration should use `ACTION_DISPATCH_ENABLED`.

## Meta app

Current app:

- name: Ishikeit
- app ID: `1042452472116584`
- category: Messaging
- status: published/live
- Graph API target: `v26.0`

Current app-level webhook subscriptions are exactly:

- `page` → `messages`
- `instagram` → `messages`, `standby`, `messaging_handover`
- `whatsapp_business_account` → `messages`

Callback:

```text
https://apps.ishinaillab.com/ishikeit/webhooks/meta
```

Instagram professional account:

```text
17841438662359631
```

WhatsApp production identifiers:

- Business ID: `1030506726679124`
- WABA: `4663054720683021`
- phone-number ID: `1416383858214802`

App Review status is currently `NO_SUBMISSION`, with no Advanced Access privileges granted. Meta currently reports `can_submit=true`, Business Verification passes, the privacy-policy requirement passes, and compliance has no open required actions or violations.

The current Instagram Messaging webhook documentation establishes the decisive public-user boundary: to receive webhook notifications that include data owned or managed by people who do not have a role on the app, the app must be approved through App Review. Without that approval, messaging webhook delivery is role-limited. This matches the production evidence: the controlled/role account path works, while the fresh ordinary non-role account message produced no outbound API activity because no normal customer message reached Ishikeit's send path.

For the Instagram API with Instagram Login architecture, the App Review package should request `instagram_business_basic` together with its dependent messaging permission `instagram_business_manage_messages`. Do not redesign the processor or outbound adapter to work around this access boundary.

## Durable ingress

The production Meta ingress path is:

1. enforce request-size limit
2. preserve exact raw request bytes
3. verify `X-Hub-Signature-256` using the Meta App Secret
4. parse only after signature verification
5. normalize provider events into the canonical event schema
6. derive provider-local deduplication and partition identities
7. transactionally persist `inbound_events` plus `inbound.event.accepted`
8. ACK only after durable commit

AI calls, media downloads, profile lookups, and provider outbound calls never run before the webhook ACK.

Reliability model:

- at-least-once transport
- deterministic inbound deduplication
- durable inbox/outbox
- lease-based workers
- bounded retry/backoff
- dead-letter handling
- ordering per partition
- lease renewal during long-running handler/media work
- duplicate provider delivery is expected and safe

Raw webhook bytes are transient and are not permanently stored.

## Canonical event architecture

Core routing fields are provider-neutral:

- provider
- channel
- capability
- account ID
- event type
- provider event/message identity
- actor/identity
- timestamps
- portable content

Portable content supports:

- text
- image
- video
- audio
- document
- structured data

Provider-native details remain available in canonical `data` so future adapters do not need to force every provider into Meta-specific shapes.

A future Telegram webhook must emit the same canonical event contract rather than adding Telegram assumptions to the durable processor.

## Durable inbound processor

`InboundProcessorWorker` consumes:

```text
inbound.event.accepted
```

The worker:

1. claims with a bounded lease
2. loads the persisted canonical event
3. applies production cutover/canary guards
4. records processing state
5. routes through `EventHandlerRegistry`
6. runs the selected handler outside the DB transaction
7. transactionally persists generated actions and marks the source event processed
8. completes the accepted-event queue record
9. retries transient failures
10. dead-letters permanent/exhausted failures

The first handler intentionally accepts only:

```text
capability=messaging
eventType=message.received
```

Delivery statuses, echoes, ads events, lead events, and future administrative events are not interpreted as customer chat.

## WordPress AI Engine bridge

The active private bridge is the WordPress plugin:

```text
Ishi AI Bridge
```

Current bridge/runtime contract:

- plugin version: `0.3.0`
- bridge API schema: `3`
- storage schema: `1.1.1`
- authenticated audio API ready: `true`
- optional machine-readable handoff reason: supported

Current WordPress REST base:

```text
https://www.ishinaillab.com/wp-json/ishi-ai/v1
```

The bridge is responsible for:

- dedicated bearer authentication
- durable AI-turn idempotency
- request-fingerprint conflict protection
- durable file-upload idempotency
- idempotent audio transcription through AI Engine's dedicated transcription API
- conversation continuity via AI Engine chat ID
- server-side AI Engine calls
- typed reply-part validation
- protected health endpoint
- no-store/private REST responses

Verified behaviors:

- valid bridge credential → authenticated health succeeds
- missing credential → HTTP 401
- wrong credential → HTTP 401
- REST responses are not cached by LiteSpeed
- repeating the exact same turn returns the same durable result
- reusing one turn ID with a different request is rejected
- controlled file upload succeeded and replayed idempotently
- controlled speech audio transcription succeeded through `/transcribe`
- bridge health reports `aiEngineReady`, `fileApiReady`, and `audioApiReady`

Provider tokens and provider webhook authentication do not live in this WordPress bridge.

## Generic action architecture

Handlers enqueue:

```text
topic = action.dispatch
```

with a generic envelope containing:

- schema version
- stable idempotency key
- provider
- capability
- operation
- ordering key
- target
- body

The worker resolves:

```text
provider / capability / operation
```

through `ActionDispatcher`.

Current concrete adapters:

```text
meta / messaging / message.send
telegram / messaging / message.send
```

Future examples may include:

```text
telegram / messaging / message.send
meta / marketing / campaign.create
meta / marketing / campaign.update
meta / leads / lead.read
meta / leads / lead.update
```

Provider-specific authentication, API limits, response parsing, retry classification, policy windows, and approval requirements stay inside provider adapters.

## Rich outbound messaging

The Meta messaging adapter currently supports portable outbound parts:

- text
- image
- video
- audio
- document

Messenger/Instagram map portable media to attachment payloads.

WhatsApp maps portable media to Cloud API media payloads.

Media handling is adapter-based and runs only after durable ingress. Meta media fetching uses HTTPS-only validation, host allowlisting, manual redirect validation, bounded redirects, request timeouts, and byte-size ceilings.

## Database state

The production PostgreSQL schema includes the provider-neutral processor migrations.

Important current properties:

- fixed three-channel DB constraint removed
- `provider` and `capability` stored separately
- `partition_key` persisted on `inbound_events`
- processing errors tracked on inbound events
- durable `processing_outcome` values: `handled`, `handoff`, `ignored`, `rollout_skipped`
- optional machine-readable `handoff_reason` stored only for handoff outcomes
- historical processed rows were deliberately not backfilled and remain outcome `unknown` in metrics
- route/partition indexes present
- historical pending accepted events were sealed before processor rollout
- readiness fails if required processor schema is absent

The persisted ingress partition key is reused by processing and action ordering. Provider-specific partition logic is not recomputed inside the generic processor.

## Production rollout proof

A staged production rollout was completed on 2026-09-30.

### Stage 1 — code and environment, workers disabled

Verified:

- latest main build deployed
- production environment expanded with processor/bridge/WhatsApp configuration
- `PROCESSOR_ENABLED=false`
- `ACTION_DISPATCH_ENABLED=false`
- health remained green

### Stage 2 — canary processor only

Canary allowlist contained the three already-controlled Messenger, Instagram, and WhatsApp test conversation partitions.

A fresh cutover was set and:

```text
PROCESSOR_ENABLED=true
ACTION_DISPATCH_ENABLED=false
```

Three correctly signed controlled Meta webhook messages were injected through the real production ingress, one for each channel.

Result for all three:

- webhook returned HTTP 200 accepted
- event persisted
- canonical partition matched the expected canary partition
- source event reached `processed`
- one durable `action.dispatch` text action was created
- no action was sent while dispatcher remained disabled

### Stage 3 — canary dispatcher

Dispatcher was enabled while canary protection remained active:

```text
PROCESSOR_ENABLED=true
ACTION_DISPATCH_ENABLED=true
```

All three queued actions were accepted by their provider API and stored a provider resource ID.

Additional provider-side proof included:

- Instagram message echo webhook received
- WhatsApp `delivery.sent` webhook received
- WhatsApp `delivery.delivered` webhook received
- Messenger production conversation continued through the canary partition

No canary action was dead-lettered.

### Stage 4 — full rollout

A new full-rollout cutover was set:

```text
2026-09-30T10:31:25.208Z
```

Canary filtering was removed and both workers stayed enabled.

A controlled post-cutover Messenger smoke event then verified:

- ingress accepted
- event processed once
- no inbound processing error
- outbound action published
- provider resource ID persisted
- no retry
- no dead letter

At the post-rollout DB audit:

- pending `action.dispatch`: 0
- dead-lettered `action.dispatch`: 0
- pending `inbound.event.accepted`: 0
- recent inbound events with `last_error`: 0

At the post-rollout Hostinger runtime-log audit:

- 179 runtime entries in the inspected one-hour window
- warning/error count: 0
- processor and outbound publish messages present

## Handoff and processing-outcome observability

The handoff observability rollout completed on 2026-09-30.

Deployed application revision:

```text
9d0fdd747e222ded771c56f47ade0229dd9a96ca
```

Deployed WordPress bridge:

```text
Ishi AI Bridge 0.3.0
```

Current contracts:

- operational metrics schema: `2`
- WordPress bridge API schema: `3`
- WordPress bridge storage schema: `1.1.1`

The processor now persists one durable outcome for newly completed inbound events: `handled`, `handoff`, `ignored`, or `rollout_skipped`.

Handoff reasons are constrained low-cardinality machine codes. Free-form customer text must not be stored as a handoff reason or emitted into operational metrics. Missing or invalid reasons normalize to `unspecified`.

The protected `/ops/metrics` endpoint reports inbound outcome counts, historical processed rows with no recorded outcome as `unknown`, handoff totals and reason groups, queue state, and publish/retry/dead-letter attempts. No historical outcome was guessed or backfilled.

Production verification:

- bridge 0.3.0 authenticated health returned HTTP 200
- AI, file, and audio bridge APIs all reported ready
- Node `/health/live` and `/health/ready` returned HTTP 200
- `/health/capabilities` reports metrics schema 2 and bridge API schema 3
- one correctly signed controlled Messenger smoke event was accepted and processed on attempt 1
- that event persisted `processing_outcome=handled`
- one outbound action published, with zero dead letters
- post-smoke protected metrics showed one new handled outcome while older rows remained unknown
- Hostinger one-hour runtime-log audit returned 96 lines with zero WARN/ERROR and contained processor/outbound activity

A live human-handoff event was intentionally not forced in production. The handoff persistence/reason path is covered by repository tests, and the WordPress bridge handoff contract remains opt-in through the existing filters.

## Instagram routing/access diagnostics

Instagram routing observability rolled out on 2026-10-01 in deployed revision:

```text
14e1bd30bbe699992bf2c8479f3cf6e6571ceaa5
```

The Meta normalizer now treats conversation-routing signals as a separate canonical capability:

- `capability=routing`
- standby message/read/delivery/postback events normalize as `standby.*`
- conversation-control notifications normalize as `handover.pass`, `handover.take`, or `handover.request`
- routing events contain no portable AI content
- `MessageReceivedHandler` explicitly does not claim routing events
- unhandled routing events are durably completed with `processing_outcome=ignored`

Production verification:

- GitHub PR #21 CI passed
- local validation passed with 14 test files and 80 tests
- Hostinger built revision `14e1bd30...` successfully
- `/health/live`, `/health/ready`, and `/health/capabilities` returned HTTP 200 after deployment
- Meta's `messaging_handover` synthetic webhook produced a durable `routing / handover.pass` event and was processed as `ignored`
- a controlled correctly signed documented standby payload produced a durable `routing / standby.message` event and was processed as `ignored`
- no AI reply or outbound action was generated for either routing probe

The current Instagram subscription includes `messages`, `standby`, and `messaging_handover`. Do not remove these routing fields without first deciding how routing diagnostics will be preserved.

External-account diagnosis:

- `povnailstudio.ph` has durable inbound Instagram events and successfully published reply actions
- `povnailstudio.com.ph` has no durable inbound Instagram event in the inspected production history, so its failure occurs before AI processing or outbound dispatch
- following status was not the differentiator for the working account
- Meta app compliance was previously verified clean, but a fresh authenticated App Review requirements read on 2026-10-01 now reports `business_verification_passes=false`; reconcile this current dashboard state before submission
- App Review still reports `can_submit=true`, current status `NO_SUBMISSION`, and no Advanced Access privileges

Do not add Conversation Routing write/control APIs merely because routing webhooks are observable. Meta's current Conversation Routing documentation is tied to the Messenger/Page-linked architecture and requires a linked Facebook Page with Pages Messaging. Ishikeit's Instagram outbound path currently uses the newer Instagram Login host `graph.instagram.com`. Keep routing control read-only/observational until the correct authorization model for this app is proven.

## Meta App Review live recheck — 2026-10-01

A fresh authenticated Meta developer-tool read for app `1042452472116584` reports:

- submission status: `NO_SUBMISSION`
- `can_submit=true`
- requested/granted Advanced Access privileges: none
- current App Review requirement snapshot: `business_verification_passes=false`

The Business Verification result conflicts with the earlier verified project state that reported it passing. Treat the current authenticated result as the active blocker and reconcile it in Meta App Dashboard before submitting. Do not infer that the earlier passing state is still valid.

Meta's current Instagram API with Instagram Login review guidance confirms that the intended Advanced Access request remains `instagram_business_basic` plus the dependent `instagram_business_manage_messages` permission, and that the review evidence must demonstrate the real login/authorization and messaging flow. Do not fabricate reviewer evidence.

## Telegram adapter implementation — merged 2026-10-01

The first non-Meta messaging adapter was squash-merged by GitHub PR #24 into `main` as:

```text
85a92e3a53bb5b41661ccae5a0f51d731dcaf56f
```

It adds Telegram through the existing provider-neutral boundaries without changing the durable processor or database schema.

Implemented boundaries:

- authenticated `POST /ishikeit/webhooks/telegram` ingress using Telegram's secret-token header
- Bot API `update_id` deduplication and per-chat durable partitioning
- portable text/image/video/audio/document normalization
- provider `file_id` resolution through `getFile` after webhook ACK
- `telegram / messaging / message.send` action adapter
- Telegram-local send limits, throttling retry guidance, and delivery-ambiguity classification
- bot-token/account consistency enforcement
- runtime credential redaction and paired token/secret configuration
- focused unit/integration tests for normalization, ingress authentication, media resolution, send behavior, environment validation, and the action adapter

Validation on PR #24 and merged `main`:

- the first PR CI run correctly failed only on four ESLint `no-base-to-string` assertions in the newly added tests
- those test assertions were corrected without changing runtime behavior
- the final PR-head CI passed Node, PHP lint, and context-continuity
- merged-main CI run #93 also passed Node, PHP lint, and context-continuity
- `npm run check` passed lint, typecheck, tests, and build
- 18 test files passed
- 96 tests passed
- no Telegram credential, provider webhook, or production activation was performed as part of the merge

Telegram production activation completed on 2026-10-01.

Production bot:

- name: `Ishi Nail Lab`
- username: `@ishinailbot`
- bot ID: `8985271003`
- webhook: `https://apps.ishinaillab.com/ishikeit/webhooks/telegram`

Activation controls and provider verification:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_OUTBOUND_REQUEST_TIMEOUT_MS` are present in Hostinger production
- the webhook rejects requests without the Telegram secret-token header with HTTP 401
- initial `setWebhook` used `allowed_updates=["message"]` and `drop_pending_updates=true`
- post-registration and post-canary `getWebhookInfo` both reported the expected URL, `pending_update_count=0`, no last error, and only `message` updates
- `GET /health/ready` returned `{"status":"ready"}`

Controlled human-originated canary proof:

- exact Telegram inbound event persisted once as `provider=telegram`, `channel=bot`, `capability=messaging`, `event_type=message.received`
- source inbound event ID: `1d608d83-85c7-450a-bf42-7d33dd0773e1`
- provider inbound message ID: `14`
- event processed on attempt 1 with `last_error=NULL`
- exactly one `telegram / messaging / message.send` action was created
- action published on attempt 1
- Telegram returned provider message ID `15`
- outbound attempt duration was 682 ms
- recent `action.dispatch` audit showed 0 pending and 0 dead-lettered actions

Telegram is therefore production-active.

Hostinger operational guardrails proven during this cutover:

- `hosting_nodejs_replace-environment-variables` is a **full replacement**, not a patch. Never reconstruct values from `hosting_nodejs_list-environment-variables`; its values are masked/non-reusable. Build the full desired set from a trusted secret source.
- For a manual `hosting_nodejs_start-build` of this repository through Hostinger MCP, use repository-root output (`root_directory="."`, `output_directory="."`) with entry `dist/processes/http.js`. Using `output_directory="dist"` publishes the contents of `dist` as the runtime root and makes `dist/processes/http.js` unavailable.
- Hostinger normalizes repository-root `root_directory="."` to `null` in returned build metadata; that is expected.
- The production readiness body is `{"status":"ready"}`; do not gate on a nonexistent `ready:true` field.

The temporary Telegram credential handoff file was cleared after the credential pair was promoted into the existing local production recovery `.env`. Secrets remain excluded from Git.

## TikTok Business Messaging adapter — implementation milestone 2026-10-02

TikTok for Business Business Messaging is implemented through the existing provider-neutral event/action boundaries. The original messaging adapter required no schema change; the later production OAuth lifecycle adds the dedicated OAuth migration documented below.

Implemented runtime boundary:

- optional authenticated `POST /ishikeit/webhooks/tiktok`
- raw-body `TikTok-Signature` HMAC-SHA256 verification before JSON parsing
- bounded signature timestamp age to reduce replay risk
- canonical route: `provider=tiktok`, `channel=business`, `capability=messaging`
- `im_receive_msg` -> `message.received`
- `im_send_msg` -> `message.sent` so send echoes do not re-enter the AI conversation handler
- deterministic event deduplication and per-conversation durable partitioning
- signed events for another authorized Business Account are acknowledged as ignored without persistence
- inbound text/image/video/share-post/structured message normalization
- inbound image/video provider-media resolver after durable webhook ACK
- `tiktok / messaging / message.send` action adapter
- generic TikTok outbound intentionally restricted to text in this milestone
- target Business Account validation
- provider-specific transport/rate-limit failure classification
- TikTok signature/app-secret/OAuth-secret log redaction
- HTTP request serialization strips query strings, preventing OAuth callback state/auth codes from entering request logs
- TikTok OAuth application settings must be configured as one complete protected set; Business Account activation is a separate post-authorization step

Configuration contract after the OAuth-lifecycle hardening:

```text
TIKTOK_BUSINESS_APP_ID
TIKTOK_BUSINESS_APP_SECRET
TIKTOK_BUSINESS_AUTHORIZATION_URL
TIKTOK_BUSINESS_REDIRECT_URI=https://apps.ishinaillab.com/ishikeit/oauth/tiktok/callback/
OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64
TIKTOK_BUSINESS_ID
TIKTOK_BUSINESS_API_VERSION=v1.3
TIKTOK_WEBHOOK_MAX_AGE_SECONDS=300
TIKTOK_OAUTH_STATE_TTL_SECONDS=600
TIKTOK_TOKEN_REFRESH_SKEW_SECONDS=300
TIKTOK_OAUTH_REQUEST_TIMEOUT_MS=10000
TIKTOK_OUTBOUND_REQUEST_TIMEOUT_MS=10000
```

`TIKTOK_BUSINESS_ACCESS_TOKEN` is deliberately no longer a production environment variable. TikTok Business Account access tokens are short-lived and are now obtained/refreshed through the durable OAuth flow.

Current official TikTok API for Business documentation treats Business Messaging, Marketing, Organic, and other API product families separately. Keep that separation in Ishikeit. Automatic messages, templates, Comment-to-Message, image upload/send, conversation unlock, lead operations, Organic API actions, Marketing API actions, and future TikTok surfaces must be explicit operations/capabilities rather than hidden behind generic conversational `message.send`.

### TikTok OAuth/token lifecycle hardening — 2026-10-02

The static-access-token design was replaced before production activation because TikTok Business Account access tokens are short-lived. The app now implements the provider's account-holder OAuth lifecycle rather than requiring a daily manual token replacement.

Implemented:

- protected `POST /ops/tiktok/oauth/start` returns a TikTok authorization URL carrying a cryptographically random one-time state
- only the SHA-256 state hash, exact redirect URI, expiry, provider, and consumed timestamp are stored
- public `GET /ishikeit/oauth/tiktok/callback/` atomically consumes state before exchanging the authorization code
- authorization-code exchange uses `tt_user/oauth2/token/`
- refresh uses `tt_user/oauth2/refresh_token/`
- protected `GET /ops/tiktok/oauth/status` returns safe account/scope/expiry metadata only
- OAuth access/refresh tokens are AES-256-GCM encrypted in the application before PostgreSQL storage
- the encryption key is a dedicated 32-byte server secret and is never stored in PostgreSQL
- ciphertext AAD binds each token to provider, Business Account ID, and access/refresh token kind
- access tokens refresh before expiry; replacement refresh credentials are persisted when returned
- concurrent requests in one process share one in-flight refresh operation
- refresh is also serialized across application processes with a PostgreSQL advisory lock; a waiting process re-reads the durable credential after acquiring the lock and skips provider refresh when another process already renewed it
- missing/expired refresh credentials require Business Account reauthorization and are classified non-retryable; transient OAuth network/rate-limit/server failures remain retryable
- TikTok sender/media calls obtain tokens dynamically; pre-send token failures are retryable but not delivery-ambiguous
- logger redaction covers OAuth encryption key plus access/refresh token fields
- application startup fails if TikTok OAuth is configured while the OAuth schema is absent; once `TIKTOK_BUSINESS_ID` is set, startup/readiness also require a matching decryptable durable credential with a usable refresh token

Database migration in `ishinaillab/ishikeit-db`:

```text
supabase/migrations/20261002020000_oauth_credentials.sql
```

It adds RLS-protected `oauth_credentials` and `oauth_authorization_states` tables, revokes `anon`/`authenticated`, enforces encrypted-token IV/tag shape and all-or-none refresh-token fields, and indexes active state expiry. The migration was first executed against production inside an explicit transaction and rolled back; that dry-run verified both tables could be created successfully. GitHub PR #5 in `ishinaillab/ishikeit-db` was then squash-merged as `952cd7894230f9ed69397922a7c3da2fa47f1777`, the exact merged migration was permanently applied to production, both tables were verified with RLS enabled, and `anon`/`authenticated` were verified to have no SELECT privilege. Because the SQL was applied directly after the Supabase CLI hit a local Windows spawn failure, the remote Supabase migration ledger was explicitly repaired and read back as version `20261002020000`, name `oauth_credentials`, with 9 recorded statements.

Latest local application validation:

- lint: passed
- typecheck: passed
- test files: 26 passed
- tests: 132 passed
- build: passed

Repository validation for the original base-adapter milestone:

- lint: passed
- typecheck: passed
- test files: 23 passed
- tests: 120 passed
- build: passed
- `git diff --check`: passed

Merge/deployment verification:

- GitHub PR #27 squash-merged to `main`
- merged revision: `933c79a3b04a7a932844c64455ae11e3234607b1`
- PR CI passed Node, PHP lint, and context-continuity
- merged-main CI passed
- Hostinger automatic build `01a0f879-11ab-71bf-9d2f-7416638948c5` completed for the merged revision
- post-deploy `GET /health/ready` returned `{"status":"ready"}`
- post-deploy runtime audit reported 31 entries and 0 WARN/ERROR
- existing Telegram webhook remained protected: unauthenticated POST returned HTTP 401
- TikTok webhook returned HTTP 404 after deployment because no TikTok credential set is configured; this is the intended inactive/configuration-gated state
- post-deploy processor/outbound activity remained present with no runtime error

OAuth-lifecycle merge/deployment verification:

- GitHub PR #29 squash-merged to `main`
- merged revision: `135d6856f10517ce9ff7eb658e9e4db175b3cb41`
- the tested branch tree and merged `main` tree were verified identical
- merged-main GitHub Actions CI run `36914140091` completed successfully
- Hostinger automatic build `01a0f8ed-aee7-711d-a25e-e2436b574d2c` completed for `135d6856f10517ce9ff7eb658e9e4db175b3cb41`
- post-deploy `GET /health/ready` returned `{"status":"ready"}`
- fresh Hostinger runtime audit reported 36 log entries, 0 WARN/ERROR, and the inbound AI processor enabled after deploy
- `POST /ishikeit/webhooks/tiktok` returned HTTP 404 because no TikTok provider configuration is present
- `GET /ops/tiktok/oauth/status` returned HTTP 404 because no TikTok OAuth application configuration is present
- the trusted local production recovery `.env` contains no `TIKTOK_*` or `OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64` values, so TikTok remains intentionally inactive

Current TikTok API-version compatibility check — 2026-10-02:

- TikTok's current API for Business documentation announces a general v2.0 release and explains that endpoints without material contract changes may require only a version-path change
- Business Messaging and TikTok-account OAuth are not yet usable on v2.0 at the live API edge
- no-credential probe of `/open_api/v1.3/tt_user/oauth2/token/` returned TikTok code `40002` (`client_id` missing), proving the v1.3 OAuth route is active
- the same probe against `/open_api/v2.0/tt_user/oauth2/token/` returned HTTP 404
- no-token probe of `/open_api/v1.3/business/message/send/` returned TikTok code `40104` (access token empty), proving the v1.3 Business Messaging route is active
- the same probe against `/open_api/v2.0/business/message/send/` returned HTTP 403 / TikTok code `40006` (`no schema found`)
- therefore keep `TIKTOK_BUSINESS_API_VERSION=v1.3` for Business Messaging/OAuth until TikTok exposes those provider contracts on v2.0; do not mechanically migrate these paths merely because the general API documentation has a v2.0 section

TikTok is **not production-active yet**. No real TikTok credential has been added to Hostinger and no TikTok Business Messaging webhook has been registered. Before activation:

1. create/use the real TikTok for Business developer app
2. obtain Business Messaging API access and complete TikTok's applicable data-security/privacy review
3. configure the TikTok OAuth application settings in the trusted production secret source: app ID, app secret, TikTok-generated authorization URL, exact HTTPS redirect URI, operational bearer token, and the dedicated OAuth encryption key
4. deploy the OAuth lifecycle code while leaving `TIKTOK_BUSINESS_ID` unset so TikTok messaging remains inactive
5. call the protected `POST /ops/tiktok/oauth/start`, complete Business Account authorization in TikTok, and verify `GET /ops/tiktok/oauth/status` reports the authorized `open_id`, scopes, and refresh availability without exposing tokens
6. set `TIKTOK_BUSINESS_ID` to that verified `open_id`, restart/redeploy, and verify the TikTok webhook/sender/media boundaries become active for only that account
7. verify the Business Account's messaging capability/limits through TikTok's supported API
8. register the Business Messaging webhook to `https://apps.ishinaillab.com/ishikeit/webhooks/tiktok`
9. verify signed webhook delivery and durable-before-ACK persistence
10. run one controlled human-originated direct-message canary through webhook -> PostgreSQL -> AI bridge -> `action.dispatch` -> TikTok reply
11. audit token refresh behavior, provider resource identity, attempts, pending queue, dead letters, and runtime warnings/errors before calling TikTok production-active

Do not claim TikTok production activation until those provider-backed checks have succeeded.

## 2026-10-02 canonical website/domain migration checkpoint

The production WordPress site has been migrated from `povnailstudio.com` to the canonical website:

```text
https://www.ishinaillab.com
```

This was a runtime/hosting migration outside the Ishikeit application repository, so this section is the durable handoff for future sessions.

### WordPress canonical state

Verified after cutover:

- WordPress `home` = `https://www.ishinaillab.com`
- WordPress `siteurl` = `https://www.ishinaillab.com`
- no `WP_HOME` or `WP_SITEURL` constants override the database values
- the new apex `https://ishinaillab.com` performs one 301 to `https://www.ishinaillab.com` while preserving path and query
- `www.ishinaillab.com` is the only canonical website hostname and does not redirect away
- homepage returns HTTP 200 with canonical `https://www.ishinaillab.com/`
- `/nail-appointment-reservation/` returns HTTP 200
- `/my-dashboard/` returns HTTP 200
- `/shop/` returns HTTP 200
- `/my-account/` redirects to the login flow on the new canonical hostname
- `/studio-policies/`, `/privacy-policy/`, and `/meta-data-deletion/` return HTTP 200
- `/wp-json/` returns HTTP 200
- `/appointment/` is not the real booking-page slug; its earlier 404 was not a migration failure

The one-shot serialization-safe migration helper:

- dry-run before cutover: 213 distinct stored values would change, 0 errors
- execute: 402 database rows updated, 0 errors
- post-migration dry-run: 0 URL-shaped `povnailstudio.com` values remaining, 0 errors
- intentionally did **not** rewrite WordPress GUIDs
- intentionally preserved old-domain email/login/history identities and physical filesystem paths
- flushed rewrite rules, WordPress object cache, Elementor file cache, and LiteSpeed purge hooks after execution
- was deactivated and removed after the cutover

Rollback:

- 19 database rollback tables with prefix `zdm1002_` remain temporarily in the production database
- exact row-count parity was verified for the URL-bearing source/backup tables before cutover
- do not drop those rollback tables until the new domain has remained stable through the next operational window

### Hostinger/origin state

The shared CloudLinux WordPress document root is still physically under the historical Hostinger website path:

```text
/home/u328762438/domains/povnailstudio.com/public_html
```

Current hosting facts:

- `ishinaillab.com` is attached to that existing WordPress vhost as a parked hostname
- Hostinger ZeroSSL is active and valid for both `ishinaillab.com` and `www.ishinaillab.com`
- the certificate chain and SANs were independently validated against the Hostinger origin
- `apps.ishinaillab.com` remains the separate Ishikeit Node.js application and was not moved
- the shared-hosting MCP surface does not expose the Hostinger primary-domain change operation; Hostinger exposes the equivalent API only for Agency Plan websites
- the Hostinger internal primary website label/path therefore still references `povnailstudio.com`
- do **not** claim that the old domain is fully detached from the Hostinger vhost yet

A manual Hostinger **Change domain** operation was deliberately deferred because Hostinger documents that changing a shared-hosting domain can remove Hostinger-managed email data and website backups, and the available MCP surface does not provide a file-level shared-hosting backup/archive operation. Public detachment was completed at DNS instead. Before changing the internal Hostinger primary-domain label later, create/verify a full file-level rollback and re-check the current Hostinger behavior.

### Cloudflare and old-domain detachment

For `ishinaillab.com`:

- apex and `www` are proxied through Cloudflare after origin SSL was issued
- the apex redirect is a single 301 to `https://www.ishinaillab.com`
- path and query are preserved
- no redirect rule is applied to `www.ishinaillab.com`

For `povnailstudio.com`:

- public web A/AAAA/CNAME records for the apex were removed
- public web A/AAAA/CNAME records for `www` were removed
- the old Cloudflare redirect rule was disabled/removed
- 1.1.1.1 and 8.8.8.8 both returned no old-domain web A/AAAA/CNAME records after the change
- Zoho MX records were preserved
- SPF, Zoho verification, and Facebook domain-verification TXT records were preserved
- local resolver/browser caches may temporarily retain a historical old-domain response until TTL/cache expiry; do not treat that as authoritative if public resolvers are clean

The intended state is: the old domain no longer routes public web traffic to WordPress and does not intentionally redirect users to the new site, while unrelated mail and verification records remain intact.

### Ishikeit / WordPress bridge continuity

The WordPress AI bridge canonical base is now:

```text
https://www.ishinaillab.com/wp-json/ishi-ai/v1
```

Repository examples and the local recovery `.env` must use that canonical hostname.

Verified during the migration:

- production `WORDPRESS_AI_BRIDGE_URL` was later found to be stale at the retired `povnailstudio.com` bridge hostname during the 2026-10-02 incident diagnosis and was corrected to `https://www.ishinaillab.com/wp-json/ishi-ai/v1` while preserving the complete Hostinger environment key set
- the local recovery `C:\\Users\\MBDS\\Downloads\\.env` was also corrected to the same canonical `www` bridge hostname
- the legacy/direct `AI_Engine` connector in this ChatGPT session became unavailable after the site-domain migration
- the separate Easy MCP WordPress connector remained available enough to verify installed plugins after migration
- if a future session needs the direct `AI_Engine` connector, refresh/reconnect its endpoint against the new canonical WordPress URL rather than reverting WordPress

Do not infer an Ishikeit production outage from the ChatGPT connector failure: the live Ishikeit environment itself did not contain the old domain when audited.

### Meta verification/app-review consequence

The earlier Meta business verification for **ISHI NAIL SERVICES** was rejected because the submitted website `https://ishinaillab.com/` redirected to a different website/domain.

That condition has been removed. For the next Meta verification attempt, submit the direct canonical URL:

```text
https://www.ishinaillab.com/
```

It serves the site directly with HTTP 200 and avoids Meta's rejection reason for a submitted URL that redirects to another website.

This domain fix is separate from the existing Meta App Review work for Instagram permissions. Continue to reconcile the fresh Business Verification discrepancy before the Instagram permission submission and do not fabricate reviewer evidence.

### TikTok onboarding state

TikTok code/runtime status remains as documented above:

- base Business Messaging adapter is implemented and deployed
- durable encrypted OAuth/token-refresh lifecycle is implemented and deployed
- `ishikeit-db` OAuth migration is applied in production and synchronized with the Supabase migration ledger
- Business Messaging and TikTok account OAuth remain on provider API `v1.3`; the live `v2.0` paths were previously verified unusable for these endpoints
- TikTok is still **not production-active**

Provider-side progress as of this checkpoint:

- the TikTok for Business application has been filled out far enough for the **TikTok accounts** permission scope to be under review
- wait for that approval before supplying real TikTok credentials to Ishikeit
- a secured local handoff file `C:\\Users\\MBDS\\Downloads\\ishikeit-tiktok-app.env` exists; it contains the generated OAuth encryption key and placeholders for the TikTok app values
- do not paste the TikTok app secret into chat

Registered/intended redirect URLs:

```text
TikTok account holder:
https://apps.ishinaillab.com/ishikeit/oauth/tiktok/callback/

Advertiser:
https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/
```

Important: the account-holder OAuth callback is implemented. The advertiser callback was supplied for the TikTok application form but the corresponding advertiser/Marketing-API OAuth route must be implemented and verified **before** performing any advertiser authorization.

After TikTok account-scope approval:

1. fill the secured local handoff file with the approved app ID, app secret, and TikTok-generated account-holder authorization URL
2. validate those values locally without printing them
3. add the complete OAuth app settings to the trusted Hostinger environment while leaving `TIKTOK_BUSINESS_ID` unset
4. complete Business Account authorization and verify the returned `open_id`, scopes, token expiry, and refresh availability
5. set `TIKTOK_BUSINESS_ID` only after the verified `open_id` is known
6. register/verify the Business Messaging webhook and run a real human-originated end-to-end canary before declaring TikTok production-active

### Canonical repository checkpoint before this continuity update

- `ishinaillab/ishikeit` main: `28ab3323c259c3154988315aaf32e174441952b9`
- `ishinaillab/ishikeit-db` main: `952cd7894230f9ed69397922a7c3da2fa47f1777`
- Telegram remains production-active and was not changed by the website-domain migration
- Meta/Telegram/TikTok provider architecture remains provider-neutral; do not redesign the core because of the website hostname change

### Continuity checkpoint persistence/deployment verification

The migration/context checkpoint above was persisted by GitHub PR #32 and then verified in the deployed environment:

- PR #32, **Record canonical website migration checkpoint**, squash-merged as `3c1abb4820fb8870fac026ad022983f8ff67b933`
- merged-main CI run `36960211692` passed `node`, `php-lint`, and `context-continuity`
- Hostinger automatic build `01a0faa6-abfe-734f-ae0a-761a99904322` completed for `3c1abb4820fb8870fac026ad022983f8ff67b933`
- `https://apps.ishinaillab.com/health/ready` returned `{"status":"ready"}`
- public `https://ishinaillab.com/` returned one Cloudflare HTTP 301 to `https://www.ishinaillab.com/`
- public `https://www.ishinaillab.com/` returned HTTP 200
- public `https://www.ishinaillab.com/nail-appointment-reservation/` returned HTTP 200
- public `https://www.ishinaillab.com/wp-json/` returned HTTP 200

These are post-merge/post-deploy checks. The remaining unresolved items are operational/provider-side, not a pending website cutover.

## Context engineering and durable continuity

Durable project context is change-coupled rather than primarily timer-coupled.

Primary rule:

- every pull request that changes a context-sensitive execution boundary must update `docs/CONTINUATION.md` in the same pull request
- context-sensitive boundaries currently include application source, migrations, WordPress bridge code, environment-contract examples, package manifests/lockfile, TypeScript/ESLint configuration, and GitHub workflows
- CI checks this rule through the `context-continuity` job on pull requests and on every push to `main`
- pull requests may use a deliberate `context-not-required` label only when a maintainer has determined that the change has no durable project-context impact
- a direct push to `main` has no label bypass: if it changes a context-sensitive boundary without updating `docs/CONTINUATION.md`, the event-driven main-branch CI run fails and the missing context must be corrected immediately
- secrets, raw customer payloads, access tokens, database URLs, and other sensitive values must never be copied into the continuation document

This makes repository changes themselves the primary context-capture event. Runtime/configuration work performed outside Git still needs an immediate continuation update in the same operational task whenever it materially changes the verified project state.

The repository's `main` branch is currently not protected, so the CI check is not yet a hard pre-merge policy gate. Normal pull-request work receives the check before merge; direct pushes are detected immediately after the push. Repository administration should eventually require the relevant CI checks through branch protection or a ruleset when an administrative write surface is available.

A daily Ishikeit context integrity sweep exists only as a safety net for missed or externally applied changes. It is not the source of truth and should not be used as a substitute for change-coupled documentation. If a native agent event-trigger surface becomes available for GitHub/configuration changes, prefer it over increasing polling frequency.

## Security posture

Current important controls:

- TLS/HTTPS
- exact raw-body Meta HMAC validation
- timing-safe signature comparison
- dedicated high-entropy webhook verify token
- dedicated private WordPress bridge credential
- server-side provider credentials only
- no provider tokens in Git
- logger secret redaction
- private/no-store bridge endpoints
- SSRF-hardened media resolution
- bounded media sizes/timeouts
- durable idempotency at ingress, AI turn, file upload, and action enqueue
- explicit rollout cutover
- provider-neutral canary partition guard
- processor and dispatcher independently disableable

Do not add provider access tokens, bridge tokens, app secrets, DB URLs, or raw customer message bodies to committed documentation.

## Current operational rollback controls

Stop new AI processing while continuing durable webhook ingestion:

```text
PROCESSOR_ENABLED=false
```

Stop provider-side actions:

```text
ACTION_DISPATCH_ENABLED=false
```

If only dispatch is disabled, generated actions remain durable. Inspect pending actions before re-enabling if a rollback lasted long enough that replies may have become stale.

Do not move the full-rollout cutover forward during an ordinary outage unless intentionally discarding the backlog.

## Real media validation

Controlled provider-backed media validation completed on 2026-09-30.

The original resolver-only validation used temporary WhatsApp Cloud API media objects and the production Ishikeit media resolver without sending customer-facing messages. Those resolver-probe objects were deleted after verification.

Verified byte-for-byte resolver paths:

- image: PNG
- document: plain text
- audio: MP3
- video: MP4

The resolver suite verifies Meta-host allowlisting, redirect revalidation, declared and actual byte ceilings, WhatsApp metadata lookup, authenticated download, safe filename derivation, and retry classification.

A later end-to-end production matrix validated the durable processor and dispatcher on deployed revision `b8562e557ba81739c5d51e7caaacff4e5b070c83`:

- image: valid PNG was resolved, uploaded to AI Engine, processed on attempt 1, and generated a published Meta reply
- document: plain-text document was resolved, uploaded to AI Engine, and processed on attempt 1
- audio: speech-bearing MP3 was resolved, sent to the authenticated `/transcribe` bridge route, transcribed by AI Engine, processed on attempt 1, and generated a published Meta reply with a provider resource ID
- video: MP4 was received as canonical portable media and processed on attempt 1, but is intentionally not sent into the current chatbot file-input path; the AI turn receives an explicit `unprocessedMediaKinds=[video]` safeguard so it must not claim to have inspected the video

A provider-neutral video interpretation capability is now implemented and deployed in revision `fd3e4c048275922c3ebe7f89380caa856b52f933`. The first concrete interpreter is an opt-in Gemini adapter using the Gemini Files API plus the stable Interactions v1 API with `store=false`, static video processing, bounded timeouts, supported-MIME validation, resumable upload URL validation, and best-effort temporary-file deletion.

Production intentionally remains at `VIDEO_INTERPRETER_PROVIDER=none` because no verified paid Gemini credential is configured. Therefore the live behavior is still the safe no-inspection path: video transport/receipt and outbound video messaging work, but the chatbot must not claim to have inspected inbound video until the interpreter is explicitly enabled and validated.

Activation requirements:

- use a paid Gemini API Cloud project/key so customer prompts/files are not used to improve Google's products under the current service terms
- set `VIDEO_INTERPRETER_PROVIDER=gemini` and `GEMINI_API_KEY` in server-side secret storage
- keep the key out of Git and documentation
- run a real provider-backed video smoke test before declaring inbound video understanding live
- verify `/health/capabilities` reports `videoInterpreterProvider=gemini` only after successful activation

The end-to-end matrix's temporary provider media cleanup was not independently verified after the execution safety layer blocked a new cleanup helper. Do not state that those later matrix objects were deleted.

Post-matrix operational metrics at `2026-09-30T14:32:15.641Z` showed:

- inbound received: 38
- inbound processed: 38
- current inbound failures: 0
- pending `action.dispatch`: 0
- pending `inbound.event.accepted`: 0
- pending legacy `meta.message.send`: 0
- published attempts in the 60-minute window: 49
- retries: 0
- dead letters: 0

Latest full repository validation:

- lint: passed
- typecheck: passed
- test files: 23 passed
- tests: 120 passed
- build: passed
- `git diff --check`: passed

GitHub PR #21 CI passed before squash merge. Hostinger then built `14e1bd30bbe699992bf2c8479f3cf6e6571ceaa5` successfully. Post-deploy `/health/live`, `/health/ready`, and `/health/capabilities` all returned HTTP 200. Routing probes confirmed handover and standby events are stored durably and ignored by the AI handler.

## Resolved messaging incident and Meta recheck - 2026-10-02

A production messaging incident occurred after the WordPress domain migration. Diagnosis established two migration-sensitive dependencies:

- Ishikeit's production `WORDPRESS_AI_BRIDGE_URL` was found pointing at the retired `povnailstudio.com` WordPress hostname and was corrected to the canonical bridge base `https://www.ishinaillab.com/wp-json/ishi-ai/v1` while preserving the complete Hostinger environment key set.
- After the bridge hostname was corrected, Ishikeit reached WordPress but affected turns returned HTTP 502. The confirmed root cause was the token used by the AI Engine <-> LatePoint connection: it had originally been issued for `povnailstudio.com` and no longer matched the migrated site. The token/domain binding was corrected outside Ishikeit, and the messaging problem is now resolved.

Do not attribute this incident to a defect in Ishikeit's provider-neutral ingress, processor, or dispatcher. The durable queues remained bounded; affected historical customer turns that exhausted retries remain audit history and must not be blindly replayed after a long delay because that could send stale replies.

Post-incident PostgreSQL audit found no currently pending outbox records. Historical incident dead letters were retained for audit, and the temporary Hostinger diagnostic cron jobs used during investigation were removed.

The direct ChatGPT `AI_Engine` connector is a separate convenience integration and may still need to be refreshed against the new canonical site if it is used in a future session. Do not use its connection state as proof of Ishikeit production health.

A fresh authenticated Meta app-state read on 2026-10-02 for app `1042452472116584` now reports:

- App Review submission status: `NO_SUBMISSION`
- `can_submit=true`
- privacy-policy requirement: passes
- Business Verification: **passes**
- Advanced Access privileges: none granted
- compliance: `compliant`
- required compliance actions: none
- open violations: none

This supersedes the 2026-10-01 transient App Review requirement snapshot that reported `business_verification_passes=false`. Business Verification is no longer the active Meta blocker. The remaining Meta work is to prepare and submit the real Instagram Login App Review package for `instagram_business_basic` and `instagram_business_manage_messages` with authentic reviewer evidence.

## Instagram Login OAuth lifecycle - implementation milestone 2026-10-02

A fresh authenticated Meta recheck reports Business Verification passing, App Review status `NO_SUBMISSION`, `can_submit=true`, no Advanced Access grants, and clean compliance. Current Meta documentation confirms the observed production boundary: Standard Access delivers Instagram messaging webhooks only for people with an app role; Advanced Access is required for ordinary customers.

To make the real App Review flow externally testable, Ishikeit now implements Instagram API with Instagram Login OAuth on the existing durable OAuth subsystem:

- public review/login entry point: `GET /ishikeit/oauth/instagram/login/`
- exact callback route: `GET /ishikeit/oauth/instagram/callback/`
- protected operational start/status endpoints
- 32-byte random OAuth state with only its SHA-256 hash persisted
- atomic one-time state consumption before code exchange
- server-side authorization-code exchange at `api.instagram.com/oauth/access_token`
- server-side exchange to a 60-day long-lived token at `graph.instagram.com/access_token`
- long-lived token refresh through `graph.instagram.com/refresh_access_token`
- encrypted durable storage in the already-deployed `oauth_credentials` tables
- account-scoped token selection for outbound Instagram sends
- long-lived-token refresh under process-local deduplication plus PostgreSQL advisory locking
- current static `META_INSTAGRAM_ACCESS_TOKEN` remains the production-account fallback until Ishi's own account is deliberately migrated
- product-specific Instagram App Secret is added to logger redaction
- current review scopes are fixed to `instagram_business_basic` and `instagram_business_manage_messages`

Configuration contract:

```text
META_INSTAGRAM_OAUTH_APP_ID=<Instagram product App ID>
META_INSTAGRAM_OAUTH_APP_SECRET=<Instagram product App Secret>
META_INSTAGRAM_OAUTH_REDIRECT_URI=https://apps.ishinaillab.com/ishikeit/oauth/instagram/callback/
META_INSTAGRAM_OAUTH_STATE_TTL_SECONDS=600
META_INSTAGRAM_TOKEN_REFRESH_SKEW_SECONDS=604800
META_INSTAGRAM_OAUTH_REQUEST_TIMEOUT_MS=10000
OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64=<existing 32-byte base64 OAuth encryption key>
```

The Instagram product App ID/App Secret are the values under Meta App Dashboard -> Instagram -> API setup with Instagram login -> Set up Instagram business login. They are not the general Meta App ID/App Secret. Do not paste the product secret into chat or commit it. A secured local handoff file `C:\\Users\\MBDS\\Downloads\\ishikeit-instagram-app.env` now exists outside the repository. It reuses the already-validated 32-byte OAuth encryption key from the TikTok handoff and contains placeholders only for the Instagram product App ID and App Secret.

The OAuth code is deployed but the feature is intentionally **not production-active yet**. The product-specific Instagram credentials and redirect registration have not been supplied to the Hostinger environment in this checkpoint, and no public website login button has been published yet. Before App Review submission:

1. securely configure the product-specific Instagram App ID/secret and the exact redirect URI
2. deploy this OAuth lifecycle while preserving the current static production Instagram token
3. verify the public login route redirects only to Instagram and the callback completes with one-time state
4. authorize a controlled Instagram professional account and verify protected OAuth status returns only account/scope/expiry metadata
5. run a controlled message through webhook -> durable event -> AI -> `action.dispatch` -> Instagram reply using that account's OAuth credential
6. add a visible website/reviewer login link to the public login route
7. record the real Meta screencast showing authorization, messaging, handling, API send, and receipt; do not fabricate evidence
8. submit App Review for `instagram_business_basic` and `instagram_business_manage_messages`
9. after approval, repeat the ordinary non-role customer DM test before declaring public Instagram messaging complete

Existing production evidence already includes successful Instagram `message.send` actions with provider message IDs, including a published send on 2026-10-01. Use that as supporting API-call evidence, but the App Review screencast must still show the actual current authorization and messaging flow.

Focused local validation for this implementation passed 42/42 tests across OAuth exchange/state, token refresh, Meta sender credential selection, HTTP review routes, and environment validation, followed by a clean TypeScript typecheck. The full repository gate then passed lint, typecheck, all 150 tests, and the production TypeScript build.

## Instagram Login OAuth merge/deployment verification - 2026-10-02

The Instagram Login OAuth lifecycle described above was squash-merged through GitHub PR #35 into `main` as:

```text
1520df5c91485383228ba246b8e76db31d35eb7c
```

Validation and deployment evidence:

- all PR checks passed: `context-continuity`, `php-lint`, and `node`
- local full gate passed lint, typecheck, 28 test files / 150 tests, and production build
- Hostinger Node.js build `01a0fb2f-7c98-7378-bae7-70b72a18f6dd` completed from exact merge SHA `1520df5c91485383228ba246b8e76db31d35eb7c`
- post-deploy `/health/ready` returned HTTP 200 with `{"status":"ready"}`
- `/health/capabilities` still reported the production processor and action dispatcher enabled, zero processor canary partitions, and video interpretation disabled
- fresh runtime audit after deploy reported 7 log entries and 0 WARN/ERROR
- `/ishikeit/oauth/instagram/login/` returned HTTP 404 as expected because the product-specific Instagram OAuth environment is intentionally not configured yet
- the live Hostinger environment key set remained unchanged from the trusted recovery set except that the intentionally empty `PROCESSOR_CANARY_PARTITION_KEYS` key is omitted server-side; no Instagram OAuth product keys were added
- post-deploy PostgreSQL audit found no pending outbox items, no dead letters in the preceding 30 minutes, and no failed inbound events in the preceding 30 minutes

Therefore the OAuth **code is deployed**, but the Instagram OAuth **feature remains intentionally inactive/configuration-gated**. Current production Instagram messaging continues to use the established static Ishi token path. Do not mark the OAuth feature active until the secured product-specific Instagram App ID/App Secret are supplied, the redirect URI is registered, and a real authorization/canary succeeds.

## Instagram review activation checkpoint - 2026-10-02

The secured Instagram handoff now contains non-placeholder product credentials. The values themselves must remain outside Git/chat.

The local promotion helper `C:\\Users\\MBDS\\Downloads\\hostinger-mcp-client\\activate_instagram_oauth_env.mjs` validated and promoted the Instagram OAuth configuration to Hostinger while preserving the existing production environment. The live environment now includes the seven configuration keys required by the deployed Instagram OAuth lifecycle.

Post-activation verification:

- `GET /health/ready` returned HTTP 200 with `{"status":"ready"}`
- `GET /ishikeit/oauth/instagram/login/` returned HTTP 302
- redirect host is `www.instagram.com`
- redirect path is `/oauth/authorize`
- redirect `client_id` matches the product Instagram App ID in the secured handoff
- redirect URI is exactly `https://apps.ishinaillab.com/ishikeit/oauth/instagram/callback/`
- response type is `code`
- requested scope is exactly `instagram_business_basic,instagram_business_manage_messages`
- cryptographically random OAuth state is present
- protected `GET /ops/instagram/oauth/status` returned HTTP 200 with `{"authorized":false}`

The feature is therefore **configured and externally launchable, but no Instagram Professional account has completed authorization yet**. Do not mark the Instagram OAuth rollout complete until a real controlled account finishes consent, the durable OAuth status shows that account authorized with the intended granted scopes, and a controlled customer-DM canary succeeds.

A submission-ready review package now lives at `docs/meta-instagram-app-review.md`. It reconciles Meta's access-level guidance: Standard Access can serve an owned/managed professional account, but customer messaging webhooks include data from ordinary people without app roles; Meta's current webhook guidance requires App Review / Advanced Access for those notifications.

## Instagram OAuth callback and data-lifecycle hardening - 2026-10-02

The first interactive Instagram authorization reached Ishikeit's callback with both `state` and `code`, but the durable authorization-state row remained unconsumed. After the initial hardening deployment, later controlled attempts did consume the matching one-time state but still stored no Instagram OAuth credential. The active failure is therefore post-state-validation: short-token exchange, long-token exchange, or credential persistence. The OAuth implementation was reconciled against current Meta Business Login documentation before retrying authorization.

Current implementation changes:

- Business Login starts at `https://www.instagram.com/oauth/authorize`, which is the endpoint specified by Meta’s current Business Login for Instagram guide. The token exchange remains `https://api.instagram.com/oauth/access_token`.
- Authorization requests include `force_reauth=true`, preserve exact redirect URI matching, and retain cryptographically random one-time CSRF state.
- Callback failures log only a short SHA-256 state fingerprint plus state/code lengths; raw state, authorization code, and tokens remain secret.
- stage-aware diagnostics classify failures as `short_token_exchange`, `long_token_exchange`, or `credential_persistence`; provider failures expose only safe HTTP/provider codes and a normalized reason such as `redirect_uri_mismatch` or `client_secret_invalid`, never raw credentials or authorization codes.
- a post-deploy controlled authorization produced `stage=short_token_exchange class=InstagramOAuthRequestError retryable=false` with no HTTP/provider error fields. Because request transport failures are retryable and provider rejections include an HTTP status/reason, this isolates the failure to validation of a nominally successful short-token payload.
- the short-token JSON parser now preserves a bare numeric `user_id` as its exact decimal string before normal JSON parsing. This prevents precision loss for Instagram IDs beyond JavaScript's safe integer range while remaining compatible with Meta's documented quoted numeric-string response. Missing token/user-id fields now emit separate safe diagnostic reasons.
- dedicated Meta signed-request verification uses HMAC-SHA256 plus timing-safe comparison.
- deauthorization callback: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/deauthorize/`
- data-deletion callback: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/data-deletion/`
- human-readable deletion status route: `/ishikeit/privacy/data-deletion/status/:confirmationCode`
- deauthorization creates a durable revocation tombstone and deletes the encrypted Instagram OAuth credential.
- successful reauthorization atomically clears the revocation tombstone.
- a revoked/deleted account cannot silently fall back to the legacy static Instagram token; static fallback remains available only for accounts that have never entered the durable OAuth lifecycle.
- a verified data-deletion request durably records status, revokes the OAuth credential, and removes matching Instagram inbound events, outbound actions, and related delivery-attempt rows before returning Meta's required status URL and confirmation code.

Database migration:

`supabase/migrations/20261002090000_instagram_data_lifecycle.sql`

It adds RLS-protected `oauth_revocations` and `oauth_data_deletion_requests` tables and revokes access from `anon` and `authenticated`. Database PR #6 was squash-merged as `506f17228cc58d50bc26d066ca4dc4924adfd231`; the exact migration was then applied to the linked production Supabase project. `supabase migration list` now shows `20261002090000` synchronized locally and remotely, and linked schema lint reports no errors.

Application validation after the hardening change:

- lint: passed
- typecheck: passed
- test files: 29 passed
- tests: 156 passed
- production build: passed
- `git diff --check`: passed

After the stage-diagnostic revision is merged and deployed, run one fresh controlled Instagram authorization from the production login route. Immediately inspect the callback log for its safe stage/reason classification and the database for state consumption plus OAuth credential persistence before attempting the customer-DM canary.

## Instagram OAuth activation and routing-identity reconciliation - 2026-10-03

A controlled Instagram Professional account authorization now completes successfully. The durable credential is AES-256-GCM encrypted at rest, includes `instagram_business_basic` and `instagram_business_manage_messages`, has the expected approximately 60-day expiry, and has no revocation tombstone. The successful callback produced no warning/error logs. Meta's app-level Instagram webhook subscription is enabled for `messages`, `standby`, and `messaging_handover`; Meta's current Instagram Login webhook flow additionally requires each authorized Professional account to enable those fields through `POST /me/subscribed_apps`, which is now part of OAuth onboarding and startup reconciliation.

The successful flow exposed an important identity distinction that must be preserved:

- Business Login's token exchange returns an app-scoped OAuth subject ID.
- Instagram messaging webhooks and the `/<IG_ID>/messages` endpoint route by the Instagram Professional account ID.
- These IDs are not interchangeable and must not be used as a single credential key.

The application now keeps the encrypted credential under its OAuth subject ID and resolves provider-routing IDs through a durable alias. The token manager is alias-aware, refresh locks remain keyed to the credential identity, revocation through either identity resolves to the same credential, and data deletion removes retained Instagram rows for both the OAuth subject and all known routing aliases. Startup reconciliation calls Instagram `/me?fields=user_id` for already-authorized credentials so the successful production authorization does not need to be repeated.

Canary findings:

- the alias-aware OAuth send path reached Meta successfully; a send to the known first-party `@ishinaillab` conversation was rejected only by the 24-hour messaging-window rule (`HTTP 403`, Graph subcode `2534022`), proving the OAuth token and Professional-account routing identity were accepted.
- the retired static `META_INSTAGRAM_ACCESS_TOKEN` path is no longer usable. Both direct probes and a real production outbox action returned Graph code `100` (`Unsupported request - method type: post`). Do not use that static credential as evidence for current Instagram functionality.
- when an Instagram OAuth token provider is configured, `MetaSender` now uses it exclusively. An unmapped account fails locally instead of falling back to the retired static token; the static token remains available only for deployments where OAuth routing is not configured at all.
- PR #44 merged as `8274c59839ce60e871bea977d8ecb73707aaca89` and Hostinger deployed that exact SHA successfully. `/health/ready` returned 200 and startup again logged successful Instagram OAuth routing/webhook reconciliation.
- a post-deploy send to the known first-party `@ishinaillab` conversation reached Meta through the mapped OAuth credential and returned only the expected expired-window rejection: HTTP 403, Graph `10:2534022`, `This message is sent outside of allowed window.` This is positive evidence that the OAuth token and Professional-account routing ID are accepted.
- a post-deploy unmapped-account outbox canary (`4d8c7862-15a2-8ccc-af0f-f7f6af7f14a0`) dead-lettered locally with `No Meta access token is configured for instagram`, with no HTTP status and no provider code. This proves the retired static token was not used and no Meta request was made for the unmapped account.
- the only post-deploy ERROR log during this verification window is the intentionally generated unmapped-account dead-letter above; no unexpected runtime warnings/errors were observed.
- Meta's dashboard webhook-test control only validates app-level delivery setup; it does not replace the required account-level `subscribed_apps` enablement for a newly OAuth-authorized Instagram Professional account.
- OAuth completion now enables exactly the active app-level Instagram fields: `messages`, `standby`, and `messaging_handover`. Startup reconciliation repeats the call idempotently with a current/refreshed OAuth token, so already-authorized accounts are repaired automatically.
- the exact account-level subscription call was exercised against the already-authorized production credential before merge and Meta returned success for all three fields; no token value was logged or exposed.

Database migration:

`supabase/migrations/20261003020000_oauth_account_aliases.sql`

It adds the RLS-protected `oauth_account_aliases` table without coupling alias lifetime to credential lifetime, so a revocation can continue blocking legacy static-token fallback. Database commit `94babed` is on `ishikeit-db/main`, and the linked Supabase CLI applied the migration after a dry run confirmed it was the only pending migration.

Application validation for the alias change:

- lint: passed
- typecheck: passed
- test files: 29 passed
- tests: 158 passed
- production build: passed
- `git diff --check`: passed

Current account-level webhook-subscription validation:

- lint: passed
- typecheck: passed
- test files: 29 passed
- tests: 159 passed
- production build: passed
- focused live Meta subscription call: passed for `messages`, `standby`, and `messaging_handover`

Instagram OAuth routing, account-level webhook subscription, OAuth-only token selection, and production verification are complete. The public reviewer page is published at `https://www.ishinaillab.com/instagram-connect-review/` and names the live authorized account `@povnailstudio.ph`. Meta currently reports `can_submit=true`, `NO_SUBMISSION`, Business Verification passing, and no Advanced Access grants. The remaining App Review artifact is the real end-to-end screencast required by Meta; do not fabricate it or reauthorize merely to recreate aliases/subscriptions.

## Current next work

The durable messaging processor is now a production system, not a scaffold. Operational metrics, audio transcription adaptation, durable handoff/outcome observability, Telegram, the TikTok adapter, and the TikTok OAuth lifecycle are already implemented; do not redo those phases.

Immediate continuity tasks after the website-domain migration:

1. if direct `AI_Engine` connector tools are needed, refresh/reconnect that ChatGPT connector against `https://www.ishinaillab.com`; do not revert WordPress to the old domain to restore a stale connector
2. Instagram OAuth is configured, authorized, encrypted, alias-aware, OAuth-only for configured accounts, and deployed. The reviewer page is public and the submission package is current. Record the required real screencast, upload it with the reviewer instructions, then submit `instagram_business_basic` and `instagram_business_manage_messages` for Advanced Access
3. wait for TikTok's **TikTok accounts** permission-scope review; after approval, continue the secured OAuth activation workflow from `ishikeit-tiktok-app.env`
4. keep the `zdm1002_*` WordPress rollback tables until the new canonical site has remained stable through the next operational window
5. do not change Hostinger's internal shared-hosting primary-domain label from `povnailstudio.com` until a complete file-level rollback/archive has been created and the current Hostinger change-domain side effects have been re-verified; public old-domain web DNS is already detached

Continue building on the adapter/registry boundaries rather than redesigning the core. Recommended product sequence after those operational tasks:

6. complete TikTok for Business provider-backed activation: authorize the target Business Account, prove token refresh, configure the webhook, verify account capability/limits, and run a controlled human-originated end-to-end canary before declaring TikTok production-active
7. complete Meta App Review by recording the required real screencast, adding the submission-ready permission descriptions and reviewer instructions from `docs/meta-instagram-app-review.md`, then submit `instagram_business_basic` and `instagram_business_manage_messages`
8. the screencast must show the public Connect Instagram page, real authorization, a customer-initiated DM, Ishikeit processing/reply, and receipt in Instagram; do not fabricate review evidence
9. after approval, repeat the fresh ordinary non-role account DM test and verify normal `message.received` ingestion plus successful reply before declaring Instagram public-user messaging production-complete
10. do not add Conversation Routing write/control APIs to the current `graph.instagram.com` path until Meta's supported authorization model for this specific app setup is proven
11. activate and perform a real provider-backed video interpretation smoke test only after a paid Gemini API project/key is securely configured; until then retain the verified no-inspection safeguard
12. add Meta lead-management capability as a separate capability/operation family
13. add Meta Marketing API operations behind their own authorization/policy layer
14. implement and verify TikTok advertiser OAuth before performing any advertiser authorization, then add TikTok Marketing operations behind their own authorization/policy layer
15. add TikTok automatic messaging, image upload/send, Comment-to-Message, Organic, Leads, and other future operations only as separate typed capabilities after the base TikTok Business Messaging path is provider-verified
16. version and test each future provider adapter and media-capability contract independently

Marketing API, lead management, and future providers must not be routed through the conversational message handler merely because they originate from Meta or TikTok.


## Authoritative latest checkpoint — 2026-10-03 18:50 Asia/Manila

This section is the current continuation source of truth. If any earlier Instagram checkpoint conflicts with this section, use this section.

### Ishikeit repositories and production

- App repository: `ishinaillab/ishikeit`.
- Database repository: `ishinaillab/ishikeit-db`.
- Retired `/ishinaillab/ishi` must not be used unless the user explicitly reintroduces it.
- Last code-bearing application revision in current `main` ancestry: `02b451ceacea67ccaf7eca6f78bf2450c318c1df` from PR #46, **Finalize Instagram App Review package**. Later documentation-only checkpoint commits do not change application behavior.
- Hostinger build for `02b451c` completed successfully on 2026-10-03.
- Production app URL: `https://apps.ishinaillab.com/`.
- Production readiness endpoint: `GET /health/ready` returns 200.
- Current database `main`: `94babed`, including `oauth_account_aliases`.
- Supabase migration `20261003020000_oauth_account_aliases.sql` is applied.

### Instagram OAuth and routing — complete

- Instagram Business Login uses `https://www.instagram.com/oauth/authorize`.
- Short token exchange uses `https://api.instagram.com/oauth/access_token`.
- Long-lived/refresh flow uses `https://graph.instagram.com/access_token` and `/refresh_access_token`.
- OAuth callback state is one-time, durable, and SHA-256 stored.
- Large bare numeric `user_id` values are preserved losslessly.
- The controlled Professional account is authorized successfully.
- Authorized account handle: **@povnailstudio.ph**.
- Professional account ID: `17841437646366614`.
- OAuth subject/credential account ID is stored separately and linked by durable account alias; do not collapse these identities.
- OAuth token is encrypted at rest with AES-256-GCM and has the expected ~60-day lifetime.
- Required scopes are present: `instagram_business_basic`, `instagram_business_manage_messages`.
- Account-level webhook subscriptions are reconciled automatically for `messages`, `standby`, and `messaging_handover`.
- When the OAuth provider is configured, Instagram outbound sends are OAuth-only. The retired static Instagram token is not a fallback for unmapped accounts.
- Revocation/data-deletion lifecycle is durable and alias-aware.
- Deauthorize callback: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/deauthorize/`.
- Data deletion callback: `https://apps.ishinaillab.com/ishikeit/oauth/instagram/data-deletion/`.

### Instagram App Review — final gate

- Meta app ID: `1042452472116584`.
- App name: **Ishikeit**.
- App mode: live.
- Business Verification: passes.
- Privacy Policy requirement: passes.
- Meta reports `can_submit=true`.
- Submission status: `NO_SUBMISSION`.
- Advanced Access grants: none yet.
- Public reviewer page is live: `https://www.ishinaillab.com/instagram-connect-review/`.
- WordPress page ID: `21471`, title **Connect Instagram**.
- The reviewer page contains the production Connect Instagram button, permission explanations, concrete reviewer test steps, the live account handle, messaging behavior, and Privacy Policy link.
- Submission-ready copy is maintained in `docs/meta-instagram-app-review.md`.
- Production database contains historical successful published Instagram `message.send` actions, including successful sends on 2026-10-01, satisfying the successful-API-call evidence requirement.
- Standard Access is insufficient for ordinary production customers because Meta documents that Standard Access testing is limited to people with app roles; Advanced Access is required for real non-role customers.
- Remaining mandatory review artifact: a **real, uninterrupted screencast** showing public reviewer page -> Connect Instagram -> real authorization -> successful callback -> customer-initiated DM -> Ishikeit processing -> API reply visible in the same Instagram conversation.
- Do not fabricate, synthesize, or mock the screencast.
- Meta currently shows the contact email `admin@ishinaillab.com` as present but not verified. This is not blocking `can_submit=true`, but verify it if Meta prompts during the final checklist.
- Final Meta Submit has not been performed. Do not claim the app is under review until the dashboard shows a real submission.

### Current validation state

- Local full release gate on current app code: lint passed.
- Typecheck passed.
- Test files: 29 passed.
- Tests: 159 passed.
- Production build passed.
- `git diff --check` passed.
- Public reviewer page: HTTP 200.
- `/health/ready`: HTTP 200.
- Production Instagram login route: HTTP 302 to Instagram with exact callback, fresh state, `force_reauth=true`, and scopes `instagram_business_basic,instagram_business_manage_messages`.

### Other project continuity

- TikTok adapter and OAuth lifecycle are implemented; activation remains blocked on TikTok **TikTok accounts** permission-scope review.
- Secure TikTok handoff remains `C:\Users\MBDS\Downloads\ishikeit-tiktok-app.env`.
- Keep `zdm1002_*` WordPress rollback tables for now.
- Do not change Hostinger's internal shared-hosting primary-domain label from `povnailstudio.com` until rollback/archive implications are reverified.
- Public canonical website remains `https://www.ishinaillab.com/`.
- Direct ChatGPT Easy MCP may still have stale connector/session behavior after the domain migration; do not revert the site domain to fix that. WPVibe is the working WordPress connector.
- Keep building future Meta Leads, Meta Marketing API, TikTok Marketing, and other providers as separate capability/operation families on the existing adapter/registry architecture.


### Instagram managed-account token regression repair — 2026-10-03

Root cause confirmed from production data and Git history:

- Instagram inbound webhooks and AI processing continued to work.
- New replies for webhook Professional account `17841438662359631` were dead-lettered locally before any Meta API request because PR #44 removed the managed-account token fallback whenever an OAuth provider was configured.
- The only durable OAuth alias currently stored belongs to a different Professional account, so the sender had no credential for the webhook account.
- The previous managed token in `META_INSTAGRAM_ACCESS_TOKEN` had been the working send path in the earlier build, but the currently configured value is no longer valid at Meta and must not be treated as usable merely because it exists.

Repair in PR #49:

- Added `InstagramAccessTokenRouter`.
- Durable OAuth remains first priority.
- A configured App Dashboard / managed-account token is now eligible only after Meta `/me` resolves its Professional account ID and that ID exactly matches the outbound webhook account ID.
- A revoked durable OAuth credential still fails closed and does not fall through to the managed token.
- Startup reconciliation now iterates all stored Instagram OAuth credentials instead of only `latest("instagram")`, preserving multi-account behavior.
- OAuth credential storage, revocation, deletion, and refresh semantics are unchanged.

Validation:

- focused Instagram token-routing and Meta sender tests: 18/18 passed.
- full local gate: lint passed, typecheck passed, 29 test files / 162 tests passed, production build passed, `git diff --check` passed.
- Meta's current Instagram API guidance supports App Dashboard access tokens for owned/managed Professional accounts and requires the sending token to be requested by the Professional account that can send messages.
- Production still needs a fresh valid managed-account token for the actual business Professional account before the repaired fallback can send; the old configured managed token currently fails Meta `/me` validation with Graph code 100.


### Instagram managed-token startup validation — 2026-10-03 late evening

Additional production diagnosis after PR #49:

- PR #49 merged as `4c38e646a285d4def7b7225f7904286f326e5277`.
- Hostinger build `01a10240-8b96-7248-bf4d-370dcd00025c` completed for that exact merge SHA.
- Both configured Instagram tester identities are reaching Ishikeit as distinct `message.received` events.
- Both tester reply actions target the same business Professional account `17841438662359631` and both were dead-lettered locally before a Meta HTTP response under the pre-fix deployment. This proves the tester roles/inbound webhook path are not the shared failure.
- A current App Dashboard screenshot captured 2026-10-03 13:08:56Z shows **Instagram -> API setup with Instagram login -> 2. Generate access tokens** with only the **Add account** button and no Professional account assigned.
- The locally archived IG token from the original working build was tested without exposing it and is expired/invalid (Meta Graph code 190). It was not promoted to production, and the local env was restored from backup.
- The current production managed token also fails Meta identity validation, so no valid business-account managed token is presently available.
- Meta's current Send API documentation states that sending requires an access token requested by the Instagram Professional account that can send the message, and lists App Dashboard as a supported token source.

Hardening added after PR #49:

- `InstagramAccessTokenRouter.managedAccountId()` exposes safe cached identity validation for the configured managed token.
- HTTP startup now validates the managed token and reconciles `messages`, `standby`, and `messaging_handover` subscriptions immediately when the token is valid.
- Invalid/wrong-account managed tokens produce an explicit startup warning instead of being discovered only after a customer message.
- full local gate: lint passed, typecheck passed, 29 test files / 163 tests passed, build passed, `git diff --check` passed.

Remaining external step is account-owner consent in Meta's dashboard: assign the actual business Professional account `ishinaillab` under **2. Generate access tokens**, complete any Instagram account confirmation Meta requires, and generate its token. This action is not exposed by the connected Meta DevTools API and requires the Instagram account owner's interactive Meta/Instagram session. Once that token exists, Ishikeit can validate the account ID, install it in Hostinger, reconcile subscriptions, and replay/verify the tester reply path.


## Authoritative transfer checkpoint — 2026-10-03 23:58 Asia/Manila

This section supersedes earlier intermediate Instagram-debugging notes where they conflict. It is the continuation source of truth for the next chat.

### User-confirmed operational state

- The user explicitly confirms that all currently used messaging platforms are working.
- Instagram is confirmed recovered: both **povnailstudio.com.ph** and **povnailstudio.ph** receive replies from **ishinaillab**.
- Do not treat the earlier Instagram dead-letter state as current; those rows are historical regression evidence only.

### Independent live database verification at transfer

Recent durable production evidence confirms successful outbound publishing:

- Instagram:
  - multiple new `published` outbox attempts after the regression repair;
  - both tester recipient identities have successful published replies;
  - latest verified published Instagram reply at approximately `2026-10-03T15:50:37Z`;
  - earlier dead-letter rows before recovery remain in history and should not be interpreted as current failure.
- WhatsApp:
  - recent inbound traffic exists;
  - recent outbound actions are published successfully.
- Messenger:
  - recent inbound traffic exists;
  - recent outbound actions are published successfully.
- Telegram:
  - recent inbound traffic exists;
  - recent outbound action is published successfully.
- The live 24-hour query showed recent inbound activity for Meta WhatsApp, Meta Instagram, Meta Messenger, and Telegram.
- The live 24-hour query showed published outbound actions for WhatsApp, Instagram, Messenger, and Telegram/bot.

TikTok remains a separate provider-activation track unless a later checkpoint records completed TikTok scope approval and a live provider-backed canary. Do not infer TikTok production activation merely from the user statement that the active messaging stack is working.

### Instagram regression — root cause and final repair

The regression was factual and code-induced:

- inbound Instagram webhooks continued to arrive;
- AI processing continued to produce replies;
- outbound reply actions were dead-lettered locally before any Meta HTTP request;
- both configured testers were reaching the same business Professional account;
- tester roles were therefore not the shared failure;
- PR #44 had made Instagram outbound OAuth-only whenever an OAuth provider existed, which removed the original managed-account/App-Dashboard token path for the actual business account.

The repaired design is intentionally not a blind fallback:

- PR #49, **Fix Instagram managed-account token regression**, merged as:
  - `4c38e646a285d4def7b7225f7904286f326e5277`
- It added `InstagramAccessTokenRouter`.
- Durable OAuth credentials remain first priority.
- A configured App Dashboard / managed token may be used only after Meta `/me` resolves the Professional account ID and that ID exactly matches the outbound/webhook account ID.
- Revoked durable OAuth credentials still fail closed and do not silently fall through.
- Startup OAuth reconciliation now iterates all stored Instagram OAuth credentials rather than only `latest("instagram")`, preserving multi-account support.
- This restored the original supported managed-account path without allowing a token for one Instagram Professional account to impersonate another.

Production evidence after this repair confirms both Instagram tester identities now receive successful published replies from **ishinaillab**.

### Instagram startup hardening after the repair

PR #50, **Validate managed Instagram token at startup**, is on app `main`:

- current app repository `main` code-bearing revision:
  - `2129601`
- PR #50 adds:
  - safe managed-token identity validation at startup;
  - immediate webhook-subscription reconciliation when the managed token is valid;
  - explicit warning when a managed token is invalid or belongs to the wrong Professional account;
  - `InstagramAccessTokenRouter.managedAccountId()`;
  - regression coverage;
  - full local gate at that revision: lint, typecheck, 29 test files / 163 tests, build, and `git diff --check` passed.

Important deployment distinction at transfer time:

- latest Hostinger build verified by the Hostinger build API:
  - build UUID `01a10240-8b96-7248-bf4d-370dcd00025c`
  - state: completed
  - deployed commit: `4c38e646a285d4def7b7225f7904286f326e5277` (PR #49)
- therefore production behavior is currently proven working on PR #49;
- PR #50 exists on `main` but was not shown as the latest deployed Hostinger build in the final transfer check;
- do not claim PR #50 is live until a later deployment check shows `2129601` or a descendant deployed.

### Instagram account identities and credential model

Current business reply account:

- business Professional account: **ishinaillab**
- webhook/outbound Professional account ID used by live reply actions:
  - `17841438662359631`

Earlier OAuth credential context:

- a durable Instagram OAuth credential was previously created for **povnailstudio.ph**;
- its Professional account ID is distinct from the business account;
- do not treat that credential as the business credential for **ishinaillab**;
- that earlier credential remains useful as historical/test OAuth coverage but is not the identity used to send replies as **ishinaillab**.

Working business send path after the regression repair:

- Ishikeit resolves the sender Professional account;
- the managed/App-Dashboard token is accepted only when its Meta `/me` identity matches `17841438662359631`;
- successful published replies after PR #49 prove the current business-token routing works for the actual **ishinaillab** account.

### Instagram App Review state

The integration itself is operational again, but App Review remains a separate unfinished track.

Meta app:

- App ID: `1042452472116584`
- App name: **Ishikeit**
- app mode: live
- Business Verification: passing
- Privacy Policy requirement: passing
- latest known review status:
  - `can_submit=true`
  - `NO_SUBMISSION`
  - no Advanced Access grants yet

Requested permissions remain only:

- `instagram_business_basic`
- `instagram_business_manage_messages`

Reviewer assets:

- public reviewer page:
  - `https://www.ishinaillab.com/instagram-connect-review/`
- WordPress page ID:
  - `21471`
- final review copy:
  - `docs/meta-instagram-app-review.md`

The next App Review work is still:

1. record the real uninterrupted screencast;
2. upload the screencast with the prepared permission explanations and reviewer steps;
3. submit the two permissions for Advanced Access;
4. after approval, run an ordinary non-role customer DM test before declaring public-user Instagram messaging review-complete.

Do not fabricate or synthesize review evidence.

### Ishikeit repository state

App repository:

- `github.com/ishinaillab/ishikeit`
- current `origin/main` at transfer:
  - `2129601` — **Validate managed Instagram token at startup (#50)**
- important recent ancestry:
  - `4c38e64` — Fix Instagram managed-account token regression (#49)
  - `b2bbd07` — Clarify saved production revision wording (#48)
  - `092e84d` — Save latest Ishikeit continuation checkpoint (#47)
  - `02b451c` — Finalize Instagram App Review package (#46)
  - `ce25903` — Record final Instagram OAuth routing verification (#45)
  - `8274c59` — Require OAuth-only Instagram routing when configured (#44)
  - `8a2f395` — Enable Instagram account webhook subscriptions (#43)

Database repository:

- `github.com/ishinaillab/ishikeit-db`
- current `main`:
  - `94babed` — Add OAuth account aliases
- key migrations already applied include:
  - foundation
  - extensible processor
  - persisted partition keys
  - operational attempts
  - durable processing outcomes
  - OAuth credentials
  - Instagram data lifecycle
  - OAuth account aliases
- current alias migration:
  - `20261003020000_oauth_account_aliases.sql`
- do not redesign or remove the alias model; it is necessary because OAuth subject IDs and Professional account IDs are not interchangeable.

### Current architecture

Do not redesign the core.

Current production architecture remains:

- authenticated provider webhook ingress
- Canonical Event Schema 2
- durable PostgreSQL/Supabase inbound queue
- provider-neutral processor
- WordPress AI bridge / AI Engine as the conversational brain
- durable generic action/outbox model
- provider-specific outbound adapters
- durable retry/dead-letter/attempt observability
- account/provider partitioning
- media-capable event/action contracts

Keep future capabilities isolated behind provider/capability boundaries:

- conversational messaging
- Meta Leads
- Meta Marketing API
- TikTok Marketing
- future platforms

Marketing/lead-management operations must not be routed through the conversational message handler simply because they come from Meta or TikTok.

### WordPress / AI bridge stack — verified live at transfer

Live WordPress site:

- canonical site: `https://www.ishinaillab.com/`

Directly relevant active plugins verified by live `wp plugin list`:

- **Ishi AI Bridge** — active, version `0.3.0`
  - current Ishikeit WordPress bridge family;
  - production bridge endpoint remains `https://www.ishinaillab.com/wp-json/ishi-ai/v1`.
- **Ishi Social AI Gateway** — active, version `1.1.1`
  - an audit-copy duplicate is installed but inactive;
  - do not confuse this older gateway surface with the current Ishikeit bridge route.
- **AI Engine (Pro)** — active, version `3.8.0`
  - update `3.8.3` is available;
  - do not update during messaging stabilization without deliberate compatibility review.
- **AI Provider for OpenAI** — active, version `1.2.0`.
- **Easy MCP AI - Connector for Claude, ChatGPT & SEO Data** — active, version `2.0.1`.
- **WPVibe** — active, version `1.20.0`
  - update `1.20.1` is available;
  - WPVibe is the working WordPress connector in the current environment.

Legacy/auxiliary plugin state relevant to continuity:

- **Ishi Domain Migration Helper** — inactive, version `1.1.0`.
- **Ishi RAG Query Normalizer** — inactive, version `0.4.2`.
- inactive Ishi Social AI Gateway audit copy exists at version `1.1.1`.

### Locked/custom plugins that must remain untouched unless the user explicitly authorizes changes

Verified active versions:

- **Ishi LatePoint Agent Portal** — `0.7.3`
- **Ishi LatePoint Instant** — `1.9.0`
- **Ishi Elementor Fix** — `4.3.0`

Preserve the previously established locked-plugin rule. Do not modify these merely because work continues on Ishikeit.

Other relevant live scheduling stack:

- LatePoint — active, `5.7.3`
- LatePoint Pro Features — active, `1.7.0`
- WooCommerce Payments integration for LatePoint — active

### Domain / hosting continuity

- public canonical domain remains:
  - `https://www.ishinaillab.com/`
- production Ishikeit Node service remains:
  - `https://apps.ishinaillab.com/`
- Hostinger Node application:
  - Fastify
  - npm
  - build: `npm run build`
  - entry: `dist/processes/http.js`
- health endpoints remain:
  - `/health/live`
  - `/health/ready`

Do not change Hostinger's internal shared-hosting primary-domain label from `povnailstudio.com` until rollback/archive implications are reverified.

Keep the `zdm1002_*` WordPress rollback tables for now.

### Provider status at transfer

Messenger:

- working;
- recent inbound and published outbound production activity verified.

Instagram:

- working after PR #49 regression repair;
- both **povnailstudio.com.ph** and **povnailstudio.ph** receive replies from **ishinaillab**;
- recent durable published outbox evidence exists for both tester recipient identities;
- historical dead letters from the regression remain only as audit history.

WhatsApp:

- working;
- recent inbound and published outbound production activity verified.

Telegram:

- working;
- recent inbound and published outbound activity verified.

TikTok:

- adapter and durable OAuth lifecycle remain implemented;
- existing continuation state says activation depends on TikTok **TikTok accounts** permission-scope review;
- no fresh TikTok production canary was independently captured in this transfer check;
- continue from the latest TikTok permission/review state rather than reimplementing the adapter.

### Next-chat start point

Do not reopen the Instagram regression diagnosis. It is resolved in production.

Start the next chat from these priorities:

1. verify whether PR #50 / `2129601` has been deployed; if not, deploy/verify it before further Instagram changes;
2. continue Instagram App Review from the real screencast/final submission step;
3. continue TikTok activation only from the latest permission-review state;
4. preserve the working Messenger, Instagram, WhatsApp, and Telegram paths while adding new capability families;
5. keep provider-neutral architecture and current durable queue/outbox semantics;
6. do not reintroduce the retired `/ishinaillab/ishi` project.

This checkpoint is authoritative until a later explicit transfer checkpoint supersedes it.


### Post-transfer deployment readback — final correction

This section supersedes the deployment distinction inside the immediately preceding transfer checkpoint.

After PR #51 merged, Hostinger completed two newer builds:

- `01a10267-7d32-70e3-9ae4-61ae7424e7d1`
  - completed
  - commit `21296010cb3b89570556a936fe2a63636e2422e6` (PR #50)
- `01a1028e-5c9d-7210-852f-01a231d34743`
  - completed
  - commit `10d00803e00307416b5cc8549906d825c19fc174` (PR #51)

Therefore the current deployed production revision at transfer is:

- `10d00803e00307416b5cc8549906d825c19fc174`

This means the PR #50 startup-hardening logic is now live in production.

Post-deploy health verification:

- `GET https://apps.ishinaillab.com/health/live` -> `{"status":"ok"}`
- `GET https://apps.ishinaillab.com/health/ready` -> `{"status":"ready"}`

Current working messaging status remains unchanged after deployment:

- Messenger working
- Instagram working
- WhatsApp working
- Telegram working
- both **povnailstudio.com.ph** and **povnailstudio.ph** receive replies from **ishinaillab**

Use this post-transfer section as the final deployment source of truth for the next chat.


### TikTok Marketing OAuth foundation — deployed; provider authorization not yet configured

Implementation/deployment state:

- database migration source branch was: `ishinaillab/ishikeit-db:feature/nullable-oauth-access-expiry`;
- database PR #7 merged as `c879024a971688bb019aebe7551020b9287f1735`;
- application PR #53 merged as `07e11245b9a51544c52e0015b9d867eaf106b7b6`;
- deployment-marker PR #54 merged as `062cf52d0bca62916c36c9324ccf493e315c5bd1`;
- production `GET /health/capabilities` now returns `tiktokMarketingOAuthSchema: 1`, proving the Hostinger runtime includes the TikTok Marketing OAuth foundation;
- at the same production readback, `/health/ready` remained `ready`, and both processor/action-dispatch runtime flags remained enabled.

Database dependency is now satisfied in production:

- database PR #7 merged as `c879024a971688bb019aebe7551020b9287f1735`;
- linked Supabase project: `ishikeit-db` / `vhmrliqemkfxblzsoyaz`;
- linked `supabase db lint --level error --fail-on error`: no schema errors;
- dry-run before apply listed exactly `20261004010000_nullable_oauth_access_expiry.sql`;
- live `supabase db push --linked --skip-vault` applied that migration successfully;
- linked migration history now records `20261004010000` on both local and remote sides.

Approved boundary:

- TikTok Business Messaging remains on the existing `tiktok` OAuth namespace and `tt_user` token/refresh lifecycle.
- TikTok Marketing advertiser authorization uses the distinct durable credential namespace `tiktok-marketing`.
- Both authorization families reuse the same TikTok API for Business developer app ID/secret.
- Marketing-specific authorization URL and redirect URI are independently configurable from the Business Messaging account-holder OAuth URLs.
- production advertiser callback is fixed to:
  - `https://apps.ishinaillab.com/ishikeit/oauth/tiktok/advertiser/callback/`
- protected operational routes are:
  - `POST /ops/tiktok/marketing/oauth/start`
  - `GET /ops/tiktok/marketing/oauth/status`
- the callback requires TikTok's documented `auth_code`; an auxiliary `code` query parameter is not used as the authorization code.
- Marketing credentials are stored encrypted, one row per verified advertiser ID.
- Marketing credentials may have no `access_expires_at`; the accompanying database migration changes only `oauth_credentials.access_expires_at` from required to nullable.
- existing Instagram and TikTok Business Messaging token managers still require a real access expiry and fail closed when it is missing.
- Marketing authorization status exposes advertiser IDs only and never tokens/secrets.
- Marketing authorization does not gate `/health/ready`; only the existing OAuth store readiness applies when the feature is configured.
- no TikTok Marketing action adapter or mutation operation is implemented in this milestone.
- campaign, ad-group, ad, creative, budget, bid, audience, lead, and delivery-changing calls remain explicitly out of scope.

The database migration now applied in production is:

- `supabase/migrations/20261004010000_nullable_oauth_access_expiry.sql`

Production readback after deployment:

- `GET /health/live` -> HTTP 200;
- `GET /health/ready` -> HTTP 200 / `ready`;
- Meta webhook negative-path probe -> HTTP 401, confirming the existing Meta ingress route remains registered/protected;
- Telegram webhook negative-path probe -> HTTP 401, confirming the existing Telegram ingress route remains registered/protected;
- `GET /ops/instagram/oauth/status` without bearer auth -> HTTP 401 with Bearer challenge, preserving the existing protected Instagram OAuth surface;
- `GET /ops/tiktok/oauth/status` -> HTTP 404 because TikTok Business Messaging OAuth remains unconfigured;
- `GET /ops/tiktok/marketing/oauth/status` -> HTTP 404 because TikTok Marketing OAuth runtime variables remain unset;
- TikTok webhook negative-path probe -> HTTP 404 for the same unconfigured TikTok runtime state.

Secure local handoff status:

- `C:\\Users\\MBDS\\Downloads\\ishikeit-tiktok-app.env` now contains the new Marketing OAuth variable placeholders/callback settings;
- `TIKTOK_BUSINESS_APP_ID`, `TIKTOK_BUSINESS_APP_SECRET`, `TIKTOK_BUSINESS_AUTHORIZATION_URL`, and `TIKTOK_MARKETING_AUTHORIZATION_URL` remain unpopulated placeholders;
- no secret values are stored in repository documentation.

Next TikTok steps:

1. populate the shared TikTok app ID/secret and the provider-generated authorization URL(s) in the secure local handoff / production environment;
2. configure `TIKTOK_MARKETING_AUTHORIZATION_URL` and the registered advertiser callback;
3. verify the protected Marketing start/status routes become available;
4. complete a real advertiser authorization;
5. verify encrypted `tiktok-marketing` advertiser credentials and perform a read-only provider-backed proof;
6. do not enable Marketing mutations because none are implemented.


### TikTok Marketing live access verification — deployed

Credential-independent implementation work continued while the TikTok developer app is under review.

PR #56 was squash-merged to `main` as `ae499489ee5df17105474db3e0bd608f9ea9c6b6` and deployed by Hostinger while the TikTok developer app remains under review.

Deployed behavior:

- protected read-only `GET /ops/tiktok/marketing/oauth/verify`;
- reuses the stored encrypted `tiktok-marketing` access token;
- calls only the existing advertiser-discovery operation already covered by **Ad account management**;
- returns authorized advertiser IDs, stored advertiser IDs, and non-mutating drift diagnostics;
- never returns access tokens, scopes, advertiser names, or provider error text;
- returns `409 not_authorized` when no durable Marketing credential exists;
- returns generic `503 verification_unavailable` for provider/transport verification failure;
- performs no automatic credential deletion/reconciliation and no Marketing mutation;
- bumps `tiktokMarketingOAuthSchema` from 1 to 2.

Production readback after PR #56:

- `/health/capabilities` now reports `tiktokMarketingOAuthSchema: 2`;
- `/health/live` remains HTTP 200 / `ok`;
- `/health/ready` remains HTTP 200 / `ready`;
- processor and action-dispatch runtime flags remain enabled;
- `/ops/tiktok/marketing/oauth/status` remains HTTP 404 while Marketing environment variables are intentionally unset;
- `/ops/tiktok/marketing/oauth/verify` likewise remains HTTP 404 until the approved TikTok app credentials and authorization URL are configured.

TikTok API-version resolution while the app is under review:

- the current portal permission inventory labels **Ad account management** as API v2.0, but that catalog label does not by itself define the OAuth transport base path;
- TikTok's current official `tiktok-business-api-sdk` `main` branch still maps advertiser token exchange to `POST /open_api/v1.3/oauth2/access_token/` and advertiser discovery to `GET /open_api/v1.3/oauth2/advertiser/get/`;
- Ishikeit's tests already pin those exact advertiser-OAuth paths;
- therefore keep `TIKTOK_BUSINESS_API_VERSION=v1.3` for the currently implemented OAuth flows and do not switch them to `v2.0` merely because the Scope of permission UI displays v2.0;
- revisit this only when TikTok publishes an authoritative v2.0 advertiser-auth endpoint contract or the approved app exposes a documented replacement.


### TikTok Marketing Ad Account Management proof — deployed

Credential-independent work continued while the TikTok developer app is under review.

PR #59 was squash-merged to `main` as `06621aa3a2b864380976011b4601f89e8b1872a7` and deployed by Hostinger.

Implemented boundary:

- dedicated `src/marketing/tiktok-advertiser.ts` module, separate from OAuth and messaging;
- official read-only `GET /open_api/v1.3/advertiser/info/` Account Management call;
- repeated `advertiser_ids` query parameters matching TikTok's official SDK;
- `Access-Token` authentication only; no app secret or authorization-code material is sent to this endpoint;
- provider response is reduced to advertiser IDs only;
- durable credentials are grouped by access token so multiple independent advertiser grants can be verified correctly;
- protected `GET /ops/tiktok/marketing/advertisers/verify`;
- `409 not_authorized` when no Marketing credential exists;
- generic `503 advertiser_verification_unavailable` for provider/transport failures;
- no advertiser/account mutation and no automatic credential reconciliation;
- new runtime capability marker `tiktokMarketingAdvertiserSchema: 1`;
- activation remains behind the existing complete TikTok Marketing OAuth configuration gate, so production stays unchanged while the app is under review.

Verification evidence so far:

- provider/service focused suite: 8/8 passed after the retry-classification RED→GREEN check;
- HTTP + provider focused suite: 26/26 passed;
- process composition typecheck passed;
- full repository gate passed: lint, typecheck, 32 test files / 202 tests, and build;
- `git diff --check` passed;
- messaging-isolation scan found no `tiktok-marketing`/advertiser-capability crossover into adapters/channels/media/dispatch;
- Marketing mutation scan found no advertiser/campaign/ad-group/ad write endpoint in `src/marketing`;
- changed-line scan found no secret-like literal additions.

Final verification and production readback:

- PR #59 Node 24 CI passed `npm run check`;
- PHP lint and context-continuity CI jobs passed;
- production `/health/capabilities` now reports `tiktokMarketingAdvertiserSchema: 1` alongside `tiktokMarketingOAuthSchema: 2`;
- `/health/live` remains HTTP 200 / `ok`;
- `/health/ready` remains HTTP 200 / `ready`;
- processor and action-dispatch runtime flags remain enabled;
- `/ops/tiktok/marketing/advertisers/verify` remains HTTP 404 while the TikTok app is under review and Marketing environment variables are unset;
- `/ops/tiktok/marketing/oauth/status` and `/ops/tiktok/marketing/oauth/verify` likewise remain HTTP 404 in that intentionally inactive state.

The next TikTok activation gate is provider approval plus the real App ID, App Secret, and generated Advertiser authorization URL. After those values are configured, run OAuth authorization first, then both read-only verification routes.


### TikTok Marketing safe advertiser summaries — implementation branch

Credential-independent development continued while the TikTok developer app is under review.

Branch: `feature/tiktok-marketing-advertiser-summary`

Implemented boundary:

- extends the existing read-only TikTok Account Management client with `getAdvertiserAccounts()`;
- requests only `advertiser_id`, `name`, `status`, `currency`, `timezone`, and `country`;
- drops sensitive provider fields including email, phone, address, license data, and balance;
- groups durable advertiser credentials by access-token grant and queries only the advertiser IDs belonging to that grant;
- filters out provider rows for advertiser IDs not represented by the durable grant;
- adds protected `GET /ops/tiktok/marketing/advertisers`;
- returns `409 not_authorized` before durable advertiser authorization and generic `503 advertiser_list_unavailable` on provider failure;
- bumps `tiktokMarketingAdvertiserSchema` from 1 to 2;
- adds no new TikTok permission, no database migration, and no Marketing mutation.

Version ruling:

- TikTok's current v2.0 guide states that endpoints whose only change is the URL version can be omitted from the v2.0 reference;
- TikTok's current official SDK and TikTok for Business MCP registry still expose advertiser OAuth and advertiser-info operations at v1.3;
- keep Ishikeit's API version configuration explicit and leave the current production value at v1.3 until endpoint-specific v2.0 behavior is verified rather than inferring a migration from the portal label or documentation omission.

TDD evidence so far:

- safe advertiser client/service RED: missing `getAdvertiserAccounts()` / `listAccounts()`;
- safe advertiser client/service GREEN: 11/11 focused tests;
- HTTP RED: missing summary route plus expected advertiser schema bump;
- HTTP + advertiser GREEN: 32/32 focused tests.

Verification completed before PR:

- full repository gate passed: lint, typecheck, 32 test files / 207 tests, and build;
- `git diff --check` passed;
- messaging-isolation scan found no advertiser-summary crossover into adapters/channels/media/dispatch;
- Marketing mutation scan found no advertiser/campaign/ad-group/ad write endpoint in `src/marketing`;
- changed-source scan found no flow of sensitive advertiser fields such as email, phone, address, license data, or balance;
- changed-line scan found no secret-like literal additions.

Next gate: PR and Node 24 CI. Do not merge/deploy without explicit production authorization because `main` auto-deploys on Hostinger.
