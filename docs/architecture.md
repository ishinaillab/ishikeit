# Ishikeit Foundation v1 architecture

Status: implementation baseline.

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

## Reliability

Delivery is treated as at-least-once. Duplicate deliveries are expected. Consequential processing must be idempotent. PostgreSQL is the durable inbox/outbox foundation; workers use leases and bounded retries in later phases.

## Data minimization

Raw bytes exist only long enough to authenticate and parse the request. The database stores the normalized event and a SHA-256 payload fingerprint, not a permanent raw webhook-body archive.

## Provider boundaries

Messenger, Instagram, and WhatsApp share the ingress security boundary but keep provider-specific semantics. IDs are never assumed to represent the same person across channels.

## Versioning

Graph API target: `v26.0`, configured by `META_GRAPH_API_VERSION`. Version upgrades are deliberate and tested rather than automatic.
