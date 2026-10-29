# Meta Graph token ownership and appsecret_proof read-only preflight — 2026-10-29

## Why this is needed
Ishikeit already implements default-OFF Graph appsecret_proof in the Messenger/WhatsApp outbound Graph clients. Before enabling it, verify that each server-side Page/system-user token was issued to the same Meta app whose app secret is configured, and that an authorized signed read-only Graph call succeeds. Meta's global Require App Secret must stay disabled until every relevant client is compatible.

Official reference:
- https://developers.facebook.com/docs/graph-api/reference/v26.0/debug_token
- https://developers.facebook.com/docs/graph-api/guides/secure-requests/

## Operator preflight endpoint
GET /ops/meta/graph-proof-preflight is registered only when the existing OPS_METRICS_TOKEN is configured. The request requires the normal private operations Bearer token; never include it in URLs, tickets or conversation transcripts. Responses use private, no-store caching.

When invoked, the backend:
1. For each configured Messenger Page and WhatsApp Graph access token, calls the official HTTPS graph.facebook.com /debug_token endpoint to inspect originating app ID and validity. The inspector uses the Ishikeit app access token, which is never returned to the caller.
2. Only if the token is valid and its app matches META_APP_ID, builds a signed, redirect-blocked Graph read using HMAC-SHA256 appsecret_proof and the matching META_APP_SECRET. The **WhatsApp System User** uses GET /me?fields=id. The **Messenger Page token** instead takes the Page ID from the validated /debug_token.profile_id, verifies Page token type if returned, and uses GET /{page-id}/subscribed_apps?limit=100, requiring the app to appear in the returned subscription list. This avoids /me and direct Page fields that produced Graph 100 on the real Messenger token because Page read grants are not present.
3. Returns a per-channel status: not_configured, inspection_unavailable, invalid_token, wrong_app, proof_unavailable or proof_compatible. It does not reveal token material, foreign app IDs, returned account IDs, errors, Graph URLs or HMAC values. Both probes are bounded with a timeout.
4. Leaves META_GRAPH_PROOF_ENABLED and Meta Require App Secret unchanged. There is no provider send, webhook update, template action, token refresh or database write.

The required debug_token GET carries input_token in its query according to Meta's documented API. The code never logs that URL, follows no redirects, and uses only HTTPS graph.facebook.com; avoid forwarding complete HTTP request URLs into tracing/reverse-proxy instrumentation. No user or customer token is ever returned to the ops caller.

## Strict rollout gate
- A local simulated response or signed webhook does NOT prove actual provider token-app ownership. An authorized operator must call the preflight on the production backend using an already-held Ops token (do not expose secrets through tools or ChatGPT), and retain ONLY the sanitized statuses.
- Both configured Graph channels must report proof_compatible before enabling the default-OFF feature flag. Recheck Meta app secret mapping and granted permissions if either fails. Instagram Login tokens are deliberately excluded and use a distinct product credential.
- Never replace Hostinger's masked env values or enable the global Require App Secret. Changing Hostinger's entire env set using masked placeholders would destroy credentials and is prohibited.
- If one token is not configured, leave its corresponding signed Graph send path unused, and do not claim that channel is verified.
- Enabling the proof flag and checking a real provider-signed GET remain separate operational actions, not part of this code PR.

## Status
At initial coding checkpoint, ESLint and TypeScript passed; 450 Vitest tests in 64 files passed; production build succeeded. The Page-token compatibility correction above passed local lint, TypeScript, 455 Vitest tests in 64 files and production build. GitHub CI, deployment readback and a fresh authenticated live preflight must be checked separately. App Review is not submitted; this probe does not request privileges or change app review state.

2026-10-29 authorized live diagnostic evidence: WhatsApp returned proof_compatible. Messenger returned proof_unavailable from the former signed /me endpoint; separate Page GET /me and GET /{page-id} returned Graph 100, while the existing token's unsigned GET /{page-id}/subscribed_apps?limit=100 returned HTTP 200 and included Ishikeit. Meta Access Token Debugger confirmed the valid Page token's issuing app ID, Page ID, and pages_manage_metadata/pages_show_list/pages_messaging permissions. No secret material was retained or pasted. Until the corrected endpoint reports live proof_compatible, Messenger signed proof is **not yet verified**.
