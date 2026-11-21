# Priority 3 — prevent pre-POST GitHub failures from stranding a Hostinger release hold

**Status:** isolated, local review only. Based on clean local checkpoint `3bbfae2df0e738b6fbc6da9d0714fadf041d53ce`; not pushed, merged, deployed or applied to any real provider. GitHub issue #284 shared-write HOLD and Meta App Review explicit NO SUBMISSION remain in effect.

## Failure and correction

The protected Hostinger release controller previously persisted `pending_external_step='app_deploy'` and **then** re-read both GitHub branch HEADs before issuing the first Hostinger build POST. A GitHub readback outage or revoked job token in that gap could leave an irreversible-looking pending external operation although no hosted build had been submitted. The only accepted recovery for an expired `app_deploy` hold requires proving the target commit was actually deployed, so this ordering could strand a protected release indefinitely without any genuine external side effect.

In `scripts/priority3-protected-hostinger-release.mjs`, move the final exact app+database GitHub head verification to immediately **before** durable external-step arming. All pre-release checks (private database schema/guard, native link/cleanup count, approved Git installation, disabled auto-deploy, saved Node build settings, old deployment SHA/UUID and health) still run before admission. The last fallible GitHub verification now completes before the irrevocable pending state, followed by `fence.arm(cfg)` and then the first `api.start()` call.

The durable hold **still precedes the Hostinger POST**. Hostinger timeout, accepted build with missing UUID, ambiguous response, failed build, commit mismatch, later GitHub head drift, health failure and lost or expired lease still leave a pending external step requiring independently proven owner-approved reconciliation. This change is not permission to retry ambiguous hosted operations and cannot fence privileged administrators or unaffiliated external writers.

## Reproduction and focused verification

Two new Node24 regression tests were added to `scripts/test-priority3-protected-hostinger-release.mjs`:

1. Force the final GitHub fetch before POST to return HTTP 503. Require zero Hostinger POST requests, no armed external step and successful release of the unused lease.
2. Verify the next operation after durably arming is the Hostinger POST, with no intervening GitHub fetch.

**Before fix (Docker Node24):** 36 tests, 34 passed and both new regressions failed. One proved the undesired pending hold; the other observed two GitHub fetches between arm and POST.

**After fix (Docker Node24):** combined Hostinger controller and protected workflow suite **58/58 passed**. Protected CI already invokes both tested scripts as part of the required Node job.

## Complete isolated verification

- Docker Compose Node.js 24 + genuine disposable PostgreSQL 17 test lab: **132/132 Vitest files and 1,066/1,066 cases PASS**, ESLint PASS, TypeScript `tsc --noEmit` PASS, production build PASS, test container **exit 0**.
- Additional network-isolated Node24 release controller and workflow tests: **97/97 PASS** (Hostinger and schema guard tests combined).
- `git diff --check` PASS. Verified the exact new Compose test containers, synthetic PostgreSQL volume and network were removed with `docker compose down --volumes --remove-orphans`; subsequent named project resource lists were empty.
- These are local tests only. GitHub-hosted protected CI was **not** run for the isolated changes, and no Hostinger API POST or live production SQL was sent.

## Acceptance boundary

This correction does not establish a universal exclusive release lock and does not authorize any protected branch publication, Hostinger Git reconnection, live Supabase 45th migration, provider grant/revocation, customer send, Meta App Review submission or deployment. Production still needs verified exclusive ownership, owner-reviewed GitHub/Hostinger environment credentials, authenticated disabled auto-deploy readback, protected hosted CI, independently verified 45/45 migration + trigger, and real provider-owner active-disconnect acceptance. Preserve the original seven canonical unpublished modifications, all owner MFA devices and legacy studio traffic.
