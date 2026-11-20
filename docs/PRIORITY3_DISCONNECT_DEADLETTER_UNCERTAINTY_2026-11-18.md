# Priority 3 — preserve provider-send uncertainty after dead-lettering

Date: 2026-11-18 (Asia/Manila). Status: **isolated local review only**, not merged, deployed, or connected to provider credentials.

## Scope and independently reproduced defect

Based on clean reviewed native runtime at commit `702ad8a4e86ee9043ef0df234fb8fb64e59c3492`, without any change to canonical dirty checkout, draft PR #304, previous Hostinger controller, or production.

Prior `PostgresActiveDisconnectHold.request` counted an unpublished outbox record only if `dead_lettered_at IS NULL` even when `tenant_send_started_at` or `meta_send_started_at` established that a provider request might already have been attempted. A worker may dead-letter such an ambiguous message locally without obtaining an authoritative provider send receipt. The old code then incorrectly stored `uncertain_inflight_jobs=0` for this native account, which could allow the verification finalizer to release the global provider account.

The prior `PostgresActiveDisconnectFinalizer.finalize` also filtered `dead_lettered_at IS NULL` when checking outstanding work. A defensive test inserted a tenant-owned, already dead-lettered, provider-send-attempted row after disconnect quarantine and showed that the old finalizer accepted otherwise valid provider readback and incorrectly completed the account disconnect.

Both tests failed against the unchanged implementation in a disposable **real PostgreSQL17** test database.

## Local fix

- Freeze transaction: continue counting as uncertain *every unpublished native job with a recorded provider-send start*, even when already dead-lettered; count leased, unattempted work only while not dead-lettered. Provider-published work is not treated as unresolved.
- Finalization transaction: refuse any unpublished, not-dead-lettered job **or** unpublished previously attempted job with `tenant_send_started_at` / `meta_send_started_at`, regardless of dead-letter state.
- Keep the `uncertain_inflight_jobs` durable, immutable cleanup ledger and all existing provider, tenant, generation, owner, and credential checks. No “manual clear” or fabricated provider receipt; genuine provider outcome reconciliation is still required.

This is deliberately conservative: it may retain an account claim until a future separately verified reconciliation flow handles an ambiguous send. It never requeues, resends, removes tokens, changes live customer traffic, or declares external revocation from a local dead-letter.

## Real local evidence

- RED, before code changes: both new PostgreSQL17 tests failed exactly as expected: **uncertain count 0 instead of 1**; **finalizer incorrectly returned disconnected generation 4** rather than rejecting an unresolved attempted send.
- GREEN, after SQL guard repair: **14/14 targeted PostgreSQL17 integration tests passed**, covering quarantine and provider-verified finalization. Complete local CI-equivalent verification: Node 24 + real PostgreSQL 17 with `npm ci --ignore-scripts`, `npm run lint`, `npm run typecheck`, `npx vitest run --no-file-parallelism` and `npm run build` all passed. **131/131 test files and 1,061/1,061 tests passed**, including the two new fail-closed cases. The disposable test container, project network and volume were removed after verification.
- Test lab: unique Docker Compose namespace `ishikeit-p3-deadletter-20261118`, no public PostgreSQL port, repository mounted read-only, temporary synthetic data only.

## No shared-write authorization

GitHub issue [#284](https://github.com/ishinaillab/ishikeit/issues/284) HOLD continues. Draft runtime PR [#304](https://github.com/ishinaillab/ishikeit/pull/304), draft Hostinger PR [#305](https://github.com/ishinaillab/ishikeit/pull/305), and the protected GitHub and production release remain untouched. This local implementation does not complete authenticated production deployment, provider-owner revocation/readback, or real active-account disconnect acceptance. Meta App Review remains **NO SUBMISSION**.
