# Phase 2 Meta automated-experience disclosure — Nov 2, 2026

## Authority and observed need

Official Meta Messenger Platform / IG Messaging API policy explicitly recommends telling users when an automated service replies at the beginning of a thread, after a significant lapse, or when human assistance returns to automation (mandatory where applicable law requires). As a best-practice disclosure, use "I'm Ishi Nail Lab's AI assistant." See https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy and https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages .

Production messages showed a response sometimes lacked clear identification when a customer initiated a Messenger/Instagram conversation; relying solely on an LLM prompt is weaker than application-layer enforcement. **Do not modify Meta business settings, global App Secret enforcement or permissions** to resolve a conversational disclosure bug.

## Change

- `src/persistence/meta-disclosure.ts`: a read-only `PostgresMetaDisclosureReader` checks the current normalized account+customer `partition_key` for a previous `processing_outcome='handled'` inbound in the preceding 24 hours, strictly before this inbound's received timestamp. The query is keyed by the existing `inbound_events_partition_idx` rather than scanning unindexed outbound payloads, and fetches only a boolean (no message contents/customer PII).
- `MessageReceivedHandler`: for Messenger and Instagram only, when there is no previous handled turn in that window, prepends `I'm Ishi Nail Lab's AI assistant.` to the first text reply **unless the AI already gave that explicit disclosure**. For a media-only reply, prepends an explicit text part; conversion happens before channel byte limits, durable outbox ordering and idempotency. Continued recent exchanges, WhatsApp and Telegram messages are unaffected. Handoff/stop requests still suppress all AI sends. A DB failure produces a retryable handler failure rather than silently sending without the disclosure.
- `src/processes/http.ts` uses `new PostgresMetaDisclosureReader(db)` through dependency injection, no schema migration or new network secrets.

## Verification

- Standalone unit regressions cover Messenger/IG first-contact/long-gap disclosure, active conversation non-duplication, pre-existing explicit AI identity not repeated, unaffected WhatsApp/Telegram, DB read failure and indexed query parameters.
- Full isolated Node24/PostgreSQL17 **591/591 tests across 82 suites**, ESLint, TypeScript typecheck and build passed before PR. Actual Supabase EXPLAIN confirms `Index Scan using inbound_events_partition_idx` with partition key and 24h bound, no global scan.
- CI, actual deployed SHA, queue/worker health and real customer-origin canary remain required. The 24-hour threshold is an implementation choice for "significant lapse" and is not claimed as a universal Meta legal threshold; future human handoff to AI requires explicit re-entry detection if the business uses that flow. This is a customer disclosure enhancement only; it is not a legal determination.
