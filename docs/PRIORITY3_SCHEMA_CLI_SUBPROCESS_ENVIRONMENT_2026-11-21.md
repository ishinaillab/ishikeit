# Priority 3 — protected Supabase CLI child process environment hardening

**2026-11-21, LOCAL/ISOLATED ONLY.** Review worktree `D:\projects\openai\ishikeit\ishikeit-priority3-schema-cli-env-20261121`, branch `review/priority3-schema-cli-env-20261121`, based on clean tested app checkpoint `83502f1`. GitHub issue #284 shared-write HOLD remains in effect. This checkpoint is not production release approval.

## Security finding and repair

The owner-only `scripts/priority3-protected-schema-lease.mjs` previously launched `supabase db push` with `env:{...process.env,PGSSLMODE:"require"}`, so the subprocess inherited unrelated parent credentials such as the GitHub readback credential, future Hostinger release token, and any ambient Supabase access token or session secrets. This is unnecessary for explicit `--remote=<postgres-url>` CLI pushes and increases secret exposure if a child runtime is compromised.

The reviewed, limited change:

- Introduces `migrationCliEnvironment(parent)` to preserve a small set of standard executable, home, temporary-file, locale, certificate and CI environment variables; always forces `PGSSLMODE=require`.
- Changes `pushReviewedMigration` to pass only that environment into the CLI. The CLI still receives the specific database connection URL via explicit `--remote=<url>`, which is unavoidable in this currently approved CLI interface; process argument exposure is **not** eliminated or claimed resolved.
- Adds an optional subprocess injection for deterministic tests. Default behavior remains the genuine `spawn("supabase",...)` with shell disabled, stdout/stderr ignored, pre-existing 14-minute abort signal and exact `--yes --skip-vault --remote=<url>` flags. No permissions, SQL, Hostinger API calls or application routing were changed.
- Adds fail-closed mock tests for child environment boundaries, enforced TLS mode and unknown/non-zero CLI exits.

The official Supabase CLI v3 documentation confirms `--remote=<url>` as the current recommended explicit target; `--db-url` is deprecated. See https://supabase.com/docs/guides/local-development/cli/migrating-to-v3 and https://supabase.com/docs/reference/cli/supabase-feedback .

## Local reproducible acceptance

- Docker `node:24-bookworm-slim`, schema controller + protected schema workflow negative tests: **42/42 PASS**.
- Full disposable Docker Compose Node24 + PostgreSQL17 CI equivalent (the second run, after fixing an ESLint-only test callback): **ESLint PASS**, TypeScript typecheck **PASS**, **132/132 Vitest files, 1,066/1,066 tests PASS**, production TypeScript build **PASS**, tests container **exit code 0**.
- Initial combined test fixture failure omitted the protected YAML fixture; corrected and reran all focused 42/42 tests. Initial full Docker attempt detected `queueMicrotask` as ESLint-undefined in the new test fixture; corrected to `process.nextTick` and reran the entire suite successfully. Neither issue was a production defect.
- Disposable projects `ishikeit-p3-schema-env-full-20261121` and `ishikeit-p3-schema-env-full2-20261121` were shut down. The second project's Compose containers, volume and network were independently verified absent. Temporary test logs were removed from the isolated worktree.
- Existing canonical repo with seven unpublished edits and prior review worktrees were not modified. No production migration, provider revocation, Hostinger build, GitHub main merge or Meta App Review submission was performed.

## External blockers independently observed this session

- Hostinger `apps.ishinaillab.com` Node deployment UI still displayed **Git provider is not connected**, and its GitHub connection path immediately led to **Select Git repository to import**. No repository was selected because import can affect the live deployment. Hostinger readback of `gitAutoDeployment:null` is insufficient proof of the required exact site-level disabled auto-deploy settings; the exact GET operation is not exposed through the official connected Hostinger MCP.
- Owner GitHub installed-application administration required a new sudo-mode owner-MFA confirmation. No MFA code was requested, intercepted or bypassed; the audit cannot prove other Codex/Claude or other principals have relinquished writer access.
- App draft PR #306 and database draft PR #25 had previously passed GitHub-hosted CI, but this *new local hardening change* is not in either PR or production CI. Shared-write release coordination issue #284 remains HOLD.
- The owner-configured GitHub environment secret `ISHIKEIT_HOSTINGER_API_TOKEN` was verified present earlier today, but no secret plaintext was read and no successful authenticated Hostinger release-controller preflight is claimed.
- Genuine owner-provider native OAuth/revocation/readback and live active disconnect acceptance remain unverified because production native account connections were zero at last readback.

**Priority 3 remains IN PROGRESS.** For a safe release, independently verify externally exclusive owner handoff, protected branch head and CI, the website's exact authenticated Git/auto-deployment state, protected schema migration to version 45, protected runtime deployment and real provider-owner disconnect/revocation outcomes. Never treat a local passing test or a GitHub environment secret's presence as these external proofs.
