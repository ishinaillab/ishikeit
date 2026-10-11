# WordPress recovery and staging runbook — 2026-10-11

Scope: www.ishinaillab.com WordPress on Hostinger Business; apps.ishinaillab.com/Ishikeit and Supabase are separate systems.

## Completed recovery snapshots

- **Current UpdraftPlus:** Oct 11, 11:29 AM Asia/Manila, identifier 38f852af2c1e, seven parts totaling 1,066,988,386 compressed bytes. Full database, plugins, themes, uploads (two parts), other wp-content and must-use plugins. Server-side archive checks and SHA-256 manifest verified all seven expected parts and all four installed ThemeREX security MU files byte-for-byte against archived entries.
- **Original rollback:** Oct 11, 04:07 AM, identifier cc81aaf5964e, seven parts totaling 1,087,163,068 bytes. Old seven-part set still exists separately.
- **Core and configuration supplement:** Private archive under /home/u328762438/ishi-secure-backups/2026-10-11/wordpress-root-core-config-postguards-20261011c.zip. Archive includes wp-admin, wp-includes, WordPress root files and wp-config.php. One-shot archive consistency and live wp-config SHA comparison returned ISHI_WORDPRESS_CORE_CONFIG_BACKUP_VERIFIED. The backup includes sensitive secrets: **never place it in a public directory, public source-control repository, chat transcript or unauthenticated download link**.
- Private checksum evidence (not published): updraft-postguards-20261011b-integrity.json and wordpress-root-core-config-20261011c-integrity.json, both outside public_html.
- **Not complete:** no independent off-server copy or restoration test. Do not advertise these as independently disaster-recovery-tested. Platform-level Hostinger settings and Ishikeit Node runtime secrets are not completely captured by the WordPress snapshots.

## Verified infrastructure constraints

- Account is Hostinger Business v3. Official Hostinger WordPress staging is available in hPanel via Websites → Dashboard → WordPress → Staging; connected Hostinger MCP does not offer a staging creation operation. **No staging was created.**
- Hostinger TCP port 65002 at the previously confirmed origin 147.93.78.149 is reachable from the authorized Windows desktop. This computer does not have a pinned SSH host identity or configured login private key for that destination. **No authenticated transfer attempted.** Verify SSH host fingerprints and authorization through Hostinger before transferring backup secrets.
- Cloudflare R2 is not enabled; do not enroll in a billable provider or put private customer databases in GitHub/Supabase without explicit storage, security and privacy review.

## Safe next actions in Hostinger hPanel

1. Connect an authenticated, trusted off-server backup destination through hPanel's approved backup/SFTP path. Keep encrypted copies of BOTH current Updraft archives and the sensitive core/config supplemental snapshot. Verify SHA-256 after transfer and test the complete restore.
2. Create protected, isolated WordPress staging under the Business hosting plan. Configure private origin and edge access BEFORE publishing staging, and ensure a separate DB and DNS A record at Cloudflare when required by external DNS.
3. Before the staging clone can process traffic, disable outgoing email, LatePoint confirmations, production WooCommerce gateways and captures, Meta/TikTok/Telegram and Ishikeit webhook/message sending, WP-Cron and all third-party notifications. Replace production credentials with test/sandbox secrets. Never use a clone with live payment or messaging credentials on the public Internet.
4. Restore the **new** Updraft database/wp-content plus private core/config supplemental snapshot into staging, then use WordPress serialized-aware URL rewriting for the staging host. Run WP core checksums, validate backup hashes, MU guard files and locked Ishi plugins. Do not click Hostinger **Publish Staging**: it overwrites production files and database.
5. Test a synthetic LatePoint 180-minute appointment (including overlapping-slot refusal and the ₱299 fee), WooCommerce sandbox checkout/order, Elementor admin preset save, Contact Form 7 test mailbox, logged-in unified customer dashboard and isolated Ishikeit webhook/message flows. Use synthetic identities and no real customer recipients or charges.
6. Only after staging success, update original ThemeREX Addons from an authenticated official 2.47.0-or-later package/diff, and validate both CVE-2026-102797 SSRF and CVE-2026-102798 stored XSS using safe controlled evidence. Current locally developed MU defenses are NOT official vendor equivalent or proof both vulnerabilities are eliminated.
7. Independently obtain authenticated Elementor Pro 4.3.1 and LatePoint Pro Features 1.7.3 packages and test staging first. Never install nulled packages or modify the three protected Ishi plugins without approval. Re-enable LiteSpeed caching ONLY after a repeatable test demonstrates stale canonical HTML and missing aggregate CSS/JS bugs are solved.

## Production read-only evidence

- LatePoint: one active Appointment Reservation service, 180 minutes and ₱299, one agent and location. Oct 12/13 availability queries returned ten 180-minute slots per day. 8 AM, 11 AM and 5 PM starts were available Oct 12; note that 5 PM to 8 PM may need a separate opening-hours decision. Nothing was booked.
- WordPress and WooCommerce Store API: HTTP 200; four publicly listed products. No orders or charges created.
- Six-page frontend audit: 171/171 CSS/JS/image assets loaded, no stale Elementor local-font CSS links.
- The original 2.45.0 ThemeREX vendor source and locked Ishi customer/booking plugins were not changed by the backup workflow. LiteSpeed Cache remains deliberately inactive pending correct invalidation.
- Backup and staging tool limitations are documented, not claimed resolved.

## References

Hostinger staging: https://www.hostinger.com/support/5720286-how-to-create-a-wordpress-staging-environment-in-hostinger/

Hostinger SSH: https://www.hostinger.com/support/1583245-how-to-connect-to-a-hosting-plan-via-ssh-in-hostinger/

Hostinger backup downloads: https://www.hostinger.com/support/5981435-how-to-download-backups-at-hostinger/

Patchstack SSRF: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-server-side-request-forgery-ssrf-vulnerability

Patchstack stored XSS: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-cross-site-scripting-xss-vulnerability

Full history: [HOSTINGER_WORDPRESS_SECURITY_CHECKPOINT_2026-10-11.md](HOSTINGER_WORDPRESS_SECURITY_CHECKPOINT_2026-10-11.md)
