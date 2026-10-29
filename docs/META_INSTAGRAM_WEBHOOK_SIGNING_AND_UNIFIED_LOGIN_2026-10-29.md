# Meta Instagram product-scoped webhook signing and Unified Login assessment — 2026-10-29

## Verified application identities and actual runtime code

- Main Meta app: Ishikeit `META_APP_ID=1042452472116584`. Meta Developer MCP lists this app with admin access and lists `instagram`, `page` and `whatsapp_business_account` subscription topics on it.
- Instagram-specific product identity: `META_INSTAGRAM_OAUTH_APP_ID=2316046942582053`, confirmed by the owner from the Instagram API setup screen. This is a separately provisioned Instagram Login product credential pair within the Ishikeit Meta app; it is not accessible as an independent Meta developer app through the app-list MCP.
- Hostinger production environment contains BOTH `META_APP_SECRET` and `META_INSTAGRAM_OAUTH_APP_SECRET` (masked readback). Neither credential value was read, copied, rotated, overwritten or exposed.
- Before this correction, the single ingress `POST /ishikeit/webhooks/meta` used ONLY `META_APP_SECRET` for `X-Hub-Signature-256`. The Instagram product secret was used for OAuth, not webhook verification.
- The owner confirms the Instagram callback is `https://apps.ishinaillab.com/ishikeit/webhooks/meta`.

## Why and how the correction is bounded

Meta's official Instagram webhook documentation calls for HMAC-SHA256 validation over the **raw received body** with the signing application's secret, and signature comparison against `X-Hub-Signature-256`:
https://developers.facebook.com/documentation/instagram-platform/webhooks

Meta's public documentation available through the connected Meta documentation search does not unambiguously distinguish the separate Instagram Login product signing secret from the main app signing secret in a shared webhook. Public implementation reports differ. Accordingly, DO NOT claim that either signer identity has been confirmed from genuine inbound traffic without a signed provider delivery.

The production code:
1. Validates the original raw bytes against both *configured, owner-controlled* candidate keys; missing/malformed/wrong HMAC always fails closed.
2. Checks the authenticated JSON envelope's `object`. For `instagram`, either credential may authenticate, supporting verified legacy and Instagram product paths during migration. For `page`, `whatsapp_business_account` or other objects, the **main Meta App Secret remains mandatory**; secondary Instagram-only HMAC does not authorize cross-channel traffic.
3. Preserves existing webhook behavior for main-app-signed Instagram, Page and WhatsApp events.
4. Emits only `signer=meta_app | instagram_product | both` for authenticated Instagram events. Never log raw payload, token, HMAC, sender, recipient, personal data or other content.
5. No new/changed secrets, env flags, Meta dashboard settings, DB schema, outbound behavior, App Review or customer sends.

## Tests and operational proof needed

- Unit/injection cases verify separately signed Instagram events, legacy main-app Instagram events, reject Instagram-secret Page/WhatsApp/unknown events, reject missing/wrong HMAC with no persistence, and preserve existing signed main-app behavior.
- Local `npm run lint`, `npm run typecheck`, `npm test` (458/458 across 64 files) and `npm run build` passed at coding checkpoint.
- GitHub CI, exact Hostinger deployed SHA and health, plus a **genuine signed Instagram delivery** observed in non-sensitive runtime diagnostics are separate verification gates. A synthetic test or masked-env presence does not prove live signing identity.
- To avoid unsolicited customer interactions, do not trigger live messaging or a Meta webhook test without the tool-specific required confirmation. A future organic provider event can confirm which accepted credential signed it via the restricted runtime log.

## Unified Login recommendation and safe migration boundary

The owner saw Meta's live dashboard notice on `/apps/1042452472116584/instagram-business/Unified-Login-API-Setup/`: **Unified Login is the recommended setup for new Instagram API features; the current Instagram Login setup still works but is now legacy.** Treat this as current account-specific UI evidence. The older publicly discoverable migration guide (dated August 2024) is about Facebook Login → Instagram Login; it does **not** describe the current Unified Login migration. Public direct URL access and Meta MCP's app configuration API do not expose the current Unified Login page's individual settings or migration actions. Do not invent a procedure or push a blind cutover.

Before migration: capture a reliable official current Unified Login contract for this app; map old/new OAuth endpoints, scopes, token refresh semantics, IG account IDs, signed webhook identities, callback, account subscription and handoff; preserve both existing responding IG tester accounts; add backward-compatible OAuth/authorization tests and a gated rollout with readbacks. Migrate only after end-to-end safe verification, without resetting existing credentials. Meta App Review is explicitly held pending the owner's separate authorization, even if a dashboard allows submission.
