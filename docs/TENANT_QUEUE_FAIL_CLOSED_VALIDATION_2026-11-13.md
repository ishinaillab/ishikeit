# Tenant queue fail-closed gate and constraint validation (2026-11-13)

## Objective

Prepare #230 for eventual, genuinely authenticated multi-workspace routing **without activating it prematurely**. At the starting point, live production contained **753** `inbound_events`, **1,051** `outbox` rows, and **zero tenant-stamped rows** in either table. `migrations/0012_ishikeit_event_tenant_provenance.sql` had already added nullable `workspace_id`, `connection_id` and `connection_generation`, with six `NOT VALID` shape/FK constraints. It is wrong to add these columns a second time or infer tenant ownership for old records.

This stage has two independent, conservative changes.

1. **Fail closed in the legacy PostgreSQL outbox worker:** `PostgresOutboxStore.claimNext` now accepts only records with all three tenant provenance columns NULL, for **both** `action.dispatch` and `inbound.event.accepted`. Pending tenant-bound work stays durably stored but **unclaimed and undispatched**, until a future separate implementation proves workspace-bound ingress, per-send generation fencing, provider grants, and controlled cutover. This stage deliberately does not enqueue tenant jobs or change existing legacy actions.
2. **Validate the already-installed six PostgreSQL constraints:** `migrations/0023_ishikeit_validate_event_tenant_provenance.sql` calls `ALTER TABLE ... VALIDATE CONSTRAINT` for exactly the existing three inbound and three outbox CHECK/FK constraints. No column, index, row, or RLS change. Validation verifies existing data and sets `pg_constraint.convalidated=true`. A second run is a PostgreSQL-documented no-op.

## Concurrency, safety and legacy continuity

- **No new live tenant routing.** Existing legacy outbox records with all three fields NULL continue through the same lease, idempotency and provider-send fence. Tenant rows will never be offered to the legacy worker.
- The outbox's earlier-job and leased-job partition scans exclude parked tenant rows, so a parked tenant event cannot deadlock an unrelated legacy job with the same `partition_key`. Durable idempotency for old jobs is unchanged.
- Even if an external process assigns a valid lease to a tenant-stamped Meta/Telegram job, `prepareMetaSend` and `prepareTelegramSend` now refuse to arm the provider POST. The expired-send quarantine applies only to pre-existing legacy jobs; tenant-stamped work remains parked and must be handled by a future tenant-aware reconciler.
- The application change does not itself validate provider signatures, grant a new provider connection, or guarantee safe live tenant messaging. No future routing feature may bypass this gate until its ingress, outbox, privileged session and connection-generation acceptance tests pass. This is a **safety stop**, not a complete tenant router.
- The PostgreSQL validation migration has `lock_timeout='5s'`, `statement_timeout='25s'`, and one transaction. PostgreSQL 17 `VALIDATE CONSTRAINT` uses `SHARE UPDATE EXCLUSIVE` on each table (plus appropriate referenced-table locks for FKs), allowing ordinary reads/writes during validation. Running a timed-out migration must be treated as failed and rechecked, not assumed successful. Do not run `ADD CONSTRAINT` or recreate indexes.
- All existing rows stay as they were. No account IDs, usernames, handles, TOTP, customer messages, credential keys or provider settings enter the migration. No `anon`/`authenticated` permission grant; existing private grants and RLS are unchanged.
- Preflight **read-only production query** (2026-11-13) found **0** invalid tenant-shape rows and **0** orphaned workspace/connection references across both tables. **All six** target constraints were `convalidated=false` before the migration.

## Acceptance

- Tests in `tests/outbox-postgres.integration.test.ts` use a disposable real PostgreSQL 17 table with provenance fields to verify: bound tenant messages cannot be claimed, manually leased tenant sends cannot be armed, legacy jobs continue across partition collisions, and tenant-bound inbound accepted events are parked.
- `tests/tenant-event-provenance-postgres.integration.test.ts` creates isolated tables and applies the actual initial migration + new validation SQL. It checks all six constraints before/after, unchanged legacy row counts, idempotent rerun, and existing RLS/foreign-tenant insertion rejections.
- Required before release: full disposable Node24/PG17 lint/typecheck/Vitest/build, all protected CI checks, exact Hostinger app SHA, public /health/live and /health/ready plus anonymous workspace authorization. Required before database closure: **actual** Supabase migration result/version and read-only `convalidated=true` for all six, source mirrored to the `ishikeit-db` main repository. Do not falsely claim these from code publication alone.
- No authenticated owner or provider-origin live test is part of this stage, and three verified owner TOTP factors remain untouched.

## Next #230 stage

Add **authenticated provider-native account proof and owner-approved session-bound connection linking**, then tenant-bound webhook ingestion and outbox dispatch with a transactional per-send generation fence (and a safe transition for existing legacy sends), two-workspace negative testing, and operator-reviewed canary. Keep `TELEGRAM_BUSINESS_USERNAME` fallback and default-off shadow flags until genuine end-to-end cutover. #206 (provider capability freshness) and #216 (booking checkout acceptance) stay open.

## Authoritative references

- [PostgreSQL 17 ALTER TABLE/VALIDATE CONSTRAINT](https://www.postgresql.org/docs/17/sql-altertable.html) — no-op when already valid, weaker validation locks and no table rewrite
- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html) — lock compatibility and transaction scope
- [PostgreSQL 17 lock_timeout and statement_timeout](https://www.postgresql.org/docs/17/runtime-config-client.html) — bounded lock wait and execution
- [PostgreSQL 17 INSERT/ON CONFLICT](https://www.postgresql.org/docs/17/sql-insert.html) — existing idempotent enqueue behavior
- [Supabase MCP migration operations](https://supabase.com/docs/guides/ai-tools/mcp) — use migration tool for schema changes and verify actual execution state
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — deny by default, request-scoped authorization


## Isolated verification result

The actual disposable Compose lab `ishikeit-tenant-fence-20261113` on Node **24**/PostgreSQL **17** passed **851/851 tests across 102/102 files**, plus ESLint, TypeScript typecheck and production build; test container exited **0**. The lab containers, PostgreSQL volume and network were removed. This is simulated tenant provenance and schema validation, not a production owner/provider or DB migration acceptance.
