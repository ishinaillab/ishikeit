# Ishikeit LatePoint durable reminder scheduler — 2026-10-29

## Production intent and strict safety boundary

Appointment booking ingress is signed with a WordPress-only ECDSA P-256 private key.
Ishikeit stores only a public verification key. Every accepted booking event contains
only booking ID, lifecycle state, UTC start and timestamp: no phone, email, name,
notes or payment details.

The scheduler introduced here is **non-sending by construction**. It stores
two candidate slots (24 and 2 hours before) for each approved booking, invalidates
plans when the booking is cancelled, deleted, completed or otherwise unapproved,
and suppresses elapsed deadlines. No code path in the scheduler creates an
`action.dispatch` job or calls a messaging provider.

Provider-approved `ishi_appointment_reminder_v1`, purpose-specific active WhatsApp
consent, a fresh authoritative LatePoint booking snapshot and safe cancellation
invalidation are still independent prerequisites to any later sender.
At this checkpoint the template is **PENDING** and there are **zero opted-in customers**.
No automated reminders may be sent.

## Database migration and privacy

Migration `20261029022318_latepoint_private_reminder_schedule.sql` lives in
`ishinaillab/ishikeit-db` and was applied to project `vhmrliqemkfxblzsoyaz`.
It creates `public.latepoint_booking_states` (most recent event ID and timestamp,
status, UTC start, conflict state) and `public.latepoint_reminder_slots`
(two lead-hour rows per booking, latest revision, deadline, state, reason).
Both use strict CHECK constraints, enable RLS, and revoke all access from
`anon` and `authenticated`. Neither stores recipient PII or provider credentials.

Transactional projection occurs inside `PostgresInboundStore.ingest` only
after a booking webhook passes P-256 verification, strict schema and deduplication.
Projection occurs in the same database transaction as inbound event persistence.
It does not depend on the general AI processor cutover/canary configuration.
Any schema or state update failure rolls back the entire event and leads to
a retryable inbound HTTP failure, rather than falsely acknowledging an event.

## Ordering and lifecycle semantics

A transaction-scoped, per-booking advisory lock serializes concurrent revisions.
Strictly older `occurredAt` revisions are ignored. Equal timestamp revisions
with different IDs quarantine the booking: `conflict=true`, all slots invalidated.
Only a strictly newer signed revision can resolve the quarantine.

An approved booking starts two future slots only if their deadlines have not
passed and the appointment is within the 90-day horizon. Pending, cancelled,
no-show, completed and deleted booking states invalidate both slots. A moved
appointment replaces the deadline and revision ID of each slot atomically.

A separate one-minute clock queries only due `scheduled` slots with
`FOR UPDATE SKIP LOCKED`, marking them `suppressed` because outbound sending
is not authorized. Suppression does not call Meta, persist customer identity,
generate template action, or treat the booking itself as consent.

## Operational verification and staged delivery

1. Validate Node ESLint, TypeScript, unit tests and build, and DB migration version.
2. Check Supabase RLS, client-role REVOKE and table constraints.
3. After deployed revision passes readiness and runtime checks, query a controlled,
   signed booking event to ensure state and two slot records materialize correctly.
4. Verify cancellation/reschedule result in invalidation/replacement. Never create
   a real booking solely for a test if native LatePoint notifications may fire.
5. Monitor `outbox` dead letters, readiness, and the absence of WhatsApp template sends.
6. Keep sending disabled until Meta approves the exact template, customer WhatsApp
   purpose consent exists, and an authoritative live booking-state/recipient resolver
   plus independently gated, idempotent dispatcher is added.

If a scheduling fault is detected, disable WordPress producer through the protected
option `ishi_latepoint_bridge_enabled='0'` and leave Meta integrations untouched.
Never rotate P-256 keys or replace masked Hostinger Node environment values as a
routine scheduler rollback.
