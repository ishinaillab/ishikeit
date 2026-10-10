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
