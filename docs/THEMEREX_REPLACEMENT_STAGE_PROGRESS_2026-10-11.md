# ThemeREX replacement investigation and isolated migration checkpoint — October 11, 2026

## Production status (NOT fully remediated)

- Live: `https://www.ishinaillab.com/`; active Qwery Child Theme and ThemeREX Addons **2.45.0**.
- Patchstack lists **CVE-2026-102797 (SSRF)** and **CVE-2026-102798 (stored XSS)** as affecting `trx_addons` versions at or below 2.46.0 and corrected in **2.47.0**. Existing production MU security controls are compensating risk reductions, not authenticated vendor security updates.
- User previously lost access to the old ThemeForest license email/account. **Do not request it again**. No new license has been purchased and no untrusted plugin archive has been installed.
- Read-only public smoke on October 11 after the staging work: `/`, `/nail-appointment-reservation/`, `/shop/`, `/cart/`, `/my-dashboard/` and `https://apps.ishinaillab.com/health/ready` all returned **HTTP 200**. No production source files, Elementor data, transactional settings or protected Ishi plugins were changed in this work.

## Secured staging recovery environment

- Separate Hostinger website `security-staging.ishinaillab.com` retains `Require all denied` at HTTP origin and has no public Cloudflare DNS. Direct origin probes after the database restore returned **403** for homepage, `wp-config.php`, `wp-admin/`, and uploads.
- Full October 11 file recovery and **192 database tables** restored into private staging DB `u328762438_ishistageoct` with separate randomly generated database password and WordPress auth salts. WP-CLI-only WordPress bootstrap confirmed the correct staging DB and staging URLs.
- WordPress HTTP API outbound disabled, `wp_mail` suppressed, WP-Cron and WordPress automatic file modifications disabled in staging. No payment transaction, booking, social message or customer email sent. Customer database and plugin secrets require additional scrubbing before any HTTP access is opened to test staff. Do not enable staging DNS or remove denial before PII isolation.
- The test helpers and private file rollback copies are confined to the secured staging environment and its private parent directory, not the public GitHub repo.

## Measured vendor-widget replacement size

Read-only analysis of restored Elementor `_elementor_data` (counts reflect two different scopes):
- Broader dataset: **45 Elementor documents** containing **749 total widgets**, of which **151** are ThemeREX widget instances across **25** documents and **21** distinct ThemeREX widget types.
- Narrower **published-document** report (different query/status filters): **21 documents**, **63 ThemeREX widgets** across **10** documents, including homepage (14), about template (15), LatePoint customer dashboard header (9), about page (9), contact (5), and login (5). These are NOT independent confirmation of identical counts across scopes.
- ThemeREX is embedded in site navigation/logo/cart/search/login layouts and appointments/customer dashboard; simply disabling `trx_addons` on production is known to break the site.

## Real isolated staging-only conversions completed

- Three individually verified simple `trx_sc_title` instances were converted to Elementor's core `heading` widget in staging post IDs **5002, 1453, and 7074**, with isolated private originals and database readback. Hostinger command output: `ISHI_STAGING_TITLE_WIDGETS_MIGRATED=3 IDS=5002,1453,7074`.
- One ThemeREX Contact Form 7 wrapper in staging post ID **1453** was converted to Elementor's core `shortcode` widget using the unchanged existing form ID. Original stored privately, form shortcode rendering verified, database readback verified. Output: `ISHI_STAGE_CF7_WIDGET_MIGRATED post_id=1453 form_verified=true backup=true`.
- A CLI-only Elementor rendering check confirms `Elementor\Core\DocumentTypes\Page::get_content(true)` returned substantial HTML containing `elementor-widget-heading` for the converted pages and `wpcf7` for the converted contact page. `get_content(true)` lengths for posts 5002/1453/7074 were 112,970 / 26,041 / 7,653 characters, respectively. `get_builder_content_for_display()` returned empty strings under this CLI context: **this is NOT a successful browser or CSS-parity proof**. The earlier strict CLI smoke test that expected browser-specific output appropriately failed; use the Elementor document API or true private HTTP browser UAT for subsequent visual evaluation.
- Reviewed eight published ThemeREX button widget instances: **four** `simple`, **two** `hover`, **two** without a declared style. Three conservatively selected simple buttons with no background/icon/custom CSS could plausibly use Elementor core `button`. The deployment of an additional staging button-conversion script was blocked by connected-computer safety checks: **no button conversion was deployed** and no production Elementor data changed. Do not claim those buttons migrated.

## Security cleanup and evidence limits

- Staging had a set of temporary, PHP-CLI-only read-only widget audit/test scripts. A constrained one-shot Hostinger cleanup attempted removal, but its automated observation reported **`CRON_OUTPUT_OBSERVED=false`**. The temporary cleanup cron was deleted successfully (`DELETE_JOB_ACCEPTED=ReazaYqd3M`). The script deletion is **not verified**; repeat authenticated staging directory inventory when file-management access is restored, rather than assuming success.
- Hostinger cron list was empty before the attempted cleanup. Production liveness checks following the attempted cleanup were six HTTP 200s. The staging root is still protected from origin HTTP.
- No offsite independently restorable encrypted backup has been verified. SSH on 147.93.78.149:65002 accepted TCP but did not furnish a usable SSH host key/authenticated SFTP session from authorized desktop; do not bypass authentication or expose archive URLs publicly.
- Browser-based end-to-end booking, payment, customer dashboard and Elementor editor workflows are **not** certified; staging customer data cannot be publicly exposed for such testing.

## Next verified completion criteria

1. Confirm legitimate source integrity of official **ThemeREX Addons 2.47.0+** directly with ThemeREX; their [published support policy](https://themerex.net/support/) says bundled add-on updates are supplied through theme releases or support tickets. Their [presale route](https://support.themerex.net/presale/) is designed for users without a purchase code but requires new registration; do not pretend a ticket was filed. No new purchase without explicit approval.
2. Otherwise, systematically replace all ThemeREX-dependent Elementor widgets **on locked staging** with feature-equivalent, maintained widgets, including global layouts, header/menu/cart/login, and homepage. Track each original in a rollback manifest outside the document root. Explicitly compare CSS/JS and accessibility against captured production baseline.
3. Securely sanitize any copied plugin/API credentials and customer PII before opening a privately authenticated browser route. Verify synthetic Woo checkout, LatePoint booking, Elementor edits, dashboard, CF7, and messaging with no external side effects. Do not publish staging over production.
4. Verify independent encrypted off-host full recovery, then deploy signed/authenticated vendor patch or regression-tested replacement in a narrow production change window; revalidate vulnerable version absent and business workflow continuity. Until then mark both CVEs **OPEN**.

Advisories:
- https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-server-side-request-forgery-ssrf-vulnerability
- https://patchstack.com/database/wordpress/plugin/trx_addons/vulnerability/wordpress-themerex-addons-plugin-2-46-0-cross-site-scripting-xss-vulnerability
