# Dormant verified tenant ingress allocation — November 13, 2026

## Intent and release boundary

This is a **pre-cutover server-only persistence primitive** for the existing #230 multi-workspace project. It does not add or modify HTTP/webhook routes, security tokens, account ownership, provider app reviews, customer subscriptions, worker behavior or production database schema. It builds on the already **applied, validated** tenant provenance columns and six constraints in Supabase migration `20261113143209_ishikeit_validate_event_tenant_provenance`, whose exact SQL was mirrored to [DB PR #23](https://github.com/ishinaillab/ishikeit-db/pull/23).

A private `PostgresTenantInboundStaging.ingestVerified(event,identity,rawBodyHash,binding)` is exposed **only to trusted server code**. Production has **no caller of this method**. Future integration must authenticate the webhook signature and the provider's app/account/connection bindings *before invoking it*. This primitive is not a substitute for provider-signed proof, current app review, OAuth grants, subscription permissions, customer consent, or outbound send authorization.

## Transaction and idempotency guarantees

The method:
1. Validates all canonical event, ingress identity, exact owner-independent provider app/account/connection identity, UUID workspace/connection, positive generation, and SHA-256 raw-body digest using strict Zod schemas. Rejects mismatched account/provider.
2. Deliberately **rejects LatePoint booking events, WhatsApp consent-bearing events and non-messaging capabilities**, because their existing legacy inbound path performs synchronous booking/opt-out/opt-in projections. Do not silently bypass these safety semantics in an inactive new implementation.
3. Uses a single PostgreSQL transaction to read `ishikeit_account_connections` and `ishikeit_workspaces`, with `FOR SHARE OF c,w`, requiring exact `connection_id`, `workspace_id`, `provider`, immutable provider account ID, application key, nullable provider connection identity, **current generation**, `connected` status and active workspace. Concurrent pause/disconnect/update locks cannot race the insertion. No frontend-supplied role, handle, alias, or environment default can prove the account belongs to the workspace.
4. Inserts the canonical inbound event with all three tenant provenance columns populated. The DB's validated composite same-workspace FK and shape checks supply independent defense in depth. Existing legacy rows and RLS/default-deny client grants are untouched.
5. Under the existing global `deduplication_key` unique constraint, `ON CONFLICT DO NOTHING` is **not enough by itself**. On a duplicate, the method examines the existing source's exact workspace, connection, generation, provider, account and SHA-256 original signed payload digest under `FOR SHARE`. A collision across tenants, generations, accounts or bodies is rejected and rolled back. A legitimate same-body retry with a new local receive timestamp is idempotent.
6. Inserts a matching `inbound.event.accepted` outbox event in the **same transaction** for newly-created inbound events only. Its exact workspace, connection and generation fields are populated. Since PR #289 deliberately makes all current legacy queue workers ignore any tenant-stamped records, this event **remains parked without processing, AI execution or provider sends**.

## Explicit limitations

- A caller passing `TenantIngressBinding` is expected to already have verified an actual signed provider webhook/app identity and its immutable resource identity. The method does **not** authenticate raw webhook requests or extract trusted IDs from untrusted content.
- This stage is **not** a new inbound routing path; there is no production invocation, runtime flag activation, Webhook/OAuth UI action, customer-origin canary or tenant-bound outbound dispatcher. No tenant-stamped job will be delivered by existing legacy workers.
- The first owner remains on the working legacy Telegram/Meta routing until per-account provider grants and cutover are explicitly proven. Do not remove `TELEGRAM_BUSINESS_USERNAME` fallback, reuse an existing managed OAuth token for a new tenant without owner consent, or migrate historic rows by username inference.
- Future tenant-aware processor must implement equivalent immediate WhatsApp consent and LatePoint booking projections, handoff policies, idempotent dispatch, authenticated provider identity provenance, per-message generation fencing, disconnection cancellation, encrypted per-account credentials and two-real-tenant acceptance. This method alone does none of them.

## Security and validation

A real disposable Node **24** and PostgreSQL **17** integration suite creates two independent active workspaces with exact application- and account-bound connections. Tests cover same-tenant atomic inbox/outbox creation, valid duplicate, malicious global cross-tenant/different-body/partition/channel collisions, concurrent same-body redelivery, transactional rollback when parked-outbox persistence fails, swapped app/account/workspace/connection/generation, revoked or suspended state, concurrent locking against pause, forbidden WhatsApp/LatePoint side effects, and malformed hash/context. No real credentials or customer data enter the test. Full lint/typecheck/serial PG17 suites and production TypeScript build must pass before the protected PR is merged.

No schema change/migration, no live Supabase mutation, no actual provider account linking. The original seven canonical local unpublished changes and all owner MFA devices are to be preserved.

## Official authority

- [PostgreSQL 17 application-level data consistency](https://www.postgresql.org/docs/17/applevel-consistency.html): shared row locks protect validity against concurrent updates within a transaction
- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): `FOR SHARE` conflicts with concurrent UPDATE/DELETE locks; row locks released after transaction
- [PostgreSQL 17 INSERT and ON CONFLICT](https://www.postgresql.org/docs/17/sql-insert.html): unique conflict handling requires application-level ownership checks
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): retain strict private table access and defense in depth
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default and require per-request authorization
