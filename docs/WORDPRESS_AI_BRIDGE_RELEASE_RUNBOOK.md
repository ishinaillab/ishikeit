# Production Ishi AI Bridge v0.3.1 rollout and rollback

**Status: INSTALLED AND VERIFIED (2026-10-25).** The site owner installed the
v0.3.1 ZIP in WordPress. Independent authenticated WordPress CLI confirmed
`ishi-ai-bridge` **active v0.3.1** at `www.ishinaillab.com`, storage schema
`1.1.1`, and working WordPress cron. A fresh post-upgrade Instagram tester
message was processed, published through Meta, correlated to its matching
provider message echo, and **confirmed received in the tester's inbox**.
This is a historical installation/rollback runbook, not an instruction to
reinstall or redeploy the plugin. Historical October 20 origin-502 root
cause is **not** proven or fixed by this release.

## Preconditions: all required

1. Authorized Hostinger hPanel or WordPress administrator **interactive**
   access. A connected ChatGPT WordPress content API is not an installer;
   do not substitute PHP snippets, database queries, or an arbitrary update URL.
2. An immediately recoverable **current** copy of the seven installed plugin
   PHP files, and a **fresh** full files/database backup of production. Confirm
   completion, download off-server, test ZIP/gzip archive integrity, retain
   integrity hashes in private release notes, and confirm restore access.
   Older October 12 archives were CRC-tested but cannot prove the current
   October 24 file/database state. **Do not store database or WP configuration
   backups in the GitHub repository or under public_html.**
3. A maintenance window and authorized test accounts for each active messaging
   provider. Confirm Ishikeit /health/ready is ready, no unresolved in-flight
   inbound jobs, and record queue counts before the change. Never replay the
   43 historical dead-lettered records.
4. Confirm the prebuilt v0.3.1 ZIP contains only the plugin root
   `ishi-ai-bridge/` with the exact seven PHP files and has a passing SHA-256
   entry in the release manifest. Do not use unreviewed archives.

## Back up safely (before installing)

**Hostinger:** Open hPanel → Websites → Dashboard for `ishinaillab.com`
→ Backups. On a plan with **Create Backup**, run and verify a new hosting
**files + databases** snapshot. Hostinger currently documents manual Create
Backup for Business or higher plans; the site's actual plan/availability has
not been verified. Separately download the current plugin directory archive
and latest database backup to private off-server storage. If the available
backup is stale, partial, or fails a restore/integrity check, **STOP**.

Keep an independent copy of the **live** folder
`wp-content/plugins/ishi-ai-bridge/` before replacement. The ZIP named
`ishi-ai-bridge-0.3.0-repository-baseline-rollback.zip` is not proven
byte-identical to the currently installed folder and must **not** replace a
genuine production snapshot as the rollback source.

Official Hostinger references:
- Create new backup: https://www.hostinger.com/support/2298928-how-to-create-backups-at-hostinger/
- Download backups: https://www.hostinger.com/support/5981435-how-to-download-backups-at-hostinger/
- Recover files/database: https://www.hostinger.com/support/4283700-how-to-restore-backups-at-hostinger/

## Stage the release ZIP

Review GitHub Actions **Ishi AI Bridge release bundles**, successful run:
https://github.com/ishinaillab/ishikeit/actions/runs/40048136724

Artifact: `ishi-ai-bridge-versioned-bundles`
(original artifact ID `12541698277`; retention ends 2027-01-22 UTC).
The artifact contains:
- `ishi-ai-bridge-0.3.1.zip` — reviewed install candidate.
- `ishi-ai-bridge-0.3.0-repository-baseline-rollback.zip` — **historical
  code baseline, NOT verified production rollback**.
- `SHA256SUMS.txt`, `ROLLBACK_README.txt`.

Verify the install ZIP checksum against the manifest and ensure its internal
top-level folder is `ishi-ai-bridge/`. No customer records, credentials,
.env files, or database contents belong in the install ZIP.

## Install only after all gates are green

The recommended WordPress-supported interactive path is:
WordPress Dashboard → Plugins → Add New → Upload Plugin → select the verified
`ishi-ai-bridge-0.3.1.zip` → Install Now → on the existing-plugin screen,
review the old/new versions and choose **Replace current with uploaded**.
Confirm the original custom plugin remains **active**. Do not delete/deactivate
or reinstall other plugins, especially Elementor/ThemeREX/LatePoint.

For a genuinely failed WordPress ZIP installer, stop and use the supported
Hostinger File Manager/SFTP workflow only with a recoverable current-folder
backup and reviewed folder paths; never extract a duplicate nested
`ishi-ai-bridge/ishi-ai-bridge/` directory. Do not assume file replacement
is atomic or that a successful ZIP upload proves the version is active.

Official WordPress plugin installation reference:
https://wordpress.org/documentation/article/manage-plugins/

## Readback/canary after install

1. WordPress plugin readback: exact slug `ishi-ai-bridge`, **active v0.3.1**.
2. Recheck site health, PHP error log (no new fatals) and
   `https://apps.ishinaillab.com/health/ready` (status `ready`).
3. From the existing **trusted Hostinger runtime** with dedicated environment
   secrets already available, run `node scripts/probe-wordpress-ai-bridge.mjs`.
   It exclusively performs bearer-authenticated `GET
   https://www.ishinaillab.com/wp-json/ishi-ai/v1/health`. Expect
   `ok:true`, `bridgeVersion:0.3.1`, `schemaVersion:1.1.1`,
   `tokenReady:true` and `aiEngineReady:true`. Do not paste credentials
   into ChatGPT or GitHub; normal WordPress admin authentication is **not**
   the bridge's independent bearer authentication. The health probe does **not**
   prove a successful chatbot generation or provider delivery.
4. With expressly authorized tester identities, run one-by-one *new* inbound
   event → durable storage → AI Bridge → outbox publish → outbound delivery
   canaries for Messenger, Instagram, WhatsApp and Telegram as applicable.
   Check idempotency and rate-limit/expiration behavior. No synthetic customer
   replays or modifications of historical dead letters.
5. Capture non-secret release evidence and note any future
   `[Ishi AI Bridge] ai_query_failed category=<fixed_enum> ref=<hash>`
   diagnostics. Never log provider exception messages, request bodies, tokens
   or user data.

## Rollback decision and scope

If a plugin fatal/error or test-account regression is attributable to the
upgrade, **stop provider canaries immediately**. Recover **only the plugin
folder** from the current production backup (using the same reviewed
WordPress ZIP replacement mechanism or Hostinger File Manager restore,
depending on administrative availability). Verify v0.3.0 active and rerun
health checks and test-account messaging before announcing recovery.

**Do not restore the whole WordPress database reflexively:** restoring a
snapshot indiscriminately can erase valid newer WooCommerce orders, LatePoint
bookings, customer data and messages. Database restore is a separate
high-impact recovery decision requiring fresh evidence of damaged DB state
and a data-preserving reconciliation plan. Do not touch Cloudflare DNS/TLS,
live provider credentials or TikTok app permissions during this rollout.

## Actual live status and remaining verification gates (October 25, 2026)

**VERIFIED:** The user completed WordPress ZIP replacement; independent WPVibe WordPress readback confirms Ishi AI Bridge **v0.3.1 active** and storage schema **1.1.1**. WordPress cron succeeded. Ishikeit's public `/health/ready` returned `{"status":"ready"}`, and AI Engine MCP ping succeeded. A fresh, owner-authorized Instagram tester message was **processed/handled**, and its outbound `action.dispatch` was published; the provider resource ID matched Meta's subsequent Instagram message echo, followed by explicit user confirmation that `povnailstudio.ph` received the reply. No new pending queue entries or newly dead-lettered canary actions were observed.

**STILL UNVERIFIED:** The dedicated authenticated Bridge health probe has not run from the trusted production runtime with its distinct `ISHI_AI_BRIDGE_TOKEN` (Hostinger masks production secret values). Other live channels have not yet completed separate after-upgrade canaries. A current **full website files + database backup**, independently downloaded and restore-verified after installation, has not been confirmed. Older October 12 UpdraftPlus archives are not a substitute. Do not infer that the upgrade retroactively fixes the October 20 origin/AI failure or makes historic dead letters safe to replay.

**Rollback scope:** Only if an observed regression attributable to v0.3.1 warrants rollback, follow the plugin-only recovery plan above and preserve all intervening LatePoint bookings, WooCommerce orders, and customer messages. Do not blindly restore an old database.

**Related code:** Draft PR #80 proposes default-off bounded retries for transient WordPress AI Bridge HTTP outages. It remains deliberately unmerged/inactive pending a human-handoff and delayed-reply policy plus controlled testing. This release confirmation does not authorize enabling that retry flag.
