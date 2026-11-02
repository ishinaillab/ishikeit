# ADR: account-independent connections and multi-workspace Ishikeit

**Status:** Accepted product requirement; engineering architecture proposal, **not yet implemented**.  
**Date:** 2026-11-02 · **Owner tracking:** [#230](https://github.com/ishinaillab/ishikeit/issues/230) · **Related:** [#206](https://github.com/ishinaillab/ishikeit/issues/206), [#203](https://github.com/ishinaillab/ishikeit/issues/203), [#207](https://github.com/ishinaillab/ishikeit/issues/207), [#216](https://github.com/ishinaillab/ishikeit/issues/216), [#169](https://github.com/ishinaillab/ishikeit/issues/169).

## Decision

Ishikeit must not be hardcoded to Ishi Nail Lab, `@ishinaillab`, a particular Telegram user, Instagram Professional account, Facebook Page, WhatsApp Business number, TikTok business account, subscription tier or account ID. The current Ishi Nail Lab studio is an **initial workspace**, not a special case in routing, data structures, entitlement determination, provider adapters or UI.

Separate **Ishikeit application configuration** (provider OAuth application ID/secret, API version and approved app privileges) from **customer workspaces**, their **connected provider accounts**, **connection/grant records**, **roles**, **per-account validated capability evidence**, and **recipient-specific conversation permissions and policy windows**. Never use a provider username as an immutable identity or routing/authorization key. Multiple provider accounts and multiple workspaces must be supported. An app's approval to offer a feature publicly is not a connected customer's permission to use it.

Public self-service must remain disabled until appropriate provider approvals, platform policy checks and tenant-isolation testing have been verified. Existing real messaging must continue while staged migration occurs.

## Source-bounded current-state findings (2026-11-02)

- `src/config/env.ts` currently has `TELEGRAM_BUSINESS_USERNAME.default("ishinaillab")`. **Hostinger production's masked environment variable names did not include `TELEGRAM_BUSINESS_USERNAME`**, so this default is part of the **live** Telegram Business owner lock. It must **not** be removed on its own; migrate to an explicit verified connection binding first.
- `src/auth/telegram-business.ts` compares authenticated `getBusinessConnection` account owner with a configured username, or optional immutable owner ID. Its live send-time rights and reply-window validation are security controls to preserve. Telegram's `BusinessConnection.user.id` and `BusinessConnection.id` are separate identifiers; usernames are mutable display attributes. Bot tokens must never be used as Telegram *user-account* credentials.
- `src/config/env.ts` configures single-instance legacy Messenger, Instagram and WhatsApp access tokens, TikTok Business ID and WordPress AI bridge. The Instagram OAuth encrypted credential store is per provider/account but not per workspace; it also supports an identity-checked legacy managed token for the initial account.
- Live PostgreSQL column inventory verified `inbound_events`, `outbox`, `oauth_credentials`, `oauth_authorization_states`, `oauth_revocations`, `oauth_account_aliases` and `provider_account_capability_facts` **do not currently include `workspace_id`**. The hashed conversation partition key does not substitute for tenant authorization. The `/ops` bearer token is operational authentication, not general authenticated customer membership.
- Existing `provider_account_capability_facts` table records fresh source-attributed proof but cannot establish owning workspace or provide general public self-service. #206 remains independently open for real provider entitlement discovery/refresh. Live tenant backfill requires independently verified ownership and tests; do not invent mappings.

## Domain architecture

The following are **proposed contracts**, not currently present database tables:

| Domain object | Purpose and uniqueness |
| --- | --- |
| `workspace` | Opaque immutable `workspace_id` UUID; own timezone, optional brand details and policy configuration. No provider handle in schema defaults. |
| `principal` / `workspace_membership` | Authenticated user subject and workspace-specific role. Owner/admin can manage eligible channels; agent/viewer cannot connect or disconnect without explicit permission. A session may switch among memberships only after server authorization. |
| `provider_application` | Integration registration and app-level permission/review/market availability; never infer from workspace, paid plan or a token's presence. Provider-specific and versioned. |
| `provider_account` | Canonical identity `(provider, immutable_provider_account_id)` with provider account kind when verified. Handle, name, image and displayed phone are mutable and untrusted as keys. |
| `workspace_account_link` | Which workspace currently manages which provider account, account-claim ownership, grant owner, transfer state and effective linking status. Default: only one active automation owner for a given provider account to avoid duplicate messages; provider-sharing cases need an explicit reviewed routing model. |
| `provider_connection` | Provider-native connection identity (Telegram Business connection ID, OAuth grant, Meta Page/IG/WhatsApp linkage, TikTok business grant) linked to verified account, workspace, integration and credential reference; revocation, generation, timestamps and lifecycle status. A provider account may have multiple connection facets without becoming multiple customers. |
| `connection_capability_evidence` | Per-account official scope/rights/app access proof and provider policy references. Preserve current `provider_account_capability_facts` until schema/retention migration is tested; no auto-unlock of undocumented provider features. |
| `connection_audit_event` | Redacted, actor-attributed connect/reconnect/permissions/disconnect/error history; no secrets or raw customer message bodies. |

### Connection state machine

`unconnected -> connecting -> verifying -> connected`, or `attention_required` / `failed` if identity, app approval, scope or provider account rights do not validate. `connected -> paused` (reversible) or `disconnecting -> disconnected`; provider-origin revoked/disabled state enters `revoked`, with all sending immediately denied. Reconnect is a new authorization and **never resumes previously cancelled outbound actions**. Use explicit state transitions and a monotonically increasing connection generation/lease fencing; prohibit `disconnected -> connected` without fresh verified authorization. Avoid a single ambiguous `connected: true` boolean.

**Username is not proof.** Bind provider account ownership only after an authenticated user initiates a workspace-bound onboarding process and a separately verified official provider response identifies the immutable account. A signed webhook identifies the provider event source, not necessarily which Ishikeit workspace requested to link it; unclaimed signed events must remain quarantined.

## Connect flow

1. Authenticated owner/admin selects active workspace and provider. Server checks membership, app-level product availability/review status and the exact provider-specific onboarding contract. Show accurate prerequisites; never advertise restricted provider APIs as available.
2. Server creates single-use short-lived workspace-bound connect intent (`intent_id`), random anti-CSRF nonce/state, expected provider and app integration, expiry and audited initiating principal. OAuth authorization-code flows use exact registered callback and PKCE S256 **where the provider supports it**, with issuer/mix-up checks when needed. Do not forge scopes; do not publish access tokens in client storage or logs.
3. Owner grants access using the provider's **official** user consent mechanism. Telegram Business bot linking occurs within Telegram user settings; signed `business_connection` webhook must be followed by authenticated `getBusinessConnection` readback, then an explicit owner/workspace-link proof. Never use Telegram user-only `account.updateConnectedBot` from the server with a bot token.
4. Validate returned provider app, immutable account identity, authorized scopes/rights and usable connection state. Verify this account is not owned by another workspace. Resolve conflicts with secure user-mediated release/transfer instead of silently reassigning provider account data.
5. Commit ownership, account-specific encrypted credential reference and activation in one transaction. Dedup provider events before and after activation; do not retroactively process pre-connection unknown customer messages. Any provider-scoped feature remains unavailable until its own official permission and adapter are verified.
6. Display connection summary with exact capabilities, approved / needs consent / unsupported / unverified reasons, grant expiry and safe refresh/reconnect instructions.

Provider adapters have different grant models. Instagram Creator/Business access is not the same as Personal account eligibility, and paid Meta subscriptions are not messaging API grants. Telegram `getBusinessConnection` rights are authoritative for that connection; Telegram's account-only settings cannot be controlled by a bot. WhatsApp number/WABA business linking and templates require separate review and per-recipient consent; TikTok Business API approval does not imply TikTok Messaging API approval.

## Routing, authorization, isolation

- **Ingress:** Verify signature/secret using the correct approved provider app FIRST; parse bounded payload; resolve `provider + application + immutable account/connection ID` to **one active workspace-owned connection**; quarantine unknown, cross-workspace or revoked accounts without AI processing. Do not auto-create a workspace based on an incoming webhook.
- **Durability:** Include authenticated `workspace_id` and `connection_id` in every inbound event, conversation, outbox action, media operation and AI/booking context; tenant-aware unique/dedup keys and indexed lookup. Never reuse a global conversation partition across tenants. Where a provider account can change connection generation, fence old queued actions.
- **Outbound:** Immediately before any send, resolve authenticated workspace and current connection generation, capability, token, app privilege, provider-specific customer window, per-recipient consent/opt-out, human-handoff status and limits. Missing/ambiguous proof fails closed. For an already in-flight provider POST, preserve honest ambiguous-outcome quarantine; do not claim it was cancelled or blindly retry.
- **Authorization:** Server-side workspace membership for every dashboard/API operation; validate object ownership on every read and write, not merely `workspace_id` supplied by the browser. Enforce PostgreSQL RLS/private grants, tenant ID indexes and negative cross-tenant integration tests. Never expose service-role credentials or provider tokens to the UI. Use separately scoped operational credentials and explicit audit for staff actions.
- **AI/WordPress:** The current Ishi Nail Lab AI Engine + LatePoint plugin are **per-workspace integration choices**, not defaults for every account. Before general availability, a workspace-owned brain/knowledge-base and booking provider must be selected or automation stays disabled. Do not allow one tenant to query another tenant's bookings or messages.

## Disconnect and recovery

1. Authorized owner/admin starts the action from a precise workspace/account card. UI explains consequences and provider-owned steps; confirm target and high-risk impacts. Option to **Pause automation** remains distinct from **Disconnect** and **Delete historical data**.
2. Atomically mark the connection non-sendable and increment generation **before** any remote API cleanup. Prevent new webhook-to-AI actions and outbound dispatch; dead-letter/cancel undelivered work safely, preserving audit and unambiguous historical receipt status.
3. Invalidate/remove this exact account's encrypted grant; issue provider token revocation/unsubscribe only when the official API and granted rights explicitly allow it, and only when no other connection relies on that resource. Record provider response or transparent manual cleanup required. Never remove a shared app subscription by guessing.
4. Reconcile scoped history retention, provider data-deletion requests, hashes/consent records, cached entitlement evidence and media; delete on applicable verified legal/provider policy while not erasing required financial/audit records without review. Do not erase other workspaces' content.
5. UI shows `Disconnected`, `Cleanup pending` or `Provider action required` truthfully and gives a one-click reauthorization journey; reconnect yields new connection generation and fresh scopes, not revived old jobs.

## Public readiness gates

Keep Ishikeit **private/owner-allowlisted** while building. Separate per-provider app authorization status (`not_requested`, `in_review`, `approved_with_scopes`, `restricted`, `revoked`) from per-customer grants; operator verification is required before exposing connection options to new tenants. No inference from mere app Live mode, account badge or subscription. Honor Meta App Review #169 owner hold and TikTok Messaging approval status. Add abuse protection, usage accounting/rate limits, per-tenant cryptographic/privacy boundaries, incident response, deletion and data portability before public onboarding.

## Phase 3 professional UI/UX contract (apps.ishinaillab.com)

Navigation: **Workspace switcher** (top bar) → **Channels** → **Connected Accounts**, plus **Conversations**, **Automations**, **Customers**, **Settings → Members & Access / Security & Audit**. No hardcoded Ishi identity or brand treatment globally; tenant branding is optional workspace data. Use a consistent, original Ishikeit design system.

- **Connected Accounts:** responsive provider cards with actual account display name, immutable identity in detail view, linked workspace, last verified time, authorized operations, unavailable/requires-reconnect explanations, and actions `Manage`, `Refresh` (only where supported), `Pause`, `Disconnect`. Group by channel; multiple accounts of one provider must be distinct and selectable. Unknown account eligibility is explicitly unknown, never shown as active.
- **Connect wizard:** provider directory → eligibility/prerequisite checklist → provider-managed authorization or Telegram-specific instructions → secure verification progress → exact permissions/capabilities confirmation → completion or actionable recovery. Never present fake green success before provider readback.
- **Disconnect flow:** clearly distinguish pause vs disconnect vs privacy deletion, provide confirmation naming the account/workspace, scope of affected automation and queued messages, and visible cleanup state. Allow safe reconnect and permission renewal without contacting support where official APIs permit.
- **Visual quality:** cohesive typography, spacing, responsive layouts, clear hierarchy, non-conflicting status colors, real empty states, skeletons, optimistic states only when safe, consistent account icons/avatars, and concise accessible copy. Target WCAG **2.2 AA** accessibility, full keyboard operation, labels/focus, status announcements, contrast and reduced-motion preference; test desktop/mobile and provider edge cases. Do not copy another vendor's proprietary UI or hardcode a studio's visual identity as the product theme.

## Rollout sequence — never disrupt production just to remove hardcoded config

1. Tests and model/schema proposal: explicit tenant ownership & provider connection state; additive migration, RLS and grants audit; owner/admin bootstrap from independently verified credentials (never auto-assign all historical events to the first registered user).
2. Staged account enrollment for the existing Ishi Nail Lab workspace; verify stable Telegram owner ID, Meta account identities, WhatsApp number/WABA and TikTok authorized business. Legacy environment secrets remain in place temporarily; never replace Hostinger's entire masked env set.
3. Add safe connection lookups and shadow reconciliation against live trusted accounts, without automatic outbound cutover. Backfill queued/inbound data with tested tenant ownership and full audit of unknown/foreign accounts. Investigate potential duplicates before backfill.
4. Canary controlled workspace-aware ingress and dispatch with account isolation, disconnection and revoked rights. Test worker races, retry/unknown outcomes, data deletion, provider 24-hour windows and global maintenance.
5. Only after verified owner-channel tests, remove the literal `ishinaillab` Telegram default and any assumption that a configured managed token belongs to only one studio. Do not remove live owner verification or provider policies. Do not add automatic unlocked-drive or production restart.
6. Phase 3 UI built on the real protected APIs; later beta/public provider-specific gating with explicit security and app-review sign-off.

**No new account is publicly connectable solely because this ADR or #230 exists.**

## Authoritative references

- OAuth Security BCP, IETF RFC 9700: https://www.rfc-editor.org/rfc/rfc9700
- Telegram Business Bots: https://core.telegram.org/bots/features and https://core.telegram.org/bots/api
- Telegram connected-bot user-account operations (NOT bot APIs): https://core.telegram.org/api/bots/connected-business-bots
- Meta official Instagram API with Instagram Login: https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
