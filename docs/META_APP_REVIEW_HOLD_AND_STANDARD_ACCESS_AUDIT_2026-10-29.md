# Ishikeit Meta App Review HOLD and official-standards release gates — 2026-10-29

> **OWNER HOLD — DO NOT SUBMIT META APP REVIEW**. Applies to Meta developer app `1042452472116584` ("Ishikeit") and any Advanced Access / feature permission review for Messenger, Instagram, and WhatsApp. No assistant, automation, repository workflow or operator should initiate a submission until (1) all actual required product/permission gates below have been independently verified, and (2) the owner explicitly authorizes submission in a subsequent request. A Meta dashboard `can_submit: true` value is **not** authorization. This decision is tracked in issue [#169](https://github.com/ishinaillab/ishikeit/issues/169).

## Key policy discovery: Instagram Standard Access may make review unnecessary

Meta's current published [Instagram App Review development-scenarios matrix](https://developers.facebook.com/documentation/instagram-platform/app-review) says **no App Review is required for Standard Access when an app is only for a business owned or managed by its operator** (with Instagram Login or Facebook Login). Apps acting as tech providers for other businesses generally require **Advanced Access and App Review**. Meta's [Instagram overview](https://developers.facebook.com/documentation/instagram-platform/overview) explains the non-owned-account distinction. Ishikeit currently appears to serve a single owned business (Ishi Nail Lab), **but the exact permission/feature-level reach, account role relationships and future multi-business use have not all been verified**. Do not assume either that review is required or that Standard Access unlocks every planned feature.

These Instagram rules do not automatically determine Messenger Page feature review or WhatsApp Business requirements. Audit every Meta product and requested permission separately. The business verification and the app's Live status do not themselves grant Advanced Access.

## Evidence reviewed and boundaries

As of October 29, 2026, application GitHub `main` was `dadee20f776d71053415fcd6f72b8e9fb5037d69`. Earlier full app regression suite: 450 tests across 64 suites, GitHub Node/PHP/context-continuity CI passed. Latest Hostinger health and readiness passed. Actual Meta App Review readback: `NO_SUBMISSION`, `can_submit=true`, `requested_privileges=null`, privileges `[]`; live application, unverified contact email; app-level Page/Instagram/WhatsApp subscriptions enabled. Meta developer API deprecations readback: latest platform `v26.0`, zero listed app-specific deprecations, though that does not prove every endpoint version/permission is compliant.

Prior source research [`META_DEEP_RESEARCH_RECONCILIATION_2026-10-29.md`](META_DEEP_RESEARCH_RECONCILIATION_2026-10-29.md) distinguished third-party research proposals from verified implementation. Current source and live artifacts must take precedence over old issue descriptions.

## Current evidence matrix

| Area | Current source / verified evidence | Status relative to submission hold |
|---|---|---|
| Webhook authenticity | `src/security/meta.ts` validates raw bytes with SHA-256 HMAC and constant-time comparison; `src/http/server.ts` verifies before ingest. | **Code covered / live product signing identity unverified**. One `appSecret` parameter is used at the shared Meta endpoint; separately configured Instagram Login app secret exists. Confirm the actual signer per product and captured valid/invalid Meta callbacks before changing secret routing. |
| Webhook retries, duplicates, out of order | `src/channels/meta-normalizer.ts` expands receipt/message events; inbound SQL dedupe; historical signed inbound evidence and tests. | **Partial provider evidence**. Need fresh, permitted Messenger and Instagram postback, seen/receipt and native handover canaries including intentionally duplicated/reordered fixtures; do not assume app-level subscription proves delivery. |
| Response-window and human ownership | `src/dispatch/meta-customer-window.ts` enforces 24h standard window minus 5-minute guard; `src/adapters/meta/messaging.ts` rechecks before dispatch, blocks active human handoff. | **Source covered**; end-to-end real authorized boundary and handover/standby behavior not fully witnessed. |
| Outbound ambiguity | `src/workers/outbox-worker.ts` enforces `prepareMetaSend` before a Meta POST; `src/persistence/outbox.ts` holds a durable arm marker and fail-closed quarantine; private operator non-sending ledger in PR #166. | **Source tests and DB recovery canary passed**; manual provider-level reconciliation and strong individual operator identity not yet complete (#159). No exactly-once provider guarantee. |
| Graph proof and token provenance | HMAC `appsecret_proof` code exists (PR #163); private `/ops/meta/graph-proof-preflight` deployed (PR #167), no unauthenticated access. | **Blocked live verification (#158)**. Production Page and WhatsApp access tokens must pass issuer and signed GET checks with the correct app secret. Flag remains default OFF; global Require App Secret OFF. Never guess/overwrite masked tokens. Instagram Login uses its own credential. |
| Instagram OAuth | OAuth state, token exchange, long-lived refresh and account alias/subscription code exist; managed studio account previously reconciled. | **Partial**. Separate old tester token reports Graph code 190; reauthorize legitimately if needed. Confirm scopes, account role/asset mapping and independent fresh signed customer events. |
| Messenger Page | App Page webhook subscription plus historically successful Page-level reconciliation; real customer-originated Messenger inbound/outbound/delivered-ID sample. | **Partial**. Need positive provider postback, quick reply, handover, standby, and exact applicable Page permission/access-level verification. Aggregate watermark read is not individual-message read. |
| WhatsApp ordinary conversation | Business verified, phone registered, published app, account subscription; historical inbound/reply samples. | **Partial**. Fresh post-release authorized two-way and receipt/opt-out/account tests, no unsolicited sends. |
| WhatsApp proactive reminders | `src/adapters/meta/whatsapp-template.ts` checks account, exact allowlist and customer purpose consent at dispatch; template `ishi_appointment_reminder_v1` status PENDING; zero actual opt-ins. | **Not authorized for proactive sending**. Dispatcher stays OFF until actual Meta template approval, real opt-in, cancellation/recipient/reschedule safe-check and opt-out enforcement. |
| API and rate limit behavior | Application Graph version defaults to v26.0, Meta developer readback v26.0 with no listed deprecations; rate-use observability has partial coverage. | **Not comprehensively certified**. Audit per-endpoint semantics, X-App-Usage and WhatsApp limit diagnostics, pagination, retry after, transient vs permanent errors, Graph code/subcode parsing and throttles against official current docs. |
| Confidentiality, privacy, operational controls | RLS/private tables, redacted diagnostics, bounded media downloads and bearer operational endpoints in code. | **Partially verified**. Repeat privacy, retention/deletion, security, IP/SSRF/redirect, token rotation, controlled operations and least-privilege audit before review. |

## Must-pass engineering acceptance checklist

- [ ] Define Ishikeit's precise owned-business use case and product/permission matrix (Messenger Page, Instagram Login business, WhatsApp Cloud) and document whether **Standard Access already meets the requirement**. Distinguish planned third-party/business expansion from present scope.
- [ ] Audit and verify correct product-specific webhook secret(s), verified raw-byte delivery, independent account subscriptions and authorization of callback events, negative signatures, deduplication, batched and out-of-order delivery.
- [ ] Independently verify production token issuers and signed Graph canaries for Messenger Page and WhatsApp; check Instagram product credential separately, resolve tester Graph 190 via legitimate OAuth only, preserve working studio credential.
- [ ] Obtain fresh, authorized, customer-originated Messenger and Instagram postback/handover/seen/receipt canaries, match provider account IDs exactly, and verify dispatch-time standard reply and ownership suppression. Use test accounts and informed participant authorization; no unsolicited customer messages.
- [ ] Verify WhatsApp inbound, status receipt correlation, per-recipient opt-out/consent and template policy; keep proactive reminders disabled before approved template and genuine opt-in.
- [ ] Evaluate Graph version/lifecycle, rate headers, 429/5xx/backoff/error codes, media and SSRF, data deletion, operational identity controls, durable queue crash behavior, and handoff/reconciliation edge cases against latest official product docs.
- [ ] Complete tests (unit, integration, source-to-fixture contract and real provider canary), code review, CI, exact deployment SHA, live health, RLS and unknown-outcome queue inspection; record evidence, rollback and unresolved exceptions.
- [ ] Explicit owner decision **after all checks**. Do not request App Review or Advanced Access until then. If only owned-business Standard Access is required, document why no App Review is needed instead.

## Official Meta sources used for this checkpoint
- [Instagram App Review development scenarios](https://developers.facebook.com/documentation/instagram-platform/app-review)
- [Instagram permissions / access-level overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- [Messenger webhooks and delivery retries](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks)
- [WhatsApp Cloud API webhook verification](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/)
- [Graph secure requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests)
- [Graph debug_token API](https://developers.facebook.com/docs/graph-api/reference/v26.0/debug_token)
- [WhatsApp opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)
- [WhatsApp Platform overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform)

## Safe ongoing work

Continue read-only provider capability checks, source review, defect repair, tests, optional owner-authorized test-account canaries, and documentation. **No Meta App Review submission, permission elevation, secret replacement, proactive template activation or bulk historical dead-letter replay.** Owner must explicitly authorize each promotion when verified.
