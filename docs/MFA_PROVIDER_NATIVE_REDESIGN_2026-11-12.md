# Ishikeit MFA — provider-native authenticator management (2026-11-12)

## Binding product decisions

Meta screenshots are **UI/UX references**, not security authorities. The authoritative
backend is Supabase Auth/GoTrue. The authentication-app method is configured iff at
least one **verified provider TOTP factor** exists. A user clicking Turn off confirms
an **irreversible provider-factor deletion**, NOT a reversible local disabled flag.
All TOTP factors—including pending ones—are unenrolled through the official
authenticated GoTrue API. An individual Remove unenrolls only the selected factor.
Removing the last factor automatically makes the authentication-app method
unconfigured, and reenrollment must produce a fresh factor/secret and verified code.

**2026-11-12 UX/security correction (supersedes the earlier standalone switch):**
there is no independent "Require authenticator at sign-in" control. Once an
authenticator is enrolled, all workspace sign-ins require its verified AAL2
challenge; preexisting database preferences that disabled login MFA cannot bypass
this enforcement. The authentication-app method is the only user-facing 2FA
control. Turning the method off permanently removes its Supabase TOTP factors
after fresh existing-factor proof, not a temporary pause of their secrets.
Privileged operations still require live AAL2 and exact factor/session binding.

SMS, WhatsApp, passkeys-as-MFA, self-service recovery codes and trusted-device
exemptions are **not implemented** for Ishikeit. The UI must never falsely show
these as configured. Recovery after removing the last factor requires a fresh
email OTP sign-in and a wholly new TOTP setup, with privileged actions still gated
as implemented. Do not claim this is phishing-resistant MFA: TOTP is not.

## Security design

- Server holds opaque host-only HttpOnly Secure SameSite=Strict session cookie,
  CSRF proof, exact-host/Origin checks, rate limits, current workspace membership,
  GoTrue JWT verification and an exact live `auth.sessions` / AAL2 / factor binding.
- **Fresh factor challenge/verification** is required for any factor
  rename and removal, and for adding an additional
  authenticator. The provider owns TOTP secret generation, allowed time window,
  replay handling and verification. Client requests contain a six-digit code
  only; no TOTP seed, provider access token or refresh token is persisted in
  browser storage or logs.
- The custom display-name table stores ONLY a validated alias, not secret
  material. The alias does not change native GoTrue factor ID/secret or its
  validity. Initial names are sent as GoTrue friendly names.
- Provider unenrollment happens before treating removal as completed. In a
  multi-factor method deletion, the factor proving this AAL2 session is removed
  **last**. If it is deleted, all Ishikeit BFF sessions are revoked and this
  browser must log in again. Other factor removal and renames rotate session
  cookie and tokens, revoke peer BFF sessions, and update the UI after fetching
  authoritative server state.
- External GoTrue deletes CANNOT be rolled back with local SQL. If some
  provider deletes succeed before an error, write a durable
  `authenticator_removal_partial` event outside the failed transaction, revoke
  browser sessions, clear cookies, and force a fresh provider-backed login/read.
  Never assert that the prior factor set was restored.
- Provider verification failures, stale membership, invalid factor IDs,
  missing CSRF, unsupported actions and throttling all fail closed.
- The legacy reversible-disabled table remains only for rolling deployment
  compatibility; new code never inserts into it or reactivates old secrets.
  Users with legacy disabled rows are blocked pending secure provider migration,
  rather than having those old secrets silently reactivated.

## UI

Security -> Two-factor authentication opens a native dialog, with separate
stages for overview, configured versus available methods, connected devices,
name selection, QR and key (Copy key), six-digit verification, success, individual
Edit/Rename/Remove, method Turn off, confirmation and fresh factor proof.
Closing without an unfinished enrollment leaves verified factors unchanged;
explicitly canceling an unfinished setup uses the official owner-bound reset
to remove only the unverified secret. The code field enables Next only when six ASCII digits are present.
Method state and list are reloaded from GoTrue-backed server data after changes.
Responsive buttons, accessible dialog labels, status messages, live regions,
and focus behavior are included. Setup key and QR are cleared on success/reset.

## Release gates / safety

1. Build and lint under Node 24 (CI) and compile under the pinned lockfile.
2. Run full unit, HTTP, shipped frontend-JS, and isolated PostgreSQL 17 tests.
3. Keep seven unpublished modifications in the original local Windows tree
   unchanged; develop in a detached fresh-origin-main worktree.
4. **Apply DB migration before application deployment**, verify schema/RLS.
   Preserve the live owner's **two verified TOTP factors**; never use those for
   destructive tests. Use disposable fake factors in isolated PostgreSQL tests.
5. After protected PR CI and release, verify exact Hostinger SHA and anonymous
   auth route guards. Live owner-controlled MFA lifecycle testing must be
   performed separately with deliberate owner proof and explicit knowledge
   that turning off the method permanently deletes the owner's factors.
6. Out-of-band security-change notifications and stronger recovery methods
   remain recommended follow-up safeguards; do not claim these exist unless
   implemented and tested. Avoid false claims that a test mock proves live
   Supabase MFA deletion or verifies actual user TOTP codes.

## Authoritative references

- NIST SP 800-63B-4 (July 2025): https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP MFA: https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- RFC 6238: https://www.rfc-editor.org/rfc/rfc6238
- Supabase Auth MFA: https://supabase.com/docs/guides/auth/auth-mfa
- Supabase unenroll: https://supabase.com/docs/reference/javascript/auth-mfa-unenroll


## Qwery Nails UI remediation and verification

The post-release UX review identified a stuck `metaBusy` flag when adding a
second/backup authenticator. The UI verified an existing factor and then tried
enrollment while the same flag remained set, so no new enroll request was sent.
The corrected sequence releases the proof-request guard before starting enrollment
and tests that the provider enrollment endpoint is actually called.

A stale pending, unverified enrollment now offers **Restart setup**, which uses
the existing CSRF-protected owner-bound reset without deleting verified authenticators.
The former duplicate sign-in protection switch is removed from visible UI AND the
server-side bypass; obsolete `sign_in` preference writes return HTTP 400.
Legacy false preferences are ignored and an AAL2 challenge remains mandatory.

Design tokens were read from the active WordPress **Qwery Child / Nails skin**
generated `skins/nails/css/__custom.css` rather than Elementor default kit values:
Questrial (body), Lusitana (headings), #FFF8F3 (warm cream),
#FFFFFF (white), #F8E0D2 (blush/borders), #FFABB4 / #F18B96
(primary/hover) and #242530 (dark text). Font stylesheet access is
restricted to Google Fonts domains by CSP; no inline scripts or secret storage
was added. All visible hover buttons/menu items set both foreground and
background explicitly. Reduced-motion and keyboard focus treatments remain.

Validation:
- Node 24 full CI-equivalent `npm run check`: **711 passed, 98 skipped**
  (database suites skipped when PostgreSQL test URL is not supplied),
  ESLint, TypeScript, and production build passed.
- Isolated disposable PostgreSQL 17 browser MFA integration:
  **34 of 34 passed**, including legacy false sign-in preference denial.
- Focused UI/HTTP state machine: **48 of 48 passed**, including
  adding a second authenticator and resetting unfinished setup.
- Four Qwery Nails color/contrast regressions passed; mobile
  390px and desktop 1440px browser previews inspected.
- This evidence does NOT substitute for a genuine authenticated
  owner-origin TOTP enrollment test after deployment.

Sources: https://supabase.com/docs/guides/auth/auth-mfa/totp ;
https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html ;
https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html ;
https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ .
