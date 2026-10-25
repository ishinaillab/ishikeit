# TikTok Business Account tier: dormant read-only preflight

2026-10-25. Branch: `feature/tiktok-business-eligibility-20261025`. Not activated or deployed.

## Why

The developer reported approval of the Ishikeit TikTok API for Business app. This does **not** prove that TikTok granted the independent Business Messaging API product, authorized a specific TikTok Business Account to that app, completed privacy/security review, or configured production access tokens.

TikTok's official Business Messaging automatic-message guidance says the authorized account must be a TikTok Account with Advanced Access or a Verified Business Account, and directs callers to the `/business/get/` profile endpoint and `has_advanced_access` field.

## Change

`TikTokBusinessEligibilityReader` is an isolated, read-only client for `/open_api/v1.3/business/get/`. It does not register a public/ops route or add configuration, send messages, change provider settings, or update the DB. It requires a specified `businessId`, exactly one already-authorized token source, and an **explicit, verified** provider request transport (`GET_QUERY` or `POST_JSON`); neither is assumed safe without account-backed confirmation.

The reader returns ONLY `{ businessId, hasAdvancedAccess }`; profile display names, usernames, photos, tokens and untrusted provider messages are discarded. Errors contain only bounded status, stage, and code; no raw response body is surfaced. A missing, malformed or wrong-account response fails closed.

The entitlement boolean **alone must not be interpreted** as app approval, account-owner age verification, Messaging scope, eligibility for every feature, a currently usable token, or conversation unlock. The live provider request method, profile response shape, and authorized account mapping still require an approved Business Messaging real-account readback before use in runtime.

## Verification and activation gate

- Local Node 24.22.1: full `npm run check` (lint, typecheck, tests, build).
- Unit tests: explicit GET/POST transport, redacted output, 403/429 behavior, credential absence, account isolation, bad fields, response body suppression, fail-closed API version.
- No new endpoints or outbound send.
- Before any runtime registration: independently inspect the exact Ishikeit app's approved products/scopes; obtain account-holder OAuth token in trusted storage; verify `/business/get/` contract and entitlement using the real approved account; verify independent Business Messaging capability endpoint; preserve current Meta/Telegram production behavior.

Official source:
https://business-api.tiktok.com/portal/docs/update-the-automatic-message-for-a-business-account/v1.3
