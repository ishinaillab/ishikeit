# Independent live Meta messaging validation — October 29, 2026

**Scope:** Ishikeit production at `apps.ishinaillab.com`, Meta developer app `1042452472116584`, the Ishi Nail Lab WhatsApp business account, live Supabase `vhmrliqemkfxblzsoyaz`, GitHub `ishinaillab/ishikeit` `main`. This audit was independently executed using provider readbacks, real production records, HTTPS negative authentication probes, and a fresh local full test run. No customer messages or consents were fabricated; no historical dead letters were replayed. Aggregate evidence only, no PII or token values copied into this report.

## Verdict

- **PASS — Messenger supported signed inbound text / response / outbound-delivery flow** for the sampled current production traffic. The sample does **not** prove every quick-reply/postback/handover variation.
- **PASS — live app-level Meta webhook subscriptions and Messenger Page-level + Instagram managed-account-level reconciliation**; production startup readback showed Messenger `changed=false` after an earlier successful `changed=true`; managed Instagram reconciliation succeeded with `historical_signed_inbound_account_match=true`.
- **PASS — production deployment/HTTPS security basics/queue integrity and full automated test suite.**
- **PARTIAL — historical Instagram and WhatsApp messaging evidence**, but no fresh post-deployment customer-originated Instagram postback/seen or handover test and no post-deployment WhatsApp end-to-end canary.
- **BLOCKED — WhatsApp proactive template reminders:** `ishi_appointment_reminder_v1` ID `1674861800945394` is still `PENDING` with `UTILITY` category; **0 active signed opt-in rows**. Sending stays disabled until both approval and customer consent / safe dispatch configuration exist.
- **EXTERNAL GATE — Meta App Review/access:** app Live and business verified; review `NO_SUBMISSION`, contact email not verified, no review privileges requested; genuine non-role public-account access cannot be certified from app-level webhook subscriptions alone. Expired historical Instagram *tester* OAuth gives Graph 190 but is distinct from the valid managed studio owner token.

## Reproducible verification checks

| Area | Method | Observed evidence | Interpretation |
|---|---|---|---|
| Provider subscriptions | Meta `list_subscriptions` | Page `messages,message_deliveries,message_reads,messaging_postbacks,messaging_handovers`; Instagram `messages,standby,messaging_handover,messaging_seen,messaging_postbacks`; WhatsApp `messages` | Three active app topics, fields verified |
| Messenger Page | Hostinger startup logs after PR #145 and final #146 | `Messenger verified Page webhook subscription reconciled; changed=false` after earlier `changed=true` | Page-installed app has required fields, independently read back |
| Instagram managed account | Hostinger startup logs | Successful managed-token webhook reconciliation and previous signed-inbound owner match; separate tester credential Graph 190 warning | Studio owner works at startup; tester needs authorization |
| Production build | Hostinger deployment, public HTTPS | Deployment completed at `9c4883b3f1b1f76364163d6865c7d353da418219`; `/health/live`, `/ready`, `/capabilities`, `/build` all HTTP 200 | Runtime online, processor and dispatcher enabled |
| Real Messenger ingress | Read-only Supabase SQL filtered after `2026-10-28T21:50:05Z` | **3** signed stored `message.received` events; all processed/handled; no retries or unprocessed events | Real production message intake supported |
| Messenger outbound | Read-only Supabase outbox | **3** post-deploy `action.dispatch` Messenger actions, all published; all **3** signed inbound sender/account pairs corresponded to a published outbound action for the same account within 2 minutes | Real response dispatch proven for this sample |
| Messenger receipt linkage | Read-only Supabase inbound/outbox join on channel+account+provider message ID | **3** `delivery.delivered` receipts matched precisely to outbound provider resource IDs; **3** `delivery.read` events also recorded and processed but were *watermark-only* with no message IDs | Delivery linkage proven; do **not** falsely attribute aggregate read to exact messages |
| Historical Meta activity | Read-only Supabase | Instagram **53** received historical messages (latest 2026-10-25 13:28 UTC), **49** echoes; WhatsApp **101** historical received messages (latest 2026-10-28 16:04 UTC). One historical Instagram `handover.pass` and one `standby.message` dated September 30 | Prior channel activity exists, **not** proof of new field callbacks after the latest changes |
| Queue health | Supabase outbox | `action.dispatch`: 216 total, 205 published, 11 historical dead letters; `inbound.event.accepted`: 525 total, 493 published, 32 historical dead letters; total **0 pending**, **0 newly dead-lettered in 24h** | No current queue backlog; historical 43 dead letters preserved without replay |
| Idempotency | Read-only Supabase GROUP BY checks and unique inbound index | **0** duplicate inbound deduplication-key groups; **0** duplicate outbound idempotency-key groups; inbound deduplication key is database-unique | Durable dedup evidence |
| Live negative auth | Direct HTTPS probes against production | GET `/ops/metrics` without token → **401**; invalid webhook challenge → **403**; POST empty Meta JSON **without signature** → **401**; health routes → **200** | Verified no unauthenticated ingress in these cases; probes did not supply a valid signature |
| Database isolation | Supabase catalog query for private event/outbox/OAuth/consent/handoff tables | RLS enabled; `anon` and `authenticated` roles have no direct SELECT or INSERT grants for the checked tables | Strong backend-only posture for tested tables |
| RLS/performance advisors | Supabase `get_advisors` | 12 informational `rls_enabled_no_policy` notices (expected for backend-only inaccessible tables) and five informational unused indexes | Do not add permissive public RLS policies or drop reliability indexes based on INFO alone; [official advisor reference](https://supabase.com/docs/guides/database/database-advisors) |
| Consent | Read-only consent tables | **0** active `meta_whatsapp_template_opt_ins` and **0** opt-outs | No permission to send proactive WhatsApp reminders |
| Regression | Fresh local `npm run check` on clean matching `main` | ESLint, typecheck, **373/373 passing tests in 55 files**, and production TypeScript build passed | Code-level signature/consent/routing/postback/receipt regressions covered; mocks are not provider end-to-end evidence |
| App review and rate limiting | Meta developer tools | App Live, business verification valid, contact email verification false, App Review `NO_SUBMISSION`; Meta rate-limit overall healthy | No review or rate-limit blocker for managed business, but ordinary non-role reach not independently proved |

## Precise outstanding acceptance checks

1. **Instagram new-event canary:** observe a signed fresh, authorized customer-initiated Instagram DM and its outbound response after the new subscriptions, and a real `messaging_seen` / `messaging_postbacks` callback. Cross-check account ID, event dedup key, worker outcome, outbound response and receipt; do not confuse managed owner with revoked tester OAuth.
2. **Messenger interaction canary:** use authorized real customer-originated postback / quick reply and native handover events; test the human-handoff no-AI-response guard and release path. A dashboard-generated sample alone is only an endpoint integration test, not proof of customer messaging eligibility.
3. **WhatsApp appointment reminders:** Meta must approve exact template language/category; before any proactive send, obtain genuine consent, validated LatePoint appointment/reminder schedule and cancellation handling, safely provision private consent HMAC key and guarded dispatch allowlist. Opt-in table currently has zero records. Existing conditional task watches template state; no templates were sent.
4. **Permissions and reviewer readiness:** verify Meta product-specific permission and non-app-role webhook access; finish app contact email, any genuine reviewer accounts/screencast, and App Review if required. Do not submit an unsupported request or claim general availability.
5. **Legacy Instagram tester Graph 190:** only the account holder's legitimate reauthorization can restore that different OAuth credential. Never delete/replace the valid studio owner credential or fabricate a token.
6. **Receipt metrics caveat:** Messenger watermark-only read receipts have no exact provider message ID. The protected exact-message lifecycle report correctly correlates delivered-by-ID and keeps unattributed read events aggregate; never report all Messenger messages individually read solely from a watermark.

## Safety and methodology

- Only direct readbacks, SQL `SELECT`, harmless unsigned/invalid-header public probes, and local `npm run check` were executed. No provider test webhook send (which has a second provider confirmation gate), no customer outbound messages, no changed live permissions or data in this independent-validation pass.
- The sample demonstrates currently observed behavior; it cannot prove 100% availability, future message delivery, public-customer access without App Review, or callback varieties that have not occurred.
- Preserve the previously tested default-off template sending, Meta 24-hour reply policy, exact owner matching, human handoff and no automatic historical dead-letter replay.
