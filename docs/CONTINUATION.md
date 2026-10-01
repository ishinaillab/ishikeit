# Ishikeit continuation handoff

Updated: 2026-10-01

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
https://povnailstudio.com/wp-json/ishi-ai/v1
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

TikTok for Business Business Messaging is now implemented through the existing provider-neutral event/action boundaries. No database migration was required.

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
- TikTok signature/app-secret/access-token log redaction
- TikTok credentials must be configured as one complete set

Configuration contract:

```text
TIKTOK_BUSINESS_APP_ID
TIKTOK_BUSINESS_APP_SECRET
TIKTOK_BUSINESS_ID
TIKTOK_BUSINESS_ACCESS_TOKEN
TIKTOK_BUSINESS_API_VERSION=v1.3
TIKTOK_WEBHOOK_MAX_AGE_SECONDS=300
TIKTOK_OUTBOUND_REQUEST_TIMEOUT_MS=10000
```

Current official TikTok API for Business documentation treats Business Messaging, Marketing, Organic, and other API product families separately. Keep that separation in Ishikeit. Automatic messages, templates, Comment-to-Message, image upload/send, conversation unlock, lead operations, Organic API actions, Marketing API actions, and future TikTok surfaces must be explicit operations/capabilities rather than hidden behind generic conversational `message.send`.

Repository validation for this milestone:

- lint: passed
- typecheck: passed
- test files: 23 passed
- tests: 120 passed
- build: passed
- `git diff --check`: passed

TikTok is **not production-active yet**. No real TikTok credential has been added to Hostinger and no TikTok Business Messaging webhook has been registered. Before activation:

1. create/use the real TikTok for Business developer app
2. obtain Business Messaging API access and complete TikTok's applicable data-security/privacy review
3. authorize the target TikTok Business Account
4. prove the production access-token/refresh lifecycle rather than relying on a manually copied short-lived token
5. verify the Business Account's messaging capability/limits through TikTok's supported API
6. configure the complete TikTok credential set in the trusted production secret source and Hostinger without round-tripping masked values
7. register the Business Messaging webhook to `https://apps.ishinaillab.com/ishikeit/webhooks/tiktok`
8. verify signed webhook delivery and durable-before-ACK persistence
9. run one controlled human-originated direct-message canary through webhook -> PostgreSQL -> AI bridge -> `action.dispatch` -> TikTok reply
10. audit provider resource identity, attempts, pending queue, dead letters, and runtime warnings/errors before calling TikTok production-active

Do not claim TikTok production activation until those provider-backed checks have succeeded.

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

## Current next work

The durable messaging processor is now a production system, not a scaffold. Operational metrics, audio transcription adaptation, and durable handoff/outcome observability are live; do not redo those phases.

Continue building on the adapter/registry boundaries rather than redesigning the core. Recommended sequence:

1. complete TikTok for Business onboarding for the newly implemented Business Messaging adapter: obtain Business Messaging API access, complete applicable security/privacy review, authorize the target Business Account, prove the production token lifecycle, configure the webhook, and run a controlled human-originated end-to-end canary before declaring TikTok production-active
2. complete and submit Meta App Review for the Instagram Login permissions `instagram_business_basic` and `instagram_business_manage_messages`; reconcile the current Business Verification discrepancy before submission
3. prepare the required real screencast/reviewer evidence showing Instagram authorization, an external-user DM, Ishikeit handling, API send, and receipt in Instagram; do not fabricate review evidence
4. after approval, repeat the fresh ordinary non-role account DM test and verify normal `message.received` ingestion plus successful reply before declaring Instagram public-user messaging production-complete
5. do not add Conversation Routing write/control APIs to the current `graph.instagram.com` path until Meta's supported authorization model for this specific app setup is proven
6. activate and perform a real provider-backed video interpretation smoke test only after a paid Gemini API project/key is securely configured; until then retain the verified no-inspection safeguard
7. add Meta lead-management capability as a separate capability/operation family
8. add Meta Marketing API operations behind their own authorization/policy layer
9. add TikTok automatic messaging, image upload/send, Comment-to-Message, Organic, Leads, and Marketing operations only as separate typed capabilities after the base TikTok Business Messaging path is provider-verified
10. version and test each future provider adapter and media-capability contract independently

Marketing API, lead management, and future providers must not be routed through the conversational message handler merely because they originate from Meta.
