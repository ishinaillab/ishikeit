# ThemeREX Addons 2.45.0 — targeted AJAX/SSRF/XSS review
**Date:** 2026-10-11 (Asia/Manila)  
**Status:** Read-only vendor-source assessment; no ThemeREX vendor files changed.  
**Source:** Pre-remediation version 2.45.0 ZIP, SHA-256 `28bfd3b0f7f7ec18499deb0d936629cedf5bd13c59243698d1a884f3a7e08fcc`, inspected locally on the authorized operator desktop. **This is not an independently authenticated official vendor distribution.**

## Scope and decisive constraints

Official Patchstack/NVD advisories **CVE-2026-102797 (SSRF)** and **CVE-2026-102798 (stored XSS)** describe ThemeREX Addons versions at or below 2.46.0, with 2.47.0 listed as corrected. Neither authoritative public CVE export supplies the exact vulnerable endpoint, function, parameter, or source diff. Do **not** equate the local MU guards with confirmed remediation of either CVE.

The existing production MU plugins remain `ishi-trx-security-hotfix.php` (8,762 bytes) and `ishi-trx-guard-v1.php` (v1.1 implementation, 7,337 bytes). The latter passed a prior 31/31 read-only WordPress test, including rejection of private metadata/loopback addresses and preservation of legitimate HTTPS destinations. It does not guarantee that raw cURL and other code paths are completely constrained.

## Static AJAX registration inventory

A targeted scan found **102 lines registering WordPress `wp_ajax_` / `wp_ajax_nopriv_` handlers** in 2.45.0. This is the number of registration statements, **not** 102 distinct remotely exploitable endpoints. Many hook names are duplicated for authenticated/anonymous access or registered from optional modules.

Nearly all are namespaced `trx_addons_*`, but several use generic action names. The existing MU guard's AJAX restrictions must not be presumed to cover those generic action names. The following handlers were manually inspected; this is a source-level triage, not a working exploit:

| Action | Source, line | Observed behavior | Security decision |
|---|---|---|---|
| `elementor_ajax` | `components/api/elementor/elementor.php:734-752` | Elementor editor-save callback calls `trx_addons_current_user_can_edit($id)` before dispatching a custom action. Other nonce controls may be supplied by Elementor's core dispatcher and were **not** independently verified. | Preserve; do not block the shared Elementor AJAX action globally |
| `ajax_search` | `components/cpt/layouts/shortcodes/search/search.php:139-196` | Public site search checks the ThemeREX nonce, queries **published** content and HTML-escapes the search term used in the WP_Query argument. | Preserve to avoid breaking site search |
| `ajax_sc_posts_search` | `components/shortcodes/shortcodes.php:1441-1488` | Authenticated search checks ThemeREX nonce, queries published posts, and returns title text in JSON. Client-side rendering context was not traced. | Audit eventual client-side HTML insertion before making XSS claims |
| `send_sc_form` | `components/shortcodes/form/form.php:74-120` | Public contact form checks nonce and sends email. Caller data influences plain-text message and reply headers; email is validated/sanitized. | Do not run as a read-only test: could deliver a real message |
| `trx_addons_action_create_preset`, `trx_addons_action_update_preset`, `trx_addons_action_delete_preset` | `components/api/elementor/extensions/type-trx-preset/type-trx-preset.php:28-42,109-215` | Elementor widget presets AJAX functions are enabled by `allow_presets_for_elementor_editor`. The create/update/delete methods check the ThemeREX nonce, but **have no explicit capability test in the inspected handlers**; `preset_name` and decoded `options` are stored without explicit field sanitization at the handler. | **Priority source-review candidate**; the current MU guard's capability gate may independently block Contributor access, but Editors have `upload_files`. Need staging role and output-context tests before tightening permissions |
| `trx_addons_woo_products_add_product_to_cart` and public product-view handlers | `addons/elementor-widgets/classes/Widgets/WooProducts/WooProducts.php:59-68` | Intentionally public WooCommerce browsing/cart integrations. | Preserve booking and shop checkout compatibility |

**Elementor presets setting:** A one-time CLI-only `trx_addons_get_option('allow_presets_for_elementor_editor')` read from the live site returned `1` (enabled). No preset was created or changed, and the read-only cron was deleted.

**Preset persistence sink:** In `type-trx-preset.php:255-263`, `save_presets()` sorts preset titles, JSON-encodes the preset structure, and saves it via `update_option()` under a theme-dependent option key. JSON encoding protects the database representation, **not necessarily later HTML/attribute/JS output contexts**. A stored-XSS claim requires tracing subsequent rendering of these values and validating a safe payload in isolated staging. The advisory does **not** identify this handler as its vulnerable route; this is a candidate, not a CVE attribution.

## Network request inventory

The same source scan identified:
- ThemeREX HTTP helpers around `includes/plugin.files.php:1445-1530`, plus the existing MU-function replacements.
- ThemeREX AI helper raw cURL in `addons/ai-helper/vendors/ThemeRex/Ai/Api.php:173+`, which exposes the `trx_addons_filter_ai_helper_curl_info` interception used by MU guard v1.1.
- A Twitter OAuth vendor cURL call in `components/api/twitter/tmhOAuth/tmhOAuth.php:778`. Endpoint construction and reachability were **not** verified; do not claim it is covered by the AI-specific cURL filter.
- WordPress HTTP callback to ThemeREX's own feed in `components/dashboard-widget/dashboard-widget.php:189`.
- Several `file_get_contents` calls for local package data and local CSS; they are not demonstrated SSRF sinks merely because they contain that function name.

**Residual risks:** Unknown CVE-specific paths; direct cURL calls not guaranteed to traverse the WordPress HTTP filters; DNS rebinding between DNS validation and connection; untrusted stored-value rendering by optional Elementor widgets.

## Live regression and recovery readiness

- Six public WordPress pages (home, booking, contact, shop, cart, dashboard landing) returned **HTTP 200** at latest probe.
- Automated first-party HEAD requests: **68 CSS + 55 JavaScript + 48 images = 171 / 171 passed**, zero missing or incorrect CSS/JS MIME responses.
- Authenticated LatePoint read interface still returned **one 180-minute active reservation service**, one active agent and one active location.
- WordPress core reports 7.1.3. Site Health displayed five recommendations, including a stale/inconsistent `WordPress update available (7.0.3)` label. **Do not downgrade** a higher installed core version based on that label.
- Hostinger lists only one WordPress installation and no separate staging WordPress site; connected Hostinger MCP has no supported shared-hosting staging creation or full backup download operation. A seven-part UpdraftPlus backup remains on the origin but an independent offsite backup and test restoration **remain incomplete**.
- Read-only Cloudflare R2 inventory failed with API error 10042, *Please enable R2 through Cloudflare Dashboard*. R2 is not currently available; do not enable a potentially billable feature without an authorized storage/retention and recovery plan.
- Authorized Windows computer has `scp` and `ssh` clients but no private SSH keys in the default `.ssh` folder. Therefore direct authenticated SCP/SFTP restoration was not established in this session.

## Next technical checkpoint

1. Obtain isolated staging through Hostinger hPanel or vetted equivalent, and scrub or disable outgoing payment, email, AI messaging and customer webhook actions in the clone before testing.
2. Verify the effective current Contributor/Editor capability gates of Elementor preset AJAX functions; inspect public/editor JavaScript handling of saved titles and JSON options. If the path is reachable, write a **narrow source-proven admin capability + contextual escaping fix**, with fail/pass tests. Avoid blocking WooCommerce, LatePoint or generic Elementor actions.
3. Acquire an independent complete website+database backup via hPanel or another authenticated private transport. Integrity-check every archive against UpdraftPlus recorded digests and actually restore the clone.
4. Acquire genuine ThemeREX Addons **2.47.0+** or a vendor-authenticated source diff; compare the precisely corrected functions and verify the CVEs against the clone.
5. Keep the two live MU guards while production runs; do not declare the CVEs permanently fixed without the source comparison and exploit-specific tests.

## References

- https://nvd.nist.gov/vuln/detail/CVE-2026-102797
- https://nvd.nist.gov/vuln/detail/CVE-2026-102798
- https://www.hostinger.com/support/5981435-how-to-download-backups-at-hostinger/
- https://www.hostinger.com/support/5720286-how-to-create-a-wordpress-staging-environment-in-hostinger/
- https://developers.cloudflare.com/r2/get-started/s3/

## Subsequent targeted remediation: Elementor preset role guard

**Implemented and production-verified later the same day:** Enabled production preset editing was confirmed. A separate custom MU plugin at `wp-content/mu-plugins/ishi-trx-preset-access-guard.php` now requires `edit_theme_options` capability to execute the four site-wide preset create/update/delete/import actions, while leaving general Elementor AJAX and public form/search/cart actions untouched. Source tracked in `ops/wordpress-security/ishi-trx-preset-access-guard-v1.php`.

Isolated role tests passed **17/17** and an unauthenticated live origin AJAX request to the protected create-preset action returned **HTTP 403** with the expected `ishi_trx_preset_insufficient_capability` code. The frontend 171-asset smoke suite passed after deployment. Site currently has zero Editor accounts and zero Contributors, but authenticated administrator preset editing has not been exercised. This is a local security hardening for an observed missing capability check, **not** a verified correction of the undisclosed CVE-2026-102798 source path.

See the [production security checkpoint](HOSTINGER_WORDPRESS_SECURITY_CHECKPOINT_2026-10-11.md) for rollback, detailed test and inventory evidence.
