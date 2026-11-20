# Priority 3 — Hostinger protected release controller: genuine PostgreSQL 17 acceptance

**Scope:** LOCAL/ISOLATED ONLY. Branch `review/priority3-hostinger-pg-acceptance-20261121` was created from prior clean `869f0e8`. GitHub coordination issue #284 remains on shared-write HOLD; this verification is not authorization to release, bypass provider permissions, submit Meta review, or change production.

## Rationale

The existing Hostinger release controller had extensive mock/state-machine tests, and its PostgreSQL compare-and-swap lease was independently tested in other code paths, but the **whole** Hostinger `run()` release lifecycle had not been exercised against actual PostgreSQL while using the exact production SQL schema. This was a remaining gap for proving that protected preflight stays strictly SELECT-only, only one holder can release, pending external operations survive ambiguous provider outcomes and expiry, and expired holds never clear without matching provider-side acceptance.

New `scripts/test-priority3-protected-hostinger-e2e-postgres.mjs` uses the approved disposable-only `PG_OUTBOX_TEST_DATABASE_URL` (localhost, database `ishikeit_outbox_test`) and actual app SQL migrations `0001`, `0010`, `0012`, `0025`, `0026`, `0027`, `0028`, `0029`; authentic database tables/roles/trigger in PG17 are created and removed inside the isolated test database. GitHub HEAD, production health, Hostinger installation/settings/build endpoints are synthetic in-memory mocks; **no actual provider requests** are sent.

Test scenarios:

1. Real PostgreSQL `preflight` performs only SELECTs, starts no build and creates no lease.
2. Real PostgreSQL concurrent owner acquisition fails after the generation-fenced `app_deploy` hold is durably armed before the mocked Hostinger build POST; matching finished build readback releases the exact owner and records verified deployment.
3. A provider response lost **after** the mocked POST retains pending `app_deploy`, including after forced expiry; competing acquisition still fails; owner-approved mocked exact deployment readback reconciles exactly once without another POST.
4. An expired hold without an independently verified matching build cannot be cleared, even when the same Git installation is present.

First real PG17 attempt surfaced a missing fixture migration (`0026`, active disconnect cleanup), not a production defect; applying the authentic fixture corrected it. A negative-case fixture was also tightened to preserve the approved installation while testing missing deployment SHA. Final isolated PG17 result: **4/4 PASS**, production TypeScript build PASS.

Protected `.github/workflows/ci.yml` now executes this PG17 test **sequentially after the schema migration tests and before the PostgreSQL restart test** in the existing disposable database job, using no provider secrets. `scripts/test-priority3-protected-hostinger-workflow.mjs` now requires that exact run location and rejects removing it. Focused static workflow suite: **24/24 PASS**. Official cached upstream `rhysd/actionlint` validates the amended CI workflow with **exit 0**.

## Complete local CI-equivalent regression

- Isolated Docker Compose Node.js 24 + real disposable PostgreSQL 17: **132/132 Vitest test files; 1,066/1,066 application tests PASS**; ESLint PASS, strict TypeScript typecheck PASS, production TypeScript build PASS; test container **exit 0**.
- New real PostgreSQL Hostinger controller e2e: **4/4 PASS**.
- Protected workflow static/negative suite: **24/24 PASS**.
- Upstream Actionlint: **exit 0**, workflow parses and validates.
- The first complete local run correctly rejected an unused import in the new test fixture; after removing it, the full isolated CI-equivalent run passed.
- GitHub-hosted CI has **not** run for this unpublished branch; these results do not grant publication or deployment permission.

## External hold and future acceptance

A tested PostgreSQL release lease does **not** fence arbitrary GitHub administrators, Hostinger hPanel deployments, separate Supabase database administrators or competing Codex/Claude developer workflows. Latest authenticated read-only Hostinger repository list for `apps.ishinaillab.com` is empty; the site still has legacy deployed app `fdec3d488fb69f7bae3457a1d6cf152676656cff`. Production read-only Supabase check: **44** migrations, **0** lease rows, **0** native connections, **0** pending native disconnects. Production 45th migration, owner-controlled protected GitHub/Hostinger release secrets and genuinely exclusive co-writer handoff remain unverified. No production SQL, Hostinger build, customer send, provider revoke or Meta App Review submission was performed.

Maintain original canonical seven unpublished modifications, owner MFA, existing live channels, and all previous isolated checkpoints. Priority 3 remains IN PROGRESS.
