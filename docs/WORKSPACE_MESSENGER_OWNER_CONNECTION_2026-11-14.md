# Priority 3 — Messenger Page account-holder native connection (OFF by default, 2026-11-14)

## Boundary and current status

This is an isolated, first-party, owner/admin-only **Facebook Login for Business → Messenger Page** identity/permission linker. It is a **partial Priority 3** implementation, not general tenant messaging or existing studio Page migration. The default is `BROWSER_MESSENGER_CONNECT_ENABLED=false`; no live Page subscription, webhook, authorization, customer send, legacy credential, Meta app settings or traffic is touched.

Meta's current Messenger Platform overview (September 28, 2026) specifies Facebook Login for Business, User-issued Page rights and Page access tokens. The code requests an owner-configured approved Login for Business **User access token** configuration via `META_FACEBOOK_LOGIN_CONFIG_ID`, not an invented Instagram Login token, and refuses an arbitrary business-system-user grant. The exact callback must be registered in Meta **before** the owner can turn on the flag: `https://apps.ishinaillab.com/app/auth/connect/messenger/callback`. Never set it automatically. Existing Meta App Review owner **hold #169** remains in effect.

## Trust model

1. The current BFF Secure/HttpOnly/Strict cookie, fresh Supabase Auth `aal2` and an enrolled authenticator, exact active workspace owner/admin, same-origin POST Origin/Host/Fetch-Site and CSRF checks must hold. Server-selected Meta app ID/config/redirect only. One-use 10-minute random state+separate 32-byte Lax/HttpOnly/Secure browser nonce are bound to exact auth session, workspace, provider and app; no user role/account/token identity is accepted from browser.
2. Browser is directed to fixed `https://www.facebook.com/{version}/dialog/oauth`, `response_type=code`, exact `redirect_uri`, `client_id`, owner-approved `config_id` and opaque `state`. Meta callback is read-only GET with strict CSP, no-store/no-referrer, never exchanges tokens; a first-party script removes callback credentials from history before the user selects a numeric Page ID and posts with BFF CSRF. Numeric Page ID is only a **candidate**, not proof.
3. Server verifies the one-use intent, fresh owner AAL2 and CSRF, exchanges the Meta code for a **User** token via fixed Graph code endpoint with client secret, validates `debug_token` issuing `app_id`, `is_valid`, User token type, grant expiry and all required scopes (`pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`, `business_management`).
4. The server reads actual authorized Pages with `GET /me/accounts` under bounded, server-generated cursor pagination, never follows a provider next URL, and requires the candidate Page ID to be present with an actual Page token and appropriate Page messaging/moderation tasks. Separately validates the **Page token** `debug_token` issuing app/type/profile ID and direct `GET /me?fields=id` exact Page ID, with server-only `appsecret_proof`. No Page token enters a browser response.
5. `linkVerified` atomically ties the unique Page-account claim and original owner/session/intent to a per-connection AES-GCM credential in isolated `workspace-messenger/<UUID>` namespace and audit in one PostgreSQL transaction, status `verifying`. Global generic workspace-token APIs cannot enumerate or upsert these credentials. A separate AAL2 owner `messenger-activate` POST performs fresh Page readback, registry role/subject/app/generation check and marks `connected`. Neither status constitutes permission to send, subscribe a Page to webhooks or route any existing tenant event; Priority 4 separately governs dispatch.
6. Meta Page user grant lifetime and app permission can be revoked independently. Current code bounds activation by original User token/data expiry and fresh Page token proof. It does **not** claim production app privileges, unlimited token durability or Messenger subscription without a genuine owner/provider readback.

## Verified official provider guidance

- [Messenger Platform overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview)
- [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/)
- [Pages API: Manage a Page](https://developers.facebook.com/documentation/pages-api/manage-pages)
- [Access Tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens)
- [Graph debug_token v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/debug_token/)
- [Messenger Webhooks](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks)
- [OAuth 2.0 Security Best Current Practice RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)

**Provider PKCE caveat:** RFC 9700 recommends PKCE S256 for confidential clients. The inspected Meta Facebook Login for Business code-exchange contract did not establish accepted code_challenge/code_verifier parameters. This implementation does not fabricate PKCE compatibility; the confidential server-only app-secret exchange uses exact redirect, random one-use state, independent browser-bound nonce and original session/owner enforcement. Record this limitation until verified with the provider.

## Tests and release gates

Run lint, TypeScript, isolated full Node24/PostgreSQL17 unit+HTTP+integration, production build, Git tree equality, protected PR CI, postmerge main CI, exact Hostinger deployed SHA and negative public auth checks. **No real owner production OAuth consent or live tenant routing is performed by synthetic tests.** Before activation confirm the Meta app's specific Facebook Login for Business config ID and product callback, actual Standard vs Advanced eligibility, provider reviewer owner hold, Page user tasks and permissions, unexpired Page token, one-time state, revoked cross-tenant owner cases, and explicit owner approval.

Preserve the canonical Windows checkout's seven unpublished files and three genuine owner TOTP factors; preserve production legacy Messenger/Instagram/WhatsApp/Telegram/TikTok workflows, five scheduled tasks, all customer messages and WordPress premium holds. Scope: independent worktree `D:\projects\openai\ishikeit\ishikeit-messenger-owner-native-20261114` started from protected `fdec3d488fb69f7bae3457a1d6cf152676656cff`. Issue #230 reopened; **Refs #230** not a closing-keyword reference. Do not merge or deploy under an unverified concurrent-owner fence.

## Measured independent acceptance (disposable local only)

- Node 24 (bookworm-slim) + PostgreSQL 17 Compose lab `ishikeit-messenger-native-20261114`: `npm ci`, ESLint, strict TypeScript `tsc --noEmit`, **909/909 Vitest cases across 110/110 test files**, and production build `tsc -p tsconfig.build.json` all passed; test container exited **0** on 2026-11-14.
- The new real PG17 regression asserts Messenger Page credential ciphertext, one-account/one-workspace claim, foreign-workspace denial, transactionally coupled account linkage and credential, and denial of unrestricted generic workspace-token retrieval/upsert. The new provider/HTTP tests cover fixed Facebook Login for Business authorization, exact Page token/app/user validation, revoked/foreign grants, missing permissions, CSRF, owner session/nonce, and disabled routes.
- Named Compose containers, PostgreSQL test-only volume and network were removed and verified absent. An initial test attempt failed from an external npm registry `ECONNRESET` during dependency installation, not a code test; a subsequent full successful run was observed. Do not misrepresent any local synthetic test as owner provider consent or production deployment.
