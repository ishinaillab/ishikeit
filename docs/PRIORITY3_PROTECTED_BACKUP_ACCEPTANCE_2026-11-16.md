# Ishikeit Priority 3 — encrypted recovery and restore acceptance

Date: 2026-11-16, Asia/Manila. **Review and synthetic test only. No production database backup has yet been created or restored.**

## Owner-controlled recovery material

- Official `age` 1.3.2 verified via Windows winget package SHA256. Dedicated hybrid post-quantum (ML-KEM-768 + X25519) identity generated under `D:\projects\openai\ishikeit\priority3-recovery\owner-identity.txt`, stored only on the owner's Windows computer. No private identity, password or sensitive database content is checked into source control, logged in CI, or sent to ChatGPT.
- That directory is restricted to the owner and Windows SYSTEM, on D: with BitLocker encryption *on*, 100% encrypted, auto-unlock disabled. The public **recipient only** is tracked at `docs/ISHIKEIT_PRIORITY3_BACKUP_PUBLIC_RECIPIENT.txt`.
- **Independent disaster recovery is not yet proven:** private key presently exists on the same owner machine. Separate offline, securely protected custody and a test from that independent copy are still required before claiming robust off-site recovery.

## Verified synthetic end-to-end test

A disposable synthetic five-file roles/schema/data/manifest/release-identity bundle was archived, encrypted to the dedicated public recipient, decrypted with the actual private identity without displaying the key, extracted, and every source/recovered file SHA256 was compared. Recovered SQL was applied to a fresh isolated Docker PostgreSQL 17 database, and a unique synthetic test row was read back successfully. The database container was removed. **Outcome: PASS.** This is evidence for the backup *mechanism* and key, not evidence that customer data or the production Supabase project has been recovered.

## Protected GitHub workflow requirements

- `priority3-protected-database-backup.yml` is manual-dispatch only from protected application `main` for an exact approved application/database SHA pair.
- First GitHub owner-approved production environment has no DB secret. Second owner-approved `ishikeit-provisioning` environment scopes the existing `ISHIKEIT_DATABASE_URL` secret.
- It performs Supabase CLI **v3.1.0** roles, schema, and data exports using official Supabase filters. Before uploading, the entire archive is encrypted via verified official age Linux v1.3.2, whose SHA256 was checked against the downloaded upstream release. Only an `.age` ciphertext file is uploaded as an artifact for seven days. No plaintext artifact, no data in logs and no database writes are intended.
- CI must run `node --test scripts/test-priority3-protected-database-backup.mjs`, including 14 deliberate failure mutations; both GitHub workflows are linted by upstream Actionlint before review.
- The encrypted artifact **must be collected**, hash-verified and independently decrypted by its owner, then SQL restore tested on a detached, isolated target before any production Priority 3 migration. Archive names, SHA manifest and release SHAs must match the approved source.

## Scope limitations and release gates

Supabase CLI filtered logical dumps exclude some managed schemas and do not capture the Storage object bytes, Auth provider settings or edge-function configuration. This does **not** constitute a complete Supabase project disaster-recovery backup. Restore testing must separately cover all relevant auth/session/MFA, storage, migrations, custom private schemas and application configuration, or document a real complete recovery route before protected deployment.

The production Supabase organization currently uses the Free plan, without automatically scheduled platform backups; the connected project was verified healthy, on PostgreSQL 17.6 with 39 applied migrations and five pending Priority 3 versions. Live backups, protected migration/release approvals, Hostinger rollout and provider-owner account acceptance are **NOT DONE**. Respect the GitHub issue #284 release hold and Meta Review #169 no-submission instruction. Do not touch seven canonical unpublished Windows edits or live legacy customer messaging.
