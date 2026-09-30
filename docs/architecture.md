# Ishikeit production architecture

Status: provider-neutral durable processor implemented behind independent safety gates; Meta messaging remains the first concrete provider integration.

## Design goals

Ishikeit is built around durable **events** and durable **actions**, not around a fixed list of social platforms.

The core must remain stable when a future capability is introduced. Examples include:

- Telegram messaging
- additional Meta messaging surfaces
- Meta Marketing API campaign management
- Meta lead capture/management
- future non-Meta providers
- richer media and structured interactions

Provider-specific semantics belong in adapters. Generic persistence, leasing, retries, idempotency, ordering, and processing must not need a new platform enum for every integration.

## Ingress

The current production ingress adapter is Meta.

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

A future Telegram webhook should be implemented as another ingress adapter/route that emits the same canonical event contract.

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

A future provider receives its own resolver and credentials.

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

The first adapter is:

```text
meta / messaging / message.send
```

Future examples can be registered without modifying the worker:

```text
telegram / messaging / message.send
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
META_OUTBOUND_ENABLED=false
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

PostgreSQL stores normalized events, hashes, durable actions, attempt state, and bounded error metadata. Logs avoid customer message bodies and redact provider/bridge credentials.

## Versioning

Meta Graph API target is configured by `META_GRAPH_API_VERSION`.

Canonical event, action, bridge, and provider adapter contracts are versioned independently. Provider API upgrades are deliberate and tested rather than automatic.
