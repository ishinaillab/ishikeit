# Ishikeit Meta durable outbound send fence — 2026-10-29

## Confirmed failure mode
A Meta message POST can succeed before Ishikeit sees its HTTP response. No provider-side message idempotency key has been verified for this integration. The previous outbox could repeat a possibly accepted request after a timeout, crash or expired worker lease. Graph app-secret proof does not address duplicate sending.

## Paired implementation
Database migration: ishinaillab/ishikeit-db PRs #11 and #12, migration 20261029090102_meta_ambiguous_send_fence.sql.

- PostgresOutboxStore.prepareMetaSend atomically commits the send-start marker while the current live lease is held, only for the exact supported Meta messaging operations. OutboxWorker requires this fence before dispatch and never calls Meta if it cannot acquire it.
- claimNext excludes all armed rows, including after lease expiry. It automatically quarantines expired armed rows into the existing durable dead-letter store with outcome code provider_outcome_unknown and the normal attempt audit, without replay.
- No-response and retryable HTTP 5xx or other unproven errors remain unknown and are not replayed. An explicit unambiguous HTTP 429 is the sole automatic Meta send-retry exception; retry atomically clears the marker.
- Current 24-hour service window, human handoff, consent, approved-template gates and account validation stay independently enforced.
- No raw recipients, customer content, token material or Graph error descriptions enter the new reason codes or metrics. Historical dead letters remain untouched.

## Guarantees and trade-offs
This provides at-most-one application-controlled provider POST attempt across a worker crash/lease expiry. It cannot guarantee confirmed exactly-once delivery. If a worker dies after fencing but before calling Meta, the message can be quarantined despite not being sent; a human must reconcile it. Once the unresolved job reaches the terminal dead-letter state, later jobs in that partition can proceed; take thread ordering into account in manual review.

## Safe deployment order
1. Leave current production app intact. Ensure no pending/actively leased send jobs.
2. Review and merge DB PR #11, apply that exact migration via authorized Supabase migration tool, verify column/index, RLS and client grants; check current runtime remains ready.
3. Merge updated app PR #164 only after Node/PHP/context CI. Confirm Hostinger exact deployed revision, health and queues. New readiness requires the column.
4. Perform a controlled synthetic DB lease-expiry and recovery exercise with no provider POST and clean up synthetic data, recording outcome-unknown audit.
5. Keep Meta app-wide Require App Secret and proactive WhatsApp appointment reminders unchanged and gated.

## Rollback
Roll back the application binary first if required. Leave nullable DB column in place because dropping it could destroy unresolved-send evidence. Never clear unknown markers or bulk replay historical dead letters. In an incident, disable action dispatch while preserving signed webhook ingress.

## Remaining work
Provide an authorized manual read-only reconciliation experience and enhanced delivery-status correlation; verify real provider behavior with legitimately controlled user-origin canaries. This does not claim undocumented Meta exactly-once semantics.
