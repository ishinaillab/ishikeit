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
