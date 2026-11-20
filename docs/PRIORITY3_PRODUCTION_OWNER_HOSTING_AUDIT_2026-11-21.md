# Priority 3 production owner and hosting readiness audit — 2026-11-21 (Asia/Manila)

**READBACK / RECOVERY AUDIT ONLY. NOT a protected production acceptance or authority to clear GitHub #284 HOLD.** This note records authenticated account settings inspected via Ishi Local Agent desktop and connected GitHub, Hostinger and Supabase APIs. It contains no tokens, credentials, TOTP codes, card numbers or customer data.

## Actual owner-authenticated GitHub settings

- GitHub owner `ishinaillab` completed GitHub Mobile sudo/step-up on the existing signed-in Chrome profile. Both `ishinaillab/ishikeit` and `ishinaillab/ishikeit-db` display **0 direct collaborators**. GitHub Apps and other automation grants remain independent potential writers.
- Application `ishikeit-priority3-production` and `ishikeit-provisioning` environments and DB `ishikeit-priority3-migrations` environment require `ishinaillab` reviewer, allow self-review for the only owner, restrict deploy to `main`, and have administrator protection bypass unchecked. The two repositories' rulesets require CI and have no configured bypass actors.
- Production and DB migration environments have **0 secrets / 0 variables**. Application `ishikeit-provisioning` has 3 secret names: `ISHIKEIT_DATABASE_URL`, `ISHIKEIT_SUPABASE_MANAGEMENT_AUTH_READ_TOKEN`, `ISHIKEIT_SUPABASE_SECRET_KEY`, plus 5 ordinary variables. **`ISHIKEIT_HOSTINGER_API_TOKEN` is absent**, making the staged protected Hostinger deploy job fail closed. Application repository has 0 repo-wide Actions secrets. DB repo has 0 repo/environment Actions secrets. Existing secret values were never accessed.
- Both draft runtime PR #304 (head `86f31e69538fa5bc06248b53427a478cabee6782`) and Hostinger controller PR #305 (head `c466e2f0e47bfd58b42e643bc37daa19dce1c52e`) remain open/unmerged; no in-progress Actions jobs were observed in either repo during this audit.

## Exact owner-approved GitHub App privilege reductions (performed and independently read back)

- Owner GitHub Hostinger App installation `182475447` was reduced from **all repositories** to **only `ishinaillab/ishikeit`**. It no longer appears in the database repo's installed Apps list. App repo retains Hostinger.
- Owner GitHub Supabase App installation `166190251` was reduced from **all repositories** to **only `ishinaillab/ishikeit-db`**. It no longer appears in the runtime app's installed Apps list. DB repo retains Supabase. Verified current active Supabase project `vhmrliqemkfxblzsoyaz` still connects to `ishinaillab/ishikeit-db` and **Deploy to production is OFF**, both after change. A second inactive project has no GitHub link.
- ChatGPT Codex Connector and Claude Apps still have broad code/workflow permissions. Their other-project usage means no safe basis to revoke globally. This and unverified independent release processors mean **exclusive external release ownership is NOT proved**.

## Hostinger exact website/readiness and unexpected outage recovery

- Hostinger owner hPanel `apps.ishinaillab.com` Deployments and Dashboard say **Git provider is not connected**; Redeploy is disabled. Account's two websites have no Hostinger website Git repositories. DO NOT connect Git until automatic deployment is proved off and protected controller acceptance is ready; connecting can create a bypass.
- Existing deployment `fdec3d488fb69f7bae3457a1d6cf152676656cff`, UUID `01a1d96f-bc54-70a0-ae01-504fa9a27c72`, remains completed and unchanged.
- Earlier on **2026-11-21** the Hostinger Business order `1009133507` returned `suspended` and both sites `is_enabled=false`. HPanel warned expired Business plan and a December 11 renewal deadline; public Ishikeit `/health/live` and `/health/ready` returned **Cloudflare HTTP 525**. The assistant investigated but **did not submit renewal/payment**.
- During this same audit the account state changed independently: official Hostinger API now returns **active** and both websites **enabled**. Live cache-bypassed GET health returned **HTTP 200**, bodies `{"status":"ok"}` / `{"status":"ready"}`, with `CF-Cache-Status: DYNAMIC`; main website also HTTP 200. Signed-in hPanel lists Business plan expiration **2026-12-20**. Cause and payer of the recovery were NOT established and must not be inferred as this agent's action.
- Renewal quote (inspected only before the externally observed restoration) was 1 month, **₱479.00 + ₱57.48 taxes = ₱536.48 total**; payment step required secure owner authentication. The assistant did **not** charge, renew or enter credentials.
- Account-level Hostinger API tokens: one active legacy non-expiring token shown as never used; left unchanged. Hostinger Connected Agents displays 45 **historical** API-agent entries, not 45 verified currently active sessions. This does not establish an exclusive Hostinger production deployment lease.
- Both Hostinger backup inventories displayed daily snapshot **2026-11-21 02:53**. Main `ishinaillab.com` has combined website+database backup download/restore controls; app `apps.ishinaillab.com` has separate files and database snapshot controls. Hostinger warns its backups exclude some backup-plugin archives, cache and DB-export files. **No file contents exported, no restore attempted, no independent backup-restore test performed**.

## Independent held state and release obligations

- Supabase active project retains **44** applied migrations and **zero** release ownership rows, owner-native connections and active disconnect cleanups. Native guard migration 45, protected Hostinger code and durable schema-lease controller are verified only in isolated local worktrees.
- Both protected branches' rulesets and GitHub environments are configured, but externally universal release ownership cannot be claimed while independent GitHub Apps, Hostinger admin APIs, manual tools, and potentially other developer sessions can mutate production outside the fenced controller.
- No app/DB GitHub push/merge, Supabase production SQL, deployment, provider-owner grant revocation or Meta App Review submission took place.
- Next safe order: identify and fence other developer/deployer actors; reconcile owner-controlled safe release publication of source-reviewed app and DB migrations; configure a **dedicated short-lived Hostinger protected secret** without exposing its token; prove Hostinger website Git/auto-deploy safety before linking; obtain actual protected GitHub CI and owner-environment approvals; apply migration 45 within its durable external-step lease; verify schema and trigger; then fenced Hostinger deployment and actual live provider-owner disconnect/revocation readback. No real provider-owner native account exists yet, so provider acceptance cannot be claimed.
- **GitHub issue #284 shared-write HOLD persists. Canonical original seven unpublished edits and all owner MFA must be preserved.** Continue isolated local-only development/notes until verified exclusive handoff and protected owner release approval.

This audit is **not** evidence of a successful live Priority 3 deployment.
