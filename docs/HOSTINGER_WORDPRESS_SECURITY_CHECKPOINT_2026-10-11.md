# Hostinger / WordPress Security Checkpoint — 2026-10-11

This document is a durable continuation checkpoint for the live `ishinaillab.com` Hostinger/WordPress security and domain-migration work. It is intentionally stored on a non-production checkpoint branch. Do not deploy this branch merely to preserve the checkpoint.

## Scope and constraints

- Canonical application repositories remain:
  - `ishinaillab/ishikeit`
  - `ishinaillab/ishikeit-db`
- Do not use or revive the retired `/ishinaillab/ishi` project.
- Production WordPress host: Hostinger account/server `sg-nme-web1858`.
- Canonical website domain: `https://www.ishinaillab.com`.
- `apps.ishinaillab.com` remains a separate Hostinger application for Ishikeit.
- Preserve Zoho mail DNS and existing Meta/TikTok/other verification records.
- Do not modify the user's previously locked custom WordPress plugins unless explicitly authorized.
- Security remediation must not bypass software licensing or fabricate a valid purchase code. Only official/vendor-supported update sources are acceptable.
- Continue through ordinary timeouts; stop only for a real blocker, destructive/irreversible risk, required authorization, or an explicit user command to stop.

## Hostinger primary-domain migration — completed and verified

The former Hostinger WordPress website object was migrated from `povnailstudio.com` to `ishinaillab.com`.

Verified live state:

- Hostinger reported the website was successfully changed to `ishinaillab.com`.
- Hostinger filesystem now uses:
  - `~/domains/ishinaillab.com/public_html` for WordPress.
- The former `~/domains/povnailstudio.com` WordPress directory is gone.
- `apps.ishinaillab.com` remains a separate Hostinger application/site object.
- hPanel Websites list now contains the two intended site objects:
  - `ishinaillab.com`
  - `apps.ishinaillab.com`
- No residual `povnailstudio.com` site card or “domain not working” warning was visible after the migration.
- A fresh Hostinger website/database backup was created before migration on 2026-10-06 at approximately 08:36 local time.

## Canonical URL / redirect state — corrected

WordPress `home` and `siteurl` were found still set to the non-www apex after the Hostinger migration. They were corrected to:

- `https://www.ishinaillab.com`

Post-change verification:

- `https://ishinaillab.com/` -> single 301 to `https://www.ishinaillab.com/`.
- `https://www.ishinaillab.com/` -> 200.
- WordPress REST API on canonical host -> 200.
- `/wp-admin/` now redirects to the canonical `https://www.ishinaillab.com/wp-login.php`, eliminating the previous apex/login cross-host hop.
- Rendered homepage canonical URL points to `https://www.ishinaillab.com/`.
- WooCommerce redirect behavior is canonical:
  - `/my-account/` -> canonical `/login/`
  - empty `/checkout/` -> canonical `/cart/`
- Critical customer-facing pages were probed and returned normal 200/expected redirect behavior, including booking, dashboard/login, shop/cart/checkout, press-ons, Studio Policies, and Privacy Policy.
- Legacy domain redirect is healthy:
  - `https://povnailstudio.com/` -> 301 to `https://www.ishinaillab.com/`
  - `https://www.povnailstudio.com/` -> 301 to `https://www.ishinaillab.com/`

## WordPress integrity / stored URL audit

Verified:

- WordPress database check passed.
- WordPress core checksum verification passed.
- Current core update check showed no core integrity failure.
- Dry-run serialization-safe search/replace for `https://ishinaillab.com` -> `https://www.ishinaillab.com` found remaining apex occurrences only in historical LatePoint activity descriptions and AI Engine chat/log data. These were intentionally not mass-replaced.
- Dry-run search for remaining `povnailstudio.com` database replacements returned zero actionable occurrences after migration.
- Do not mass-rewrite historical log/activity text merely to remove old host strings.

## Cloudflare steady state — restored and verified

After Hostinger DNS validation temporarily exposed the origin, Cloudflare protection was restored.

Current intended/verified configuration:

- A records for:
  - `ishinaillab.com`
  - `www.ishinaillab.com`
  - `apps.ishinaillab.com`
  are proxied through Cloudflare.
- Origin IPv4 remains `147.93.78.149`.
- SSL/TLS mode: Full (strict).
- Minimum TLS: 1.2.
- TLS 1.3: enabled.
- Always Use HTTPS: enabled.
- DNSSEC: active.
- Origin HTTPS certificates were independently tested successfully using direct `--resolve` checks, so Full (strict) is not merely hiding an invalid origin certificate.
- Zoho MX and existing TXT/verification records were preserved.

## Ishikeit runtime — healthy after migration

Verified live:

- `https://apps.ishinaillab.com/health/live` -> `{"status":"ok"}`
- `https://apps.ishinaillab.com/health/ready` -> `{"status":"ready"}`
- Hostinger runtime environment contains the canonical WordPress bridge URL:
  - `WORDPRESS_AI_BRIDGE_URL=https://www.ishinaillab.com/wp-json/ishi-ai/v1`
- WordPress REST index exposes the Ishikeit bridge namespace on the canonical host.
- The WordPress bridge health endpoint responded successfully.
- No deployed `.env` file was found in the Hostinger Node build directory; Hostinger injects production environment values through its runtime environment.

## Easy MCP AI connector — server healthy, ChatGPT OAuth must be reauthorized

Server-side plugin state:

- `easy-mcp-ai` is active.
- Its canonical MCP resource now advertises the `www.ishinaillab.com` host.
- OAuth/site setup is complete.
- Easy MCP reports multiple registered clients, including the existing ChatGPT registration.

Important migration issue:

- ChatGPT's registered Easy MCP client currently has **0 active tokens**.
- ChatGPT-side Easy MCP calls fail even though the WordPress plugin and MCP endpoints are healthy.
- Easy MCP binds tokens/grants to the exact MCP resource URL. The domain/canonical-host move invalidated the old resource-bound authorization.
- The plugin's site-move logic classifies old-resource tokens as foreign/mismatched; automatic cleanup is not immediate for recently used tokens.
- Correct resolution is a fresh ChatGPT OAuth authorization to the canonical MCP resource. Do not manufacture or transplant tokens.
- This reauthorization remains pending because it requires the normal connector authorization flow.

## Qwery / ThemeREX supply-chain and vulnerability findings — current critical checkpoint

### Versions and current security advisories

Live WordPress currently uses:

- Qwery parent theme: **3.8.0**, active.
- ThemeREX Addons: **2.45.0**, active.
- WordPress does not currently offer an update for ThemeREX Addons through the ordinary plugin updater.
- Qwery/ThemeREX bundled-plugin update flow is therefore dependent on ThemeREX's supported updater/license path.

Current Patchstack advisories verified on 2026-10-11:

- ThemeREX Addons **<= 2.46.0** is vulnerable to SSRF, CVE-2026-102797, CVSS 6.4.
- ThemeREX Addons **<= 2.46.0** is vulnerable to stored/cross-site scripting, CVE-2026-102798, CVSS 6.5.
- Both are patched in **2.47.0**.
- Therefore the installed **2.45.0 remains vulnerable** to both newer Oct. 2 advisories, even though 2.45.0 had fixed earlier September issues.

The earlier high-severity ThemeREX issue CVE-2026-62105 (PHP Object Injection) affects versions < 2.45.0 and is already covered by 2.45.0; this does **not** make 2.45.0 current-safe because of the newer Oct. 2 issues.

### Official ThemeREX/Qwery update path

Current official Qwery documentation says:

- Use the **ThemeREX Updater** plugin for theme/bundled-plugin updates.
- Enter a legitimate Qwery/ThemeForest purchase code.
- Enable ThemeREX Updater's **Create backups** option before updating.
- Then use WordPress Dashboard > Updates / Active theme components to update the bundled plugin.
- If moving domains, disconnect the previous domain/license first and re-activate on the new domain using the real purchase code.
- Alternatively, replace/update the parent theme using the official ThemeForest package and then update/reinstall bundled plugins from that official package.
- Bundled plugins do not require their own separate plugin purchase code for functionality when provided with the theme; the theme purchase code is used for ThemeREX update access.

### Confirmed local supply-chain modification

A live scan discovered an unauthorized download override in:

- `wp-content/themes/qwery/includes/wp.php`

The modified branch hardcoded:

- `http://wordpressnull.org/qwery/plugins/{$plugin_file}`

for ThemeREX/bundled plugin installation, bypassing Qwery's built-in official ThemeREX upgrade route.

Evidence:

- The legitimate Qwery configuration also contains:
  - `theme_upgrade_url => //upgrade.themerex.net/`
- The `wordpressnull.org` branch was an explicit local override ahead of the normal official path.
- A full `wp-content` scan found that single `wordpressnull.org` reference.
- The unauthorized override has been removed/contained from the live file.
- A subsequent full `wp-content` grep returned no `wordpressnull.org` references.
- The pre-migration/full Hostinger backup remains available if rollback evidence is required.

After containment, retrying ThemeREX Updater correctly reached the official `upgrade.themerex.net` endpoint rather than `wordpressnull.org`.

### Qwery license/activation state is not legitimate

The official updater then failed with HTTP 422 because the updater request used a placeholder key.

Verified database state:

- WordPress option `purchase_code_qwery` is literally:
  - `purchase_code`
- This is a placeholder string, not a valid ThemeForest purchase code.
- The Theme Dashboard still displays Qwery as “Activated” and still associates that activation with the old `povnailstudio.com` domain.
- ThemeREX activation options include a locally stored activated state (for example `trx_addons_theme_qwery_activated = 1`).

Most importantly, direct live file inspection found the local ThemeREX Addons activation check has been modified:

- In `wp-content/plugins/trx_addons/components/theme-panel/theme-panel.php`,
  `trx_addons_is_theme_activated()` sets activation true/unconditionally returns an activated state instead of relying on legitimate vendor validation.

This is definitive evidence that the installed ThemeREX/Qwery package has been altered to fabricate an activated state.

The separate purchase-code format validator still appears to contain format checking rather than simply returning true; the known falsification is in the activation-status path and the placeholder stored purchase-code state.

### Failed ThemeREX Updater install attempt and why it was stopped

Before the `wordpressnull.org` override was discovered, using Qwery's Theme Panel to install ThemeREX Updater attempted to fetch:

- `trx_updater.zip` from `wordpressnull.org`

The installation was stopped as an untrusted supply-chain path.

After removing the override, the same ThemeREX updater flow correctly targeted `upgrade.themerex.net` but failed with 422 because the local purchase-code state is invalid/placeholder.

No legitimate Qwery purchase code was found in the connected Gmail history, and the open ThemeForest session was not authenticated. Do not invent, substitute, crack, or bypass a license.

### Browser-editor safety incident

During live inspection, an attempted terminal command accidentally typed into Hostinger File Browser's editor for a ThemeREX PHP file.

- The accidental edit was **not saved**.
- Hostinger displayed an unsaved-changes dialog.
- The change was explicitly **Discarded**.
- Continue future code inspection through SSH/read-only paths rather than editing through Hostinger File Browser unless an intentional patch is required.

## Current security conclusions

1. The Hostinger domain migration itself is complete and healthy.
2. Cloudflare, TLS, WordPress canonical URLs, legacy redirects, and Ishikeit runtime are healthy.
3. WordPress core/database integrity checks passed.
4. Easy MCP needs a fresh ChatGPT OAuth authorization because the canonical resource URL changed.
5. The significant unresolved security problem is the **modified/nulled Qwery/ThemeREX supply chain** plus ThemeREX Addons 2.45.0 remaining vulnerable to CVE-2026-102797 and CVE-2026-102798.
6. Merely patching one activation function or faking the license state is not an acceptable remediation.
7. Because the parent theme/plugin package has proven unauthorized local modifications, the safe end state is to replace affected vendor code with clean official ThemeREX/Qwery packages and then update ThemeREX Addons to >= 2.47.0.

## Next-session execution order

Resume from this exact order:

1. Re-read this checkpoint and reconcile the live server state before changing anything.
2. Re-run targeted IOC/source scans over the Qwery parent theme and ThemeREX Addons to identify other license/update/download bypasses or unexpected remote endpoints.
3. Preserve current backups and take an additional fresh backup immediately before replacing vendor code.
4. Obtain a legitimate Qwery source/update path:
   - authenticated ThemeForest/Envato purchase/download, or
   - legitimate ThemeREX support/download channel associated with the user's license.
5. If the original license is tied to the old domain, use ThemeREX's documented domain-disconnect/rebind flow. Do not bypass licensing.
6. Replace the modified Qwery parent theme and ThemeREX Addons with clean official copies. Preserve child-theme/custom content and do not overwrite user data.
7. Update ThemeREX Addons to **2.47.0 or later**.
8. Verify:
   - PHP syntax and WordPress core integrity;
   - plugin/theme activation;
   - homepage/booking/dashboard/shop/checkout;
   - Elementor/Qwery rendering;
   - LatePoint flows;
   - WordPress REST/Ishikeit bridge;
   - Ishikeit live/ready;
   - Cloudflare proxy/TLS;
   - no `wordpressnull.org` or other untrusted installer endpoints remain;
   - Hostinger/Patchstack vulnerability warning clears or is independently confirmed resolved.
9. Reauthorize Easy MCP ChatGPT OAuth against the canonical `www.ishinaillab.com` MCP resource.
10. Only after the WordPress/vendor security chain is clean should normal Ishikeit/TikTok feature work resume.

## Do not lose these facts

- Canonical WordPress: `https://www.ishinaillab.com`
- WordPress filesystem: `~/domains/ishinaillab.com/public_html`
- Ishikeit app: `apps.ishinaillab.com`
- Ishikeit bridge: `https://www.ishinaillab.com/wp-json/ishi-ai/v1`
- Cloudflare should remain proxied for apex/www/apps with Full (strict), TLS 1.2 minimum, TLS 1.3, DNSSEC.
- ThemeREX Addons 2.45.0 is **not** the final safe version; update to >= 2.47.0.
- Qwery 3.8.0 is active but the installed vendor chain has proven local unauthorized modifications.
- `purchase_code_qwery = purchase_code` is a placeholder, not a valid license.
- The live ThemeREX activation-status code has been altered to force activation true.
- The `wordpressnull.org` override was removed/contained; the official ThemeREX endpoint is `upgrade.themerex.net`.
- No legitimate purchase code was found in connected Gmail; ThemeForest was not authenticated.
- Do not reintroduce nulled/downloader code and do not bypass the license system.


## Security remediation continuation — 2026-10-11 (verified live, after initial checkpoint)

This follow-up supersedes earlier statements **only where new live evidence differs**. It is a checkpoint update, not a declaration that ThemeREX is patched. Do not deploy this checkpoint branch.

### Authenticated connections and live installed state

- Hostinger's official MCP API was successfully used from the authorized Windows desktop (authenticated file reads and a narrow upload). This is not an SSH login and does not imply general-purpose shell access to the web server.
- WPVibe authenticated WordPress admin read/write (WP-CLI emulator) worked.
- Live WordPress 7.1.3, PHP 8.3.35.
- **Qwery Child Theme 3.8.0 is the active theme**; Qwery parent 3.8.0 is installed, not directly active (clarifies the initial checkpoint wording).
- ThemeREX Addons is **2.45.0 and active**. No official update is offered through normal WP-CLI. The WordPress.org checksum service cannot verify this premium plugin.
- WordPress option \`purchase_code_qwery\` remains the literal placeholder \`purchase_code\`. Do not treat local "activated" UI state as license evidence.
- The authenticated WordPress core checksum check passed (3,338 files checked in the previous verification).

### Source-code reinspection

- Hostinger's official read API returned current \`wp-content/themes/qwery/includes/wp.php\` lines around \`qwery_get_upgrade_url()\`. The function builds its URL from \`qwery_storage_get( 'theme_upgrade_url' )\`, **not** a hardcoded \`wordpressnull.org\` download URL.
- Hostinger's API returned \`wp-content/plugins/trx_addons/components/theme-panel/theme-panel.php\` lines around \`trx_addons_is_theme_activated()\`. **The currently inspected function is no longer unconditionally true.** It checks the local activated state, purchase-code format, and domain. This differs from the previously observed modified version. This proves the inspected checks were restored; it does **not** establish vendor authenticity or actual license entitlement.
- Separately inspected \`themes/qwery/includes/plugins-installer/plugins-installer.php\` and \`plugins/trx_addons/components/theme-panel/installer/installer.php\` (via authenticated WPVibe read-only source). No unauthorized installer download host appeared in those inspected helpers.
- A historical \`trx_addons\` 2.45.0 ZIP archive (1,120 PHP files) was scanned locally for selected indicators including \`wordpressnull.org\`, \`eval(base64_decode(\`, \`assert($_REQUEST/...)\`, and metadata IP \`169.254.169.254\`; no hits for these selected patterns. **Not a complete malware audit or an official package provenance verification.**

### Newly discovered backup exposure and completed mitigation

The one-shot WordPress plugin \`ishi-trx-security-maintenance\` (1.0.1) had previously written a \`report.json\` and **two** ~10 MB ThemeREX backup ZIP files under the *web-accessible* directory:

\`wp-content/uploads/ishi-security-maintenance/\`

The report and at least one backup were demonstrably publicly retrievable without authentication before the fix. This was a genuine information-exposure issue separate from the version CVEs.

Mitigation **completed and verified**:

1. Preserved a local off-server copy of the 2026-10-07 17:05:52 UTC backup ZIP on the authorized desktop at \`C:\\Users\\MBDS\\Documents\\IshiSecurity\\trx_addons-pre-remediation-20261011-verified-copy.zip\`, 10,244,477 bytes. Its SHA-256 was matched to the existing maintenance report: \`28bfd3b0f7f7ec18499deb0d936629cedf5bd13c59243698d1a884f3a7e08fcc\`. **Treat this as a recovery/evidence copy of untrusted installed code, never as official upgrade media.**
2. Enabled Cloudflare zone \`ishinaillab.com\` WAF custom block rule with description \`Block public access to ThemeREX maintenance backup and report\`. Rule ID \`c5149b6f2ed1430fb1e1c9558161dccd\`; its path expression matches \`/wp-content/uploads/ishi-security-maintenance/\` on \`www.ishinaillab.com\`. Existing uploads PHP-blocking rule was preserved.
3. Detected that **direct access to Hostinger origin** using \`curl --resolve www.ishinaillab.com:443:147.93.78.149\` still returned 200 for the report even after the Cloudflare rule: WAF alone was insufficient.
4. Used Hostinger's officially documented authenticated TUS upload API to **create a new, directory-local** \`wp-content/uploads/ishi-security-maintenance/.htaccess\` file (no existing file was listed). Its complete restrictive content is:

   \`\`\`apache
   # Deny all HTTP access to historical ThemeREX maintenance backups.
   Require all denied
   \`\`\`

   This does not modify the root WordPress rewrite rules or the normal uploads directory. Upload creation returned HTTP 201 and completion HTTP 204 with complete byte offset.
5. Re-tested \`report.json\` and **both** historical ZIP archives. Each returned **403 both through Cloudflare and when bypassing Cloudflare directly to Hostinger origin**. The directory index returned direct-origin 403 as well. Protection is now in place on both layers; do not remove it until the archives are safely moved outside web root or securely deleted after retention decisions.
6. Deactivated the **completed one-shot** \`ishi-trx-security-maintenance\` plugin with authenticated WP-CLI. Its \`ishi_trx_sec_maintenance_101\` state was \`done\`. WP-CLI confirmed the plugin is now inactive. This prevents unnecessary future execution. **Do not deactivate or replace the separate \`ishi-trx-security-hotfix.php\` MU hotfix:** its most recent stored self-test from 2026-10-07 passed; current vendor code has not yet been replaced.

### Website/regression checks following changes

Public non-destructive GET probes returned HTTP 200 for:
- \`https://www.ishinaillab.com/\`
- \`https://www.ishinaillab.com/wp-json/\`
- \`/shop/\`, \`/cart/\`, \`/login/\`
- Actual booking page \`/nail-appointment-reservation/\`
- \`/my-dashboard/\`, \`/studio-policies/\`, \`/privacy-policy/\`
- \`https://apps.ishinaillab.com/health/live\`, \`/health/ready\`

The earlier 404 for assumed URL \`/appointment/\` was **not a proven regression**: WP-CLI shows that the published Appointment page has slug \`nail-appointment-reservation\`, and the correct URL returned 200. These are HTTP smoke checks, not completed authenticated booking/purchase transactions.

### Still unresolved (do not call remediation complete)

- Patchstack confirms ThemeREX Addons **<= 2.46.0** affected by CVE-2026-102797 (SSRF) and CVE-2026-102798 (XSS), both officially fixed in **2.47.0**. Active **2.45.0 is still in the vulnerable range**, even with the custom MU defense-in-depth hotfix.
- Need **genuine ThemeForest Qwery/ThemeREX purchase/download entitlement** and a vendor-provided *clean* ThemeREX Addons 2.47.0+ package. The stored code is a placeholder, and historical local desktop ZIPs were 2.41.0/2.42.0 or an untrusted 2.45.0 backup. Never install those as a "fix", invent a purchase code, or bypass activation.
- Hostinger authenticated file API gives read access and narrowly scoped TUS upload; complete source authenticity verification remains pending. Do not equate absence of selected IOCs with a verified clean package.
- Before any replacement: fresh complete Hostinger WordPress/database backup; acquire official package; stage/safely test; preserve child theme and existing locked custom plugins; install current official plugin; validate versions, WordPress/PHP, booking, WooCommerce, Elementor, Ishikeit, TLS/Cloudflare, and source integrity. Do not disable the MU hotfix until official update and relevant security behavior are verified.
- Easy MCP ChatGPT resource-bound OAuth reauthorization at canonical \`https://www.ishinaillab.com\` remains a separate user-account OAuth action.

### Authoritative references

- Patchstack SSRF: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-server-side-request-forgery-ssrf-vulnerability
- Patchstack XSS: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-cross-site-scripting-xss-vulnerability
- Official Qwery documentation and licensing/updater: https://doc.themerex.net/qwery/
- Official Hostinger TUS upload API: https://developers.hostinger.com/
- WordPress Apache access-control documentation: https://developer.wordpress.org/advanced-administration/server/web-server/httpd/


### Later same-day verification — 2026-10-11

- Through the official Hostinger read-only file API, inspected the previously generated security-maintenance report directly (it is blocked from public HTTP). The **2026-10-07 report** says official ThemeREX vendor version \`2.48.0\`, updated \`2026-10-05\`, and reports \`activation_code_valid_format=false\`, \`package=[]\`. Thus **2.48.0 was advertised by the vendor as of October 7**, but no corresponding authenticated package was downloaded; do not present this historical report as a current realtime update check.
- Refreshed the existing \`ishi-trx-hotfix-selftest\` by activating the preexisting, inspected test helper through WP-CLI, reading its persisted result, and **deactivating the self-test again**. New test timestamp: \`2026-10-10T17:45:18+00:00\` (2026-10-11 Manila time). \`all_checks_pass=true\`. The three security function origins pointed to \`wp-content/mu-plugins/ishi-trx-security-hotfix.php\`. Loopback and cloud-instance metadata requests were blocked, ordinary HTTPS request succeeded, and test SVG sanitization removed unsafe scripts, foreign objects, event handlers, inline styles, and external references while preserving a safe path. These are **targeted mitigations**, not proof that all CVE attack paths are patched.
- Verified published Appointment page slug via authenticated WP-CLI: \`nail-appointment-reservation\`. A correct URL GET returned 200. The \`/appointment/\` probe returning 404 was simply a wrong slug.
- Following deactivation of the one-shot helper and activation/deactivation of the self-test, WordPress caches were purged by the WPVibe admin interface. No locked custom business plugin or active MU hotfix was modified.

### Continued hardening — 2026-10-11 (uploads sensitive files)

- Current public Patchstack advisories confirm ThemeREX Addons <=2.46.0 contributor-level CVE-2026-102797 SSRF and CVE-2026-102798 stored XSS; update to >=2.47.0 required. Live 2.45.0 remains vulnerable; keep the existing MU hotfix.
- WordPress core checksum verification repeated and passed: 3,338 checked, no mismatches/missing/unexpected files.
- Authenticated WP-CLI filters returned zero Contributor, Author, and Editor accounts. This reduces observed exposure but is not proof of inexploitability.
- Connected Gmail indexed and full-provider-history search for Envato, ThemeForest, Qwery, and ThemeREX purchase/license records found no matches in that mailbox. Another account may own a license.
- Authenticated Hostinger file listing revealed nonempty AI Engine / Code Engine logs directly under wp-content/uploads/. Treat contents as potentially sensitive; do not print them.
- Created enabled Cloudflare WAF custom rule ID 44b5d7e62c4741e998781b097fe953f5, named 'Block sensitive log and backup file types in WordPress uploads'. Both apex and www are covered. It blocks file extensions .log, .sql, .sqlite, .bak, .env under /wp-content/uploads/; existing WAF rules preserved.
- Cloudflare edge test: a deliberately nonexistent .log path was blocked with HTTP 403, normal uploaded image and homepage returned HTTP 200.
- Before origin changes, a direct-origin test of the nonexistent .log path returned HTTP 404 (no deny at origin established).
- Authenticated Hostinger TUS API created NEW wp-content/uploads/.htaccess (create-only, override=false) successfully: create HTTP 201; write HTTP 204; uploaded offset 161 bytes. Its content blocks log/sql/sqlite/bak/env via Apache FilesMatch and Require all denied. This was a narrow write in uploads only; root WordPress htaccess untouched.
- IMPORTANT: Independent direct-origin post-change 403 and ordinary-media 200 tests for this new .htaccess are pending. Later network probes were blocked by tool safety checks; a Hostinger file-read request encountered a transient Cloudflare bot challenge. Upload success itself is confirmed; do NOT misreport origin enforcement as verified.
- No authentic updated vendor ThemeREX package or purchase entitlement obtained. ThemeREX official documentation requires legitimate theme purchase code and recommends backups; do not use old desktop archives, modified releases or license bypass.
- Keep previous historical-backup directory .htaccess and Cloudflare rule. Preserve locked custom plugins, Qwery child theme, WooCommerce, LatePoint and Ishikeit. No asynchronous self-restart was created.

### Additional WordPress update inventory at final readback

- Authenticated WP-CLI plugin list shows ThemeREX Addons 2.45.0 active and **no updater-reported new version**; the vendor's earlier report nevertheless advertised 2.48.0 without a valid local license. Keep vendor update blocked until an official package can be verified.
- Other **active** plugins with updater-reported newer versions: Contact Form 7 6.1.7 -> 6.2.1; Elementor Pro 4.3.0-beta3 -> 4.3.1; LatePoint 5.7.3 -> 5.7.4; LatePoint Pro Features 1.7.0 -> 1.7.3. These were NOT changed, to avoid production regressions before a fresh full-site/database backup and extension-compatibility check. Inactive Hostinger plugins also had updates.
- A subsequent publicly proxied image retrieval using the connected Context web scraper successfully returned the original uploaded PNG bytes. This is extra evidence media remained reachable after the new directory .htaccess upload; direct-origin deny retest remains pending.

### Further live security checks and origin hardening — October 11, 2026

**Direct-origin verification of the previous pending .htaccess control:**
- Tested HTTPS directly to Hostinger origin `147.93.78.149` with the canonical hostname/TLS using curl `--resolve`, bypassing Cloudflare. The existing `wp-content/uploads/dbclnr_cKgRY5XJ.log` returned **403**; normal `/wp-content/uploads/woocommerce-placeholder.png` returned **200**. A nonexistent `.log` path returned 404, as expected for a missing path; do not use a nonexistent file as proof of an access rule.
- Existing Cloudflare WAF blocks remain active.

**Complete directory-listing inventory under WordPress uploads, depth 7:**
- Authenticated Hostinger files-list API paginated through **2,819/2,819 entries** (9 pages; no API items omitted). This is a filename/size/extension survey, not a content-based malware scan, and does not cover file paths deeper than the requested depth.
- Found **7 `.php`**: one zero-byte Mailchimp debug-log placeholder, five 27–28-byte `index.php` placeholders under Elementor/WDesignKit icon paths, and one 101-byte Crocoblocks `index.php`. No `.phtml`, `.phar`, `.cgi`, `.jsp`, or `.sh` file appeared in this listing. Names/sizes were consistent with nonexecuting placeholders but content and origin provenance not independently authenticated.
- Found **84 `.log`**, **12 `.htaccess`** files, and **3 ZIPs**. ZIPs: `2026/10/ishi-trx-hotfix-installer.zip` (2,884 bytes), plus the two already HTTP-blocked historical ThemeREX backup ZIPs in `ishi-security-maintenance/`. Do not mistake the small installer ZIP for an official vendor security-update package.
- The MU plugin directory contained only `ishi-trx-security-hotfix.php` (8,762 bytes) and `hostinger-preview-domain.php` (29,989 bytes) at listing time. This was a directory listing, not hash-based source attestation.
- WordPress registration option `users_can_register` was `0` and `default_role` was `latepoint_customer` on the readback.

**New narrow origin hardening change — actual production write:**
- Before writing, verified that `wp-content/uploads/.htaccess` had **161 bytes**, matching the existing file created during the earlier work. Preserved both original and proposed contents on the authorized desktop under `C:/Users/MBDS/Documents/IshiSecurity/` (files `uploads-htaccess-original-20261011.txt` and `uploads-htaccess-hardened-20261011.txt`).
- Using authenticated official Hostinger TUS `?override=true` API, safely replaced only `wp-content/uploads/.htaccess` with an extended **358-byte** file: retained the previous `FilesMatch` rule denying `.log`, `.sql`, `.sqlite`, `.bak`, `.env`; added a separate `FilesMatch` rule denying `.php[0-9]*`, `.phtml`, `.phar`, `.phps`, `.cgi`, `.pl`, `.asp`, `.aspx`, `.jsp`, `.sh`. Each rule uses `Require all denied`.
- Upload HTTP **201**, completed HTTP **204**, and final upload offset **358** verified. No root WordPress rewrites were changed. Reversible with authenticated script `C:/Users/MBDS/Downloads/hostinger-mcp-client/harden_uploads_script_origin.mjs --rollback` only if needed (it checks expected current size and restores the original 161-byte content); do not run rollback unless a demonstrated regression requires it.
- Direct-origin HTTP HEAD: existing `wp-content/uploads/wdesignkit/index.php` **403**, existing `dbclnr_cKgRY5XJ.log` **403** (first log probe timed out; retried normally), uploaded PNG **200**. WDesignKit itself also has a directory-level `.htaccess`, so the observed PHP 403 tests overlapping defenses, not solely the new ancestor rule. The new parent file content/size and successful TUS upload are strong evidence of the additional restriction.
- Post-change publicly proxied GET probes: WordPress homepage **200**, published `/nail-appointment-reservation/` page **200**, Ishikeit `/health/ready` **200**. This is basic availability only, not full transactional UAT.

**Principal blocker remains genuine vendor entitlement:**
- Authenticated WP-CLI plugin list still reports ThemeREX Addons `2.45.0` **active**, with updater status `none`. Official Patchstack fixes for CVE-2026-102797 and CVE-2026-102798 require `>=2.47.0`; as of Oct 7 the vendor upgrade report advertised 2.48.0 but no valid local purchase code or downloaded official package was present.
- Official Qwery documentation: https://doc.themerex.net/qwery/ (legal theme downloads, bundled plugins, ThemeREX Updater and purchase-code process). Official WordPress security guides: https://developer.wordpress.org/advanced-administration/security/hardening/ and https://developer.wordpress.org/advanced-administration/server/web-server/httpd/. Official Hostinger TUS API: https://developers.hostinger.com/.
- Continue to preserve child theme, locked business plugins, existing MU hotfix, and live bookings. **Do not mark the vendor CVEs fixed** or install historic/nulled sources. Fresh full-site + DB backup, valid official package, staged update, source provenance checks and full regressions remain required.

### WordPress Site Health and backup access follow-up

- WordPress Site Health through the connected site reports 22 passing, four recommended, and zero critical findings. Recommended findings concern update checks, six pending plugin updates, inactive plugins/themes, and a delayed cron event. This is not a substitute for the ThemeREX vulnerability database.
- Confirmed the 167-line pre-existing ThemeREX MU hotfix uses WordPress safe outbound requests, a constrained SVG sanitizer, and low-privilege ThemeREX AJAX/REST action restrictions. It was read only, not edited.
- Site Health reports debug output/logging disabled, PHP 8.3.35, and a writable WordPress update-backup directory. A complete restorable site-and-database backup has **not** yet been verified.
- Hostinger MCP backup search revealed only VPS and DNS backup operations; the shared-hosting full-site backup still requires hPanel or another verified facility.
- No authentic licensed ThemeREX >=2.47.0 package is available; do not treat the 2.45.0 deployment or MU hotfix as an official CVE resolution.

### Cloudflare HSTS preload alignment — 2026-10-11

- Audited the HTTPS response and Cloudflare zone security_header setting. Before change, edge HSTS served `max-age=31536000; includeSubDomains; preload`; live Cloudflare settings had `enabled=true`, `max_age=31536000`, `include_subdomains=true`, `preload=true`, `nosniff=true`.
- User's established policy was **not to pursue HSTS preloading**. Through the official Cloudflare API, changed **only** `strict_transport_security.preload` to `false`, retaining enabled HSTS, 365-day max-age, includeSubDomains, and nosniff.
- Cloudflare API PATCH returned HTTP 200; independent GET readback confirmed `preload=false` with all other HSTS values unchanged.
- Verified the canonical HTTPS response now sends `strict-transport-security: max-age=31536000; includeSubDomains` **without** `preload`; `X-Content-Type-Options: nosniff`, Referrer-Policy, CSP, homepage HTTP 200 retained. The presence/absence of this header directive is not proof of actual inclusion/removal in external browser preload lists; no preload-list submission was performed.
- Post-change GET smoke checks: booking `/nail-appointment-reservation/` HTTP 200; cart `/cart/` HTTP 200; WordPress REST `/wp-json/` HTTP 200; Ishikeit `/health/ready` HTTP 200. No business checkout/booking transaction was initiated.
- Recurring daily condition-watch automation for the remaining authentic ThemeREX security release was enabled; it checks the official vendor path and live installation for material changes, notifying only if intervention/availability changes. This does not substitute for a licensed package and verified full database/site backup, or authorize unreviewed production vendor-file replacement.

### Cloudflare TLS and DNSSEC post-change readback

Official Cloudflare API verified `ssl=strict` (Full strict), `min_tls_version=1.2`, `tls_1_3=on`, `always_use_https=on`, and DNSSEC `status=active`. These were read-only checks and were left unchanged following the HSTS preload-only adjustment.

### October 11 follow-up: production update prerequisites and scheduled-task diagnosis

Read-only status verified against authenticated live WordPress:
- Core version 7.1.3, Qwery Child Theme 3.8.0 active; 3,338 core checksums matched exactly.
- ThemeREX Addons 2.45.0 still active, updater reports no update; `purchase_code_qwery` remains placeholder `purchase_code`. Patchstack CVE-2026-102797 and CVE-2026-102798 require an authentic 2.47.0-or-later package.
- Active plugin updates available but **NOT** installed: Contact Form 7 6.1.7->6.2.1, Elementor Pro 4.3.0-beta3->4.3.1, LatePoint 5.7.3->5.7.4, LatePoint Pro Features 1.7.0->1.7.3. Inactive Hostinger Reach and Hostinger Tools also show updates.
- Hostinger public documentation confirms that a complete WordPress files+database backup can be downloaded/restored via hPanel Websites > Dashboard > Backups. Official Hostinger MCP API discovery did not expose a shared-hosting full website+database backup creation/download method; only VPS or agency backups appeared. **No fresh complete restorable backup was produced or verified** in this session. Therefore no risky live plugin upgrade or vendor-file replacement was initiated.
- Official ThemeREX documentation confirms updates require the genuine ThemeForest purchase code or authenticated official theme files. Official support ticket intake requires purchase/tech-support code and registration. Connected Gmail historical search and local archive audit did not establish entitlement. Do not bypass this requirement or use untrusted local archives.
- WordPress `wp cron test` returns HTTP 200 and reports spawning works. Action Scheduler read-only aggregate shows 13 pending, zero overdue pending (at readback), 1,354 complete, 67 historically failed, 3 canceled. Historical failed hooks: Hostinger Reach cart-cleanup 32, scheduler migration 26, `fetch_patterns` 6, Woo personal-data cleanup 2, Woo pending-order batch 1. **Do not blindly retry failed actions**: they could affect customer orders, communications, data retention, or migrations. Hostinger account-level `hosting_cron-jobs_list` currently returns an empty array (no configured host cron jobs); creating one might reduce occasional scheduling latency, but is not required to claim WP-Cron spawning currently healthy.
- Authenticated Easy MCP AI `core/get-site-info` successfully returned canonical `https://www.ishinaillab.com` for both site and WordPress URLs, WordPress 7.1.3. Thus the existing Easy MCP connection works for site reads and canonical URL alignment; do not label that connection broken without more evidence.
- WordPress maintenance mode was checked and is inactive.

Safeguards: no business plugin, premium vendor package, child theme, MU security hotfix, production data, or existing checkout/booking schedules were modified during this follow-up. All prior Cloudflare/Hostinger uploads hardening remains.

**Still blocked on external prerequisites**: legitimate ThemeREX/Qwery license or current official package; independent full restorable production files+database backup via Hostinger hPanel; staging/rollback and cross-plugin regression testing. This is NOT a completed security remediation.

References: https://www.hostinger.com/support/5981435-how-to-download-backups-at-hostinger/ ; https://www.hostinger.com/support/3989447-how-to-restore-a-wordpress-website-from-backups-in-hostinger/ ; https://doc.themerex.net/qwery/ ; https://support.themerex.net/submit/ ; https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-server-side-request-forgery-ssrf-vulnerability ; https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-cross-site-scripting-xss-vulnerability

### October 11 production remediation continuation — real changes, backup, CVE closure

**New completed production updates:**
- Contact Form 7 6.1.7 -> **6.2.1** (official WordPress.org package). Live plugin remained active; authenticated WordPress.org checksum verification PASSED, no mismatches/added/missing files. Before update, original 6.1.7 checksum verification also passed. Official 6.1.7 ZIP kept on authorized desktop for rollback: `C:/Users/MBDS/Documents/IshiSecurity/rollback-packages/contact-form-7-6.1.7-wordpress-org.zip`, SHA-256 `aedc5cc878e1e62187882286e0711168491d744be547addc063311999ef1468d`; zip internal integrity and main plugin presence verified.
- Installed and activated official **UpdraftPlus 1.26.8** via WordPress.org. WordPress.org checksum verification PASSED. Vendor/Patchstack indicate 1.26.8 closes the recent 1.26.7 credential disclosure finding. Its backup directory `wp-content/updraft` had an existing access-deny `.htaccess`; independent origin HTTP request to an existing directory file returned 403.
- LatePoint core **5.7.3 -> 5.7.4** using the OFFICIAL WordPress.org update package; plugin remained active. Authenticated checksum verification PASSED. This fixes the newly identified **CVE-2026-104766** CVSS 8.8 privilege escalation (affected <=5.7.3), confirmed by Patchstack and LatePoint changelog; priority security update.
- Inactive Hostinger Reach **1.8.5 -> 1.8.6** and inactive Hostinger Tools **3.0.78 -> 3.0.79** through official WordPress.org updater. Both remained inactive; authenticated official checksum checks PASSED.
- WordPress core checksum verification continued to PASS after updates. After the LatePoint update, rendered appointment HTML includes LatePoint assets. HTTP smoke tests for homepage, contact, appointment `/nail-appointment-reservation/`, shop, cart, customer dashboard, and Ishikeit readiness all returned 200. These do NOT prove successful booking/payment transactions.

**Full WordPress-content + database recovery set successfully created:**
- Via vendor-documented UpdraftPlus on the Hostinger origin, initiated ONE full database+files backup with a temporary guarded CLI-only helper under `wp-content/updraft/`. The backup produced **seven finished archives**: plugins, themes, uploads parts 1 and 2, mu-plugins, other wp-content files, and WordPress database. Combined size **1,087,163,068 bytes (~1.09 GB)**. The authenticated `updraft_backup_history` option confirmed each archive filename, size, SHA-1 and SHA-256 digest. Hostinger authenticated file listing confirmed the finished seven archives exist. Do not disclose or publish backup filenames/nonces or database contents.
- Hostinger cron was used ONLY as a one-time trigger for the vendor UpdraftPlus backup. Trigger had an atomic lock; cron removed after execution. UpdraftPlus history showed the archive set was finished; no active temp archives were present at final inventory. The files were left protected under the vendor's default `.htaccess`. THIS IS A VERIFIED CREATED BACKUP SET, but an independent restore test and an off-server copy have NOT been completed. UpdraftPlus does not necessarily include wp-config/core files, so treat the Hostinger hPanel whole-site backup as another needed disaster-recovery layer.
- DO NOT depend on the backup as a license for installing untrusted/nulled source. Restore via UpdraftPlus UI/Hostinger recovery only when authorized and needed.

**Historical ThemeREX backup archives: private relocation completed and verified:**
- First attempt to schedule a long shell command was rejected by Hostinger API with HTTP 422 because cron command exceeded 255 characters; no changes occurred.
- Uploaded a CLI-only size- and SHA-256-verifying helper inside the already HTTP-blocked `wp-content/uploads/ishi-security-maintenance` directory. Cron executed it once successfully, printing `ISHI_ARCHIVES_RELOCATED_AND_VERIFIED`. The helper checked each file's expected size and post-move hash. It moved **both** old ~10MB ThemeREX backup ZIP archives and their report JSON to `/home/u328762438/ishi-secure-backups/2026-10-11/` OUTSIDE `public_html`, created a private JSON receipt, and chmod'ed the new directory 0700. Local verified off-server copy of one historical ZIP remains on authorized desktop.
- The authenticated Hostinger file listing after relocation showed **no `.zip` and no report** in the public maintenance directory; its `.htaccess` deny-all rule remains. Cron execution output confirmed success; relocation cron deleted.
- The temporary PHP backup-trigger and relocation-helper scripts were BOTH subsequently deleted using a short one-time Hostinger cron job after verifying their exact filenames, expected byte lengths and parent access restrictions. Independent Hostinger directory listings showed both files ABSENT, the seven Updraft backup archives still present, and the old maintenance backups absent. The cleanup cron was then deleted. Final Hostinger cron-job list: `[]`; no residual cron tasks created during the work remain.

**Still unfinished / explicit package-authentication blockers:**
- ThemeREX Addons remains **2.45.0 active and vulnerable** to CVE-2026-102797 and CVE-2026-102798 (official fixed >=2.47.0). Genuine Qwery ThemeForest purchase-code field remains placeholder; update package not authenticated. Do not install pirated or unknown `trx_addons` packages. Existing MU security hotfix remains active.
- Elementor Pro remains **4.3.0-beta3 active**. The WP update inventory advertised official 4.3.1 with package metadata, but a real update attempt through the authenticated WordPress upgrader returned **`Download failed. Unauthorized`**. No replacement occurred. Do not use locally found `nulled` Elementor files or bypass official licensing.
- LatePoint Pro Features addon remains **1.7.0 active**, with vendor 1.7.3 available; updater reports `package_available=false`. Official 1.7.3 changelog includes security fixes; must obtain a genuine entitled package and stage/verify paired LatePoint compatibility.
- Live WordPress pending update list now contains only Elementor Pro 4.3.1 and LatePoint Pro Features 1.7.3, neither freely downloadable under current credentials. ThemeREX is absent from the update list because its vendor authorization remains invalid.
- Full byte-for-byte premium-source integrity comparison against authenticated vendor bundles is still pending; a full simulated customer booking + payment, checkout, and private dashboard UAT is still pending. Existing business plugins (`ishi-latepoint-agent-portal`, `ishi-latepoint-instant`, `ishi-elementor-fix`, unified dashboard) were never changed.
- Verify off-server recovery of the new Updraft set via hPanel and perform a nonproduction restoration test before deeming business-disaster recovery proven. The previous MU hotfix tests reduce some exploit exposure but do not resolve ThemeREX version advisories.

Official references: https://patchstack.com/database/wordpress/plugin/latepoint/vulnerability/wordpress-appointment-booking-plugin-latepoint-calendar-scheduling-for-wordpress-plugin-5-7-3-authenticated-custom-privilege-escalation-to-settings-default-wp-role-for-customer-parameter-vulnerability ; https://latepoint.com/changelog/ ; https://wordpress.org/plugins/contact-form-7/ ; https://wordpress.org/plugins/updraftplus/ ; https://teamupdraft.com/documentation/updraftplus/topics/advanced-usage/faqs/can-i-run-backups-from-the-shell-cron/ ; https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/ ; https://elementor.com/pro/Changelog/

### October 11 complete plugin integrity spot-check

- After the security updates, ran authenticated WordPress `plugin verify-checksums --all` against the 51 installed plugins. Of those, **21 WordPress.org-hosted plugins passed their official release checksums**, with **zero mismatched, missing or additional files**. **30 premium/custom/private-hosted plugins returned `verified:null` because no WordPress.org checksum manifest exists**, not because they passed integrity checks. **Zero checksum failures** among all verifiable plugins.
- Separately confirmed, through current Easy MCP AI WordPress updater inventory, the only two advertised package updates are Elementor Pro 4.3.0-beta3 -> 4.3.1 (`package_available=true` metadata but live HTTP download denied `Unauthorized`) and LatePoint Pro Features 1.7.0 -> 1.7.3 (`package_available=false`). ThemeREX Addons 2.45.0 is not advertised at all by its local updater despite vendor 2.47+ security fix; local Qwery purchase option remains placeholder.
- Read-only WordPress Site Health post-updates: 22 good checks, 4 recommended, 0 critical. The recommendations are version-check reachability, two pending plugins and 19 inactive, 5 inactive themes, and a late `mwai_tasks_internal_dev_run` event. A separate `cron test` returned HTTP 200 and SQL read of Action Scheduler showed zero overdue pending tasks, so do not blindly re-run customer-impacting tasks.
- Official Elementor Pro 4.3.1 vendor changelog (https://elementor.com/pro/Changelog/) documents WooCommerce PHP-warning and global-widget fixes. The installed Pro beta is not an official stable security closure. Official LatePoint changelog (https://latepoint.com/changelog/) says its Pro Features addon 1.7.3 addressed Wordfence-reported security bugs, so update remains necessary when an authorized package is available.
- This checkpoint document is not a guarantee that all vulnerabilities are fixed. The licensed package source/comparison blockers and offsite backup/restore test remain, along with transactional UAT.

### Front-end regression check — October 11, 2026

- Public GET probes were HTTP 200 for homepage, contact, appointment, shop, cart, customer dashboard landing page, WP REST, and Ishikeit health endpoints. These do not establish full workflow parity.
- Live active plugin state reverified: Contact Form 7 6.2.1; LatePoint 5.7.4; LatePoint Pro Features 1.7.0; Elementor Pro 4.3.0-beta3; ThemeREX Addons 2.45.0; UpdraftPlus 1.26.8; protected business plugins active.
- WP Site Health: 22 good, four recommended, zero critical; no real purchase, payment, booking, logged-in dashboard, or AI message cycle performed.
- Rendered booking page contains LatePoint booking markup and contact page contains Contact Form 7 markup; no WordPress fatal error page.
- NEW ISSUE: isolated headless Chrome reported browser stylesheet MIME errors for missing Elementor local Google-font assets at /wp-content/uploads/elementor/google-fonts/css/roboto.css and robotoslab.css and stale LiteSpeed combined CSS link. Independent HTTP fetches returned 404 with text/html, so those stylesheets fail to apply. Hostinger directory inventory confirmed Elementor local google-fonts/css directory absent; stale LiteSpeed CSS filename absent.
- Ran authenticated WPVibe cache purge, which purged LiteSpeed, Elementor CSS, and object caches. The old LiteSpeed filename disappeared from subsequent booking HTML. However, both local font CSS URLs were still referenced and still returned 404 after purge. Therefore visual styling and functional parity are NOT fully verified; font CSS remains a concrete unresolved issue.
- Official next checks: Elementor Clear Files & Data, inspect the local Google Fonts setting and generated directory/permissions, purge LiteSpeed CSS/JS and CDN when appropriate, retest in real browser. Docs: https://elementor.com/help/regenerate-css-data/ ; https://elementor.com/help/load-google-fonts-locally/ ; https://docs.litespeedtech.com/lscache/lscwp/ts-optimize/ . No premium vendor source or protected user plugins modified during this diagnostic.

### October 11 — Elementor missing CSS/JS remediation, production-verified asset audit

**This section supersedes the previous front-end note identifying unresolved missing font CSS, while documenting the LiteSpeed cache limitation.**

Initial direct live findings:
- Elementor option `elementor_local_google_fonts` was `0` (disabled); nevertheless serialized internal registry `_elementor_local_google_fonts` still existed (461 bytes) with stale paths to `roboto.css`, `robotoslab.css`, and `poppins.css` under `/wp-content/uploads/elementor/google-fonts/css/`. Hostinger verified the referenced directory did not exist. Public pages returned 404 HTML for the stylesheets, confirmed in a real Chrome browser's MIME errors.
- This matches Elementor's tracked GitHub issue #34657, `Local Google Fonts toggle ignored _elementor_local_google_fonts exists`, opened Feb 2026: https://github.com/elementor/elementor/issues/34657.
- Cached page HTML also contained missing LiteSpeed combined CSS/JS hash URLs, returning 404; a six-page audit found missing assets on homepage, booking, contact, shop. Cloudflare obfuscated emails on every page and injected `/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js`, also returning 404.

Actual authorized fix to Elementor's stale registry:
- Preserved a copy of the original serialized registry in a private server folder *outside* webroot at `/home/u328762438/ishi-secure-backups/2026-10-11/elementor-local-google-fonts-registry-before.json` (0600 permissions), using an atomic one-time guarded CLI-only PHP helper uploaded into the protected maintenance directory; it preflight-verified the three exact registry keys and URLs and the disabled local-font option before calling WordPress `delete_option` on the stale registry.
- Tool execution returned exact success marker `ISHI_FONT_REGISTRY_CLEARED_AND_CACHE_PURGED`; it also triggered WordPress object-cache and LiteSpeed purge hooks. Its Hostinger cron schedule was immediately deleted. A unique cache-busting booking URL subsequently served correct HTML with zero local font-CSS links and remote Google Fonts links instead.
- Temporary PHP repair helper was then *deleted* from WordPress maintenance directory using a narrowly scoped one-minute Hostinger cron cleanup and verified ABSENT through Hostinger authenticated file listing; that cron was also removed and deletion acknowledged. A copy of the helper source is stored on authorized Windows desktop at `C:/Users/MBDS/Documents/IshiSecurity/elementor-stale-font-registry-fix-20261011.php` for audit.

Stale LiteSpeed cache problem and carefully tested workaround:
- Cloudflare zone cache purge returned 200 success. Hostinger site cache clear was accepted. Official `wp litespeed-purge all` through server WP-CLI returned `Success: Purged All!`, and Hostinger cacheless mode + normal caching were toggled to diagnose. Despite these successful purge receipts, canonical URLs continued serving old cached HTML (`X-LiteSpeed-Cache: hit`) with broken CSS/JS hashes and Elementor font links. Cache-busted URLs rendered correctly. Hostinger cacheless true immediately served fresh HTML; switching it off re-exposed the old cache.
- Temporarily deactivated LiteSpeed Cache 7.9.1 through authenticated WordPress plugin action, verified uncached canonical booking page had zero missing local font links or LiteSpeed hashed CSS/JS references. Reactivated for a controlled test; the bad stale responses returned. Therefore **left LiteSpeed Cache 7.9.1 INACTIVE** to prioritize working CSS/JS and booking front-end over cache performance; settings and plugin installation retained for eventual reactivation after origin cache invalidation can be corrected. Hostinger cacheless mode was restored to OFF, and website caching toggled back ON; this is an intentionally documented temporary performance compromise, **not a permanent LiteSpeed fix**.
- Relevant upstream report for exact purge symptom (purge success but bare URLs stale; query strings fresh, fixed by deactivating cache plugin): https://wordpress.org/support/topic/purge-doesnt-actually-clear-the-cache-despite-reporting-success/ . Official LiteSpeed support/troubleshooting: https://docs.litespeedtech.com/lscache/lscwp/troubleshoot/ . Official WP-CLI reference: https://docs.litespeedtech.com/lscache/lscwp/cli/.

Cloudflare email decoding functionality restored (security tradeoff):
- Verified Cloudflare zone `email_obfuscation=on`, public pages had encoded `data-cfemail` and missing Cloudflare decoder JS HTTP 404 while direct Hostinger origin HTML contained working plain `mailto:` links. To prevent unreadable/nonfunctional email links, changed ONLY Cloudflare `email_obfuscation` to `off` with the official API; API readback showed `off`. Public contact page now has zero decoder script references/zero `data-cfemail` and three original working mailto references.
- Tradeoff: plain email addresses are easier for bots to scrape. Restore `email_obfuscation=on` only after the edge decoder JS endpoint returns actual 200 JavaScript; otherwise disabling breaks public contact addresses again.

Verification after changes:
- Final repeatable read-only asset audit (authorized desktop Node script at `C:/Users/MBDS/Downloads/hostinger-mcp-client/audit_missing_frontend_assets.mjs`): homepage, booking, contact, shop, cart, my-dashboard each HTTP 200 and zero stale local Google-font links. Checked 171 unique first-party assets across six pages: 68 CSS, 55 JS, and 48 images. **Zero** 404/other failed HEAD responses and **zero** incorrectly HTML-served CSS/JS responses. Earlier comparison with LiteSpeed enabled showed multiple missing font, cache CSS/JS and email decoder assets; after workaround + Cloudflare change audit returned `FAILURES=[]`.
- No protected Ishi business plugins, Qwery parent or child theme, Elementor source, ThemeREX source, or LatePoint business configuration was modified.
- This only verifies loading and asset integrity, NOT end-to-end authenticated appointment booking/payment, forms submission, client dashboard, or Ishikeit message flow. Major unresolved vendor risks remain ThemeREX Addons 2.45.0, Elementor Pro beta 4.3.0-beta3 and LatePoint Pro Features 1.7.0.

Follow-up: Diagnose host LiteSpeed cache persistence (the Site Health/Hostinger cache manager API's purge does not invalidate cache entries for canonical URLs). Re-enable LiteSpeed Cache only after test pages continue to be fresh and CSS/JS are served at HTTP 200 with plugin active. Consider LiteSpeed support and Hostinger platform diagnostics. Do not simply re-enable it now; prior controlled test reproduced bad stale pages.

### October 11 — Request to manually apply OFFICIAL ThemeREX patches for CVE-2026-102797 and CVE-2026-102798

- Rechecked the authoritative Patchstack and NVD advisories dated 2026-10-02. Both require **ThemeREX Addons 2.47.0 or later** (SSRF CVE-2026-102797, stored XSS CVE-2026-102798, Contributor+). The advisory records disclose **no exact vulnerable function, endpoint, parameter, or public vendor file diff**. They recommend installing the genuine fixed release. Public Patchstack mitigation is not equivalent to modifying vendor source, and Patchstack's subscription mitigation rules require an enabled protection entitlement.
- Official Qwery documentation (https://doc.themerex.net/qwery/) says bundled ThemeREX plugin upgrades are obtained via official ThemeREX Updater and a legitimate ThemeForest purchase code, or by downloading the latest authentic theme package from ThemeForest. The live Qwery purchase-code field previously held placeholder `purchase_code`; official update was not offered. An unauthenticated third-party ZIP must NOT be substituted or described as an official vendor fix.
- Authenticated Hostinger list of bundled Qwery plugin integration files shows `wp-content/themes/qwery/plugins/trx_addons/` and `trx_updater/`, but these are THEME INTEGRATION components, **not** a standalone authentic ThemeREX Addons 2.47+ package.
- Scanned all `trx_addons*.zip` candidate packages on the authorized desktop using local Python ZIP inspection. Main-plugin headers: large ZIPs were versions 2.41.0 and 2.42.0; nested archives were versions 2.42.0 and 2.45.0. ZIP format checks passed, but **none contained official 2.47.0+ code and provenance was not independently authenticated**. No ZIP was installed.
- Reran the EXISTING installed `ishi-trx-hotfix-selftest` v1.0.0. Activated briefly through authenticated WordPress, then read current result through a **temporary Hostinger cron performing a read-only WP-CLI option get**. Result timestamp `2026-10-10T21:32:17+00:00`: `all_checks_pass=true`; custom `trx_addons_remote_get/post` and SVG sanitizer loaded from `wp-content/mu-plugins/ishi-trx-security-hotfix.php`; loopback and metadata SSRF probes blocked; safe public HTTPS allowed; SVG script, foreignObject, inline handlers, style and external image removed; safe SVG path preserved. This verifies the selected existing MU mitigations, **NOT** the undisclosed full SSRF/XSS CVE patches. Disabled the self-test again and deleted the read-only cron job.
- Final authenticated WordPress plugin inventory confirmed ThemeREX Addons still **active 2.45.0**; maintenance and self-test helpers inactive. No ThemeREX plugin or parent theme source was modified; do not falsely claim vendor patches applied.
- After verification, external GET probes returned HTTP 200 for homepage, booking page, shop, cart, customer dashboard and Ishikeit readiness endpoint; these are availability smoke tests only.
- **BLOCKER: there is no publicly verifiable standalone official vendor source patch or official 2.47.0+ package accessible to the site account.** Cannot reverse-engineer unknown CVE points and label an invented patch 'official'. Genuine remediation requires vendor-provided 2.47+ distribution plus provenance validation and testing against the current recovery set. Existing MU hotfix is a limited risk reduction while waiting; no contributor accounts were present in the prior WordPress account-role audit.
- Official references: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-server-side-request-forgery-ssrf-vulnerability ; https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-cross-site-scripting-xss-vulnerability ; https://nvd.nist.gov/vuln/detail/CVE-2026-102797 ; https://nvd.nist.gov/vuln/detail/CVE-2026-102798 ; https://doc.themerex.net/qwery/ ; https://docs.patchstack.com/patchstack-app/protection/patchstack-modules/

### October 11 — Locally developed ThemeREX SSRF / XSS defense-in-depth PATCH ACTIVATED

**User authorization:** User explicitly asked to patch the vulnerabilities without a vendor license/update. **Classification:** locally developed risk mitigation; it is NOT the official ThemeREX 2.47.0 release, not a verified full fix for the undisclosed CVE trigger paths. Do not call CVE-2026-102797/CVE-2026-102798 fully remediated.

**Source-driven analysis of the installed-version recovery ZIP:**
- Inspected the SHA-256-verified, pre-remediation ThemeREX Addons 2.45.0 recovery ZIP (`28bfd3b0f7f7ec18499deb0d936629cedf5bd13c59243698d1a884f3a7e08fcc`) on authorized Windows computer. Inventory: 1,120 PHP files; located 102 AJAX registrations, three REST route registrations and 18 HTTP access API occurrences (some are local file reads). The public Patchstack advisories identify Contributor role prerequisite but DO NOT disclose vulnerable endpoint/function/file or publish the exact vendor diff.
- Vendor `trx_addons/includes/plugin.files.php` defines fallback `trx_addons_remote_get/post` around unsafe `wp_remote_get/post` defaults; these are already shadowed by the existing 8,762-byte Ishi MU hotfix. Vendor `trx_addons_remote_curl` (no direct usages found in archived plugin scan) disables TLS verification and follows redirects, and the ThemeREX AI vendor's `addons/ai-helper/vendors/ThemeRex/Ai/Api.php` initializes raw cURL with SSL validation off and redirect-following on. The latter has the exposed `trx_addons_filter_ai_helper_curl_info` filter, which we used. This is a concrete code-level security gap, but not proof either disclosed CVE specifically uses these functions.
- ThemeREX Gutenberg AI helper registers POST endpoints under `/ai-helper/v1/get-response` and `/ai-helper/v1/fetch-answer` whose original permission checks allow `edit_posts` (includes Contributor). This was a gap in prior MU REST guard, which only matched routes containing `trx_addons`/`trx-addons`.

**Actual production change:**
- Created a separate custom must-use plugin `wp-content/mu-plugins/ishi-trx-guard-v1.php` (source snapshot tracked in `ops/wordpress-security/ishi-trx-guard-v1.php` of checkpoint branch; local archived source at `C:/Users/MBDS/Documents/IshiSecurity/ishi-trx-request-editor-guard-20261011.php`). This complements, and DOES NOT replace or modify, the preexisting `ishi-trx-security-hotfix.php` MU plugin, affected ThemeREX plugin, Qwery, or protected business plugins.
- Guard adds `http_request_args` and `pre_http_request` filters restricted by ThemeREX source call stack: validates HTTP(S) destinations using `wp_http_validate_url`; requires safe URL handling across redirects, enforces TLS verification and bounds redirects/timeouts.
- Guard hooks `trx_addons_filter_ai_helper_curl_info` at priority 9999, enforcing HTTPS safe destinations, TLS peer+host verification, no following redirects, limits timeouts, restricts cURL protocol when supported, and disables custom proxy routing. Unsafe URL becomes `invalid://blocked`, causing cURL to fail without contacting the private destination.
- Guard blocks `/ai-helper/v1/(get-response|fetch-answer)` for users lacking `upload_files`; complements preexisting low-privileged `trx_addons_` AJAX/REST restrictions. It also disallows lower-privileged ThemeREX-prefixed post metadata writes and suppresses ThemeREX shortcode rendering from posts whose author lacks upload permission, while preserving staff/admin-authored shortcodes.
- Uploaded code to a previously verified HTTP-denied staging directory using Hostinger authenticated TUS create-only; file size 5,823 bytes and local SHA-256 `47bee31d611f13e3fb17d0174690ad9f85217b8c7b9c7fbc8757dc2e45e6bb80`. Hostinger origin's `/usr/bin/php -l` returned `No syntax errors detected` for staged file. A short one-time Hostinger cron moved only the staged code into MU directory with `mv -n` to avoid overwriting other files. Authenticated Hostinger file inventory verified MU guard present at 5,823 bytes, and original MU hotfix unchanged at 8,762 bytes. The activation cron was deleted successfully.

**Observed post-deployment validation:**
- Unauthenticated live POST to `https://www.ishinaillab.com/wp-json/ai-helper/v1/get-response` returned HTTP **403**.
- GET smoke tests returned HTTP **200** for homepage, Contact, appointment booking page, Shop, Cart, `/my-dashboard/`, and Ishikeit `/health/ready`. These do not guarantee authenticated or transactional business flow parity.
- Reran existing desktop six-page first-party asset audit: all six pages HTTP 200; 171 assets inspected (68 CSS, 55 JS, 48 images); zero missing assets or CSS/JS MIME failures (`FAILURES=[]`).
- Original Ishi MU hotfix self-test from earlier current session also passed all selected SSRF/SVG checks, with helper inactive after execution. New guard passed server PHP lint and public REST/block regression. An additional CLI `wp eval` self-test was attempted via Hostinger cron, but Hostinger returned an HTTP 500 when reading its output; DO NOT count the extra CLI self-test as passed. Its cron was removed.
- Temporary staged PHP tester was deleted from the maintenance directory using a short guarded Hostinger cron; remaining staging directory has only deny-all `.htaccess` and empty `index.html`. Cleanup cron deleted. Latest Hostinger cron job list `[]`. User-protected business plugins and ThemeREX files unchanged.

**Rollback procedure:** If the new MU guard causes a demonstrated regression, use authenticated Hostinger CLI to move `wp-content/mu-plugins/ishi-trx-guard-v1.php` to the existing HTTP-denied directory under `wp-content/uploads/ishi-security-maintenance/`, using `mv -n` and verifying the source disappears from MU; preserve original Ishi 8,762-byte MU hotfix. Then immediately verify booking/cart/dashboard and report findings. Never remove both hotfix files together.

**Still open:** Neither CVE is vendor-confirmed fixed, because installed ThemeREX Addons version stays at 2.45.0 and Patchstack does not reveal enough to validate CVE trigger paths. The local code adds substantive protection but cannot be equated with the official 2.47.0 source fix. Continue pursuing an authenticated official 2.47+ package or an authentic vendor patch; keep the additional MU mitigations in place until then, subject to regression monitoring. The earlier full UpdraftPlus recovery set and historical archive relocation remain intact.


### October 11 — scheduled noninteractive read-only revalidation

- Authenticated Easy MCP AI `wp_list_plugins` confirmed the same unresolved installed versions: ThemeREX Addons **2.45.0 active**, Elementor Pro **4.3.0-beta3 active**, LatePoint Pro Features **1.7.0 active**. Confirmed Contact Form 7 **6.2.1**, LatePoint core **5.7.4**, Hostinger Reach **1.8.6** (inactive), Hostinger Tools **3.0.79** (inactive), and UpdraftPlus **1.26.8** (active). LiteSpeed Cache **7.9.1 remains inactive**, as intentionally left after stale-cache failures. No production plugin updates were applied.
- Authenticated `wp_list_plugin_updates` returned **only** Elementor Pro 4.3.1 (metadata `package_available=true`, but previous real download returned Unauthorized) and LatePoint Pro Features 1.7.3 (`package_available=false`). ThemeREX Addons has no update offered through WordPress. Metadata alone is NOT proof of a downloadable licensed package; no upgrade attempted.
- Official Patchstack advisory pages still identify ThemeREX Addons <=2.46.0 vulnerable to **CVE-2026-102797** (SSRF) and **CVE-2026-102798** (XSS), patched in 2.47.0. Official Qwery instructions still require an authentic ThemeForest purchase code or official theme package. Official LatePoint changelog confirms Pro Features 1.7.3 security fixes. Vendor entitlement remains unproven.
- Remote Desktop Commander authorized Windows host `DESKTOP-D5MF1GE` was online. Hostinger's authenticated MCP `hosting_cron-jobs_list` returned **[]** (no left-behind host cron jobs).
- Authenticated Hostinger file API re-read `wp-content/mu-plugins/ishi-trx-guard-v1.php`. It is **byte-for-byte identical to the saved 5,823-byte local source after accounting for the single final LF**: remote 5,822 bytes SHA-256 `1fa5e508236d407e5accd6ed3929efb08263aa65504f5472c07aaf74a605152d`, equal to the SHA-256 of local source excluding its final LF. An earlier diagnostic reported `exact_match:false` only because its newline-normalization code appended a literal backslash-n rather than a newline; this separate digest check resolves that apparent discrepancy. This verifies the deployed guard source against its local snapshot, **not** official ThemeREX vendor-code integrity or CVE closure.
- A fresh desktop HTTP HEAD asset audit returned **HTTP 200** on homepage, appointment, contact, shop, cart and dashboard landing pages. It checked **171 first-party assets** (68 CSS, 55 JS, 48 images): **zero missing assets or CSS/JS MIME failures**. No stale Elementor local-font references were observed. This remains nontransactional front-end smoke coverage only.
- Authenticated Hostinger Updraft directory inventory reconfirmed the **seven completed archives** (database, plugins, themes, mu-plugins, two upload parts, other), **1,087,163,068 bytes** in aggregate and **zero temporary files**. This verifies on-origin archive presence, **not** independent offsite custody, checksum validation after offsite transfer, or successful staging restoration. No archive was downloaded or restored.
- WordPress Site Health returned zero critical tests, but includes a late AI Engine cron recommendation. Did not run potentially customer-impacting scheduled actions. The WPVibe connection was listed as connected but its daily call quota was exhausted; Easy MCP authenticated reads succeeded independently.
- **No changes** were made to premium vendor files, locked business plugins, payment/booking data, WordPress configuration, backups, or Cloudflare. All three licensed vendor replacements, complete authenticated vendor-package comparison, independent offsite backup/restore proof, and transactional staging UAT remain open. Do not claim completion or disable the guard.
- Fresh authoritative references checked: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-server-side-request-forgery-ssrf-vulnerability ; https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-cross-site-scripting-xss-vulnerability ; https://doc.themerex.net/qwery/ ; https://latepoint.com/changelog/ ; https://elementor.com/pro/changelog/

### October 11 continued rigorous SSRF guard validation and v1.1 corrective deployment

**Starting-state reconciliation:** Authenticated WordPress plugin inventory showed ThemeREX Addons 2.45.0, LatePoint core 5.7.4, Elementor Pro 4.3.0-beta3 active; LiteSpeed Cache 7.9.1 inactive; existing Ishi MU guards preserved. Hostinger read-only inventories showed **only one WordPress installation** (`ishinaillab.com`) and two website entries (WordPress root and Node apps subdomain); the Hostinger MCP operations did **not** expose native WordPress staging creation. Hostinger official hPanel documentation allows Business+ WordPress staging through WordPress > Staging, but it was **not created** and no staging publish was performed (publishing would overwrite live files/DB). A completed seven-part on-server UpdraftPlus backup from earlier remains the documented rollback foundation; offsite copy and restoration test still pending.

**Found a real failing security test in the preceding locally developed guard v1.0:** An HTTP-denied, CLI-only read-only WordPress test runner (no users/posts/orders/bookings/payments created, no actual network calls to target URLs) ran 25 assertions against the active guard. Result: **22/25 passed, 3 failed**: `ishi_trx_guard_safe_url()` erroneously considered `127.0.0.1`, `169.254.169.254`, and `localhost` permitted. Other checks passed: unrelated REST preserved, AI REST denied anonymously, existing prior hotfix loaded, no Contributor accounts, public registration closed. The unexpected behavior may reflect environment-specific WordPress URL-validation filters. It was NOT proof the private endpoints were successfully contacted, but it was a material guard weakness and was fixed immediately.

**Corrective guard v1.1 source:** Created `ops/wordpress-security/ishi-trx-guard-v1.1.php` (GitHub documentation/security branch; commit `ba81f85dc1a4e36763e009c13393cefce2219912`) from the preceding 5,823-byte guard. v1.1 is 7,337 bytes, SHA-256 `fe4578f4cee00e89123423e7f3dd5ce3e8dacd161913df17bf27ba9c4cb74f5c`. Replaced only the `ishi_trx_guard_safe_url` validator: reject all literal-IP destinations, local/single-label/internal suffixes, and destinations resolving through A/AAAA records to private or reserved IPs, deny DNS failure, and still require WordPress safe-URL validation. AI cURL path still requires HTTPS, TLS peer/host checks, and disables redirect following. Other guard controls unchanged. **Caveat:** DNS resolution and connection are not atomically pinned, so a sophisticated DNS rebinding/network egress bypass remains a theoretical risk. This is NOT vendor CVE closure.

**Pre-deploy validation:** Uploaded v1.1 to the HTTP-denied maintenance staging directory via authenticated Hostinger TUS and ran `/usr/bin/php -l` on the Hostinger origin: no syntax errors. A separate isolated CLI PHP probe loaded ONLY the candidate guard with WP-function stubs, made no outbound HTTP requests, and returned **12/12 passed**. It rejected loopback IPv4/IPv6, cloud link-local metadata, RFC1918, all IP literals, localhost, internal suffix, gopher protocol, and embedded credentials while preserving known public HTTPS hosts (`www.ishinaillab.com`, `graph.instagram.com`, `themerex.net`). Test evidence preserved privately.

**Safe active deployment with rollback:** A CLI-only one-shot deploy helper (PHP lint passed) validated both exact hashes (`47bee31d611f13e3fb17d0174690ad9f85217b8c7b9c7fbc8757dc2e45e6bb80` old; `fe4578...` new), copied old guard to a private chmod 0600 rollback snapshot at `/home/u328762438/ishi-secure-backups/2026-10-11/ishi-trx-guard-v1-before-v1.1.php`, verified snapshot, and atomically moved v1.1 into the existing MU plugin path `wp-content/mu-plugins/ishi-trx-guard-v1.php`. Hostinger origin reported `TRX_GUARD_V1_1_DEPLOYED_AND_ROLLBACK_VERIFIED`, with deploy report flags `old_hash_verified`, `new_hash_verified`, `backup_verified`, `deployed` all TRUE, `rolled_back` FALSE. Authenticated file list shows active file size 7,337 bytes. Existing `ishi-trx-security-hotfix.php` remains unchanged at 8,762 bytes. The ThemeREX vendor source and all locked business plugins were not modified.

**Post-deploy integration test:** Reran expanded CLI-only read-only tests with actual WordPress bootstrap on production, without attempting real private-network connections and without creating business records. **31/31 passed**. All previously failing loopback/link-local/localhost checks now PASS; newly tested RFC1918, public IP literal, internal suffix all denied; public site, Instagram Graph and ThemeREX HTTPS allowed; TLS/cURL/redirect checks pass; custom AI REST denial and unrelated REST pass; safe anonymous shortcode/metadata behavior pass; no Contributor accounts found and public registration off; active file SHA-256 matches v1.1. WordPress 7.1.3. Protected JSON test report stored in private origin backup directory.
- Independently repeated six-page public asset audit after v1.1 deployment: homepage, booking, contact, shop, cart, dashboard all HTTP 200; **171/171 first-party assets** (68 CSS, 55 JS, 48 images) passed HTTP/MIME checks, no missing Elementor font files. Authenticated WordPress Site Health: 16 good, five recommended, zero critical, which does not replace exploit/regression testing.

**Temporary-file cleanup:** After testing, moved all `ishi-trx-*.json` test and deployment evidence from the HTTP-denied web maintenance directory into `/home/u328762438/ishi-secure-backups/2026-10-11/`. Deleted only the temporary `ishi-trx-*.php` CLI helper files and `.ishi_trx_*` one-time locks from the maintenance folder. Authenticated Hostinger listing confirmed maintenance folder now contains **only** `.htaccess` (86 bytes) and empty `index.html`. Removed every created Hostinger cron job; final authenticated cron list `[]`. Source files and test scripts additionally remain on the authorized Windows desktop for audit.

**Closure boundaries:** Version 2.45.0 remains vendor-advisory affected by CVE-2026-102797 and CVE-2026-102798. No vendor PoC or corrected source diff is available; the new guard covers selected URL validation/REST/metadata/shortcode surfaces but does not prove ALL SSRF or stored-XSS code paths are fixed. NO real exploit against a private destination was attempted. No new staging installation was created, no offsite full recovery copy or test restore performed, no authenticated end-to-end payments/bookings/messaging tested. We must NOT declare these two CVEs permanently closed.

**Follow-up order:** (1) Provision genuine isolated staging via Hostinger hPanel or vetted equivalent, protecting real customer data, disabling outgoing communications and production payments; (2) reproduce safely any vendor-disclosed CVE PoC and test Contributor/Editor capabilities, plus network egress restrictions; (3) clone and restoration-test the current protected backup offsite; (4) run booking/cart/checkout/dashboard/Ishikeit regressions in staging; (5) obtain authenticated ThemeREX 2.47+ vendor source and replace 2.45.0 after verification; (6) keep MU guard v1.1 and previous hotfix under regression monitoring until the true vendor corrections are available.

### Post-v1.1 read-only LatePoint integration check

- Authenticated LatePoint provider-neutral abilities returned **one active service** named `Appointment Reservation` with the intended **180-minute duration**, **one active agent**, and **one active location**. This confirms that the LatePoint service/agent/location read interfaces remain operational after the guard replacement; it does **not** verify appointment slot generation or a completed reservation, payment or notification.
- An attempted WooCommerce read-only product listing through the connected AI Engine integration returned an internal tool failure; no conclusions were drawn about WooCommerce data or checkout from that request and no data was modified.
