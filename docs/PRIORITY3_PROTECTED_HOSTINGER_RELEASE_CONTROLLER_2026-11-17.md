# Priority 3 — Hostinger protected release controller (review-only, 2026-11-17)

**Release state: NOT DEPLOYED. This document and workflow do not authorize an app rollout, provider consent, or customer traffic cutover.**

## Independently verified live baseline

- GitHub app protected `main`: `398e0ce59c4b54eec4c12c2a306efe228c1201d2`.
- GitHub database protected `main`: `2bf7c2f6b2cc6245c4e0ea7660ed817654e2ad3e`.
- Supabase production `vhmrliqemkfxblzsoyaz`: **44** applied migration versions; the five new private Priority 3 versions were applied and read back by protected workflow [#43814638743](https://github.com/ishinaillab/ishikeit/actions/runs/43814638743). The release lease table exists but has **zero** leases, **zero** native workspace account connections and **zero** active cleanup jobs. Nine v2 capability facts are not proof of native provider-owner consent.
- Actual Hostinger `apps.ishinaillab.com` last completed build `01a1d96f-bc54-70a0-ae01-504fa9a27c72` still deploys `fdec3d488fb69f7bae3457a1d6cf152676656cff`. This older runtime is NOT the current GitHub main and has NOT been upgraded.
- Encrypted production SQL backup and successful actual isolated official Supabase PG17 transactional restoration: owner-gated GitHub run [#43754997641](https://github.com/ishinaillab/ishikeit/actions/runs/43754997641). It is a SQL backup, not a complete all-provider, Storage and external configuration backup.
- Native account runtime integration [PR #304](https://github.com/ishinaillab/ishikeit/pull/304) is a **draft**, unmerged and not consented or live-accepted. Preserve the seven original Windows canonical unpublished edits, live legacy messaging, owner MFA and five scheduled tasks. Never submit Meta App Review while owner hold #169 is active.

## Controller boundary (code staged for review only)

`.github/workflows/priority3-protected-hostinger-release.yml` is **manual only**, on protected app `main`, with SHA-exact protected dual-repository check, strict trusted GitHub CI/rules/environment readback, two separate owner-approved environments, shared privileged-release workflow concurrency (never cancel active deployment), and no repo/production secrets in the first owner gate.

`scripts/priority3-protected-hostinger-release.mjs` requires:
1. The original deployed Hostinger UUID/SHA pair from authoritative live readback; the latest stored Node.js framework, entry point, build script and package manager must still be the reviewed Fastify/Node24/npm configuration.
2. The official Git **source owner/repository/branch** is exactly `ishinaillab/ishikeit/main` on both previous and new build records. Refuse a same-SHA archive, unrelated repository or other branch. GitHub both protected HEADs must remain exact.
3. A genuine authenticated Hostinger GET `/git/auto-deployments/settings` returns 404 (disabled) before admitting release. 200, 401, 403, network errors, redirects and ambiguous responses fail closed; null metadata from an aggregate MCP result is insufficient to prove this.
4. **Preflight is strictly non-mutating:** it uses PostgreSQL `SELECT` only, checks that no active lease or unresolved external step blocks future release, rechecks approved GitHub heads and the old hosted build, and does not dispatch Hostinger or reserve a lease. A preflight result is a snapshot, **not ownership**. Only `deploy` acquires the exclusive 256-bit random-holder SHA-256 digest CAS lease on the exact app/DB SHAs. Lease generation increases monotonically. Before even trying the Hostinger POST, it persists `pending_external_step='app_deploy'`. Pending uncertainty blocks subsequent lease acquisition even after expiry.
5. Official Hostinger Node.js build request uses only `source_type=git`, known installation UUID, owner, repository and protected main branch; it does **not** replace the 59 existing runtime environment variables. Hostinger build UUID, exact SHA, source Git provenance, final latest build, live and ready HTTP health, saved settings and disabled auto-deploy must independently pass before the pending step is cleared.
6. On provider timeout, failed build, SHA mismatch, lease loss, or health failure, retain the durable pending hold. Manual `reconcile` mode can clear it **only after** a separately owner-approved workflow proves exact committed and healthy hosted source and expired ownership.

Sources: [Hostinger official API reference](https://developers.hostinger.com/), [Hostinger official SDK API endpoints](https://github.com/hostinger/api-python-sdk), [GitHub secure use reference](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions), and [PostgreSQL advisory/transactional locking](https://www.postgresql.org/docs/17/explicit-locking.html).

## Tested evidence and remaining blockers

The independent review clone `D:\projects\openai\ishikeit\ishikeit-priority3-hostinger-controller-audit-20261117` passed **40/40** offline positive/negative Node tests, real synthetic PostgreSQL17 CAS and expired pending-step reconciliation integration, and upstream Actionlint for controller/CI workflows. The original separate unfinished developer review worktree was NOT edited. GitHub-hosted CI for this new exact source tree, protected branch publication and live secret-backed Hostinger preflight have NOT yet run.

**Do not claim release ownership universally enforced:** this controller fences its own privileged workflow and PostgreSQL state but cannot stop unrelated Hostinger admin UI/API actions, manual Supabase SQL, privileged GitHub merges or legacy auto-deploy hooks. These bypass routes require external permissions, verified provider webhooks and owner operational policy. Hostinger Git provider connected status in hPanel has previously been inconsistent; the Hostinger API token `ISHIKEIT_HOSTINGER_API_TOKEN` presence in the protected GitHub environment is NOT yet verified. Do not run `deploy` until both readbacks pass and actual app code/runtime PR is separately accepted.

The narrower next deliverables are code review/CI for this controller, verifying the Hostinger token and external auto-deploy state, a non-mutating manually approved `preflight`, then explicit protected `deploy` and exact production commit/health acceptance. Independent genuine owner-provider OAuth grants and live active-account disconnect safety acceptance follow; zero live native accounts makes those claims impossible today.
