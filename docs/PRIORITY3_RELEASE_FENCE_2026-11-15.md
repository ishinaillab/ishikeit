# Priority 3 — atomic single-writer release ownership and external enforcement

2026-11-15, Asia/Manila. **LOCAL-ONLY, NOT DEPLOYED, NO ACTIVE LEASE.**

This implementation closes the original issue-comment-based ownership race
*at the PostgreSQL data structure level*. The developer tools and production
providers do **not yet enforce** the new lease. Never interpret an issue
comment, browser tab, Windows PID, unacknowledged STOP instruction, or a
database lease by itself as permission to deploy or merge.

## Audited risk and authoritative design

The owner located the former primary chat and posted a STOP directive on
2026-11-15; it was visibly delivered, but the old chat hit its maximum
conversation length and did not acknowledge. There were no observed
local Ishikeit Git writers or running containers. This does NOT rule out
future/remote writers. GitHub application main has a ruleset with a PR and
four strict CI checks, while the DB main has a PR rule with no mandatory
CI checks. Hostinger apps.ishinaillab.com still auto-deploys from app main,
so a main change outside a fenced controller can deploy immediately.

The `ishikeit_release_ownership` schema is an isolated private SQL
lease. It requires a random 256-bit base64url owner secret (stored only
as SHA-256), exact application/database protected MAIN SHA-1 identities,
a bounded 60–900-second expiry and an atomic `INSERT ... ON CONFLICT DO
UPDATE ... WHERE expired` CAS. Every successful new acquisition increments
a monotonic `generation`; release increments it again. `check`, `renew`
and `release` require the same scope, digest, exact generation, exact
two SHAs and a STILL-LIVE DB-side timestamp. Expired/stolen/obsolete owners
cannot renew or release. One external PostgreSQL transaction serializes
parallel acquisition via the primary key; no Python thread locks, cached
chat-state or monitoring promises are relied on.

The table has RLS, zero anonymous/authenticated/public grants, and no
browser-facing API. A token is NEVER exposed by `inspect`; it reports
only whether a lease is still active and the scope/head/generation/expiry.
No initial live lease is created by the migration.

Code:
- `migrations/0025_priority3_release_ownership_fence.sql`
- `src/operations/priority3-release-fence.ts`
- `tests/priority3-release-fence-postgres.integration.test.ts`
- Matching independent DB:
  `ishikeit-db/supabase/migrations/20261115021500_priority3_release_ownership_fence.sql`
- Protected app PR CI `outbox-postgres-integration` now specifically
  includes the app-scoped ownership and release lease PG17 tests, run
  serially to avoid temporary schema collisions.

## Required production enforcement — NOT YET CONFIGURED

This release mechanism remains **advisory until integrated into a
privileged, protected single release controller**. Before any protected
GitHub merge, Supabase DDL, Hostinger build, OAuth callback change or
provider activation, that controller must:

1. Acquire the exclusive live lease and verify it has the current
   monotonic generation; require an authorized human release intent.
2. Independently read the real GitHub protected app/DB `main` heads and
   compare them to BOTH SHA values in the acquired ticket. Refuse drift.
3. Revalidate the ticket and GitHub heads immediately before EACH
   irreversible operation and its outcome. Use remote compare-and-swap
   / expected-head constraints for protected refs and fail closed.
4. Require GitHub PR/CI branch rules and a deployment environment with
   external approval; enforce **all** app/DB release operations through
   that controller. A direct admin GitHub merge, Supabase SQL editor
   write, Hostinger manual deploy, or Hostinger Git auto-deploy can
   bypass a database lease unless separately restricted.
5. Preserve release audit, check exact deployed SHA and service health,
   and release/expire the ticket. Never infer successful user OAuth
   consent or provider App Review from a database lease.

GitHub administration and Hostinger auto-deployment settings are still
unchanged. Current connected GitHub MCP does not expose administration
actions for changing branch rulesets; no owner-controlled approval for
live schema or provider app permissions has been impersonated.

## Release sequencing

- Merge the protected DB expand-only v2 + lease SQL AFTER reviewed CI,
  approved migration procedure and verified exclusive execution.
- Check v2 RLS/roles, legacy three-column writer compatibility and
  `legacy-unbound` quarantine before releasing the matching new app.
- App CI requires Node24, PostgreSQL17, PHP and continuity jobs.
  A read-only preflight must verify exact main heads and a privileged
  controller gate; do not permit auto-deploy to bypass authorization.
- Run genuine owner AAL2/OAuth/consent and per-provider official rights
  readbacks. Meta App Review **explicitly remains ON HOLD #169**.
- Keep active tenant routing disabled until event/outbox/worker generation
  fencing, provider revocation/subscription cleanup, token removal and
  durable reconnect tests are independently proven.

## Test evidence and limits

TDD RED: import failed before the release-fence implementation existed.
Focused isolated Node24/PG17 after implementation: **5/5** cases passed
with lint and strict TS: concurrent acquisition (only one), hash-only
storage, exact head binding, revoked release generation, expiry takeover,
failed stale renewal/release, malformed scope/secret/TTL rejection, and
private table RLS/no PUBLIC permissions. Test container and PG volume
removed, exit 0. The protected GitHub Postgres CI workflow is updated
to include these real tests, but its **new commits have not yet run on
GitHub Actions** because the user-authorized shared-write hold forbids
pushing them. Final complete local suite must be checked independently.

PostgreSQL authoritative concurrency reference:
https://www.postgresql.org/docs/17/explicit-locking.html
GitHub branch policy reference:
https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
GitHub protected deployment reference:
https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments

**No work is performed continuously in the background by this code or
by this conversation.** No production release lease has been acquired.
Priority 3 IN PROGRESS, no Priority 4/5 activation.

### Final full-suite verification

The standalone fencing tests passed **5/5** in disposable PG17 with lint/strict TS. After adding protected GitHub PG17 test coverage and limiting the Docker test source copy to `.github/workflows/ci.yml`, the **complete** Node24/PG17 suite passed **1005/1005 cases across 125 files**, ESLint, strict TypeScript and compiled build. All named test containers and storage were removed (exit 0). No live lease or release coordination privilege was acquired. The original first attempt failed just one new CI-fixture file read because the allowlist omitted its workflow; corrected and full rerun passed.

### Actual Supabase client-role privilege negative tests

An additional disposable PG17 regression now creates both real `anon` and `authenticated` NOLOGIN roles **before** the release-ownership migration, confirms neither role has SELECT or UPDATE privilege and uses independent `SET LOCAL ROLE` transactions to prove direct SELECT is denied. Five of five release-fence PG17 cases, ESLint and strict TypeScript passed; lab cleanup exit 0. The table's RLS/REVOKE is independently exercised, not inferred from missing-role fallback values.
