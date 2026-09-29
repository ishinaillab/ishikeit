# Ishikeit continuation handoff

Updated: 2026-09-29

## Canonical project

- Repository: `ishinaillab/ishikeit`
- Branch: `foundation-v1`
- Draft PR: #1 — Build Ishikeit Foundation v1
- Do **not** use `ishinaillab/ishi` for this app.
- Do **not** use the legacy route `/ishi/webhooks/meta`.
- Canonical webhook route: `/ishikeit/webhooks/meta`.

## Meta app

- App name: Ishikeit
- App ID: `1042452472116584`
- Current mode: Development
- Category: Messaging
- Current Graph API target: `v26.0`
- Current live app inspection showed:
  - App Review submission: none
  - Privileges: none
  - Compliance: compliant
  - Open violations: 0
  - Webhook subscriptions: 0
  - Require App Secret: off
  - Require 2FA: off

## Audited Foundation v1 architecture

The backend is a first-party Meta business messaging service for Messenger, Instagram, and WhatsApp.

Public endpoints:

- `GET /health/live`
- `GET /health/ready`
- `GET /ishikeit/webhooks/meta`
- `POST /ishikeit/webhooks/meta`

Webhook POST order:

1. enforce request size
2. preserve exact raw request bytes
3. verify `X-Hub-Signature-256` using `META_APP_SECRET`
4. only then parse/trust JSON
5. normalize the Meta envelope into provider-aware canonical events
6. derive provider-aware idempotency + partition identities
7. transactionally persist normalized event + outbox record in PostgreSQL
8. return 200 only after durable commit
9. AI, WordPress, media downloads, profile lookups, and outbound Meta API calls stay outside the ACK path

Reliability model:

- at-least-once delivery
- idempotent processing
- PostgreSQL durable inbox/outbox
- duplicate delivery expected
- future workers need recoverable leases, bounded retry/backoff, dead-letter handling, per-conversation serialization
- DB failure before persistence must not return 200

Data handling:

- raw webhook bytes are transient only for authentication/parsing
- do not permanently archive raw webhook bodies
- persist normalized event + SHA-256 payload fingerprint
- minimize Platform Data and keep secrets/customer content out of routine logs

Provider boundaries:

- Messenger object: `page`
- Instagram object: `instagram`
- WhatsApp object: `whatsapp_business_account`
- do not merge identities across channels automatically
- provider-specific policy windows, echoes, attachments, statuses, and outbound semantics remain isolated

Security baseline:

- HTTPS/TLS
- exact raw-body HMAC verification
- timing-safe comparison
- independent high-entropy webhook verify token
- server-side secrets only
- no secrets in source control/logs
- least-privilege permissions/webhook fields
- appsecret_proof is outbound Graph hardening, not webhook authentication
- mTLS is optional hardening, not a Foundation v1 dependency
- IP allowlisting remains unset until real stable outbound egress is known

## Current repository work

A new clean `foundation-v1` branch was created from the initial clean repo.

Implemented on that branch:

- Node.js 24 + TypeScript + Fastify scaffold
- `/ishikeit/webhooks/meta` GET + POST
- exact raw-body signature verification
- Meta verification challenge
- PostgreSQL durable-before-ACK ingestion
- provider-aware Meta normalizer
- no permanent raw webhook-body storage
- liveness/readiness
- environment validation
- secret-safe logger redaction
- migration `migrations/0001_foundation.sql`
- unit tests for webhook auth and HTTP ingress
- architecture README/docs
- GitHub Actions CI workflow
- removed placeholder `delete-this-file.txt`

## Important current state

Draft PR #1 is open from `foundation-v1` -> `main`.

Do **not** merge yet.

The code has not yet been fully validated by CI. The previous session checked for workflow results immediately after creating the branch and saw no workflow run/status yet.

The next chat should:

1. inspect PR #1 and current head commit
2. check GitHub Actions status
3. if CI fails, inspect logs and fix every lint/typecheck/test/build failure
4. re-run until CI passes
5. rigorously review the final diff against this handoff and current Meta docs
6. only then mark PR ready / merge
7. after merge, deploy to `apps.ishinaillab.com`
8. apply PostgreSQL migration
9. verify `/health/live` and `/health/ready`
10. verify GET challenge and signed POST persistence
11. only after backend verification, configure Meta webhook subscriptions
12. keep outbound Meta delivery and AI execution disabled until those later phases are implemented and tested

## Meta configuration cautions

Current Meta documentation contains a real access-level ambiguity between Messenger overview and webhooks guidance regarding own-Page use vs Advanced Access for non-role customers.

Do not assume production customer messaging works solely because the Page is owned by Ishi.

Production readiness must be verified by:

- actual permissions/features shown in App Dashboard
- exact access level granted
- required App Review/Advanced Access if Meta requires it
- published/live state where required
- successful end-to-end test with a real non-role customer

Instagram authorization remains a deployment/configuration decision:

- Instagram API with Facebook Login
- or Instagram API with Instagram Login

Do not mix scopes/token flows between those two paths.

WhatsApp production should use the WABA-oriented `whatsapp_business_account` webhook model and subscribe only to required fields, initially centered on `messages`.

## Transitional public-site/legal context

Current public/legal pages may temporarily remain on `povnailstudio.com` until the public site is migrated to `www.ishinaillab.com`.

Do not treat the temporary old-domain legal URLs as an architecture defect solely because the backend is on `apps.ishinaillab.com`.

## Old repository warning

Before the repository correction, an isolated branch named `foundation-v1-audited` was created in `ishinaillab/ishi`.

Its `main` branch was not changed.

That old repository is not part of Ishikeit and should be ignored unless the user explicitly asks to clean it up later.
