# Ishikeit Phase 1 — disposable Docker integration lab (2026-10-30)

## Purpose

Run the existing Ishikeit lint, TypeScript check, unit tests, real PostgreSQL
integration tests, and build on the **supported Node.js 24** runtime, using
PostgreSQL 17 in Docker Desktop on Windows. This is not a production Compose
stack and **never** starts the Ishikeit HTTP server or sends provider messages.

## Prerequisites

- Docker Desktop running with a Linux container engine and Compose v2+.
- A clean checkout of `ishinaillab/ishikeit`, without customer exports.
- Enough disk and network access to pull `node:24-bookworm-slim` and
  `postgres:17` and download the locked npm dependencies.

## Run on Windows PowerShell

From the Ishikeit checkout:

```powershell
.\scripts\test-docker.ps1
```

The script sets `COMPOSE_DISABLE_ENV_FILE=1` for the session, validates
`compose.test.yaml`, starts PostgreSQL with a health check, runs `npm ci
--ignore-scripts` then `npm run check`, and removes the dedicated project
containers, network and **all project volumes** in a `finally` block, including
after test failures. It restores the original process environment setting.

The Compose project is fixed to `ishikeit-phase1-test` to avoid touching
unrelated Docker Desktop projects. Never run `docker system prune` for this.

## Safety properties

- The PostgreSQL database is named **exactly** `ishikeit_outbox_test`. There is
  no published database port; it is accessible only within the test containers.
- Node shares the isolated test PostgreSQL network namespace. Existing
  integration-test source guards still require
  `127.0.0.1/ishikeit_outbox_test`; **the guards are not weakened**.
- No `.env` or `env_file` is loaded by Compose. The test container receives
  only explicit CI, npm and synthetic test-database environment variables.
- The **host repository is mounted read-only** to `/source`. An explicit
  allowlist copies tracked application/test source categories into the
  container's disposable writable `/workspace`, never copying `.git`,
  `.env*` or other unlisted files. `node_modules` and `dist` exist only
  inside the temporary test container filesystem.
- No Hostinger configuration, Supabase project credentials, Instagram/Meta
  access token, customer data, WordPress signing key, LatePoint booking, or
  provider webhook URL is passed into this stack.
- Production-safe fake test actions (synthetic Page and recipient IDs) cover
  send fencing, lease expiry, concurrency, definite 429 retries, manual
  unknown-outcome review, encrypted OAuth persistence and account aliases.
- Image caches remain in Docker Desktop for future runs; they are not temporary
  test resources. Only containers, networks, and volumes of this named project
  are removed.

## Verified baseline

On October 30, 2026, the initial Node.js 24 + PostgreSQL 17 local run passed
`npm run lint`, `npm run typecheck`, Vitest **67 test files / 497 tests**,
and `npm run build`. This includes **8 real PostgreSQL integration tests**
(5 outbox-fencing and 3 OAuth-persistence). After the PostgreSQL idle-client failure hardening, the final test run passed
**68 test files / 499 tests**, including **10 real PostgreSQL integration tests**.
The new integration tests safely terminate only idle, disposable PostgreSQL
backends, require a sanitized SQLSTATE warning, verify a fresh connection, and
ensure a throwing observability callback cannot terminate the application.
No live customer send or provider test occurred.

## Next failure-injection additions

Continue with isolated whole-database restart and sustained connection-loss tests, lease expiry
under worker termination, simultaneous send-worker races, out-of-order webhooks
and alerting verification. Add them to this runner or existing CI without
loosening production-facing security guards. Production health/metrics belong
to a separate measured rollout; this test lab does not activate them.

The owner-approved Phase 3 private dashboard stays on
`apps.ishinaillab.com`. At Phase 4 the existing custom WordPress bridge must
be safely renamed to **LatePoint Addon - Ishikeit Automation** (GitHub #192).
Neither future milestone is implemented by this Docker testing configuration.

## Phase 1 operational alert summary (staged, not deployed)

The existing bearer-protected `GET /ops/metrics` endpoint remains unchanged.
A new read-only `GET /ops/metrics/alerts?window=60` route uses the same
operator bearer authorization and accepts only windows from 5 to 1440 minutes.
It returns a privacy-safe, non-sending aggregate summary of known queue topics,
current inbound processing failures and recent dead letters:

- Current inbound failures: warning at 1; critical at 5.
- Pending inbound/outbound queue lag: warning from 5 minutes; critical from
  15 minutes. Intentionally disabled processor/dispatcher queues are excluded.
- Recent dead letters in the selected window: warning at 1; critical at 5.

The route cannot send messages, change queues, access a provider or schedule
notifications. It does not return customer identities, message bodies, tokens
or raw errors. A healthy summary **is not proof that a worker is alive**:
worker heartbeats and external notification delivery are separate future work.
These initial thresholds are engineering defaults, not provider SLAs.

The complete disposable Docker test run after adding alert classification
passed **505 of 505 tests in 69 test files**, including **10 real PostgreSQL
integration tests** and all lint/typecheck/build checks. Temporary test
containers, network and volumes were removed. This code remains in PR #193
until reviewed and merged; no Hostinger deployment or production test has
occurred as part of this Phase 1 work.


## Local worker-loop diagnostics (Phase 1, subsequent change)

- The read-only route `GET /ops/workers/local` is registered **only** when
  `OPS_METRICS_TOKEN` is configured and requires the same bearer credential.
  It sends `cache-control: private, no-store` and discloses **no customer or
  provider identifiers, message bodies, raw errors, access tokens, or DB URLs**.
- The response explicitly identifies `scope: "local_process"`, a random
  per-process `instanceId`, last iteration timestamps, iteration counts and
  state for inbound processing and outbound dispatch. `disabled`, `not_started`,
  `stopped`, `idle`, `working`, `long_running` and `stalled` are descriptive,
  not guarantees about healthy delivery or other Hostinger replicas.
- A running worker can legitimately process a long task; after two minutes its
  state becomes `long_running`, not `failed`. No data is sent and no queue work
  is retried. The 30-second between-iteration stall check is a provisional local
  diagnostic threshold, not an SLA.
- Instrumentation wraps only worker loop iterations. Callback exceptions are
  caught and cannot stop inbound/outbound processing. Standalone `runOnce`
  calls intentionally are not counted as active background loop ticks.
- This is **not distributed heartbeat persistence**. To detect dead workers
  across multiple instances, use a future durable per-instance heartbeat and
  external watcher. Do not treat one responsive `/ops/workers/local` result,
  `/health/ready`, or an empty queue as proof of global worker liveness.
- Node 24/PostgreSQL 17 integration runner checks this protected route and
  worker event wiring without any Meta requests or real customer messages.
