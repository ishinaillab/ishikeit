# Ishikeit TikTok integration: 2026-10-27 security and approval readiness audit

## Scope and source-of-truth

Reviewed current `main` implementation for TikTok owner OAuth and refresh, Messaging API read/send, Comment-to-Message, automatic-message reads, webhook configuration, marketing OAuth, advertiser reads, media transfer, webhook signature verification, production activation documentation and CI. The source of truth for provider behavior is TikTok API for Business's current endpoint-specific **Business Messaging v1.3** documentation, not its newer **Marketing/Reporting v2.0** pages.

Official references:
- https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3
- https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3
- https://business-api.tiktok.com/portal/docs/get-a-list-of-conversations/v1.3
- https://business-api.tiktok.com/portal/docs/update-the-automatic-message-for-a-business-account/v1.3
- https://business-api.tiktok.com/portal/docs/accounts-api-overview/v1.3

## Verified production facts

- 2026-10-27: Hostinger build of PR #98 succeeded. Protected probe refreshed the single stored owner OAuth token; refreshed expiry persisted.
- The subsequent Business Messaging conversation-list probe returned `provider_rejected`, provider code `40000`, coarse message category `scope`. **This category is heuristic**, not a definitive provider permission inventory or a guarantee that every request parameter is valid.
- Protected OAuth status returned 15 organic/Accounts-oriented scopes and **no explicit messaging scope**.
- `TIKTOK_BUSINESS_ID` remains absent; outbound messaging and Comment-to-Message are intentionally disabled. Do not replace the entire masked Hostinger environment to add one key.
- Existing Instagram, Messenger and WhatsApp integrations must remain operational; do not replay historical dead letters.

## Changes in this hardening release

- Reject HTTP redirects for TikTok API requests containing app secrets, access tokens, message content, media upload content or webhook configuration. Prevents a redirect from forwarding sensitive custom `Access-Token` headers or OAuth POST bodies to another endpoint.
- Preserve existing deliberate `redirect: "manual"` behavior on untrusted image/media retrieval; do not auto-follow untrusted URLs.
- Add regression assertions for no-redirect behavior in TikTok owner OAuth, Business Messaging reads and message sending.
- Correct the old live-probe checkpoint: the protected probe can now refresh and persist an expiring stored credential, and returns a coarse error classification.

## Provider-dependent approval gates (do not bypass)

1. Obtain **Business Messaging API product access** for the ishikeit developer application, including TikTok's required data-security/privacy reviews. Organic Accounts and Marketing approvals are not substitutes.
2. Confirm the target TikTok Business Account has Advanced Access or Verified Business Account eligibility. TikTok's `/business/get/` `has_advanced_access` readback is the authoritative account eligibility check; the owner must be over 18, and applicable region/account restrictions apply.
3. Complete **new account-owner authorization** for the actual Messaging API scopes TikTok grants. Existing organic OAuth scopes cannot be treated as Messaging consent. Verify the account-specific `open_id` and consent scope list after reauthorization; never assume an advertiser ID is the same as the owner open ID.
4. Read back TikTok account capability, supported conversation and messaging limits, and webhook configuration **before** enabling message dispatch. Use the approved Business Messaging webhook event schema, signature algorithm and callback URL.
5. Only after all gates pass, set the exact approved account mapping using a safe secret-preserving deployment method. Perform one new tester-originated DM canary; verify signed webhook -> durable inbox -> AI -> outbound acceptance -> receipt, without replaying historical events.
6. Independently gate Comment-to-Message, account-level automatic messages (subject to TikTok review), conversation unlock, and bounded reconciliation/backfill. Do not confuse account-level automatic messages with Marketing API creative auto-message endpoints.

## Deferred / unverified

- The provider's precise approved Messaging scopes and access entitlement are **not yet issued**. Do not claim full activation or assume `40000` proves one particular missing permission.
- Do not turn on a dormant automatic-message reader until its request method and response contract are checked against TikTok's current account-level endpoint.
- Do not change webhook subscriptions, production environment, account authorization, send test DMs, or perform historical backfill before provider approval.
- Any future HTTP client must enforce fixed TikTok HTTPS origin, no redirects, bounded timeout and response size, token secrecy, and fail-closed authorization.
