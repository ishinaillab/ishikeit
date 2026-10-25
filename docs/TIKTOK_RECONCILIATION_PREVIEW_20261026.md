# TikTok Business Messaging history reconciliation — safe preview

Date: October 26, 2026. **Source-only draft. Not live, not registered or deployed.**

## Purpose

Compare one already-authorized TikTok Business Messaging conversation batch with
persisted provider message identifiers, as preparation for future reconciliation
and backfill. The batch may be incomplete or paginated. A zero-gap preview
**never** establishes that an entire TikTok conversation is synchronized.

`previewTikTokHistoryReconciliation()` takes:

- The expected Business Account and the previously authorized Business Account;
  any mismatch fails before processing.
- One conversation ID.
- A bounded provider message batch already obtained through an authorized
  read-only Business Messaging API call.
- A bounded set of existing persisted provider message IDs from the same
  conversation/account, read-only.

The result is always `mode: "dry_run"` and
`coverage: "provided_batch_only"`. It records batch, unique, duplicate,
already-persisted and missing counts. Candidate and conversation identifiers
are returned **only as SHA-256 digests**, not raw IDs. Customer text, profile
fields, tokens, attachments, or raw provider payloads are never returned.

## Safety boundary

This module performs **no TikTok API call**, database query or mutation,
message import, storage migration, queue replay, AI request, or message send.
It is not registered in a server route, worker, startup action, or public API.
It does not mark provider messages as delivered or independently verify
TikTok Business Messaging account access.

The input bounds are 500 provider rows and 10,000 persisted IDs. It rejects
invalid IDs, control characters, account or conversation crossover, and
malformed timestamps. Exact duplicate provider IDs count once; missing
digests are sorted for deterministic repeatability.

## Future provider-verified integration gates

1. Independently verify Ishikeit app's Business Messaging product/scope grant,
   security/privacy access, and Business Account owner authorization.
2. Confirm `/business/get/` account entitlement and actual eligible
   conversation capability on an authorized test account. Do not substitute
   an advertising-account credential from the connected Ads MCP.
3. Read provider message pages under a bounded cursor/time scope and compare
   with `inbound_events.provider_message_id` for the exact same account,
   channel and conversation partition.
4. Offer a **read-only preview** to an authorized operator with counts only.
5. Separately design and review any missing-message import with idempotency,
   privacy boundaries, exact conversation ownership, sequencing, and
   **NO automatic AI reply or customer send**. Historical dead letters
   must not be replayed as part of reconciliation.
6. Run account-backed canaries, GitHub CI, deployment provenance and rollback
   checks before enabling a runtime route.

## Verification

Node.js 24.22.1 full `npm run check` passed:
40 test files, 295 tests, ESLint, TypeScript typecheck and build.
`npm audit --omit=dev --audit-level=low`: 0 vulnerabilities.
Eight dedicated reconciliation tests cover partial history, account isolation,
duplicate detection, wrong conversations, message-text non-disclosure,
determinism, invalid timestamps, and bounded input.

TikTok official Business Messaging onboarding:
https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3
