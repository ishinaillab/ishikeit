# Ishikeit continuation handoff

Updated: 2026-09-30

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

Verified deployed Git revision:

```text
b8562e557ba81739c5d51e7caaacff4e5b070c83
```

That revision completed its GitHub Actions workflow successfully and Hostinger completed the corresponding Git-based Node.js build.

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
  "wordpressBridgeApiSchema": 2,
  "wordpressBridgeStorageSchema": "1.1.1",
  "runtime": {
    "processorEnabled": true,
    "actionDispatchEnabled": true,
    "processorCutoverAt": "2026-09-30T10:31:25.208Z",
    "processorCanaryPartitionCount": 0
  }
}
```

Also verified:

- `GET /health/live` → HTTP 200
- `GET /health/ready` → HTTP 200

The full-rollout cutover is intentionally retained across ordinary restarts. Do not move it forward just because the process restarts; doing so would discard recoverable post-launch backlog.

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

Raw values are secret and must stay in Hostinger/runtime secret storage.

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
- `instagram` → `messages`
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

No App Review submission is currently required for the first-party own/managed messaging setup that has already been proven empirically in production. Reassess access/review requirements before supporting unrelated client businesses.

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

- plugin version: `0.2.0`
- bridge API schema: `2`
- storage schema: `1.1.1`
- authenticated audio API ready: `true`

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

Current concrete adapter:

```text
meta / messaging / message.send
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

Video content interpretation is therefore not yet implemented. Video transport/receipt is supported, outbound video messaging is supported, and the current inbound behavior is deliberately safe rather than pretending the chatbot can inspect MP4 content.

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
- test files: 12 passed
- tests: 65 passed
- build: passed
## Current next work

The durable messaging processor is now a production system, not a scaffold. Operational metrics and audio transcription adaptation are already live; do not redo those phases.

Continue building on the adapter/registry boundaries rather than redesigning the core. Recommended sequence:

1. refine AI handoff/escalation behavior and make handoff states operationally observable
2. if inbound video interpretation is required, add it as an explicit media-processing capability/adapter and keep the current no-inspection safeguard until a verified backend is available
3. add Telegram as the first non-Meta messaging adapter
4. add Meta lead-management capability as a separate capability/operation family
5. add Meta Marketing API operations behind their own authorization/policy layer
6. version and test each future provider adapter and media-capability contract independently

Marketing API, lead management, and future providers must not be routed through the conversational message handler merely because they originate from Meta.
