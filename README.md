# Ishikeit

Ishikeit is Ishi Nail Lab's first-party Meta business messaging backend for Messenger, Instagram, and WhatsApp.

## Foundation v1

The initial production boundary is intentionally narrow:

- Node.js 24 + TypeScript + Fastify
- one Meta webhook ingress: `/ishikeit/webhooks/meta`
- GET verification challenge
- exact raw-body `X-Hub-Signature-256` verification before JSON is trusted
- PostgreSQL durable-before-ACK ingestion
- provider-aware normalization and deduplication
- no permanent raw webhook-body archive
- health/readiness endpoints
- outbound messaging and AI execution disabled until the ingress foundation is verified

## Development

```sh
npm ci
npm run check
```

Apply `migrations/0001_foundation.sql` before starting the service.
