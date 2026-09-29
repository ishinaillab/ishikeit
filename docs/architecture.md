# Ishikeit production architecture

Status: ingress verified; outbound foundation implemented behind an explicit safety gate.

## Ingress

`GET /ishikeit/webhooks/meta` performs Meta's verification challenge.

`POST /ishikeit/webhooks/meta` follows this order:

1. enforce request size
2. preserve exact request bytes
3. verify `X-Hub-Signature-256` with the Meta App Secret
4. parse and validate the Meta envelope
5. normalize provider events
6. derive provider-aware idempotency and partition identities
7. transactionally persist the normalized event and an outbox record in PostgreSQL
8. return HTTP 200 only after durable commit

AI, WordPress, media download, profile lookup, and outbound Meta calls never run before the webhook ACK.

## Outbound delivery

Outbound Messenger and Instagram replies use explicit `meta.message.send` records in the existing PostgreSQL outbox. The HTTP process can run a lease-based worker when `META_OUTBOUND_ENABLED=true`.

The worker:

1. claims one due record with `FOR UPDATE SKIP LOCKED`
2. validates the typed outbound payload
3. sends through the provider-specific Meta adapter
4. marks the row published only after a successful Meta response
5. schedules bounded exponential retries for transient/ambiguous failures
6. dead-letters permanent failures and exhausted retries
7. clears leases on completion, retry, or dead-letter

Messenger sends use `/{PAGE_ID}/messages` with `messaging_type=RESPONSE`. Instagram sends use `/{IG_ID}/messages`. The Instagram Graph host is explicit because Meta supports both Instagram Login and Facebook Login integration families.

Meta does not provide a general client-supplied idempotency key for these Send API calls. A network failure after Meta accepts a request but before Ishikeit receives the response is therefore delivery-ambiguous; retrying preserves at-least-once behavior but can theoretically duplicate a message. The worker records this condition in logs/dead-letter reason rather than claiming exactly-once delivery.

Inbound `inbound.event.accepted` outbox records are not consumed by the outbound sender. A later AI/automation processor must deliberately create `meta.message.send` records.

## Reliability

Delivery is treated as at-least-once. Duplicate inbound deliveries are expected. Consequential processing must be idempotent. PostgreSQL remains the durable inbox/outbox boundary.

## Data minimization

Raw webhook bytes exist only long enough to authenticate and parse the request. The database stores the normalized event and a SHA-256 payload fingerprint, not a permanent raw webhook-body archive.

Outbound logs avoid message text and redact access tokens. Dead-letter reasons contain provider/transport error metadata, not credentials.

## Provider boundaries

Messenger, Instagram, and WhatsApp share the ingress security boundary but keep provider-specific semantics. IDs are never assumed to represent the same person across channels.

WhatsApp outbound sending remains outside this worker for now.

## Versioning

Graph API target: `v26.0`, configured by `META_GRAPH_API_VERSION`. Version upgrades are deliberate and tested rather than automatic.
