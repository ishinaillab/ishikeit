# Phase 2 — durable tenant provenance slots in inbox/outbox (Issue #230)

**2026-11-02 — additive DB foundation, NOT tenant-aware runtime cutover.**

After verified workspace registry migration 0010 and private OAuth intent
migration 0011, migration `migrations/0012_ishikeit_event_tenant_provenance.sql`
adds nullable workspace linkage to existing `inbound_events` and `outbox`.

## Schema and security properties

Both tables gain `workspace_id uuid`, `connection_id uuid`, and
`connection_generation bigint`, all **nullable with no default**.
Historical messages, unknown-scope operations and existing queued actions
retain **NULL workspace provenance**. We do not infer tenant ownership from
an Instagram handle, Telegram username, configured operator token, raw signed
webhook, platform app ID or provider customer identifier.

New tenant-bound records must pass:
- `workspace_id` references an existing workspace.
- `(connection_id,workspace_id)` refers to the **same** verified workspace
  connection record; foreign workspace/connection pair is rejected by database.
- When `connection_id` is present, `connection_generation` is a positive
  number and workspace must be present. A workspace-only event/job is allowed
  for future account-independent functions such as authorized bookings.
- Foreign keys and shape checks are `NOT VALID` during the additive step;
  PostgreSQL still enforces them for new/updated records. The existing legacy
  NULL rows need no rewrite; later full VALIDATE is a separately audited task.
- Partial indexes support future workspace-time and connection queries.
  Existing queue indexes, deduplication keys, leasing, retry semantics and
  dispatch fencing are untouched.
- Existing RLS stays enabled and client `anon`/`authenticated` table access
  stays revoked. No public API or client-visible tenant records are added.

Migration uses `SET LOCAL lock_timeout = '5s'` to fail safely rather than
block live message processing indefinitely. **No code writes tenant
fields yet**. Database foreign keys prevent a mismatched workspace link,
but this is not a proof of currently authorized sender rights or live
connection status. Dynamic provider entitlement (#206), recipient consent,
Meta/Telegram reply windows, provider App Review and per-send generation
fencing remain mandatory.

## Verification

CI PostgreSQL 17 runs a **separate sequential DDL-backed test** after
the existing outbox/inbound suites (to avoid destroying shared test fixtures):
`tests/tenant-event-provenance-postgres.integration.test.ts`.
It applies migration 0010 and 0012 to synthetic disposable tables, tests
legacy NULL data, valid multi-workspace pairs, rejection of cross-tenant
foreign keys, missing generation, unknown workspace and no browser grants.

Only after CI can the migration be applied to Supabase. Verify the three new
columns are all NULL on existing records, FK/check constraints and indexes
exist, previous public-role security is unchanged, and production readiness
still passes. **Do not populate or backfill customer data automatically.**

## Next actual runtime work

1. Finish trusted Ishikeit workspace sessions and official provider
   connect-intent callback integration. The current legacy operator token
   must not be treated as a customer identity.
2. Resolve each signed provider event to the verified immutable provider
   account and **active exact workspace connection** before ingestion.
   Quarantine unresolved events and preserve customer and provider privacy.
3. Make inbox/outbox inserts atomic with workspace and connection identity,
   tenant-bound partition/dedup keys and cancellation/generation fencing.
   No dispatch can use the new columns as proof of API entitlement by itself.
4. Test cross-tenant AI, media, consent, handoff, reminder and bookings before
   enabling more than one workspace in production. Migrate existing Ishi
   workspace identities only with actual ownership evidence; retire legacy
   @ishinaillab default after verified owner-level canary.

## Sources

- PostgreSQL 17 foreign key constraints, including NOT VALID enforcement
  against new writes: https://www.postgresql.org/docs/17/sql-altertable.html
- Supabase RLS and grants: https://supabase.com/docs/guides/database/postgres/row-level-security
  and https://supabase.com/docs/guides/api/securing-your-api
- Provider-specific messaging permissions, standards and policy contracts
  remain source-backed in docs/PROVIDER_CONTRACTS_2026-11-02.md and #206.
