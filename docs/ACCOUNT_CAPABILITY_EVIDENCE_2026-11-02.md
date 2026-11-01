# Ishikeit per-account capability evidence — 2026-11-02

## Scope of this release

An additive, private PostgreSQL table stores the latest **provider/account/evidence-key** fact with the verified source, a non-secret source reference, observation time, and validity deadline. It does NOT store access tokens, raw provider responses, customer messages or inferred subscriptions. Source records must originate from server-controlled provider validation. An unverified or expired result must not make a feature available.

Provider capability names and account requirements are defined in the reviewed versioned catalog (`src/policy/provider-contracts.json`), not code switches. A supported feature additionally needs a verified account kind where applicable, all actual fresh grants, and an installed official adapter. Unknown features remain unverified, even if the provider may release them later. Reviewed provider policy windows still control dispatch separately; storing a grant is not an exception to a reply window, consent or opt-out.

## What feeds evidence now

- **Telegram Business:** every real `getBusinessConnection` successful owner/rights readback for the configured account records `telegram.business_connection` and `telegram.rights.can_reply` against the returned immutable owner ID. An unrelated connection, expired reply window or revoked right never authorizes a reply. A best-effort evidence database outage does not override an already executed fresh provider check.
- **Instagram:** successful OAuth token account identity plus webhook subscription reconciliation records `instagram.oauth` and `instagram.app_access` against the verified Professional ID. Stored requested/granted login scopes are **not** treated as current permissions without an independently supported live scope read. The production account is not silently assumed Business vs Creator, nor Meta One/Premium from branding.
- **Privacy:** Instagram deauthorization and account deletion remove scoped capability evidence, including verified aliases. Deletion runs in the existing transactional cleanup. No production data deletion is needed to release.

## Staleness and safety

- Facts expire after five minutes from authenticated readback. This is an internal evidence freshness limit, **not a provider policy**. Expired proof remains recorded as an unverified snapshot; no earlier grant is resurrected. Newer denial beats stale grant, and denial wins exact timestamp ties.
- Multi-fact snapshot writes are atomic, account-scoped, parameterized, and validated. Rows use RLS enabled and explicit revoked client-role grants (no Data API access).
- This release is **observation-only** for newly collected proofs, leaving existing provider send-time and token validation authoritative. Do not deploy a new universal entitlement-based outbound gate until per-account coverage and provider live-scope introspection are confirmed; otherwise legitimately available free features would become unavailable.

## Deployment order and verification

1. Run `migrations/0009_provider_account_capability_facts.sql` on **ishikeit-db** via the authorized Supabase migration mechanism first, and verify the resulting RLS/private table exists. This migration is additive.
2. Run Node24/PostgreSQL17 CI, tests and build. Do not deploy until these pass.
3. Merge application PR and confirm Hostinger serves the new commit with both health endpoints ready.
4. Query the table in read-only mode for actual verified provider observations. No fabricated or simulated production grants.

## Still open

- Live and scheduled read-only scope/entitlement introspection for other providers where official APIs genuinely expose them, dynamic permission change and revocation refresh, and per-feature outbound dispatch gating after baseline coverage.
- Account kinds must come from verified provider reads, not labels. Per-recipient consent and provider-native messaging windows need separate enforcement.
- Phase 3 admin **Channels → Connected Accounts** interface at `apps.ishinaillab.com`; final real tester-origin canaries/booking checkout acceptance and Meta App Review owner actions are separate.
