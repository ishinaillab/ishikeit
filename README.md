# Ishikeit

Ishikeit is Ishi Nail Lab's first-party Meta business messaging backend for Messenger, Instagram, and WhatsApp.

## Production foundation

The production boundary currently includes:

- Node.js 24 + TypeScript + Fastify
- one Meta webhook ingress: `/ishikeit/webhooks/meta`
- GET verification challenge
- exact raw-body `X-Hub-Signature-256` verification before JSON is trusted
- PostgreSQL durable-before-ACK ingestion
- provider-aware normalization and deduplication
- no permanent raw webhook-body archive
- schema-aware health/readiness endpoints
- durable outbox leasing, bounded retries, dead-lettering, and idempotent enqueue
- Messenger, Instagram, and WhatsApp text-message send adapters for Graph API `v26.0`
- outbound delivery disabled by default until all provider access tokens are configured and verified

AI execution remains disabled. The outbound worker only consumes explicit `meta.message.send` outbox records; inbound events are not automatically turned into replies.

Each logical outbound send must carry a stable `idempotencyKey`. Ishikeit derives a deterministic outbox UUID from that key plus the provider conversation identity. Re-enqueuing the same logical send is a no-op; reusing the same key with a different payload is rejected.

## Development

```sh
npm ci
npm run check
```

The canonical database migration history lives in `ishinaillab/ishikeit-db`.

## Outbound safety gate

Set `META_OUTBOUND_ENABLED=true` only after the Messenger Page token, Instagram user token, and WhatsApp system-user/business token have all been configured. Messenger and WhatsApp send through `graph.facebook.com`. Instagram defaults to `graph.instagram.com`; set `META_INSTAGRAM_GRAPH_HOST=graph.facebook.com` only when the account is intentionally using the Facebook Login-based Instagram API flow.

WhatsApp free-form text replies are intended for active customer-service conversations. Initiating a WhatsApp conversation outside the customer-service window requires an approved message template and is outside the current text-only worker.

Access tokens are secrets. Keep them in the hosting environment only and never commit them.
