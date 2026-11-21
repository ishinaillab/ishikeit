# Priority 3 integrated offline acceptance — 2026-11-19 (Asia/Manila)

**Review only. No GitHub push, merge, production migrations, Hostinger build, provider network changes or Meta App Review submission is authorized or claimed. GitHub issue #284 shared-write HOLD remains active.**

## Isolated source composition

App review branch `review/priority3-integrated-acceptance-20261119` starts from tested app native queue fence commit `0750886fe926f3596829b5352a728dc788596e32`, including fresh provider disconnect readback boundary, dead-lettered attempted-send hold, and the additive SQL migration `migrations/0029_priority3_native_outbox_write_fence.sql`.

The following *five* reviewed release-controller files were copied directly from clean independent Hostinger rerun review commit `2286080742a540e8c2bde6d33f76a4f83d8a3825` with no new credential or provider actions: `scripts/priority3-protected-hostinger-release.mjs`, the two corresponding test files, `.github/workflows/priority3-protected-hostinger-release.yml`, and the companion technical review documentation. The release controller still needs genuine protected environment and Hostinger authorization before running.

App protected `.github/workflows/ci.yml` now explicitly executes the offline Hostinger controller and owner-rerun negative tests in the required Node 24 CI job; the real PostgreSQL 17 outbox integration step now includes `tests/priority3-native-outbox-write-fence-postgres.integration.test.ts`. The existing `tests/priority3-release-ci-coverage.test.ts` now rejects missing CI declarations.

## Verified — integrated Node24 + PostgreSQL17

The isolated Docker Compose project `ishikeit-p3-integrated-20261119` used a real disposable PostgreSQL 17 server without exposed port, private/production credentials, or provider network requests, and mounted repository sources read-only. Single-command fail-fast pipeline completed with exit code 0:

- `npm ci --ignore-scripts --no-audit --no-fund`
- `npm run lint` and `npm run typecheck`
- `node --test scripts/test-priority3-protected-hostinger-release.mjs scripts/test-priority3-protected-hostinger-workflow.mjs` (54 release-controller/workflow tests in prior independently confirmed focused acceptance; full integrated command succeeded)
- `npx vitest run --no-file-parallelism`: **132/132 files, 1,066/1,066 tests passed** in real disposable PG17
- `npm run build` (TypeScript compilation)
- The exact integrated protected workflow passed upstream Actionlint without network access.

## Verified — official Supabase CLI complete local replay

Separate isolated DB review branch `review/priority3-db-cli-acceptance-20261119` starts from tested migration mirror commit `8185ee892b024457e59a57ecedb86fa19a919eca`. Only its temporary `supabase/config.toml` project_id was changed to unique local `ishikeitp3cli20261119` for validation. There was no linked remote project, token or production `--remote` flag.

Official stable `supabase@3.2.0` (npm dist-tag `latest`) performed `db reset --no-seed` successfully on the isolated local PG17 stack, applying **all 45 versioned migrations**, including `20261118222000_priority3_native_outbox_write_fence.sql`. The official `db lint --fail-on error --schema public` passed with **No schema errors found**.

Direct local `psql` readback showed **45** migration records; exactly **one** enabled `ishikeit_native_outbox_write_fence` trigger; and `ishikeit_guard_native_outbox_write()` with `prosecdef=false` and no `EXECUTE` privileges for `anon` or `authenticated`. The app/DB SQL mirrors are SHA256-identical: `62ce9b0b733062a2b220372b7782056f9cc7bfb296d0d444f112bb7b46227252`. Offline DB migration integrity and CI safety checks previously passed **6/6**.

The initial `db start` required fetching newer local Docker images and timed out after 180 seconds; the subsequent local `db reset --no-seed` completed successfully and replaced that incomplete attempt. This is NOT evidence of hosted Supabase migration or GitHub-hosted CI success.

## Remaining external release gates

1. Issue #284 **exclusive release handoff/HOLD** clearance and verification no parallel developer/release writer, with a fenced release owner; local commits cannot assert exclusive Hostinger/DB/GitHub administrative write prevention.
2. GitHub protected *main*, both required reviewer environments and effective CI/branch rules, with authentic owner-approved guarded CI and a separately configured short-lived Hostinger API token. The owner browser had not been signed into GitHub at prior readback.
3. Authenticated exact Hostinger Git installation/repository/main and `GET /git/auto-deployments/settings` readback, with auto deploy demonstrably off; Hostinger site hPanel had displayed Git provider **not connected**. No external build or mutable-main fallback is authorized.
4. Protected release app+DB exact SHA preflight/lease/reconcile and production migration/deploy acceptance. Existing production hosted code remains older than draft PR runtime.
5. Genuine provider-owner OAuth and revocation/readback for each native account, preservation of shared legacy Page/business assets, full uncertain-send outcome reconciliation, and owner-accepted live account disconnect/worker tests. Production currently has zero native connections.
6. No Meta App Review request or app submission without explicit separate owner permission.

**Never claim Priority 3 completed merely because these local checks pass.** Preserve the original seven unpublished canonical files, verified MFA factors, legacy customer traffic, and other clean review branches. All original account handles must remain configurable, not hard-coded as platform identities.

## Current read-only external release evidence (2026-11-19 Asia/Manila)

- Live app `ishinaillab/ishikeit` protected main: `398e0ce59c4b54eec4c12c2a306efe228c1201d2`; protected DB `ishinaillab/ishikeit-db` main: `2bf7c2f6b2cc6245c4e0ea7660ed817654e2ad3e`. Neither includes this local consolidated branch.
- Authenticated GitHub integration fetched the *effective repository rulesets*: app ruleset #27029590 and DB ruleset #27030251 are **active** and both publish `bypass_actors=[]`. Both require PR, no deletion, no force push, linear history and strict required checks. App required checks: `node`, `outbox-postgres-integration`, `php-lint`, `context-continuity`; DB: `migration-ci`. Both accept zero approving reviews, the previously owner-approved solo-maintainer model. GitHub environment reviewer configuration and current protected release secret existence were **not accessible** through this integration; a ruleset read does not substitute for their independent authenticated check.
- Official Hostinger website list confirms `apps.ishinaillab.com` is an enabled Node.js site. Official **website Git repository** list returned `[]`; that endpoint explicitly excludes GitHub/GitLab auto-deploy configurations, so the empty list **does not prove** GitHub auto-deploy disabled. Official Hostinger latest completed build remains UUID `01a1d96f-bc54-70a0-ae01-504fa9a27c72`, deployed app SHA `fdec3d488fb69f7bae3457a1d6cf152676656cff`, and aggregate `gitAutoDeployment=null`. No separate authenticated site `GET /git/auto-deployments/settings` operation was exposed by the connected Hostinger MCP. Reconnecting Git in hPanel or starting a build was deliberately NOT attempted.
- Two independent unauthenticated production health GETs returned HTTP 200: `/health/live` responded `{"status":"ok"}`; `/health/ready` responded `{"status":"ready"}`. This verifies legacy hosted app availability, not the proposed protected runtime.
- Hosted Supabase read-only SQL: **44** applied migration records, **0** active release ownership rows, **0** native account connections and **0** active disconnect-cleanup rows. The proposed 45th local native outbox fence migration is **not deployed**.
- The live GitHub connector did not authorize the protected per-environment/secret readback and the existing owner-authenticated Chrome DevTools endpoint `127.0.0.1:9222` refused connection. The standard Browser connector could not access the originating tab context. These are actual capability limits, not permission to bypass owner login or retrieve credentials from private profile files.

**Stop conditions**: shared-write HOLD #284 and explicit no Meta App Review submission remain effective. For a production release, a verified exclusive owner handoff and owner-authenticated protected GitHub + Hostinger Git/secret readback are mandatory; a site-level configuration change or credential transfer must be performed by its genuine account owner through the approved UI/secret path. Subsequently verify hosted preflight, migration and release exactly against approved app/DB commit SHAs, health and provider-owned consent/readback with native account test fixtures. In the absence of owner consent and live native connections, Priority 3 is NOT complete.
