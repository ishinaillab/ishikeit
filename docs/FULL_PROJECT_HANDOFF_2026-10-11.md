# Complete Ishi / Ishikeit continuation handoff — October 11, 2026

**Purpose:** Durable, source-backed context for a NEW ChatGPT conversation. This document consolidates the most recent WordPress/Hostinger security work with the independent Ishikeit app and database project. It is intentionally committed on the **non-production checkpoint branch**, not `main`. **Reading or committing documentation here does not deploy code.**

**Critical distinction:** This file records observed states with explicit verification limits. The newest read-only WordPress reconciliation at approximately **2026-10-11 19:46 Asia/Manila** reports **ThemeREX Addons 2.46.0 active in production**. Earlier checkpoints correctly describe the site's previous 2.45.0 state. Do **not** assume the latest live plugin is still 2.45.0; **independently inspect** and hash the live files before any new change. Both vendor CVEs remain OPEN under the public version criterion, because the source-level security defects were not independently proven fixed.

## 1. User's instructions and hard boundaries

- The user operates Ishi Nail Lab / Ishí, a premium hand-only private, appointment-based nail studio in Quiapo, Manila, with a real WordPress shop, booking and dashboard and a separate messaging app. They want **complete, careful vulnerability remediation**, not repeated progress statements and not an untested removal that breaks the business.
- User explicitly lost the ORIGINAL Qwery/ThemeForest purchasing account and its very old email long ago. **Do not request the lost email, purchase code, or license again.** Do not alter activation logic, bypass paid licensing, download nulled packages, or represent a custom hardening change as a licensed vendor 2.47.0 update.
- User supplied an **untouched ThemeREX Addons 2.46.0 archive** and authorized careful local security patching of that source. Preserve both untouched source and exact modified ZIP, diff and cryptographic fingerprints.
- Maintain active revenue/customer functions: Qwery/Elementor display, LatePoint appointments, WooCommerce and press-ons, customer dashboard, Contact Form 7, WordPress AI Engine bridge, Meta messaging, and Ishikeit. Do not send live test messages, real bookings/payments, or customer emails without justified authorization.
- Three specially protected WordPress Ishi custom plugins must **not** be modified without express permission: **Ishi LatePoint Agent Portal 0.7.3**, **Ishi LatePoint Instant 1.9.0**, **Ishi Elementor Fix 4.3.0**. Preserve unified dashboard behavior, customer data, existing bookings, security guards and product settings.
- Do **not** use the retired `/ishinaillab/ishi` codebase. Canonical app is `ishinaillab/ishikeit`, database project `ishinaillab/ishikeit-db`.

## 2. Domains, hosting, production architecture

- Public/canonical website: **https://www.ishinaillab.com/**. Hostinger WordPress/Qwery, DNS and edge security via Cloudflare. Root `ishinaillab.com` redirects to HTTPS www; `povnailstudio.com` is legacy/redirected. WordPress origin IP **147.93.78.149** (Hostinger shared host `sg-nme-web1858`). WordPress root: `/home/u328762438/domains/ishinaillab.com/public_html`.
- Separate Node 24/Fastify provider-neutral **Ishikeit** messaging/automation app at **https://apps.ishinaillab.com**, started with `node dist/processes/http.js`. Health: `/health/live` and `/health/ready`; production health was repeatedly 200/ok and 200/ready in preceding checks. Its files, environment and Supabase tables are NOT the WordPress plugin source.
- Privately restored WordPress staging: **security-staging.ishinaillab.com**, separate website root `/home/u328762438/domains/security-staging.ishinaillab.com/public_html`. No public DNS, origin `.htaccess` begins `Require all denied`; independent probes returned 403 for stage homepage, admin, config and uploads. **Never expose this stage publicly**: it contains copies of production data and plugin/API configuration. No authenticated browser UAT has been authorized/completed.
- Stage database is distinct from production: **u328762438_ishistageoct**, independent credentials on stage host via `localhost`, recovered from October 11 Updraft SQL dump. Restore output **528 SQL statements / 192 tables**; stage WordPress boot confirmed correct DB, stage URLs, WP_ENVIRONMENT_TYPE=staging.
- Stage has a must-use outbound kill switch `ishi-staging-network-email-killswitch.php` blocking WP HTTP API, `wp_mail`, WP-Cron, WP file modification/updates. Stage `wp-config.php` uses separately generated salts, DISABLE_WP_CRON, WP_HTTP_BLOCK_EXTERNAL, DISALLOW_FILE_MODS, and stage URLs. Do NOT apply this stage-only kill switch to production.
- Cloudflare zone active on Free plan, Free Managed WAF enabled and three custom block rules protecting uploads/report/backup paths. DNSSEC and suitable TLS configuration previously set. **Caveat:** the origin was directly reachable by IP + host/SNI, bypassing Cloudflare WAF; origin WordPress guards remain essential. Do not implement an untested origin-IP block on shared Hostinger.
- LiteSpeed Cache **7.9.1 remains disabled** after earlier Elementor frontend regressions; do not reenable blindly. WP Site Health most recently reported **one critical performance** item (cache/response latency) and four recommended items, NOT a vulnerability-free certification.

## 3. ThemeREX vulnerabilities and latest production state

**Official advisories (October 2, 2026):**
- **CVE-2026-102797**: ThemeREX Addons SSRF, versions **through 2.46.0**, fixed vendor version **2.47.0**.
- **CVE-2026-102798**: ThemeREX Addons stored XSS, versions **through 2.46.0**, fixed vendor version **2.47.0**.
- Both list Contributor-level prerequisites. No Contributor/Editor/Author user accounts were present in an earlier live role inventory, but account composition can change. Absence of affected roles is mitigation, not proof of safe code.
- Patchstack SSRF: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-server-side-request-forgery-ssrf-vulnerability
- Patchstack XSS: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-cross-site-scripting-xss-vulnerability
- Public notices do **not** establish the exact vulnerable function, source/sink, parameter, or official 2.47 diff. Do not claim a custom patch definitively closes these two exact CVEs without reproducible tests or a proper vendor diff.

**Version history — do not confuse timestamps:**
1. Most of October 11, production ThemeREX Addons was **2.45.0**, Qwery theme **3.8.0** with active Qwery Child Theme. Many mitigation-only WordPress MU guards were installed.
2. User provided *untouched 2.46.0* archive with **SHA-256 `eef273dcaa82a7c2d01df289a1b20277259dfe3e280b95fa5dd0c8fde607885d`**, 2,609 archive entries, internal header Version 2.46.0, ZIP CRC test passed. Its being untouched/CRC-valid is NOT a verified vendor digital signature.
3. An independently hardened ZIP named **`trx_addons-2.46.0-ishi-security-hardening.zip`** was constructed from the untouched archive, **SHA-256 `df755d4b12c05bd747db762e0bb5632428c9ec31705985119fc892358f1d209e`**. It changes precisely two plugin PHP files, `trx_addons/includes/plugin.files.php` and `trx_addons/includes/plugin.media.php`, without changing license/activation code or declaring a fake vendor version. Scope: stricter HTTP/Safe URL / TLS / redirects and SVG file handling and sanitization. Static checks in the current conversation reported **1,122 PHP files syntax-valid, 20 focused security/compatibility checks and intact ZIP**. These are local tests, NOT official CVE exploit regressions.
4. The exact hardened ZIP was uploaded to the **locked staging** WordPress, and 2.45.0 staged plugin directory was privately backed up. CLI stage audit confirmed ThemeREX Addons **2.46.0** loaded, WooCommerce/LatePoint loaded, unsafe outbound destinations denied, and malicious SVG script/onload/event content sanitized while benign SVG path and plugin SVG asset remained. Additional Elementor smoke tests and rollback helpers were being developed.
5. **Most recent independent 19:46 read-only audit:** active **production** plugin version is **2.46.0** according to authenticated WordPress plugin inventory, changed since preceding 2.45.0 checkpoint. That audit did not itself make a live plugin change. It did **not** verify live `plugin.files.php` / `plugin.media.php` SHA-256 or complete browser/checkout regression. Therefore do not assert the live installation matches the hardened ZIP until an independent file-by-file hash/readback. A staging promotion/preparation script and prior 2.45 rollback directories exist as evidence clues; verify actual live state before further writes. No vendor 2.47 package has been obtained.
6. **Official vulnerabilities still OPEN** for both CVEs. Custom defenses strengthen site security but are not a documented equivalent to the undisclosed vendor fix.

**Expected source SHA-256 within the hardened package**, to compare with live and stage:
- `trx_addons/includes/plugin.files.php`: **`f5855f75ef6e2cc8547fcc39d293c0729ee4d57daa32fb71c75527fedff41c42`**
- `trx_addons/includes/plugin.media.php`: **`a3ff2c3b50da1ce7b03d2cac35206658a283998a62714646b80ae0d785553ef7`**
- Clean untouched 2.46 source corresponding file SHA-256:
  - `plugin.files.php`: **`6554907df5518e6614424ea1cdd242226ca3856ab2dc4662fca8efd2f6b3ea08`**.
  - `plugin.media.php`: **`1475a0cfcb805c76dc461453e87bd737a9be2caf0b41c1841aaa99ed071842b0`**.
All hashes are archival evidence from current conversation. Reverify exact file locations and bytes on production instead of assuming paths.

**Other observed unsafe code:** the original 2.45/2.46 `trx_addons_remote_curl()` disables TLS certificate verification and follows redirects and permits custom cURL option overrides; static audit found no direct call sites in the supplied 2.46 plugin. A separately deployed production MU shim uses the WordPress safe HTTP API, requires HTTPS, denies local/private URLs, proxy and custom override arguments, blocks redirects, enforces TLS, and limits response size/time. This corrects a hardening weakness but has **not** been demonstrated as either CVE root cause.

**Existing production WordPress MU protection inventory (do not casually disable):**
- `ishi-trx-security-hotfix.php`
- `ishi-trx-guard-v1.php` (later v1.1 amendments within guard family)
- `ishi-trx-preset-access-guard.php`
- `ishi-trx-preset-output-guard.php`
- `ishi-trx-unused-ai-surface-guard.php`
- `ishi-trx-authenticated-ajax-role-guard.php` (v1.0.1; correctly handles `has_action(...)=0` using strict false comparison)
- `ishi-trx-safe-curl-shim.php`.
These controls protect ThemeREX administrative AJAX, preset access/output, unused AI generators, and outbound requests. Sample unauthenticated ThemeREX AI/importer/preset requests returned HTTP **403**. The cURL shim was deployed to production and successfully verified via live WordPress runtime before the 2.46 stage work. Review interactions with the 2.46 custom code before removing or overriding any guard.

## 4. Backups, tests, and production regression evidence

- Full seven-part UpdraftPlus production backup from October 11, ID **`38f852af2c1e`**; stored on Hostinger `wp-content/updraft`, about 1.067 GB total across chunks. Also a secure root/core/wp-config archive under `ishi-secure-backups/2026-10-11`. Private staged old plugin rollback and restored staging DB exist. **No independently tested encrypted off-host recovery copy yet**.
- Multiple unauthenticated read-only public regressions previously returned **HTTP 200** on homepage, booking, contact, shop, cart, customer dashboard, WordPress REST and Woo Store API; separate Ishikeit readiness 200. One audit loaded **171 assets** (68 CSS, 55 JS, 48 images), zero failures.
- These tests do NOT prove visual CSS equality, Elementor editor saves, real LatePoint appointment creation, Woo checkout/payments, live client dashboard authentication, Contact Form 7 actual submission, or social messaging send/receive. Staging's complete origin-deny precludes browser testing until customer PII, secrets, and authentication isolation are addressed.
- Current checkpoint after reported production 2.46 update has **not yet** established independently tested runtime and exact code identity. Resume with **read-only** WordPress plugin list, full relevant hashes / diff vs untouched and hardened ZIP, WP fatal logs/Hostinger runtime; then page/asset/browser and isolated business workflows. Check backup/rollback adequacy before changing production again.
- Hostinger temporary audit cron jobs had been cleaned up: authenticated list **`[]`** as of the latest read-only reconciliation. Recheck before creating new scheduled tests.
- There are also outstanding Elementor Pro / LatePoint premium-plugin update issues: Elementor Pro installed **4.3.0-beta3**, stable **4.3.1** offered with authenticated WordPress package_available true (not yet upgraded); **LatePoint Pro Features 1.7.0**, **1.7.3** available/security fixes but `package_available=false`; LatePoint main **5.7.4**. Do not install unauthorized/nulled ZIPs. Elementor’s official update guidance requires backup and staging regression tests.

## 5. ThemeREX dependency/migration evidence (alternative to vendor patch)

- Existing design is heavily built using ThemeREX Elementor widgets; instant removal breaks important layouts. Private staging audit: broad scope **151 ThemeREX widget instances over 25 Elementor documents** (45 documents overall), and narrower published scope **63 instances over 10 documents** (different filter criteria, do not conflate). Broader later published scan surfaced roughly **19 distinct ThemeREX widget types**.
- Seven individual ThemeREX widget instances were successfully replaced **only in staging**: three plain title widgets to native Elementor heading (post IDs 5002,1453,7074), one Contact Form 7 wrapper to native Elementor shortcode (post 1453), three simple buttons to native Elementor buttons (post IDs 21231,19880,17495). Original Elementor JSON backups stored privately outside staging document root.
- A CLI test with ThemeREX temporarily excluded only from that one stage bootstrap verified Elementor's built-in widgets and converted content still rendered, but page HTML was shorter and other widgets did not. **Full equivalent design/functionality NOT achieved**.
- Elementor Pro registers potential replacement widgets for menu, logo, Woo cart, search, login, galleries/maps/sliders and core social controls; audit found 15 logo, 12 menu, 10 cart, 10 search, 8 login instance patterns. Real responsive/menu/cart and CSS parity still need rebuilding and verification before ThemeREX can be removed.
- This migration is an alternative fallback, NOT a completed production change. Do not deploy the security checkpoint branch as the app or deactivate ThemeREX on production merely because some widgets were converted.

## 6. Ishikeit app — separate deployed production codebase

**Canonical repositories:**
- App **https://github.com/ishinaillab/ishikeit**, production branch `main` with deployment to **https://apps.ishinaillab.com** (Hostinger Fastify Node 24, TypeScript build `npm run build`, entry `dist/processes/http.js`).
- DB/migrations **https://github.com/ishinaillab/ishikeit-db**, Supabase PostgreSQL; managed through `supabase/migrations/`, with durable messaging tables `inbound_events`, `outbox` and extended provider/automation functionality. Avoid ad-hoc production migrations.
- Durable authoritative app-specific handoff **[docs/CONTINUATION.md on main](https://github.com/ishinaillab/ishikeit/blob/main/docs/CONTINUATION.md)**. This 130k+ character document contains Meta/Instagram token lifecycle, webhook, processor, retry/outbox, WordPress integration, TikTok API/OAuth/marketing/messaging implementation, testing and deployment checkpoints. **Read it in the next chat** before changing Ishikeit; this WordPress security checkpoint does not replace it.

**Functionality and provider state:**
- Provider-neutral durable inbound webhook `→` persisted event `→` WordPress AI Engine bridge `→` outbound processor/dispatch/retries. Supports multi-platform future expansion and text/images/videos/audio/documents subject to provider capabilities.
- User confirmed messaging functioning on **Facebook Messenger, Instagram (including both old tester identities `povnailstudio.ph` and `povnailstudio.com.ph`), and WhatsApp** earlier. Retest before claiming live current availability. Separate Telegram token reported saved, but account/feature activation is a separate milestone.
- Instagram OAuth paths and verification/role permissions described in app continuation; latest Meta App Review readiness requires provider approval and correct tester/app role/permissions. Don't alter secrets or guess provider approvals.
- TikTok Business app permission/scope review was pending, including Business Messaging activation; user deferred automated **mention/comment responses** until TikTok app approval. Do not silently turn on those automations. Separate TikTok Marketing OAuth and advertiser read features were already implemented, provider access conditional.
- App `main` previously included PR **#67** deployment with TikTok Business Messaging image send and conversation category/capability preflight `tiktokBusinessMessagingImageSendSchema: 2`, plus `tiktokBusinessMessagingReadSchema: 1`, `tiktokBusinessMessagingWebhookSchema: 1`, `tiktokMarketingOAuthSchema: 2`, `tiktokMarketingAdvertiserSchema: 2`. The preflight resolves `SINGLE` and `STRANGER` with bounded pagination and checks `IMAGE_SEND` before media I/O; image feature **dormant until provider credentials/access**. See `docs/CONTINUATION.md` for exact PR/CI/live verification (34 test files/244 tests and Node 24 check passed at merge checkpoint).
- The WordPress AI bridge and production AI Engine path have changed historically, including a legacy separate WordPress site. **Read deployed env/config and app docs before changing URLs**; do not blindly substitute `povnailstudio.com` or `ishinaillab.com`.
- Protect direct WordPress custom business plugins listed above and current LatePoint × Woo dashboard integration.

## 7. Current tools, project artifacts, and secrets handling

- GitHub checkpoint branch: **`checkpoint/hostinger-wordpress-security-2026-10-11`** under `ishinaillab/ishikeit`. Security working files:
  - `docs/HOSTINGER_WORDPRESS_SECURITY_CHECKPOINT_2026-10-11.md` (large history/audits, last independently checked production 2.46 state)
  - `docs/THEMEREX_REPLACEMENT_STAGE_PROGRESS_2026-10-11.md` (Elementor migration and isolation).
  - `docs/security-artifacts/*.php` (selected original first-party MU guard sources; NOT the full 2.46 ZIP).
- Owner-supplied unchanged and hardened ZIP copies in the authorized connected Windows computer, under `C:\Users\MBDS\Downloads\`: `trx_addons-2.46.0_untouched.zip` and `trx_addons-2.46.0-ishi-security-hardening.zip`. Connected Desktop Commander device **DESKTOP-D5MF1GE**; `C:\Users\MBDS\Downloads\hostinger-mcp-client` contains authenticated Hostinger MCP scripts (e.g. `hostinger_call.mjs`, guarded one-shot cron, stage upload helpers) and `C:\Users\MBDS\Documents\IshiSecurity` contains audited sources/temporary tests and private backups.
- Use official Hostinger connected tools and authorized client rather than sharing or printing credentials. Do NOT copy staging `wp-config.php`, DB credentials, auth tokens, customer data, unpublished logs, or exact private source into public GitHub. Do not try to recover lost vendor credentials or alter paid-plugin licensing.
- WPVibe was connected but returned **Free daily fair-use cap** at this transfer; further WPVibe calls were explicitly blocked at that moment. Use connected Hostinger read-only verification; do not consume a banked WPVibe quota reset without explicit user instruction.
- Sandbox file paths are session-specific. Do **not** invent a download URL in a new chat. Use supplied uploaded ZIP, connected computer, official Hostinger, or verify file bytes again if needed.

## 8. Exact next action sequence when conversation resumes

1. **Read this file and the two security checkpoint documents, PLUS `docs/CONTINUATION.md` on Ishikeit `main`.** Avoid unrelated app changes and never use retired `ishi` repository.
2. **Confirm current live ThemeREX files**: plugin header/version, SHA-256 for `plugin.files.php` and `plugin.media.php`, diff against original owner 2.46 ZIP and independently hardened package, who/when deployed if audit logs permit. Previous independent audit showed 2.46 live at 19:46, but identity of live modified bytes and exact CVE closure were not established.
3. Verify `trx_addons` and Qwery runtime, versions/licenses without activation bypass, all preexisting MU protection, errors/WP debug logs with private-safe reporting; health pages, critical booking/customer/shop endpoints, assets. Reconcile check against latest official Patchstack/NVD/Wordfence vendor advisories and security-research disclosures if they become available; **identify concrete vulnerable functions/exploit path instead of general mitigation only**.
4. Preserve a verifiable private rollback of the exact current production plugin and sufficient independent backups **before writes**. Don't disable WordPress security guards or install nulled packages. Keep stage `Require all denied` and outbound suppression throughout until all test data/credentials are sanitized.
5. If modified 2.46 genuinely addresses vulnerable entry points, write tests for contributor-role SSRF / stored-XSS behavior and compare patched/unpatched behavior in isolated staging. Without actual vulnerability root-cause evidence, **do not certify these two CVEs as fully remediated** even if general hardening and status checks pass. If verified vendor-fix code remains inaccessible, continue careful code audit or isolated functional migration, and present unresolved gaps transparently.
6. Test security and compatibility on stage: PHP lint, integrity hashes, constrained URLs (localhost, metadata IP, IPv4/IPv6, redirects, DNS rebinding defense where possible), SVG/sanitizer event handlers; Elementor/Qwery layout; Woo Store/cart/checkout; LatePoint bookings; customer dashboard/login; AI gateway and provider dispatch, with external side effects blocked. Obtain private HTTP testing only after locking down copied PII and secrets.
7. Carefully promote only audited changes with zero-downtime/atomic plugin directory switching and immediate rollback criteria. Recheck live product functions and all security guards. Never mistake a mere `Version: 2.47.0` string edit for a corrected vulnerability.
8. Commit accurate results, checksums, rollback/recovery evidence to this checkpoint branch. Update application `main` docs only when the app actually changes; no premature production code promotion.
9. If instead continuing TikTok messaging, start from Ishikeit `main` `docs/CONTINUATION.md`, verify live feature flags and current TikTok access, and honor the user's explicit deferral of comment/mention automations until approval.

## 9. Notes on certainty

- **Verified:** newest prior read-only report says live ThemeREX **2.46.0**; patched ZIP exists by recorded digest; a staging install and targeted runtime checks previously succeeded; production MU defenses present at prior smoke; Updraft backup/staging isolated restore; provider-neutral Ishikeit deployment history.
- **Not proven:** live PHP byte-for-byte equality with hardened ZIP; authentic ThemeREX 2.47 fix or exact CVE root-cause/diff; full CVE exploit prevention; fully tested new plugin in live authenticated client workflows; independently restored offsite encrypted backups; vendor security ticket accepted; TikTok API approval; final live feature state beyond previous health probes.
- **Safe reporting:** use `mitigations in place; official CVEs still open` rather than `fully fixed`. Prefer evidence-based progress and executing authorized safe next steps to repetitive status-only messages.

## 10. Same-day independent read-only continuation after handoff (October 11, 2026)

This section supersedes the prior uncertainty **only for the specifically verified files and endpoints**. It is not a new production release. All tests were non-mutating; the sole new mutation was updating this non-production checkpoint document.

### Live source verification, exact fingerprints
- Authorized Hostinger WordPress inventory: `trx_addons` **2.46.0 active**, with **two vendor CVEs still reported**: CVE-2026-102797 SSRF and CVE-2026-102798 stored XSS; fixed vendor floor remains 2.47.0. Elementor core 4.3.4 active, Elementor Pro 4.3.0-beta3 active/update available, LatePoint 5.7.4 and LatePoint Pro Features 1.7.0 active, WooCommerce 11.2.1 active, LiteSpeed Cache 7.9.1 inactive.
- Live `wp-content/plugins/trx_addons/includes/plugin.files.php`: **60,172 UTF-8 bytes**, SHA-256 **`f5855f75ef6e2cc8547fcc39d293c0729ee4d57daa32fb71c75527fedff41c42`**. This **matches** the locally hardened archive exactly.
- Live `wp-content/plugins/trx_addons/includes/plugin.media.php`: **105,486 UTF-8 bytes**, SHA-256 **`a3ff2c3b50da1ce7b03d2cac35206658a283998a62714646b80ae0d785553ef7`**. This **matches** the locally hardened archive exactly.
- Source extraction was performed read-only using Hostinger's authenticated `hosting_files_website-content` endpoint; for the long media file, page-boundary overlap was removed before reconstructing the exact byte count and hashing. Two matching PHP files **do not prove every other file in the 2,609-entry plugin matches** or establish closure of the October CVEs.
- Current Windows local ZIP SHA-256 repeated and matched earlier record: untouched 2.46.0 **`eef273dcaa82a7c2d01df289a1b20277259dfe3e280b95fa5dd0c8fde607885d`**; independently hardened 2.46.0 **`df755d4b12c05bd747db762e0bb5632428c9ec31705985119fc892358f1d209e`**.
- Production MU inventory shows the seven expected Ishi ThemeREX guards: `ishi-trx-security-hotfix.php`, `ishi-trx-unused-ai-surface-guard.php`, `ishi-trx-preset-access-guard.php`, `ishi-trx-guard-v1.php`, `ishi-trx-authenticated-ajax-role-guard.php`, `ishi-trx-preset-output-guard.php`, and `ishi-trx-safe-curl-shim.php`. Three protected business plugins are still active at their locked versions 4.3.0, 0.7.3, and 1.9.0 respectively. File presence and plugin list were independently verified; no new security guard mutation was made.

### Staging and safe operations readback
- Hostinger stage root listing verifies `wp-config.php`, `.htaccess`, `wp-admin/`, `wp-content/`, and `wp-includes/` remain. `.htaccess` was read verbatim and still contains **`Require all denied`**. The stage MU inventory still includes `ishi-staging-network-email-killswitch.php` and `ishi-staging-trx-off-test.php` in addition to the seven common guards.
- Stage ThemeREX header directly read from stage file API says **2.46.0**. Stage `plugin.files.php` and `plugin.media.php` also independently matched the two hardened fingerprints above at exact reported byte lengths.
- An HTTP direct-origin test of stage home, `wp-login.php`, staging smoke helper, and rollback helper returned **403 each**. HTTPS direct-origin stage probes failed TLS handshake with the available clients (**not** an HTTP 403 test); HTTPS behavior and authenticated browser UAT remain **unverified**.
- Stage root currently still contains `stage_246_elementor_functional_smoke_20261011.php`, `stage_246_elementor_functional_smoke_v2_20261011.php`, `rollback_prod_trx_246_20261011.php`, and the hardened plugin ZIP. They remain behind origin deny; before any stage exposure, verify/relocate these CLI helpers and sanitize cloned personal data and secrets. No helper was invoked or removed in this pass.
- Authenticated Hostinger cron inventory returned **`[]`**. A combined staging audit script failed with API **422** because its `hosting_databases_list` request uses an incompatible `is_assigned` parameter shape; independent file and cron calls succeeded. This is a test-script error, not evidence of stage database failure. Distinct stage DB and outbound kill-switch runtime behavior are supported by prior October 11 CLI checkpoint, **not freshly re-proven** here.

### Public functional and asset smoke
- Fresh six-page unauthenticated HTTP crawl: **200** for home, `/nail-appointment-reservation/`, `/contact/`, `/shop/`, `/cart/`, `/my-dashboard/`.
- **171 same-host assets** checked by HEAD (68 CSS, 55 JS, 48 images), **zero failures** by this test. Headless Chrome (fresh temporary profile) checked booking (latepoint marker present, document complete), contact (CF7 form present, document interactive), cart (document complete, no empty-cart form marker), dashboard (document complete, login/guest state; dashboard marker absent). No observed uncaught JavaScript errors or network failures in these four samples. Absence of guest dashboard/cart markers is not proof of a regression.
- `GET /wp-json/` **200** with routes; Woo Store API `GET /wp-json/wc/store/v1/products?per_page=5` **200**, returned four products. Separate Ishikeit `/health/live`, `/health/ready`, `/health/capabilities` all **200**; first two returned `ok` and `ready`. This establishes only runtime responsiveness, not end-to-end inbound/AI/outbound messaging.
- No real booking, payment, email, logged-in dashboard, Elementor edit/save, or provider message was created or sent. No production or staging plugin, theme, DB, domain, DNS, policy, role or guard changes were made.

### Outstanding priority and safe next step
1. **Still OPEN:** two official ThemeREX Addons CVEs because version 2.46.0 is affected in the vendor advisory and no authenticated exploit-specific regression test or official 2.47.0 patch diff has been established. Preserve both current hardening and origin MU guards. Do not upgrade the plugin by changing its version metadata, use an untrusted ZIP, deactivate a dependency-heavy plugin, or bypass license checks.
2. Perform contributor-authorized SSRF and stored-XSS sink/source tracing (ideally using authentic 2.47.0 vendor fix or validated disclosure) **in the locked stage**, only then patch targeted entry points and independently prove red/green exploit regression and frontend parity. Vendor 2.47.0 from an authorized source remains preferred; no lost purchase credentials should be sought.
3. Before risky production changes, obtain and restore-test independently stored encrypted off-host backup, isolate/redact copied staging PII/secrets for safe authenticated UAT, and verify checkout/booking/dashboard/layout behaviors. Stage's deny and outbound controls remain non-negotiable until then.
4. Check fresh production PHP/runtime error telemetry through privacy-minimized diagnostics, verify actual full plugin directory file integrity and surviving rollback directory, and assess Elementor Pro/LatePoint premium updates separately behind recovery/UAT gates.

**Evidence boundary:** exact two PHP source identities verified; stage origin deny verified on HTTP; public health smoke good; **CVE closure, entire-plugin integrity, authenticated business transactions, direct-origin HTTPS stage response, and offsite restoration remain unverified**.
