# LatePoint → Ishikeit booking lifecycle: verified preflight and gated integration (29 Oct 2026)

## Live WordPress audit — read-only evidence

The following queries were executed on the *real Ishi Nail Lab WordPress database*, not inferred from installed plugin names:

- `SHOW TABLES LIKE 'wp_latepoint%'`: 63 LatePoint tables, including `wp_latepoint_processes`, `wp_latepoint_process_jobs`, `wp_latepoint_bookings`, `wp_latepoint_settings`.
- `SELECT ... FROM wp_latepoint_processes`: **0 workflows** (no native LatePoint WhatsApp, email or reminder workflow exists in that table).
- `SELECT ... FROM wp_latepoint_process_jobs`: **0 scheduled process jobs**.
- Configuration key names in `wp_latepoint_settings`: **no WhatsApp notification processor setting** matched the scoped audit query. No private settings values or customer records were copied.
- Aggregated `wp_latepoint_bookings` by status: **4 approved, 1 cancelled, all in the past, none lacking `start_datetime_utc`**. This is evidence about this data snapshot, not a historical claim about all bookings or future reminders.
- WordPress `timezone_string`: **Asia/Manila**. Existing WP-Cron `latepoint_process_scheduled_jobs` runs every 300s (not overdue when read).
- Installed and active: **LatePoint 5.7.5**, **LatePoint Pro Features 1.7.3**, and **LatePoint WhatsApp by Meta 1.1.0**. Installation of an add-on by itself does *not* configure or send notifications.
- Official docs: [LatePoint hooks](https://latepoint.com/docs/list-of-latepoint-hooks-actions-and-filters/), [WhatsApp notifications](https://latepoint.com/docs/sending-whatsapp-messages-in-latepoint/), and [appointment reminders](https://latepoint.com/docs/how-to-create-appointment-reminders/).

**Sender choice:** Because there are no native workflows and consent/approval gating must remain centralized, Ishikeit is the proposed single canonical *future* WhatsApp reminder sender. Do not independently activate a LatePoint "Send WhatsApp Message" workflow. Check for changes to this choice before enabling any outbound messages.

## Completed deliverables, intentionally default off

- Node ingress `POST /ishikeit/webhooks/latepoint` is **not registered** unless `LATEPOINT_BOOKING_WEBHOOK_SECRET` (32–256 UTF-8 bytes) is configured at process startup.
- An independently versioned WordPress producer is packaged at `wordpress/ishi-latepoint-booking-bridge/ishi-latepoint-booking-bridge.php`. Without both PHP constants `ISHI_LATEPOINT_BRIDGE_ENABLED=true` and `ISHI_LATEPOINT_BRIDGE_SECRET` (32+ bytes), it **does not enqueue or send anything**.
- Producer hooks: `latepoint_booking_created`, `latepoint_booking_updated`, `latepoint_booking_deleted`; no modifications to LatePoint or its premium add-ons.
- Producer sends **only** `schemaVersion, source, bookingId, change, status, startsAt, occurredAt` — never names, phones, emails, payment amounts, comments or consent assumptions.
- `startsAt` comes directly from verified LatePoint `start_datetime_utc` and is encoded with an explicit UTC `Z`, avoiding browser and WordPress timezone ambiguity.
- The producer queues a single WP-Cron HTTP dispatch with bounded retries on transient failure (no retry for authentication or invalid data). It signs `<unix timestamp>.<raw JSON bytes>` with SHA-256 HMAC and an independent key.
- Receiver checks timestamp ±300 seconds, HMAC with constant-time comparison, exact allowlisted source and status, 4 KB body limit, and Zod strict schema **before** touching the database.
- Accepted snapshots are stored via the existing `inbound_events` + `inbound.event.accepted` durable outbox, with a keyed, stable booking partition and deduplication hash. They carry `provider=latepoint, channel=bookings, capability=booking`.
- No handler currently generates WhatsApp actions for this new booking capability. The worker records it as an ignored, non-sending lifecycle event, with safe historical retention for future rechecks. This is **ingestion groundwork**, not a complete delivery or cancellation scheduler.
- The previously built `latePointReminderCandidate` still performs only pure planning. Do not mistake its result for permission to send.

## Safe activation sequence (not performed automatically)

1. Create a unique random secret (not the Meta app secret or WordPress AI bridge token). Configure it **without logging or exposing the value** in secure WordPress server configuration as `ISHI_LATEPOINT_BRIDGE_SECRET`, and in Hostinger Node.js variables as `LATEPOINT_BOOKING_WEBHOOK_SECRET`. **Important:** the official Hostinger API's environment-variable write endpoint is full replacement. The read endpoint masks existing secrets with asterisks. Never apply a naive "read, add one, write" because it would erase/rewrite 51 live variables and break Instagram, Messenger, WhatsApp and TikTok.
2. Activate the dedicated non-premium WordPress bridge only after the WordPress code is installed and verified, retaining `ISHI_LATEPOINT_BRIDGE_ENABLED` absent/false at first. Deploy the paired Node receiver; verify the endpoint returns HTTP 404 while unconfigured. Separately configure WordPress and Node with the identical independent secret.
3. Run one **controlled, authorized real LatePoint booking edit**, with the feature explicitly enabled, not a customer-facing synthetic appointment. Inspect the signed request ACK, exactly one deduplicated `inbound_events` record, `inbound.event.accepted` published, and zero `action.dispatch` messages generated for booking events. Repeat the same body/HMAC within the window to verify duplicate ACK. Test a cancellation and deletion tombstone separately on authorized noncustomer test records.
4. Before notification activation, independently verify **latest authoritative booking state** at send time; sort by event revision not arrival time (stale events can be delayed), suppress canceled/rescheduled bookings, explicitly verify purpose-specific WhatsApp opt-in from signed customer messages and STOP tombstones, verify exact Meta-approved template, and implement durable reminder job versioning with a single canonical scheduler and a global kill switch. Current Meta Utility template was PENDING with **zero active opt-ins** on last provider/database check. No proactive WhatsApp dispatch until those gates are met.

## Acceptance checks and limits

- Local `npm run check` covers HMAC positive and negative paths; replay dedup; created/updated/canceled/deleted snapshots; PII rejection; strict timestamps/status; body cap; and disabled 404. GitHub CI separately checks PHP syntax. These are *simulated source events in tests*, not real appointment exports.
- Production existing Meta webhooks remain independent and unaffected when the new route is disabled.
- Does not add WordPress customers to Supabase, invent consent, change LatePoint Pro Features, enable WhatsApp templates, or create native LatePoint workflows.
- Never set the Hostinger Node env variable using the full-replacement API response because all currently sensitive values are masked as `********`.
