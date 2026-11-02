# Phase 2 · Multi-workspace foundation — migration 0010

**Status:** Server-private infrastructure only. It is NOT public self-service, NOT a
complete multi-tenant event pipeline and NOT permission to connect an arbitrary
account. Tracking [#230](https://github.com/ishinaillab/ishikeit/issues/230).

## Implementation

- `migrations/0010_ishikeit_workspace_connections.sql` creates five additive
  prefixed tables: workspaces, memberships, verified provider account identities,
  workspace/account connections and redacted connection audit history.
- `src/persistence/workspace-connections.ts` implements server-only validated
  transactions: create workspace+initial owner, owner-provision member,
  link a fresh officially verified provider account as **verifying**, activate
  after a second matching fresh identity proof, pause, request disconnect with
  generation fencing and read-only account resolution. Owner/admin-only mutation,
  read access for members, no user-supplied identity accepted as authenticated
  without a separately implemented verified identity boundary.
- A partial unique index enforces only one non-disconnected automation owner
  per `(provider, immutable_account_id)` and one active native connection per
  `(provider, provider_connection_id)`. Different providers may reuse IDs;
  a workspace can manage multiple accounts of one provider. No account handle,
  username, subscriptions or plan are hardcoded.
- `verifying` never resolves as an active provider account. `paused` and
  `disconnecting` immediately disappear from **new** registry lookups and
  increment a generation. The claim stays held through `disconnecting` until
  provider-specific cleanup is verified. **This does not yet fence existing
  production dispatchers:** routing/queue integration is a later, separately
  gated milestone.
- The new tables have RLS enabled with no browser roles granted and no policies;
  server-side authorization checks use exact workspace membership and active
  workspace state within database transactions. Raw provider tokens remain in
  existing encrypted credential systems, not the workspace registry.
- No pre-existing `inbound_events`, `outbox`, OAuth grants, capability facts,
  Facebook Pages, Instagram accounts, Telegram owner, WhatsApp number, TikTok
  app settings or WordPress integration is altered or backfilled.

## Production-safe sequence

1. Run Node 24 lint/typecheck/unit/build and disposable PostgreSQL 17
   integration tests, including two-workspace isolation, member role denial,
   cross-tenant provider claim concurrency, generation fencing and RLS/grants.
2. Apply migration 0010 with a tracked Supabase migration **after** successful
   CI and before enabling any future registry usage. Verify five empty tables,
   RLS, client role grants, indexes, uniqueness and no app readiness regression.
   Do not insert real workspace/account ownership without authentic provider
   proof. Do not add client Data API grants yet.
3. Implement verified Ishikeit user authentication/authorization with safe
   session management; provider-specific workspace-bound OAuth or Telegram
   connect-intent handling; legitimate operator bootstrap; provider-app
   permission gating and actual provider token lifecycle.
4. Map and verify existing studio external IDs before backfill. Add nullable
   tenant IDs to event/outbox/consent/automation/AI data via controlled, indexed
   migrations and **prove every legacy record's ownership** or quarantine.
   Do not guess an owner from `@ishinaillab` or any configured token.
5. Implement authenticated signed provider ingress lookup and tenant-aware
   action dispatch with connection-generation fencing and provider send-time
   rights/policy checks. Test 2+ workspaces and no tenant leaks; only then cut
   over one provider at a time and retire legacy defaults.
6. Implement provider-specific disconnect completion only after remote
   credentials, subscriptions and queued actions are safely reconciled. Never
   call `requestDisconnect` alone a successful full disconnect.
7. Keep #206 dynamic permissions refresh and #169 provider review restrictions.
   The Phase 3 Connected Accounts UI should call the real protected APIs,
   never bypass the above gates.

## Authoritative security sources

- PostgreSQL 17 RLS and its default-deny / owner-bypass semantics:
  https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- Supabase Row Level Security:
  https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase API grants:
  https://supabase.com/docs/guides/api/securing-your-api
- OAuth security BCP (RFC 9700):
  https://www.rfc-editor.org/rfc/rfc9700
- Provider-specific authentication, scopes, bot rights and disconnect APIs are
  NOT added by this migration; inspect the providers' latest official docs at
  the time their integrations are implemented. Provider identity evidence here
  may come only from the proper trusted adapter, not a client-provided claim.
