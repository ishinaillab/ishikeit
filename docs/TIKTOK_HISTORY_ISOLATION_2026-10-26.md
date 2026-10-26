# TikTok message-history conversation isolation (2026-10-26)

## Reason for this change

The existing read-only TikTok Business Messaging history client accepted the
provider's message.conversation_id without verifying it matched the requested
conversation_id. If a provider response unexpectedly contains a message from a
different conversation, the protected /ops/tiktok/messaging/conversations/
:conversationId/messages response must not disclose that message's text or
metadata. TikTok Business Messaging is not currently active in production.

## Implemented fail-closed behavior

- On any returned message with a nonempty conversation_id that differs from
  the requested ID, the complete read rejects with a generic
  TikTokBusinessMessagingReadError: stage message_list, retryable false.
- The returned error includes no foreign message text, foreign conversation
  ID, access token, personal identity, or partial history.
- The check occurs before other message-shape validation, so a foreign item
  cannot be skipped solely because its message ID or message type is absent.
- Normal records for the requested conversation and explicitly empty histories
  remain supported.
- This changes only the existing provider-specific read adapter. No new
  routes, OAuth flows, webhook subscriptions, queue writes, database schema,
  outgoing actions, provider API requests, configuration, or startup behavior.

## Regression proof and activation gates

A focused test was added and demonstrated RED against the previous behavior
(the old client returned mixed-conversation records); the same test and the
malformed foreign-item/empty-history tests pass with the isolation guard.
The full Node 24 lint/typecheck/Vitest/build and GitHub CI must pass before
any merge. The fix is independent of PR #93's authorization preflight and
should not be interpreted as authorization to activate TikTok.

The official TikTok Business Messaging onboarding flow requires API-product
access, owner OAuth, and webhook subscription before the first messaging
request: https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3

Do not backfill history, replay historical dead letters, or enable any TikTok
outbound delivery while Business Messaging entitlement and proper account
binding remain unverified. Any future history-gap reconciliation should use
the same exact account/conversation identity check, classify imported
historical messages as non-reply-eligible, preserve deduplication and require
an explicit separate operational review.
