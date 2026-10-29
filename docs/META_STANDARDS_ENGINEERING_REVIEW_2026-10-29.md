# Ishikeit Meta standards implementation review — 2026-10-29

## Scope and evidence boundary

This is a source-verified engineering checkpoint for `ishinaillab/ishikeit`, not a claim to have ingested the full output of the two separate Deep Research reports. Those reports are not available as files in this workspace or directly attached to this chat. Cross-check any additional report-specific recommendations when the original reports are supplied. No live Meta settings, permissions, credentials, customers, queues, or database rows were modified in this change.

Reference material:
- Meta, [Secure Graph API Calls](https://developers.facebook.com/docs/graph-api/guides/secure-requests): TLS and server-side `appsecret_proof` guidance.
- Meta, [WhatsApp Cloud API media reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media) and [WhatsApp Business media tutorial](https://whatsappbusiness.com/blog/media-messages-via-app/): media metadata, authenticated download and size restrictions.
- Existing internal verified production baseline: `docs/META_LIVE_VALIDATION_2026-10-29.md`, `docs/META_MESSAGING_VERIFIED_CONTINUATION_2026-10-29.md`, `docs/LATEPOINT_DURABLE_REMINDERS_2026-10-29.md`.

## Confirmed defects corrected in this change

### 1. Meta inbound media buffered before enforcing its size limit

Before: `src/media/meta.ts` downloaded the full HTTP response with `response.arrayBuffer()` and *then* checked `MEDIA_MAX_BYTES`. A Meta-hosted response without a valid Content-Length could consume memory well above the configured limit before rejection.

After: `readBoundedMedia` consumes `ReadableStream` chunks, checks the remaining byte allowance before retaining each chunk, cancels oversized streams, and classifies a broken stream as retryable without copying upstream error text into its public failure message. The existing redirect-host, HTTPS, timeout, declared-size and WhatsApp Bearer-token controls remain intact. Tests cover oversize cancellation, multi-chunk exact-limit acceptance, broken stream, and existing direct/WhatsApp media paths.

This is a *resource-exhaustion hardening* change, not a claim that Meta requires a particular Node.js streaming API. The application's configured maximum is independent of the larger provider-specific media maxima.

### 2. Instagram OAuth Graph error message copied into thrown exception

Before: `src/auth/instagram-oauth.ts` interpolated up to 300 characters of Meta's untrusted `error.message` into `InstagramOAuthRequestError`. An upstream error containing a token, authorization code, or personal data could reach exception logs even though the structured diagnostic helper was already conservative.

After: the thrown message contains only a fixed phrase and HTTP status; `providerCode`, sanitized `reason`, `retryable` and flow stage remain available for support. Regression test verifies a deliberately sensitive provider error string never enters exception or machine diagnostic messages. This does not change OAuth grants, tokens, scopes or subscriptions.

## Prioritized remaining work (not silently enabled)

| Priority | Area | Verified evidence / question | Safe next action |
|---|---|---|---|
| P1 | Ambiguous Meta POST retries | `src/channels/meta-send.ts` marks transport failures `ambiguous=true`, but `src/workers/outbox-worker.ts` currently retries retryable failures. If Meta accepted a request before the connection failed, another POST can duplicate a customer message. No universal provider-side exactly-once guarantee has been verified. | Design per-channel reconciliation / conservative quarantine, with metrics and tests, before altering live retry semantics. Do not bulk replay historical dead letters. |
| P1 | Graph server request hardening | Meta officially recommends `appsecret_proof = HMAC-SHA256(access_token, app_secret)` for server Graph calls. Current `MetaSender`, Meta media metadata, and Page subscription clients use TLS + Bearer but do not attach proof. | Validate that each live Page, WhatsApp system-user and Instagram token belongs to the expected Meta app. Add a separately testable, staged `appsecret_proof` implementation; do not enable Meta's global Require App Secret switch until all consumers are compatible and rollback-tested. |
| P1 | Permission and live access gates | Existing `docs/META_LIVE_VALIDATION_2026-10-29.md` reports Meta App Review `NO_SUBMISSION` and a distinct legacy Instagram tester credential with Graph 190. | Owner verifies app contact email, completes genuine Instagram Business Login reviewer evidence, and reauthorizes the distinct tester only with account-holder approval. Never overwrite the valid managed studio credential. |
| P1 | WhatsApp proactive templates | Last internal readback: `ishi_appointment_reminder_v1` `PENDING`, zero purpose opt-ins, no sending-enabled template configuration. LatePoint scheduler is intentionally non-sending. | Keep all template sends off until exact Meta approval, actual customer opt-in, fresh booking/recipient resolver, cancellation recheck and idempotent guarded dispatch. |
| P2 | Authenticated media redirects | `src/media/meta.ts` validates all URLs as HTTPS on Meta-owned hosts, but accepts a broad set of Meta domains for credential-bearing redirects. | Test actual Graph media redirect host inventory, then restrict where WhatsApp Bearer headers can be forwarded without breaking Meta's real download path. |
| P2 | Version and webhook coverage | Current code supports Messenger, Instagram and WhatsApp signed webhooks; historical callback coverage is not equivalent to fresh live provider-origin postback, seen or handover canaries. | Build provider-shaped contract fixtures for the pinned Graph version and run authorized tester-originated canaries. Track Graph deprecation windows and app-level/Page-level subscription readbacks. |

## Release and rollback constraints

- No unsolicited Meta messages, fake WhatsApp consent, synthetic public customer traffic, App Review submissions or live permission changes.
- Do not touch TikTok pending-approval configuration, Elementor Pro, LatePoint Pro Features, WordPress signing keys, or Hostinger masked environment values.
- Validate `npm run check` and GitHub Node/PHP/context CI before merge.
- Deploy only through normal GitHub-to-Hostinger release flow; verify exact deployed SHA, readiness and queue health independently.
- For a regression, revert this source-only change via GitHub; no database rollback is needed.
