# TikTok Business Messaging API: controlled live access test (2026-10-27)

## Purpose

Confirm, without enabling TikTok message delivery, whether an **already
authorized** TikTok organic-account OAuth token stored in Ishikeit's encrypted
credential store can perform a single supported Business Messaging API read.

TikTok's onboarding guide explicitly lists Business Messaging API access,
account-owner authorization, webhook subscription, and authentication as
prerequisites. A live API probe is useful diagnostic evidence, but **does not
replace TikTok approval** and must not be used to bypass TikTok's requirements.

Source: https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3

## Implemented behavior

- Registers GET /ops/tiktok/messaging/availability-probe only when the existing
  TikTok OAuth feature/credential store and OPS_METRICS_TOKEN are configured.
- Performs **nothing on startup**. After a valid operational bearer-authenticated
  request, loads only TikTok OAuth credentials from existing encrypted storage.
- Requires exactly **one** stored TikTok owner credential with an access token
  that does not expire within 60 seconds. If multiple accounts are configured,
  fails closed rather than choosing the wrong private account.
- Sends one GET to
  https://business-api.tiktok.com/open_api/v1.3/business/message/conversation/list/
  with the **stored open_id** as business_id, conversation_type=SINGLE and
  limit=1, under a bounded timeout. No other host or redirect.
- Parses the provider numeric code and a coarse allowlisted error category (heuristic, not proof of scope or entitlement). Provider conversation
  payloads, message text, account IDs, tokens, and user identities are
  **never logged, returned, stored, or forwarded**.
- May refresh and persist the sole stored OAuth credential under its existing database lock; never consumes new consent, sends messages,
  touches webhooks, replays dead letters, or enables TikTok outbound.
- Response types: accepted, provider_rejected, provider_unavailable,
  invalid_provider_response, no_stored_authorization,
  ambiguous_authorization, access_token_expired, credential_store_unavailable.
  Optional HTTP status, bounded provider numeric code and coarse error category help diagnose denial
  without disclosing private response messages.

## Execution and interpretation

1. Review the code, CI and access controls, then deploy a verified build
   through the established main-branch pipeline, preserving every existing
   integration. No environment variables need replacing or adding.
2. **From an already authorized operational environment**, invoke
   GET https://apps.ishinaillab.com/ops/tiktok/messaging/availability-probe
   with an existing secret OPS_METRICS_TOKEN bearer. Do not paste/export the
   bearer into chat, issue trackers, shell command lines, history or logs.
   Use no retries or background polling.
3. `accepted` means TikTok accepted this narrow read for that token at the
   time of the test. It does **not** prove a full Business Messaging product
   entitlement, webhook approval, message-sending rights, or eligibility of
   other TikTok accounts. Review TikTok developer approval and owner consent
   separately.
4. `provider_rejected` means the actual provider call was rejected; HTTP
   status and numeric code support escalation to TikTok without exposing
   customer content. Do not repeatedly probe or use alternative tokens to
   bypass a denial.
5. Other statuses describe token/storage readiness or an inconclusive
   provider failure, not permission approval.

Do not activate TIKTOK_BUSINESS_ID, the TikTok dispatcher, Comment-to-Message,
auto-messages or any history backfill solely from a successful probe.
The independent PR #94 message-history isolation patch should be reviewed
before enabling any real conversation/message reading route. PR #93 supplies
an additional read-only local preflight without a TikTok provider call.

## Verified local tests

New module and route integration mocks cover read-only request shape,
missing/multiple/expired credentials, HTTPS host and no redirects, provider
denials including HTTP 200 business errors, sanitized output, invalid/
oversized payloads, transport errors, unauthenticated requests and route
absence when disabled. Run `npm run check` under Node 24 and verify CI.
