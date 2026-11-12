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

An independent **Require authenticator at sign-in** preference changes only the
ordinary workspace-login policy; it does **not** delete or reenable TOTP factors.
Privileged actions continue demanding verified AAL2 and live session/factor binding.

SMS, WhatsApp, passkeys-as-MFA, self-service recovery codes and trusted-device
exemptions are **not implemented** for Ishikeit. The UI must never falsely show
these as configured. Recovery after removing the last factor requires a fresh
email OTP sign-in and a wholly new TOTP setup, with privileged actions still gated
as implemented. Do not claim this is phishing-resistant MFA: TOTP is not.

## Security design

- Server holds opaque host-only HttpOnly Secure SameSite=Strict session cookie,
  CSRF proof, exact-host/Origin checks, rate limits, current workspace membership,
  GoTrue JWT verification and an exact live `auth.sessions` / AAL2 / factor binding.
- **Fresh factor challenge/verification** is required for every account-wide
  sign-in preference change, rename and removal, and for adding an additional
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
Cancellation is non-mutating; canceling a pending setup calls the official
factor reset. The code field enables Next only when six ASCII digits are present.
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
