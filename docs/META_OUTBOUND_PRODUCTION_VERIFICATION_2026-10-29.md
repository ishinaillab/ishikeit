# Meta durable outbound safety — production verification, 2026-10-29

## Canonical artifacts
- Application PR #164 merged into main at 58be7eb746117428f35af6fe8f064ca8dcb20e69. Node 24 Fastify on apps.ishinaillab.com.
- Database PRs #11 and #12 merged into ishikeit-db main 97f1fdc603c13dfd2fbade88bb1b07c7b6b13fc7. Exact applied Supabase migration: 20261029090102_meta_ambiguous_send_fence.
- Local ESLint, TypeScript check, production build and 443 Vitest tests in 62 suites passed. PR #164 GitHub CI jobs Node, PHP and context-continuity all passed.

## Actual production evidence
- Hostinger Node.js auto-deployment build 01a186e8-a2a7-71a6-9bd0-bcffb69d6361 reported COMPLETED for exact Git revision 58be7eb746117428f35af6fe8f064ca8dcb20e69. Source revision in public /health/build is null and must not be used to claim a SHA; Hostinger build readback is the authority.
- Direct HTTPS /health/live, /health/ready, /health/build each HTTP 200; ready returned status ready.
- Supabase outbox: meta_send_started_at column and recovery index each present once; RLS enabled; zero anon/authenticated table grants; zero pending jobs, zero unresolved armed sends, zero new dead letters in the inspected one-hour window.
- Real database synthetic canary: within a single DO transaction, inserted an uncommitted synthetic outbox message, durably armed the fence while a live lease was owned, expired the lease, confirmed an armed row was not claimable, ran the same SKIP LOCKED recovery shape, verified the unknown-outcome dead letter + attempt audit, and deleted synthetic rows before the statement committed. A later independent query returned zero synthetic rows, zero pending, and zero armed. This test performed **no provider HTTP requests**, no customer changes and no replay of historical dead letters.
- Hostinger runtime: managed studio Instagram token matched prior signed inbox and reconciled; Messenger Page subscription reconciled unchanged; processor and dispatcher enabled; existing independent Instagram tester credential continues to yield Graph 190, unrelated to this release.

## Meta provider readbacks and holds
- Ishikeit Meta app 1042452472116584: live. Require App Secret = false, App Review NO_SUBMISSION, contact email unverified. App-level webhook subscriptions present and enabled for Page, Instagram and WhatsApp.
- WhatsApp Ishi Nail Lab business verified, account/phone registered, Ishikeit app published with callback and active account subscription. Appointment utility template ishi_appointment_reminder_v1 (en_US, ID 1674861800945394) remains PENDING. No WhatsApp appointment consent rows. Therefore proactive appointment reminders stay OFF.
- Meta app rate limit readback healthy with 0% call-count usage on current view.

## What this release guarantees (and does not)
- Once an Ishikeit worker commits a live-lease send-start marker, the same action cannot be automatically retried after a worker crash or lease expiry. Explicit unambiguous 429 rejection can safely clear the fence for retry; uncertain HTTP/no-response outcomes are dead-lettered for manual reconciliation.
- The design does NOT guarantee confirmed exactly-once Meta provider delivery, and may leave a message unconfirmed or undelivered if the worker crashes after arming but before sending.
- Safe manual outcome reconciliation, proof of each live Page/system-user token's originating app, Graph read-only proof canary, and public non-role Instagram App Review remain unfinished. Issues #159 and #158 stay OPEN.
- Do not enable Meta app-wide Require App Secret, toggle WhatsApp template dispatcher, fabricate consent, change business credentials, or bulk-replay 43 historical dead letters to close those gaps.

References: docs/META_DURABLE_SEND_FENCE_2026-10-29.md, docs/META_DEEP_RESEARCH_RECONCILIATION_2026-10-29.md, docs/CONTINUATION.md.
