# Priority 3 — Hostinger provider-only protected preflight before database migration

**Scope: LOCAL/REVIEW ONLY.** Added on isolated branch `review/priority3-provider-preflight-20261121` based on clean `65f263d`. No application production release or Supabase DDL performed. Issue #284 shared-write/release ownership HOLD is not cleared by this work.

## Release admission gap and repair

The pre-existing Hostinger `preflight` required migration 45, so a live, owner-authenticated verification of Hostinger API token, Git installation, saved Node24/Fastify settings, disabled auto-deployment and existing deployed revision could not run before applying the additional production migration. This made migration a prerequisite for learning whether the Hostinger release provider was usable.

The new **`provider-preflight`** mode is available only through the same manually dispatched, main-only, first-attempt, owner-actor, **two independently required GitHub environments** (`ishikeit-priority3-production`, `ishikeit-provisioning`) as the existing operations. It verifies the same pinned app and DB HEADs, authenticated Hostinger disabled-auto-deployment proof, active owner GitHub installation access to `ishinaillab/ishikeit` main, saved Node24/Fastify build settings, current existing build UUID/commit/status/origin and /health/live and /health/ready; it repeats the provider and GitHub readbacks to detect drift.

This operation runs **before** `assertProtectedNativeSchema` and exits without any SQL read or write, PostgreSQL connection, release-lease acquisition or Hostinger build POST. `main()` does not validate/use the production database credential for this mode. The GitHub workflow injects a fixed nonsecret placeholder into `ISHIKEIT_DATABASE_URL` on this exact operation; schema-aware `preflight`, `deploy` and `reconcile` retain their existing database credential and require version 45 with a live enabled trigger. No provider-only execution can bypass the schema requirement on deployment.

The provider-only preflight still requires the protected Hostinger API token and a true authenticated GET of the site's Git auto-deployment settings via the Hostinger release controller. It cannot be replaced by aggregate `gitAutoDeployment:null` or a disconnected Git-provider UI.

## Test evidence

- Focused Node24 controller and GitHub workflow mutation tests: **66/66 PASS**, including 44-migration provider-only execution, zero SQL/lease/POST, double provider readbacks, revoked owner installation, auto-deploy unexpectedly enabled, build identity/health errors, and database-secret masking.
- Full disposable Node24 + PostgreSQL17 Docker Compose regression: **132/132 Vitest files and 1,066/1,066 tests PASS**; ESLint, TypeScript typecheck and production build PASS; tests container **exit code 0**.
- Upstream cached Actionlint validates protected Hostinger release and CI YAML: **exit 0**, no errors.
- The disposable Docker Compose project's containers, volume and network were removed and independently verified absent; temporary stdout/stderr test logs removed.
- This **does not** yet prove the Hostinger production API credentials, site installation, current provider health or release actor; those need a live manual dispatch on protected main after review publication/approval.

## External evidence and remaining release hold

On 2026-11-21 the owner-directed Hostinger integration accepted a domain-scoped `hosting_git_delete-auto-deployment-settings` operation for `apps.ishinaillab.com`. Separate readback continued to show previous build `fdec3d488fb69f7bae3457a1d6cf152676656cff` completed, aggregate `gitAutoDeployment:null`, an empty website Git-repositories list and both service health endpoints HTTP 200. **This is not a substitute for the controller's authenticated exact GET verification.**

Owner-authenticated GitHub installed-App audit shows ChatGPT Codex Connector and Claude GitHub Apps with all-repository write scopes; Hostinger installation is narrowed to one app repository and Supabase to the DB repository. Codex and Claude also have GitHub user authorizations. This proves other principals *could* have write permission, **not** that they are currently writing. Their permissions were not revoked or modified because the account also uses 41 other repositories and a temporary global suspension or incomplete allowlist would disrupt unrelated work; zero release-owner uniqueness is not claimed.

Supabase project `vhmrliqemkfxblzsoyaz` stays on **44 migrations**, with zero native connections, zero lease rows and no native disconnect cleanup at last authenticated readback; GitHub integration's **Deploy to production** setting was observed disabled. The new provider-only operation is still unpublished locally; protected app PR #306 and DB PR #25 remain draft, unmerged. No hosted SQL mutation, runtime deployment, live provider OAuth/revoke/disconnect acceptance or Meta App Review submission was performed. Preserve owner's existing MFA, original seven unpublished canonical files and live legacy messaging.

**Priority 3 remains IN PROGRESS.** Release may proceed only after a verified exclusive owner handoff, protected main CI, owner-controlled manual workflow approvals, live provider-only readback, schema 45 + trigger acceptance, final runtime deploy and real provider-owner disconnect/readback canaries.
