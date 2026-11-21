# Priority 3 native tenant outbox write admission (local-only, 2026-11-18)

**Status: NOT MERGED, NOT APPLIED, NOT DEPLOYED.** GitHub issue #284 shared-write HOLD is still active. This is a **database-level defense in depth** for dormant native tenant event queues. It does not switch production routing or authorize provider sends, provider revocation or any owner consent.

## Confirmed defect

The earlier provenance migration limited nullable workspace/connection/generation *shape* and foreign keys, but allowed a privileged server writer to INSERT `outbox.connection_generation` unrelated to the current generation, INSERT after account pause/freeze, or UPDATE an existing queue row to another identity in the same workspace. These operations were observed in isolated PostgreSQL 17 tests. A concurrent status/generation update could complete while an outbox insert remained uncommitted because the prior FK only held a key-share lock. The new tests failed against the existing SQL before the fix.

## Additive, dormant correction

The matching app migration `migrations/0029_priority3_native_outbox_write_fence.sql` and DB mirror `supabase/migrations/20261118222000_priority3_native_outbox_write_fence.sql` are SHA256-identical:

`62ce9b0b733062a2b220372b7782056f9cc7bfb296d0d444f112bb7b46227252`

The `SECURITY INVOKER` trigger function with pinned `search_path=pg_catalog` requires newly inserted connection-bound native outbox work to reference a `connected`, activated connection with exactly matching `workspace_id` and `generation`, and an active workspace. It takes `FOR SHARE OF c,w` row locks, which serialize the insert with account freeze/pause/disconnect updates. The trigger refuses *all actual provenance column changes* on an existing outbox row; ordinary attempts, leases, delivery, and quarantine updates still work. Legacy (all-null provenance) and workspace-only connectionless tasks remain accepted. No stored tokens, customer content or new Data API client grants are introduced. Existing queue rows are not rewritten.

Read-through: [PostgreSQL 17 row locks](https://www.postgresql.org/docs/17/explicit-locking.html), [transaction-level consistency](https://www.postgresql.org/docs/17/applevel-consistency.html), [trigger functions](https://www.postgresql.org/docs/17/plpgsql-trigger.html), and [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Verified local testing

- Added five real-PostgreSQL 17 integration tests (valid/current generation, paused/frozen/stale account, same-workspace identity rewrite, unchanged legacy/workspace tasks, repeatable migration/privilege readback, and concurrent insert vs freeze).
- **RED** before the migration: three distinct tests failed, exposing stale generation insertion, provenance reassignment and connection freeze outrunning an uncommitted insert.
- **GREEN** after migration: **5/5** new tests passed; the entire isolated Node 24 + PostgreSQL 17 application CI-equivalent suite passed **132/132 files and 1,066/1,066 tests**, plus ESLint, TypeScript typecheck and production build.
- Database repository local naming and offline required migration CI guards passed **6/6 tests**; 45 distinct ordered migration versions reported. The two SQL files matched SHA256 exactly.
- The local Supabase CLI binary is not on this Windows shell's PATH. This review has **not** run the official Supabase CLI `db reset` / `db lint` on the complete 45-file repository history. The new migration was executed and replayed successfully against real PostgreSQL 17 synthetic fixtures; GitHub-hosted official CLI migration acceptance is still required.

## Release and safety limits

A privileged PostgreSQL administrator can change triggers or schema; this database rule does not claim to fence independent DBA / Hostinger / GitHub production writes. The next production schema release, after owner-approved exclusive fenced release ownership and required protected CI, must review operational locking and owner session controls, run official `supabase db reset --no-seed` and `supabase db lint --fail-on error --schema public`, verify SHA parity and backup/recovery, and keep native tenant sends dormant until separately accepted. No global provider account is released merely because an outbox row is dead-lettered. Real provider-side revocation/readback and live active-account disconnect remain unverified. **Do not submit Meta App Review without the owner's express permission.**
