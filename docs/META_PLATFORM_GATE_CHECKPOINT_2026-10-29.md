# Ishikeit Meta security and approval gate checkpoint — 2026-10-29

## Verified merged production baselines
- Application main functional SHA 0be6203b9bcad958527101a544880716dc0f583c (PRs #166 and #167), Hostinger Node 24 / Fastify auto-deployment COMPLETED for that exact SHA; direct /health/live and /health/ready returned HTTP 200.
- Database main SHA 1b3cbef7ed838038cfb435953f239f34a931a835, private reconciliation migration 20261029092718_meta_outbound_unknown_reconciliations applied and RLS/no PUBLIC/anon/authenticated grants confirmed; earlier pre-send fence unchanged.
- CI (Node, PHP, context-continuity), ESLint, TypeScript and build passed. Full local test suite: 450 tests across 64 files.
- One-transaction synthetic DB operator review acceptance test verified first immutable insert, conflict safety and nonrelease of dead-letter rows, with cleanup. Independent DB readback found 0 synthetic rows, 0 review rows, 0 recent dead letters, 0 pending and 0 unresolved armed sends.

## Issue #159 operator outcome reconciliation
- Operator-only GET /ops/meta/unknown-outcomes and POST /ops/meta/unknown-outcomes/:outboxId/review deployed; no release/retry/send route and no customer payload exposure. Auth requires OPS_METRICS_TOKEN. The returned fields are bounded, cache-blocked and metadata-only.
- **Unresolved**: stronger per-person verified operator identity, human reconciliation with provider source/receipt evidence; no automated repeat of ambiguous sends.

## Issue #158 Graph proof token and app security
- Default-OFF Graph HMAC module was previously integrated in PR #163. New Ops-only read-only GET /ops/meta/graph-proof-preflight in PR #167 validates token issuer with Meta /debug_token then signs GET /me only when the token's app ID matches. No Instagram Login mixing, customer send, token refresh or Meta dashboard setting change.
- Production endpoint returned 401 without bearer, as intended. Hostinger environment key inventory includes OPS_METRICS_TOKEN, META_APP_ID, META_APP_SECRET, META_MESSENGER_ACCESS_TOKEN and META_WHATSAPP_ACCESS_TOKEN; values are masked. **No authenticated proof preflight was run**, and neither live token has been formally proven by this canary. The app-wide Require App Secret remains OFF and the optional proof flag stays default OFF; never enable without actual owner/proof compatibility evidence.
- Official reference: https://developers.facebook.com/docs/graph-api/reference/v26.0/debug_token and https://developers.facebook.com/docs/graph-api/guides/secure-requests/.

## Meta App Review / Instagram
- Meta app 1042452472116584: live. Readback: App Review submission_status NO_SUBMISSION, no privileges returned, requirements can_submit=true; contact_email_verified=false. Page, Instagram and WhatsApp app-level subscriptions are enabled.
- URLs currently configured for app privacy policy, terms of service and data deletion return HTTP 200 after their canonical slash redirects. Review eligibility does not mean a submission has been filed or permission has been approved.
- Managed Instagram professional-account token and subscription reconciled at runtime. An independent older tester credential continues returning Meta error code 190 during startup. Treat that as a stale/invalid credential needing genuine account reauthorization; do not invent refresh success or delete it merely to suppress logs.

## WhatsApp appointment reminders
- Ishi Nail Lab WhatsApp business is verified with full business profile, payment, published app, account webhook subscription and registered sender as read by WhatsApp tools.
- Utility template ishi_appointment_reminder_v1, language en_US, ID 1674861800945394 is PENDING; current Supabase purpose-specific consent count is zero. Proactive appointment sends stay disabled. No template approval or recipient opt-in is implied by business verification.

## Safe subsequent priorities
1. Execute the Ops-authenticated Graph proof preflight **inside an authorized private operational context** that never exposes or replaces tokens. Record only sanitized per-channel statuses. Enable the optional proof flag only after each token reports proof_compatible and the full no-customer-send regression gates pass; do not enable Meta-global Require App Secret.
2. Build a genuine Meta App Review submission package for instagram_business_basic and instagram_business_manage_messages with accurate reviewer test steps and evidence. Verify contact email independently as needed; don't declare submitted until developer dashboard confirms.
3. Reauthorize the affected historical Instagram tester via the correct Instagram Login OAuth flow if that tester remains necessary, avoiding any impact to the healthy studio account.
4. Wait for actual WhatsApp template approval and collect genuine purpose-specific user consent before any notification dispatch activation; preserve booking cancellation/rescheduling and duplicate safeguards.
5. Mature #159 operator individual identity and provider-level evidence workflow without any bulk replay of historical dead letters.

See docs/META_UNKNOWN_OUTCOME_OPERATOR_RUNBOOK_2026-10-29.md, docs/META_GRAPH_PROOF_READONLY_PREFLIGHT_2026-10-29.md, docs/META_OUTBOUND_PRODUCTION_VERIFICATION_2026-10-29.md.
