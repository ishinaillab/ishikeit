# Meta Deep Research reconciliation — 2026-10-29

## Source and evidence boundaries

Reviewed the three user-supplied reports:
1. *Meta Platform Deep Research and Ishikeit Technical Audit*
2. *Executive Summary*
3. *Ishikeit Meta Security Module Integration and Production Rollout Plan*

These research reports did not perform authenticated line-by-line inspection of the latest Ishikeit application code or independently verify the latest Hostinger build. Their recommendations are proposals, not proof of currently missing features. This reconciliation is against GitHub `main` at `02695ac979890ad9f4c531615b76e7d103557915` and the local D: checkout. Production state must still be checked against actual Hostinger, Supabase and Meta readbacks before release.

## Findings already implemented in the current code

- Exact raw-body Meta HMAC verification exists in `src/security/meta.ts`; `src/http/server.ts` calls it before accepting POST webhook payloads. The current runtime passes one configured Meta App Secret to that route.
- HMAC-SHA256 Graph `appsecret_proof` is implemented at `src/channels/meta-graph-proof.ts`, guarded by `META_GRAPH_PROOF_ENABLED` (default off). Messenger and WhatsApp Graph sends, WhatsApp Graph media metadata, and Messenger Page subscription reconciliation are covered. Instagram Login deliberately uses a different credential path and is excluded. See PRs #160 and #163 and `docs/META_GRAPH_PROOF_ROLLOUT_2026-10-29.md`.
- Provider-neutral inbox/outbox, lease-based dispatch, response-window gating in `src/adapters/meta/messaging.ts`, human handoff suppression, and explicit WhatsApp template/consent checks exist. Do not replace these with generic illustrative code from the reports.
- Signed P-256 LatePoint event projection and suppression-only 24h/2h scheduler exist. **There is no enabled proactive reminder sender**; template approval, genuine consent and authoritative dispatch-time recheck are separate requirements.
- Receipt and account-subscription reconciliation have existing implementation and historical live verification. Messenger watermark-only reads must never be attributed to exact sent message IDs.

## Confirmed finding addressed in this branch

Prior to this change, `src/channels/meta-send.ts` correctly marked no-response Graph POST failures as `ambiguous=true`, but `src/workers/outbox-worker.ts` retried any retryable failure. A lost HTTP response might follow successful provider acceptance, so the same message could be sent twice.

The worker now preserves ambiguous Meta `messaging/message.send` and `messaging/message.template.send` failures in the existing durable dead-letter store with `provider_outcome_unknown` classification, explicitly requiring manual reconciliation and prohibiting automatic retry. This is a conservative customer-safety tradeoff: one reply may remain unconfirmed or undelivered until manually resolved. It does **not** establish provider exactly-once semantics, and must **not** trigger bulk replay of the 43 historical dead letters. Other providers' retry behavior is unchanged.

**Remaining related risk:** a process may terminate or lose its lease after Meta accepted a POST but before Ishikeit durably records success. The worker can later reclaim that job without knowing whether the POST succeeded. Preventing that requires a durable pre-send claim/outcome-unknown fence (and a well-defined manual resolution path), not merely a catch-handler change. Therefore issue #159 remains open until crash/lease-loss and safe manual reconciliation acceptance tests pass.

## Remaining Meta priorities from the three reports

1. **P0 — Correct webhook signing identity:** separately verify the actual Meta app/product that signs Messenger, Instagram Login and WhatsApp deliveries. The live Meta route currently has a single signing secret, while Instagram OAuth uses a distinct configured product secret. Test actual signed deliveries, bad/wrong secrets and raw UTF-8 bytes before changing the fail-closed signature boundary. Never add unverified permissive fallback logic.
2. **P0 — Ambiguous-send durability:** finish the pre-send state, crash/lease-loss safeguards, safe manual reconcile and full #159 acceptance matrix. Never assume `appsecret_proof` implements message idempotency.
3. **P0 — Live capability proof:** verify Page and WhatsApp token app ownership, scopes, asset subscriptions, and read-only Graph proof canaries before enabling `META_GRAPH_PROOF_ENABLED`. Keep Meta's global Require App Secret setting off until every relevant app client is verified (#158).
4. **P0 — WhatsApp reminder sender remains OFF:** template provider approval, purpose-specific consent, booking/recipient revalidation, reschedule/cancellation suppression, and duplicate-safe dispatch are mandatory.
5. **P1 — Graph transport policy:** consolidate safe error/subcode classification, rate-use header telemetry, backoff, pagination and outbound Graph test fixtures. Existing implementations must be inventoried before restructuring.
6. **P1 — Read-only capability and Conversations reconciliation:** explicit versioned scopes, provider asset readbacks, bounded backfill that never replays historical messages through the AI processor.
7. **P2 — OAuth/key rotation and official Meta developer-tool audit:** audit current implemented flows and record explicit acceptance evidence; don't conflate a documentation gap with a code defect. Meta Marketing/MCP implementation remains a separately authorized future capability.

## Release gates

- Run ESLint, typecheck, full bounded-worker Vitest suite and TypeScript build.
- Use a reviewed PR and passing CI, then check exact deployed Hostinger SHA, health/readiness, queue metrics, and no unexpected customer/Meta errors.
- Do **not** activate WhatsApp reminder sends, modify Meta subscriptions/app-wide security settings, alter masked Hostinger environment values, replay historical dead letters or modify the retired `ishinaillab/ishi` repository as part of this change.
