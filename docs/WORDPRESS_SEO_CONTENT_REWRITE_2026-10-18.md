# Ishi Nail Lab — WordPress SEO and Critical Content Rewrite Checkpoint
**Date:** October 18, 2026 (Asia/Manila)  
**Website:** https://www.ishinaillab.com  
**Branch:** checkpoint/hostinger-wordpress-security-2026-10-11 (documentation only; do not deploy)  
**Scope:** editorial, local SEO, accessible content, privacy-sensitive client dashboard. All premium-plugin vulnerability fixes remain expressly on hold.

## Verified live-site inventory
- 61 installed plugins: 50 active, 11 inactive.
- Preferred workflow: SEO Engine Pro 0.9.4 for *one* source of SEO metadata/schema; Auditizer 1.5.6 for audit and reviewed suggestions; AI Engine Pro 3.8.0 for writing; Site Kit and direct Google Search Console for actual performance; Elementor and Gutenberg for preserving editing structures; Easy MCP AI/WPVibe for restricted review and writes. Do not install a second full SEO suite or blindly run AI bulk rewriting.
- Published content: 21 pages, 10 posts, 12 service CPT items, 9 portfolio entries, 4 WooCommerce products, 3 team profiles, 3 testimonials (62 published items). Counts cover these types only, excluding templates, orders, media and other CPTs.
- Auditizer database: 61 recorded scans touching 31 unique posts/pages (21 pages + 10 posts); **none** of the 31 published service/product/portfolio/team/testimonial CPT entries were audited. 204 recorded issues = 105 SEO (including 6 fixed), 77 SGE/AI-search heuristics, 22 accessibility; 198 pending, six marked fixed. Heuristic SEO scores are not Google ranking metrics.
- Homepage mobile Lighthouse: SEO 92, accessibility 90, best practices 96. Failures included uncrawlable links, contrast, heading order, nameless links, absent main landmark, browser console errors.
- Exact 129 image attachments in WordPress media library have *no saved _wp_attachment_image_alt metadata*, even though some rendered content contains alt attributes. Distinguish decorative images from informative images before writing descriptions.
- Canonical head links: absent from sampled home, about, contact, service, shop, dashboard, and other page types. SEO Engine `mwseo_options` enables auto metadata and WordPress sitemap, while frontend site title is only `Ishi`. Existing structured JSON-LD often emits generic Article/Person/Organization/WebPage on ordinary pages, including dashboard; investigate generating plugin before changing schema. WordPress sitemap `/wp-sitemap.xml` exists and robots.txt references it.
- High-priority irrelevant published content: 2020-2021 theme/demo posts with placeholder prose; team profile pages with stock names; four WooCommerce products include Pedicure and Foot Massage while the business is hand-only. Do not automatically unpublish/delete these without reviewing dependencies, incoming search traffic and old orders. /services/pedicure/ is an *old slug* serving a second Custom Press-Ons service, alongside /services/custom-press-ons/. Preserve URL until a tested 301/internal-link consolidation.
- Home public title currently `Home | Ishi`, multiple H1s and legacy placeholders (including 'Innovative Technology & Nail Services'). About multiple H1s. Shop snippet says 'This is where you can browse products in this store'. Press-Ons page is a coming-soon message despite separate Custom Press-On service pages. Contact has no real H1, accessibility form-label flags. Login/account/checkout pages must be protected and appropriately nonindexable; do not pad them with generic SEO copy.

## Actual security/privacy repair completed this turn
**Page 17474**, published `/my-dashboard/`:
- Existing WordPress `post_content` was 4,794 bytes of **static customer-dashboard HTML** and included a personalized welcome and booking/order details. Elementor `_elementor_data` (2,472 bytes) uses the official live `latepoint_customer_dashboard` widget with hide-new-appointment configuration. Anonymous HTTP fetching exposed old personalized content in both HTML and plain WordPress post fields.
- Used authenticated WordPress page edit to replace **only the stored post_content** with the documented LatePoint shortcode `[latepoint_customer_dashboard hide_new_appointment_ui="yes"]`; kept page ID, status, slug, permalink, all Elementor builder meta, and existing customer/order DB data unchanged. Official LatePoint docs confirm shortcode serves login form to nonauthenticated visitors, own dashboard to authenticated LatePoint customers; hide_new_appointment_ui is supported.
- Immediate SQL readback: page remains published, stored `post_content` now 60 bytes, `_elementor_data` still 2,472 bytes; WordPress revision created (1). A new anonymous HTTP GET with cache buster returned 200, `cf-cache-status: DYNAMIC`, shows login form; **legacy personalized welcome, known booking identifier and prior appointment date NOT PRESENT**. Public WP REST `/wp-json/wp/v2/pages/17474` also lacks tested legacy markers; revisions REST endpoint returns 401 anonymous. This fixes the verified stored-content exposure.
- **Remaining**: full real customer logged-in LatePoint dashboard functional regression test is not performed (no test credentials or booking should be created); historical WordPress revision preserves the old snapshot for rollback and is accessible only with authorization; plan confidential revision retention review. Dashboard should gain `noindex` without WordPress-login-only redirect, because LatePoint authenticates customers separately from WordPress.
- No PII replicated to GitHub checkpoint, no customer data/order DB edited, no merchant/booking settings changed.

## Actual unpublished WordPress editorial drafts created
All statuses read back as **draft**; tests without login returned HTTP 404 for the five new draft pages. These are **NOT replacement live pages**; do not add to nav/sitemap or publish as duplicates; apply reviewed text to source page's Elementor/Gutenberg structure.

| Editorial draft ID | Contents | Source |
|---|---|---|
| 21525 | Homepage rewritten with Quiapo/private studio positioning, differentiated hand-only services, internal links, booking CTA; proposed title and meta description | page 5002 |
| 21526 | About: one H1, real studio positioning, distinct sections and cross-service links; no invented founder/staff stories | page 17495 |
| 21527 | Contact: one H1, live-site address/email/telephone, booking/contact copy; explicit placeholder for **preserving existing functioning CF7 form** | page 1453 |
| 21528 | Custom Press-Ons: style-led copy; clear **confirm current order availability** instead of promising ecommerce live; cross-service links | page 20974 |
| 21529 | Six service SEO briefs: titles, descriptions, distinctive introductions, internal links and QA guidelines for Gel Removal 17765, Overlay 17767, BIAB 17768, Extensions 17769, Nail Art Add-On 17777, Custom Press-Ons 17780 | source CPT entries |
| 21530 | Unpublished original editorial **post** comparing BIAB vs overlay vs extensions, balanced technical explanations, comparison, booking decision checklist; requires artist/product review before publishing | new blog draft |

Careful language: no cure, medical, “guaranteed damage-free”, or promised durability/dispatch. All ordering/booking service claims should be rechecked with current service catalog. A proposed homepage **excerpt update was blocked by platform safety checks and NOT applied**; do not evade that check through alternate write routes.

## Next implementation steps in priority order
1. **Private client content/indexability**: periodically retest dashboard anonymous and authorized users, validate real LatePoint customer workflow with existing authorized test customer; investigate safe `noindex` and removal of private dynamic routes from XML sitemap. Preserve LatePoint customer login, avoid `is_user_logged_in()` gating which would block LatePoint-only customer sessions. Inspect template and cache headers for other possible sensitive content.
2. **Apply approved text to original pages without rebuilding Elementor**: backup original `post_content` AND `_elementor_data` for each page, edit only identified widget text/heading settings and nonvisual excerpt/metatags via documented APIs, keep original page IDs/permalinks/templates and builder constraints, verify visually mobile/desktop, automated smoke tests, internal links and booking initiation. Do not replace post_content of Elementor page with a freeform block because it can desynchronize layout. Editorial drafts are source documents.
3. **Title and canonical metadata**: investigate SEO Engine’s head injection and validate why `rel=canonical` missing. Avoid double output; generate self-referencing canonical URLs on **indexable** public pages, ensure correct pagination/canonical for variants, avoid contradictory signals between WordPress and SEO plugins, keep canonical www host. Avoid indexing login, dashboard, cart, checkout, order review, connect-review and other utility pages.
4. **Content cleanup**: verify actual offered services and any transactional dependencies of Pedicure/Foot Massage product records. If abandoned, safely hide from public catalog and set redirects/noindex with separate audit of historical orders/links. Consolidate duplicated Custom Press-Ons old slug only when link inventory and 301 tests pass. Review actual team profiles/legacy posts before removing or rewriting inaccurate demo content.
5. **Local SEO and trust**: validate address/phone/service price/date policy against current real business data and Google Business Profile. Use accurate photos and ethical first-party reviews, accessible alt text, no fake testimonials/experience claims, verify NAP consistency.
6. **Schema and accessibility**: choose accurate LocalBusiness/BeautySalon/Service/Breadcrumb schema only where supported by visible content; do not add generic 'HowTo', author bio or “AI summary” merely for plugin score. Fix multiple H1 headings, unlabeled forms and maps, empty anchors, contrast, meaningful internal links, main landmark. Validate generated JSON-LD rather than adding duplicate plugins.
7. **Performance and measurement**: monitor GSC queries/impressions, Site Kit GA4 and page vitals before and after publication; validate PageSpeed and internal links; do not turn on aggressive HTML/JS caching due prior LiteSpeed regressions and dynamic WooCommerce/LatePoint.

## Authoritative references
- LatePoint customer dashboard shortcode: https://latepoint.com/docs/customer-dashboard-shortcode/
- LatePoint hide-new-appointment widget and shortcode: https://latepoint.com/docs/hide-the-new-appointment-button-and-tab-on-the-customer-dashboard/
- Google people-first content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google AI content guidance: https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- Google canonicals: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google noindex/security: https://developers.google.com/search/docs/fundamentals/get-started-developers

## Constraint reminder
User expressly deferred all Elementor Pro, LatePoint Pro Features and ThemeREX Addons security/vulnerability remediation until later. **Do not perform their premium security fixes.** No public staging site should be recreated. Do not deploy this GitHub documentation branch.
