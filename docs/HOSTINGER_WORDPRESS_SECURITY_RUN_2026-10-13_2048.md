# Hostinger / WordPress security continuation — 2026-10-13 20:48 Asia/Manila

Supplement to `docs/HOSTINGER_WORDPRESS_SECURITY_CHECKPOINT_2026-10-11.md`. Documentation-only checkpoint branch; DO NOT deploy to production.

## Fresh authenticated evidence

- WPVibe WP-CLI read-only `plugin list`: ThemeREX Addons **2.47.0 active**; Elementor Pro **4.3.0-beta3 active**, update offered **4.3.1**; LatePoint Pro Features **1.7.0 active**, update offered **1.7.3**. Elementor core 4.3.4; LatePoint core 5.7.4; UpdraftPlus 1.26.8. Qwery/ThemeREX vendor provenance is not attested.
- **Completed in the immediately preceding interactive remediation turn:** official WordPress.org Contact Form 7 update **6.2.1 -> 6.2.2**, active. Follow-up WP-CLI checksum verification passed: no mismatched, missing or added files. Read-only Contact page HTML inspection returned content. No forms were submitted.
- Fresh WP-CLI WordPress **7.1.3** core checksum verification passed **3,338 files**, no mismatched/missing/unexpected files.
- WP-CLI `maintenance-mode status` inactive; `cron test` passed, spawn HTTP 200.
- WPVibe authenticated read-only HTML for /appointment/ and /shop/ returned HTML. This does NOT verify payment, login, bookings, editor, or browser behavior.
- `updraft_service` option returned empty and file/database backup intervals remain **manual**. An independent encrypted offsite backup and isolated restore have NOT been verified.
- Earlier this session, official Elementor Pro 4.3.1 update download returned **Unauthorized**, and official LatePoint Pro Features 1.7.3 update returned **Update package not available**; no premium code was changed. ThemeREX 2.47.0 version is above the two Patchstack CVE fixed floors, but a clean official distribution comparison remains pending.
- No production customer data, payments, bookings, locked Ishi plugins, DNS, Cloudflare WAF or staging was modified in this check. No premium plugin replacement was attempted without the vendor package and verified recovery path.

## Official vendor references (checked 2026-10-13)

- Patchstack CVE-2026-102797 SSRF: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-server-side-request-forgery-ssrf-vulnerability
- Patchstack CVE-2026-102798 XSS: https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-cross-site-scripting-xss-vulnerability
- LatePoint October 8 Pro Features 1.7.3 security fixes: https://latepoint.com/changelog/
- Elementor Pro September 30 stable 4.3.1: https://elementor.com/pro/changelog/

## OPEN / safe next steps

1. Authenticate legitimate Elementor and LatePoint vendor licenses/download access. Do not bypass or fabricate.
2. Independently verify Qwery parent and ThemeREX Addons installed files against clean licensed vendor packages; 2.47.0 version alone is insufficient.
3. Establish encrypted off-host full backup and prove restore in isolated environment; verify recovery/rollback.
4. After official packages and recovery are verified, update Elementor Pro and LatePoint Pro Features with compatible isolated regression, then production verification.
5. Complete authenticated isolated booking, checkout, Elementor editing, AI bridge, and customer login regression; preserve protected staging until safe closure.
