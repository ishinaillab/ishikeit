# Ishikeit worker heartbeat and operational incident monitoring

**Issue:** #194. **Application PR:** #195. **Database PR:** ishikeit-db #14.

## Data model and privacy

Two additive Supabase migrations are in the canonical database repository and were applied to project `vhmrliqemkfxblzsoyaz` through the authorized migration API:

- `20261031234741_ishikeit_worker_heartbeats.sql`: per-process UUID, inbound/outbound worker name, bounded status and iteration counters, database-observed timestamp.
- `20261031234957_ishikeit_private_operational_incidents.sql`: only allowlisted aggregate alert codes, severity, counts, cooldown claim timestamp and recovery state.

Both tables have **RLS enabled** and no privileges for `PUBLIC`, `anon`, or `authenticated`. Independent catalog readback verified RLS and denied client read privileges. No customer IDs, messages, phone numbers, tokens or raw provider errors are recorded.

## Detection

- Inbound and outbound loops preserve the original per-process observations.
- Every running Node process writes a heartbeat at 15-second intervals. Database server time is used for observations.
- A worker record with no heartbeat for >45 seconds is classified `stale` if its state was enabled/running. Explicitly disabled and cleanly stopped workers are excluded.
- Operator readback `GET /ops/workers/fleet` uses existing `OPS_METRICS_TOKEN`, returns `Cache-Control: private, no-store` and an explicit `scope=observed_instances`.
- The database query is bounded to the most recent 15 minutes and 100 rows. This is **NOT** an expected-instance inventory: a long-absent process drops out after lookback and must be detected by an external independent watcher.
- A periodic 60-second incident scanner uses the operational metrics/alert classifier and fleet snapshot. Covered codes: `stale_worker`, `queue_lag`, `recent_dead_letter`, `inbound_processing_failed`, `graph_rate_limited` (Meta HTTP 429 from durable attempt metrics), and `oauth_renewal_failed` (aggregate failed Instagram maintenance pass).
- Incident claim and severity changes are persisted in PostgreSQL; five-minute cooldown prevents unbounded duplicate notifications across replicas. Recovered incidents close once when no longer observed.
- Operator readback `GET /ops/incidents` uses the same bearer and never exposes raw errors.
- Monitoring failures are caught; they must not crash or block provider sends, shutdown, or queue processing.

## External operator notifications — opt-in only

`OPS_ALERT_WEBHOOK_ENABLED=false` is the default and preserves all existing customer messaging. To activate an approved operator-only webhook, separately configure all of:

- `OPS_ALERT_WEBHOOK_ENABLED=true`
- `OPS_ALERT_WEBHOOK_URL=https://<approved-host>/<approved-path>`
- `OPS_ALERT_APPROVED_HOST=<approved-host>`
- `OPS_ALERT_WEBHOOK_SECRET=<independent-32+character-secret>`

The destination must be HTTPS, use the exact approved hostname, have no URL credentials, nonstandard port, or fragment, and reject redirects. Payloads contain only source, code, severity, count, and firing/recovered state; authentication is independent of Meta/customer bearer credentials. A 5-second timeout limits delivery failure. Never use customer-channel APIs as a notification shortcut.

Hostinger's Node environment API is **full-replacement** and returns masked values: do not copy masked values back to set these variables. Use a separately verified safe incremental secret-configuration path or an authenticated complete known plaintext secret source. **No production operator destination has been approved or configured by this change.**

## Independent outage detection remains a distinct operational dependency

An in-process timer cannot send an alert when the entire app is down, when the database is unreachable, or when this code cannot run. An independently hosted watcher with an approved credential/destination must poll/observe heartbeat freshness and the application's public health endpoints. This cannot safely be activated by simply enabling the app's local monitor. The final production readiness gate must verify independent watcher delivery and recovery before declaring complete end-to-end alerting.

## Verification and release

Run `scripts/test-docker.ps1` in the relocated Docker Desktop environment at `D:\projects\docker` for Node 24 + PostgreSQL 17, lint, typecheck, full Vitest suite and build; confirm no named test containers/networks/volumes remain. Additional tests exercise offline process aging via database timestamps, concurrent incident deduplication, recovery state, webhook URL safeguards, and authenticated HTTP readbacks. Production schema was read back for client-role privilege denial. Keep deployment on PR/CI until checks pass; the app auto-deploys from `main`, so obtain a rollback baseline and verify Hostinger's exact deployed SHA after merge.
