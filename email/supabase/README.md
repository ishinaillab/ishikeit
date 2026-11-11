# Ishikeit — responsive, light/dark Supabase Auth email templates

**Version:** 2026-11-03 (responsive + dark-mode upgrade)

**Deployment status:** source-controlled templates; publishing them to hosted Supabase is a separate operation. Verify the actual SMTP configuration, official template readback and recipient delivery. Never send the first-owner invitation before the protected approval and readiness gates in Ishikeit Issue #230 pass.

## Templates

| Supabase Dashboard → Authentication → Emails → Email Templates | File | Subject |
| --- | --- | --- |
| **Invite user** | `invite-user.html` | `You're invited to Ishikeit` |
| **Magic Link (configured for email OTP)** | `magic-link-otp.html` | `Your Ishikeit sign-in code` |

The invitation retains `{{ .ConfirmationURL }}` as both the button URL and visible fallback. The OTP email retains `{{ .Token }}`; do not change it to a magic-link flow without changing the Ishikeit BFF authentication behavior and its tests.

### Email-code entry deep links (November 12, 2026)

The Magic Link/OTP template's **Ishikeit sign-in** hyperlink deliberately points to
`https://apps.ishinaillab.com/app/login#verify-email={{ .Email }}`.
Supabase's Go `html/template` automatically percent-encodes `.Email` in
an HTML `href` URL-fragment context. Do **not** insert `{{ .Token }}`,
`{{ .TokenHash }}`, `{{ .ConfirmationURL }}`, a Supabase bearer, or a
session cookie into the link: link previews and automatic security scanners
must never log in or consume the emailed OTP.

The fragment is removed from browser history as soon as the first-party,
strict-CSP Ishikeit script executes. It is never sent as part of an HTTP
request URL, logged on the server, reflected into HTML or stored locally.
When the original request cookie exists, the server resumes code entry
without exposing even the email address. In a different browser, the
client submits only the email hint as same-origin JSON to
`POST /app/auth/resume-otp`, which creates a **new unprivileged challenge**
ONLY if that account has a recent, successfully dispatched, unconsumed
OTP (HMAC lookup and per-email/IP rate limits). The user must still type
the original email code, and afterward complete normal TOTP step-up.
No second email is sent on link navigation. Expired/missing/blocked
attempts cannot authenticate and present a fresh-code fallback.

IMPORTANT: this repository is **not** the hosted Supabase template itself.
The editor/API must be updated for `mailer_templates_magic_link_content`
and read back through an authorized Supabase Auth management capability.
Deploy additive migration `0019_browser_otp_email_link_resume.sql` to
the correct Supabase project **before** the Node app code expecting the
new columns. Do not claim cross-browser live support until both the
hosted template and deployed application have been verified in a real
recipient email. The pre-existing static link continues to work when
opened in the original browser's still-valid pending cookie.

Authoritative sources: [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
and [Go html/template contextual autoescaping](https://pkg.go.dev/html/template).

### Responsive behavior

- **Mobile first:** single-column 100%-width presentation tables, 12px outside gutters, 24px content gutters, readable 16px body text and an accessible 56px+ invitation action. The layout is fluid even if the client strips media queries.
- **Tablet ≥480px:** wider outer and inner padding and larger heading/code sizing.
- **Desktop / larger tablet ≥640px:** the card remains at most 600px wide, centered, with generous spacing.
- **Classic Outlook on Windows:** conditional 600px MSO wrapper provides a fixed desktop maximum if Outlook ignores CSS `max-width`. This has **not** been verified in a live Outlook installation.
- **Very narrow phones <360px:** compact header and OTP spacing. No horizontal scrolling was observed at 320px in Chromium.

### Light and dark modes

- Includes `<meta name="color-scheme" content="light dark">` and `<meta name="supported-color-schemes" content="light dark">`.
- Light theme is the inline-style fallback; custom dark colors are applied via `@media (prefers-color-scheme: dark)` where supported.
- Best-effort `[data-ogsc]` (foreground) and `[data-ogsb]` (background) overrides are included for some Outlook rendering engines.
- The email client may ignore this CSS, strip it, partially invert colors, or force its own dark mode. **There is no cross-client guarantee of perfect theme matching.** Test delivered messages in the actual target clients before release.
- Palette uses no external image, web font, script, or tracking pixel; unmodified background and text combinations were selected for sufficient legibility in both themes.

### Tested locally

The two HTML files were validated for the required Supabase placeholders, dark-mode metadata and styles, fluid tables, Outlook conditional wrappers, and no script/external image content.

Chromium rendering tests ran **20 template/viewport/theme combinations**: 320, 375, 390, 768, 1280 CSS pixels × light/dark × 2 templates. Verified:

- No document horizontal overflow at any viewport.
- Card width never exceeds 600px.
- OTP text fits its container on all test widths.
- Light/dark card backgrounds and light/dark invitation button text switch as intended.
- 12 full-page previews captured at 390px (phone), 768px (tablet), and 1280px (desktop), in light and dark mode for each template.

These are **browser-simulation tests, not live Gmail, Apple Mail, or Outlook inbox tests**. Sample confirmation links and OTPs in screenshots are dummy values only. See `render-audit.json` for computed results.

## Apply to hosted Supabase after SMTP approval

1. Complete production custom SMTP with the approved domain-restricted credential and sender `Ishikeit Authentication <no-reply@auth.ishinaillab.com>`; recheck official Supabase Auth configuration. Do not confuse Resend domain/provider delivery with Supabase Auth SMTP delivery.
2. Open the hosted Supabase Auth email-template editor for project `vhmrliqemkfxblzsoyaz`; paste the subject and HTML from the corresponding file.
3. Read back both saved templates and confirm that `{{ .ConfirmationURL }}` and `{{ .Token }}` are unchanged.
4. Perform safe recipient-side email delivery checks and visual tests in real email clients without sending or creating the real owner prematurely.
5. Keep the `ishikeit-provisioning` protected human approval and `ISHIKEIT_ADMIN_PROVISIONING_ENABLED` / `BROWSER_AUTH_ENABLED` switches OFF until separate live owner verification and MFA activation gates are complete.

The branding deliberately stays **Ishikeit**, not permanently Ishi Nail Lab, because Supabase Auth templates are global to the project and Ishikeit is designed to support multiple workspaces.

## Authoritative sources

- Supabase Auth email templates: https://supabase.com/docs/guides/auth/auth-email-templates
- Supabase passwordless email OTP: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Litmus: dark mode CSS and client limitations: https://help.litmus.com/article/617-dark-mode-builder
- Litmus: fluid hybrid responsive email / Outlook wrappers: https://www.litmus.com/blog/understanding-responsive-and-hybrid-email-design
- Can I Email: client support for `prefers-color-scheme`: https://www.caniemail.com/features/css-at-media-prefers-color-scheme/
- Ishikeit readiness checkpoint: https://github.com/ishinaillab/ishikeit/issues/230