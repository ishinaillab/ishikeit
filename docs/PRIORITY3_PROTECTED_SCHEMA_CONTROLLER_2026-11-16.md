# Priority 3: protected schema release acceptance (2026-11-16)

**Status: review only; no production schema migration, Hostinger deployment or provider channel activation occurred.**

## Enforced source and approval boundaries

- Both GitHub repositories have owner-authorized zero-code-review solo-maintainer rules while retaining pull requests, GitHub Actions source-pinned strict checks, no force pushes or deletions, and review-thread resolution. Existing protected deployment environments require separate real owner approvals.
- The manually dispatched `priority3-protected-schema-release.yml` only runs on the exact application `main` SHA matching input, with an exact protected database `main` SHA. Both repository rules, environments and SHAs are checked twice, including after owner approval. There is an exclusive GitHub Actions concurrency group for this controller.
- First protected job uses `ishikeit-priority3-production` and has no database secrets. Second job uses `ishikeit-provisioning`, which already contains the secret `ISHIKEIT_DATABASE_URL`. It requires another GitHub environment approval before the secret is available.
- The target project must be `vhmrliqemkfxblzsoyaz`. Versioned migration history must match the exact 39 existing applied versions plus five new versions: `20261115013500`, `20261115021500`, `20261115030147`, `20261115040000` and `20261115040500`.
- `preflight` is read-only. `apply` requires protected approvals and uses the *pinned* Supabase CLI **v3.1.0** with explicit `--remote=<url> --yes --skip-vault`; `verify` checks the full 44-entry database history. Vault secrets, roles and seed data are excluded. Always include `--skip-vault`: Supabase CLI v3's `db push` can otherwise synchronize Vault secrets **before migrations**. Official CLI v3 breaking change: https://supabase.com/changelog/supabase-cli-v3. Reference: https://supabase.com/docs/reference/cli/introduction.
- `node --test scripts/test-priority3-protected-schema-workflow.mjs` is mandatory in app CI, with deliberate negative mutations for missing owner/environment gates, Vault suppression, wrong project identity, seed/role inclusion, and bypass triggers. Official upstream Actionlint must also succeed.

## Limits that remain external

This protected GitHub workflow is a *candidate* release controller and **does not guarantee exclusive ownership across direct GitHub admin merges, Supabase SQL editor/MCP migrations, or Hostinger manual/automatic builds**. No single GitHub Actions concurrency group can independently deny these out-of-band paths. Before a production release, the production backup/restore, no-bypass deployment flow, stateful release lease integration and genuine provider-owner consents/readbacks must be accepted. The 2026-11-15 GitHub coordination hold in issue #284 and Meta App Review NO SUBMISSION hold #169 are not bypassed by this workflow.

The actual first protected owner approval and second database environment approval have not been carried out for an `apply` run. Do not claim Priority 3 complete from passing CI or static release workflow tests. Preserve live legacy messaging and seven canonical unpublished local changes.
