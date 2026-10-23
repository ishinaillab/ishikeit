# Ishikeit operational review — 2026-10-24 (PHT)

> Read-only application / WordPress / Cloudflare investigation, plus one controlled Supabase security migration. This checkpoint branch is **not** intended for Hostinger deployment. The application production branch remains `main`. Do not use retired `/ishinaillab/ishi`.

## Canonical references

- App: `ishinaillab/ishikeit` `main`; current latest inspected app commit `f02dfc57471d32ad8b86efaebd832148e3576a23` (2026-10-11).
- Database: `ishinaillab/ishikeit-db` `main`.
- Backend: `https://apps.ishinaillab.com` (Hostinger, Node 24, Fastify).
- WordPress AI Engine bridge: `https://www.ishinaillab.com/wp-json/ishi-ai/v1`, plugin Ishi AI Bridge 0.3.0.
- TikTok Comment-to-Message: unmerged `ishikeit` PR #71 / `feature/tiktok-comment-to-message`; this branch diverged from `main` by +20/-2 commits at review time.

## Production application check — 2026-10-24

Public endpoints retrieved independently via Context web scrape (raw response bytes):

- `GET /health/live` → `{"status":"ok"}`.
- `GET /health/ready` → `{"status":"ready"}`.
- `GET /health/capabilities` → `architecture=event-action-v1`, `canonicalEventSchema=2`, `actionSchema=1`, `operationalMetricsSchema=2`, `wordpressBridgeApiSchema=3`, `wordpressBridgeStorageSchema=1.1.1`; `processorEnabled=true`, `actionDispatchEnabled=true`, `processorCanaryPartitionCount=0`, `processorCutoverAt=2026-09-30T10:31:25.208Z`, `videoInterpreterProvider=none`. TikTok Business Messaging read/webhook/image schema markers remain exposed; this does **not** prove provider approval or production message delivery.
- These public health endpoints do not expose the running commit SHA. Do not assume that current production revision equals a GitHub commit unless Hostinger build metadata is read separately.
- WordPress authenticated connector confirms Ishi AI Bridge `0.3.0` **active**, AI Engine Pro `3.8.6` **active**.
- Authenticated private bridge health itself was **not** tested. Unauthenticated scraping of that endpoint encountered an anti-bot/access wall. Do not treat that as a failed authenticated bridge call.

## Supabase live database and incident findings

Project `ishikeit-db` reported `ACTIVE_HEALTHY`. At review time:

- `public.inbound_events`: 499 rows; `public.outbox`: 712 rows; `public.outbox_attempts`: 659 rows.
- Outbox pending across topics: 0.
- `inbound.event.accepted`: 32 historical dead letters, 10 newly dead-lettered within previous seven days, all latest on 2026-10-20.
- `action.dispatch`: 11 historical dead letters, zero newly dead-lettered within previous seven days.
- Recent failed inbound records from Messenger, WhatsApp, Telegram explicitly record `WordPress AI bridge returned HTTP 502` or (WhatsApp) `HTTP 522`; no evidence of provider outbound send faults causing these inbound-processing failures.
- Latest recorded message and outbound publish: Telegram 2026-10-23T09:37 UTC. Recent successful Instagram, Messenger, WhatsApp messages recorded before that.
- **Do not automatically replay old dead-lettered customer messages:** delay/duplicate sends would be possible. Require human review and safe per-conversation replay strategy.

## Cloudflare incident evidence — 2026-10-20

Read-only authorized Cloudflare GraphQL `httpRequestsAdaptiveGroups` for zone `ishinaillab.com`, bridge request path `/wp-json/ishi-ai/v1/turn`:

For **2026-10-20T13:45:00Z through 14:50:00Z**:

- 45 requests: `edgeResponseStatus=502`, `originResponseStatus=502` (the origin returned bad gateway).
- 1 request: `edgeResponseStatus=522`, `originResponseStatus=0` (origin connection timeout).
- 2 requests: `edgeResponseStatus=525`, `originResponseStatus=0` (origin TLS handshake failure).

Other non-bridge paths also showed `522` in that incident window, supporting an origin/connectivity incident rather than a social-platform-specific fault.

For **2026-10-21T00:00:00Z to 2026-10-24T00:00:00Z**, the bridge path's available aggregated analytics recorded 3 responses with `edgeResponseStatus=200` and `originResponseStatus=200` and no other result groups. This suggests recovery; it does **not** establish permanent reliability or diagnose the underlying host/PHP process mechanism.

Cloudflare's legacy Zone Analytics API is sunset; use GraphQL Analytics API for subsequent investigations. GraphQL adaptive counts are subject to sampling/retention rules as provided by Cloudflare.

The WordPress PHP error log available through Easy MCP AI is `error_log_ishinaillab_com` (380,528 bytes at the time read), with no lines matching the October 20 date string or `ishi-ai`. The available live log does not prove what PHP/FastCGI was doing during the incident. Hostinger PHP-FPM/webserver/origin logs and resource ceilings for that window remain unverified.

WordPress Site Health performed during review: 27 good / 4 recommended / 2 critical on async run, with the criticals including Aipatch Scanner score 45/100 (site-level concern separate from Ishikeit) and page caching absent / median homepage server response 1,694 ms. LiteSpeed Cache is currently inactive by deliberate prior decision; do **not** enable page caching without checking Elementor correctness, booking, customer data and `/wp-json/ishi-ai/v1/*` non-cache requirements. Site Health aggregate counts varied with runs, so refer to named tests rather than assuming fixed totals.

## Critical Supabase security exposure — **remediated on production**

Supabase Security Advisor initially reported `rls_disabled_in_public` on `public.outbox_attempts` and broad `anon`/`authenticated` table privileges.

Executed production migration through authorized Supabase MCP:

- migration version: `20261023205748`
- migration name: `secure_outbox_attempts_rls_and_client_access`
- DDL:
  ```sql
  REVOKE ALL PRIVILEGES ON TABLE public.outbox_attempts FROM anon, authenticated;
  ALTER TABLE public.outbox_attempts ENABLE ROW LEVEL SECURITY;
  ```
- Verified `relrowsecurity=true`; `anon` and `authenticated` have no `SELECT` on that table; `postgres` retains `INSERT`; Security Advisor's `rls_disabled_in_public` finding is gone. Other internal tables have RLS enabled without client policies intentionally.
- Canonical Git migration file committed and fetched for read-back:
  `ishinaillab/ishikeit-db` `main`: `supabase/migrations/20261023205748_secure_outbox_attempts_rls_and_client_access.sql`, commit `b0586a230dc5647c3c9ad461df1caf4f4151d47e`.
- Post-change `/health/live` and `/health/ready` remain healthy, both workers enabled; outbox still zero pending. No artificial customer message was sent; a new real post-migration message canary has not yet been performed.

Supabase reference: https://supabase.com/docs/guides/api/securing-your-api

## Pending engineering / external gates

1. Obtain authorized Hostinger historical origin/PHP-FPM/webserver logs/resource telemetry for 2026-10-20 13:45–14:50 UTC or a subsequent recurrence. Diagnose the **cause of** origin 502/522/525, not merely the resulting API status. Investigate concurrency/process limits, TLS origin handshake, PHP worker overload, WordPress request latency, and external AI timeouts only when logs support a conclusion.
2. Run fresh authenticated Ishi AI Bridge health and safe future canary (not a customer replay) when available; protect idempotency, no-cache semantics, private tokens and policy limits.
3. Verify Hostinger's currently deployed application revision from build metadata; public endpoint health alone proves availability, not SHA parity.
4. TikTok Business Messaging approval/provider eligibility remains unverified. Do not present a database-less TikTok path as live.
5. PR #71 currently diverges from `main` (ahead 20 / behind 2). Refresh branch and rerun Node 24 CI/tests and cross-channel regressions **before** any merge; retain existing `TIKTOK_COMMENT_TO_MESSAGE_ENABLED` gating and do not activate provider calls without provider permissions and controlled validation.
6. Preserve existing production messaging, Cloudflare rules, WordPress security guards, customer data, booking operations and canonical domains. No unrelated provider mutations or dead-letter replays occurred during this review.
