# Meta Send API 2xx acknowledgment safety — 2026-10-29

## Confirmed defect and official response contracts

Ishikeit previously returned an empty `MetaSendResult` for a Meta messaging POST that responded HTTP 2xx but whose JSON lacked the documented provider message ID. The caller treated that empty result as a successful action: the outbox was marked `published_at` without a provider ID, and there was no key for exact delivery receipt reconciliation. This incorrectly equated HTTP success with an attributable accepted message and could silently hide a malformed or incomplete provider acknowledgment.

Meta's documented standard success responses include:
- Messenger Send API: `recipient_id` and `message_id` ([Meta Messenger Send Messages](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages)).
- Instagram Send Messages: `recipient_id` and `message_id`; existing Instagram Graph integration also accepts a nonblank `id` for historical supported response fixtures ([Meta Instagram messaging](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)).
- WhatsApp Cloud API: `messages[0].id`, with `message_status` optionally describing accepted/held/paused ([Meta Message API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api)).

## Correction

- MetaSender now accepts a success response only if the **correct channel-specific provider message ID** exists and is nonblank. WhatsApp requires `messages[0].id`; Messenger/Instagram accept nonblank `message_id` or `id` (existing supported Instagram shape). A Messenger `message_id` no longer incorrectly passes as a WhatsApp acknowledgment.
- HTTP 2xx but missing, empty, whitespace-only or wrong-shape ID throws a typed `MetaSendFailure` with `ambiguous=true`, `retryable=true`, the numeric HTTP status, and a fixed non-sensitive message. The existing durable armed send fence and outbox worker **quarantine** that outcome for manual reconciliation; they do not automatically retry or falsely mark an unattributable send as published. The response body and tokens are not logged.
- No change to the standard 24-hour reply eligibility, customer opt-in, template allowlist, handoff ownership, provider credentials, Meta security settings or feature flags.
- A valid `messages[0].id` means only that WhatsApp accepted a request; it **does not** establish delivery/read status. Delivery receipts remain tracked independently.

## Regression and release gates

Tests include a successful Messenger acknowledgment, valid Instagram ID, WhatsApp `wamid`, a successful template, and new missing/whitespace/wrong-shape HTTP 200/202 outcomes across Messenger, Instagram and WhatsApp. Previous transient HTTP 429/5xx and crash/retry fence policy remain unchanged. No direct provider send was made for this change.

This is an implementation hardening step under the owner's **DO NOT SUBMIT META APP REVIEW** hold ([issue #169](https://github.com/ishinaillab/ishikeit/issues/169)); it is NOT verification of correct live product-specific signing secrets, live token provenance, provider acknowledgment consistency or Advanced Access eligibility. Keep the hold, proactive templates OFF, and global Meta Require App Secret OFF.
