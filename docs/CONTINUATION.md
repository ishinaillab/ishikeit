# Ishikeit continuation handoff

Updated: 2026-09-29

## Canonical project

- Repository: `ishinaillab/ishikeit`
- Canonical branch: `main`
- PR #1 — Build Ishikeit Foundation v1 — merged 2026-09-29
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

Foundation v1 was completed on `foundation-v1`, validated, reviewed, and squash-merged through PR #1 into `main`.

Implemented and verified:

- Node.js 24 + TypeScript + Fastify scaffold
- `/ishikeit/webhooks/meta` GET + POST
- exact raw-body signature verification
- Meta verification challenge
- PostgreSQL durable-before-ACK ingestion
- provider-aware Meta normalizer
- customer-side conversation partitioning for Messenger/Instagram message echoes
- no permanent raw webhook-body storage
- liveness/readiness
- environment validation
- secret-safe logger redaction, including the hyphenated signature header
- migration `migrations/0001_foundation.sql`
- reproducible `package-lock.json` + `npm ci`
- current Node 24 / ESLint 10 CI toolchain
- tests covering webhook authentication, invalid JSON, request-size enforcement, DB-failure non-ACK behavior, provider normalization, idempotency/partition behavior, echo routing, and logger configuration
- architecture README/docs
- GitHub Actions CI workflow
- removed placeholder `delete-this-file.txt`

Validation result before merge:

- final feature-branch head: `fe356bec2fe4a4fe8ce72e5d9ca54b9bfe555cd6`
- CI: passed
- test files: 4 passed
- tests: 14 passed
- lint: passed
- typecheck: passed
- build: passed
- npm audit during CI install: 0 vulnerabilities
- squash merge commit on `main`: `9f8691d288f22787b54d9479e97bafe419c2d6b4`
- `main` CI after merge: passed

## Deployment state and blocker

Production deployment is **not yet verified or complete**.

The existing Hostinger application at `apps.ishinaillab.com` was previously deployed from the old repository `ishinaillab/ishi`, branch `main`. Merging Ishikeit PR #1 therefore does not by itself prove that Hostinger deployed `ishinaillab/ishikeit`.

The authorized desktop/Hostinger control path available to ChatGPT was offline during this continuation session, so the Hostinger source repository could not be changed or inspected from here. Do not claim the new backend is deployed until Hostinger shows the Ishikeit repository/commit as the active deployment.

Required Hostinger source/build target:

- repository: `ishinaillab/ishikeit`
- branch: `main`
- Node.js: `24.x`
- build command: `npm run build`
- start command: `npm start` (runs `node dist/processes/http.js`)
- preserve the existing production secrets/environment values; do not copy secrets into GitHub

Next execution sequence:

1. change/reconnect the Hostinger Node.js app source to `ishinaillab/ishikeit`, branch `main`, and deploy the current `main`
2. record/verify the deployed Git revision
3. verify whether `migrations/0001_foundation.sql` is already present in the intended production PostgreSQL database; apply it only if needed
4. verify `GET /health/live`
5. verify `GET /health/ready`
6. verify the Meta GET challenge at `/ishikeit/webhooks/meta`
7. send a correctly signed POST and verify durable `inbound_events` + `outbox` persistence
8. only after those checks pass, configure the minimum required Meta webhook subscriptions
9. keep outbound Meta delivery and AI execution disabled until their later implementation/test phases

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
