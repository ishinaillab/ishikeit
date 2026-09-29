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
- durable outbox leasing, bounded retries, and dead-lettering
- Messenger and Instagram text-message send adapters for Graph API `v26.0`
- outbound delivery disabled by default until access tokens and review readiness are verified

AI execution remains disabled. The outbound worker only consumes explicit `meta.message.send` outbox records; inbound events are not automatically turned into replies.

## Development

```sh
npm ci
npm run check
```

The canonical database migration history lives in `ishinaillab/ishikeit-db`.

## Outbound safety gate

Set `META_OUTBOUND_ENABLED=true` only after both Messenger and Instagram access tokens have been configured. Messenger uses a Page access token. Instagram defaults to `graph.instagram.com`; set `META_INSTAGRAM_GRAPH_HOST=graph.facebook.com` only when the account is intentionally using the Facebook Login-based Instagram API flow.

Access tokens are secrets. Keep them in the hosting environment only and never commit them.
