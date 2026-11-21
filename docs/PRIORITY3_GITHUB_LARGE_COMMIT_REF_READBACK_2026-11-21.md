# Priority 3 — GitHub Actions large-commit release-readback correction

**21 November 2026, LOCAL ISOLATED REVIEW.** Source baseline is actual protected app `main` `8eed158e64cd5054b6bee3938021a029665e7a13`, from merged app PR #306. The release workflow is owner-only and manual; this patch does not authorize or perform a Hostinger deployment, Supabase migration or provider change.

## Live failure / root cause

The already manually triggered protected Hostinger `provider-preflight` workflow (run `44899148044`) entered the initial owner-approved environment and passed the actor/rerun guard and runner setup. It then failed in `node scripts/verify-priority3-github-release.mjs` with `GitHub release verification unavailable`. The downstream privileged Hostinger job was skipped. No Hostinger API deployment, schema operation or PostgreSQL lease occurred from that attempt.

The release checker used `GET /repos/ishinaillab/{repo}/commits/main` and explicitly rejected responses larger than **131,072 characters**. After merge PR #306, the app's full commit endpoint returned **HTTP 200, 1,051,529 characters**, including large file patches. The DB commit response was 63,673 characters. Reproducing the same verification locally with actual app `8eed...` and DB `2bf7...` SHAs failed with the same generic error. This is a valid size safeguard rejecting an unnecessarily huge response, **not** an infrastructure outage or bad Hostinger token.

GitHub's authoritative Get a reference API exposes `GET /repos/{owner}/{repo}/git/ref/heads/main`, returning `ref:\"refs/heads/main\"` and `object:{type:\"commit\",sha:\"...\"}`. See https://docs.github.com/en/rest/git/refs#-get-a-reference .

## Narrow fail-closed patch

- Replace only the two required protected-main commit lookups with the Git reference endpoint in `scripts/verify-priority3-github-release.mjs`; require exact `ref`, object type `commit`, and SHA match against the caller-pinned app/DB commit pair. Keep the GitHub response-size limit, allowlist, scopes, branch rules, environment reviewers, required CI and repeated rule checks unchanged.
- Apply the same lightweight exact-reference readback to the owner-only Hostinger release controller `assertGitHeads` and the GitHub Actions PR probe. Ensure no production script still calls `/commits/main`.
- Update deterministic unit and disposable PG17 Hostinger fixtures. Add an explicit red-first regression forbidding full commit API use even if the pinned SHA is the same, negative tests for tag/noncommit/wrong SHA refs, and an oversized compact-ref response test that verifies the size bound remains fail-closed.

## Verification

1. Before the fix, new red regression under Docker Node 24 produced **12 passed, 1 failed**, specifically because the controller still used the full commit API. No production code was touched.
2. After the fix, focused release verification/Hostinger controller/workflow tests under Docker Node 24: **81/81 passed**.
3. Live read-only `node scripts/verify-priority3-github-release.mjs` with exact app `8eed158e...` and DB `2bf7c2f...` passed. The same exact call had failed before the change.
4. Full Docker Compose Node 24 + disposable real PostgreSQL17 run: **132/132 application test files, 1,066/1,066 tests passed**, ESLint passed, TypeScript check passed, production build passed, test container **exit code 0**. The first full run caught a newly introduced unused test callback parameter; corrected, reran full suite and passed.
5. Disposable test project `ishikeit-p3-gh-ref-fix-20261121` containers, volume and network were shut down, removed and confirmed absent.
6. No secrets, tokens, provider data, customer data or GitHub action bearer credentials were printed. All GitHub API readbacks were safe GETs.

## Unchanged external acceptance boundary

This patch does not constitute a release-owner handoff or remove the owner coordination HOLD (#284). The protected Hostinger provider-only workflow still needs a fresh **first attempt** on an approved protected main SHA after its change merges (reruns fail closed), the required owner environments and live Hostinger token/install/settings/current-build readback, and separate SQL v45/provider-native acceptance. Live production was not changed by this local correction. Do not submit Meta App Review without separate explicit approval.
