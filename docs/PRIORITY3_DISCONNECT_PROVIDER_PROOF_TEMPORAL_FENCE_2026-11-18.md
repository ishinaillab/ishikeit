# Priority 3 — Native provider disconnect proof temporal fence

**Date:** 2026-11-18, Asia/Manila. **Status:** independent local review only; no remote publication, protected merge, provider write, or production deployment.

## Source and scope

This isolated review worktree branches from the clean native runtime integration checkpoint `9f84c7da0be4d23a9aaa426a29c6dcad37b2b15a`. The local Git blobs for `src/persistence/active-disconnect-finalizer.ts` and `src/persistence/tenant-send-admission.ts` were compared against draft PR [#304](https://github.com/ishinaillab/ishikeit/pull/304) at `86f31e69538fa5bc06248b53427a478cabee6782` and matched exactly. Canonical unpublished edits, other review worktrees and owner MFA are untouched.

## Actual defect and fail-closed repair

The finalizer's trusted provider verification still permitted a timestamp up to **120 seconds in the future**, and a still-recent observation from **before the owner requested disconnect**. A readback that precedes the database's frozen disconnect record does not establish provider revocation following that disconnect. An independently added negative integration test reproduced the defect using a disposable PostgreSQL17 database: one readback from 30 seconds before the request was accepted and completed account disconnection.

The revised finalizer now:
- Reads `d.requested_at` from the durable `ishikeit_active_disconnect_cleanup` ledger during both the initial read and the final transaction-held read.
- Requires the current readback to be no more than 60 seconds old and no more than 2 seconds future-dated; refuses invalid timestamps.
- Requires the readback to follow the database-recorded disconnect request, allowing only 2 seconds of cross-service clock skew, and repeats this test under locks immediately before deleting only the native per-connection credential and marking the account disconnected.
- Fails closed on invalid or missing request-time records, without altering account ownership, credentials, or the unresolved cleanup hold.

This is a server-side temporal validation, **not** provider-side revocation. A legitimate verifier still needs owner-native provider consent and actual authoritative provider API readback. The app's native tenant workers remain review-only and disconnected from legacy production routing.

## Observed validation

1. **Red**: New cases in `tests/active-disconnect-finalizer-postgres.integration.test.ts` rejected pre-disconnect and future-dated observations, failing against unchanged prior code in real disposable PostgreSQL17.
2. **Green**: The fixed implementation passed all **5/5** targeted real-PostgreSQL17 integration tests, including both new negative readbacks, exact Telegram Business verified disconnect, isolated native TikTok credential deletion, and in-flight sends quarantine.
3. **Complete CI-equivalent local suite:** Docker Compose with supported Node 24 and PostgreSQL17, unique project `ishikeit-p3-disconnect-fresh-20261118`, ran `npm ci --ignore-scripts`, `npm run lint`, `npm run typecheck`, `npx vitest run --no-file-parallelism`, and `npm run build` successfully: **131/131 test files** and **1,059/1,059 tests passed**.
4. Database fixtures and source were container-confined and read-only mounted; no real Supabase, customer/provider messages, GitHub shared writes, or Hostinger credentials were used. Containers, project network and disposable volume must be removed after tests.

## Release status and blockers

Issue [#284](https://github.com/ishinaillab/ishikeit/issues/284) coordination/shared-write HOLD remains active. Draft PR [#304](https://github.com/ishinaillab/ishikeit/pull/304) is not updated by this isolated local change and remains unmerged. Draft PR [#305](https://github.com/ishinaillab/ishikeit/pull/305) and the separate Hostinger controller checkpoint are unchanged. This work **does not** prove complete active-account disconnect safety, live provider revocation, exclusive Hostinger release ownership or protected production acceptance. Meta App Review remains **NO SUBMISSION** without the owner's explicit instruction.
