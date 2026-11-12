# Ishikeit — primary-unavailable backup authenticator acceptance

Status: **automated recovery covered; live real-device owner acceptance pending**.
Scope: first-owner browser sign-in on `https://apps.ishinaillab.com/app/login`.
No production factor deletion, credential extraction or secret sharing is authorized.

## Why the distinction matters

Two verified TOTP entries and a successful prior backup code prove enrollment,
but do not independently prove that a **new** login can recover when the primary
device is inaccessible. The Supabase Auth provider accepts a challenge from any
currently enrolled, verified factor. Ishikeit must preserve AAL1 restrictions
until a user-selected backup factor is verified and an AAL2 session bound to
that factor is confirmed. TOTP is not phishing-resistant.

## Safe, owner-controlled production acceptance

1. Keep the existing verified primary and backup factors enrolled. Do **not**
   choose **Turn off**, **Remove**, or a provider unenroll function. Those are
   irreversible and are not required for this recovery exercise.
2. Use an independent browser profile (or log out first), and deliberately do
   **not** use the primary authenticator device. The primary device can remain
   safely stored; turning it off, erasing it, and changing provider settings
   are unnecessary.
3. Navigate directly to the HTTPS URL above. Enter the owner's existing email
   address, request the email sign-in OTP, and verify the email code **in the
   real browser UI**. Never send the OTP into a chat, support ticket or log.
4. Confirm the session requests a second factor and does **not** expose the
   workspace or privileged endpoints while at AAL1.
5. Select **Backup authenticator** (or its owner-defined display name) from the
   available authenticators. Enter its current six-digit code **only in the
   website's secure verification form**.
6. Confirm that the browser reaches the authenticated workspace and Account >
   Security still shows both verified authenticators. Use **Log out** after the
   acceptance check. Do not rename, remove or turn off any authenticator.
7. Record pass/fail, date/time and observed UI result **without** copying QR
   codes, TOTP secrets, OTP values, session cookies, access tokens or personal
   recovery data.

A pass requires the successful *new* email-OTP + backup-TOTP login with no
primary device involvement, AAL1 workspace denial before verification, AAL2
access afterward, and both factors still enrolled. A failed login must remain
unprivileged, with an actionable error; stop repeated attempts rather than
triggering rate limits. Never mark this real-device check passed from mocks,
repository tests, or a database count alone.

## Automated non-production regression

`tests/private-browser-auth-postgres.integration.test.ts` includes a
disposable PostgreSQL 17 scenario that: enrolls two synthetic factors; logs
out the previously privileged browser session; simulates fresh email login
at AAL1; denies workspace access; rejects a simulated unavailable primary
challenge; verifies the enrolled backup; checks the upgraded provider factor
binding; and asserts neither synthetic factor was removed.

This is a regression check against application logic. The test uses a
mocked Supabase challenge/verify provider with isolated PostgreSQL; it is
**not** proof of an actual physical backup device or live GoTrue acceptance.

## References

- Supabase TOTP: https://supabase.com/docs/guides/auth/auth-mfa/totp
- Supabase MFA: https://supabase.com/docs/guides/auth/auth-mfa
- OWASP MFA recovery: https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- NIST SP 800-63B-4: https://pages.nist.gov/800-63-4/sp800-63b.html
