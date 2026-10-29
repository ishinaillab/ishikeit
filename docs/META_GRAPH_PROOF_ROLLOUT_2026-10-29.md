# Meta Graph appsecret_proof integration — 2026-10-29

## What changed

Implemented Meta's server-side Graph API `appsecret_proof` as an **opt-in**, using `HMAC-SHA256(access_token, META_APP_SECRET)`. The reusable module lives at `src/channels/meta-graph-proof.ts` (no secret or token is stored in source control). The original attempt to create a module with a sensitive-path filename was blocked by local file safety guards. The replacement is a normal code helper in the channel layer, not a credential file.

Official reference: [Meta Graph API — Secure Requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests).

Wired callers when `META_GRAPH_PROOF_ENABLED=true`:
- Messenger Page standard outbound Graph message POST.
- WhatsApp standard outbound Graph message POST.
- WhatsApp approved-template Graph message POST (still independently subject to template/consent gates).
- WhatsApp Graph media **metadata GET**; CDN download URL receives **no** proof.
- Verified Messenger Page `subscribed_apps` Graph GET/POST/readback.

The helper accepts only `https://graph.facebook.com` on the default HTTPS port, without URL credentials, and preserves existing query parameters. All signed calls retain `redirect: "error"` (media metadata uses the existing `redirect: "manual"` and does not auto-follow). Proof is computed only at request time from the matching token and app secret, and is never included in application logs or persisted. Existing Bearer authentication is unchanged.

**Instagram Login is intentionally excluded**, including when its configured Graph host is `graph.facebook.com`, because it uses a distinct product App ID and secret. The Instagram OAuth and webhook subscription flows remain untouched.

## Production gate

The flag defaults to **false** and production keeps existing behavior until explicitly enabled. `loadEnvironment` rejects `META_GRAPH_PROOF_ENABLED=true` without `META_APP_SECRET`. Enabling it does not enable outbound dispatch, change messaging windows, approve WhatsApp templates, or infer customer opt-in.

Before enabling in Hostinger:
1. Verify the Messenger Page token and WhatsApp system-user token were issued for the Meta app matching `META_APP_SECRET`. Confirm with Meta's own app/token debugging and business authorization readbacks. A token from a different Meta app will not validate against this proof.
2. Check all other clients and providers using the same Meta app, including WordPress and third-party integrations. **Do not toggle Meta's app-wide Require App Secret setting yet**.
3. Stage a read-only Graph test with each authorized token using proof. Record only HTTP status and provider numeric error codes, never URLs containing proof, token values or response bodies.
4. Enable `META_GRAPH_PROOF_ENABLED=true` only after ownership and readback pass. Observe Messenger Page subscription reconciliation, WhatsApp media metadata and outbound error rates with approved authorized tester traffic.
5. Roll back by setting `META_GRAPH_PROOF_ENABLED=false` if verified requests fail, and redeploy/restart through the standard controlled release process.

## Verification

- Unit tests: exact HMAC, host/protocol/port guard, query preservation, default-off env validation, Messenger/WhatsApp/approved-template send, Instagram exclusion, WhatsApp Graph metadata vs CDN download, and Page subscription GET/POST.
- `npm run check` must pass locally and CI Node/PHP/context checks must be green before merge.
- Deploy readback must match the merged SHA; verify `/health/live`, `/health/ready`, `/health/build`, zero new dead letters and no unexpected Meta provider errors.
- No live Meta setting or token changes, WhatsApp reminder sends, database migrations or WordPress edits are part of this patch.

## Related follow-up

- GitHub issue #158 remains open for **real token ownership verification and gated production activation**.
- GitHub issue #159 remains open for **ambiguous outbound POST retry safety**. This HMAC integration does not fix possible duplicate sends.
- The two Deep Research reports have not yet been provided; reconcile additional recommendations against those original reports before claiming full standards completion.
