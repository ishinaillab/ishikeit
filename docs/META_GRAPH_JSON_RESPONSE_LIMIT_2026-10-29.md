# Meta Graph Send API bounded acknowledgment parsing — 2026-10-29

## Source-verified resource bound

Previously `src/channels/meta-send.ts` used `await response.json()` for Graph send acknowledgments and error bodies, without a byte limit. The endpoint is normally a small JSON object, but the application should not trust a missing, inaccurate or unexpectedly large `Content-Length` enough to buffer arbitrarily large responses.

The hardening now limits the **whole Graph send HTTP response JSON to 64 KiB before parsing**. It rejects over-limit declared content length before reading; otherwise it consumes a `ReadableStream` in bounded chunks, cancels the stream as soon as cumulative bytes exceed the limit, and never includes raw upstream response text in error logs.

- A normal Meta response still decodes `message_id` (Messenger/Instagram, with existing optional Instagram `id`) or `messages[0].id` (WhatsApp).
- On HTTP 2xx with empty, malformed, oversized or incomplete JSON, the missing-ID guard from PRs #171/#172 classifies the provider outcome as ambiguous; the durable send fence and worker quarantine rather than publishing or retrying a possibly accepted customer message. The exact body is discarded.
- On non-2xx responses, existing structured Graph error code/subcode, Retry-After and HTTP status handling remains, when a valid bounded JSON error body is present; an oversized body is discarded with status and headers still available.
- Parsing is a general secure resource-control practice, **not a claim Meta mandates the specific 64 KiB limit**. The previous bounded `src/media/meta.ts` download controls are independent and remain unchanged.

Tests cover success-ID responses, 2xx responses with deliberately oversized Content-Length, streaming without Content-Length that surpasses the cap and triggers cancellation, and earlier ambiguous post/no-response/429/template cases. Local ESLint and TypeScript pass, complete Vitest run **454 tests / 64 suites** (one earlier broad run hit three transient test failures under local resource contention; rerun passed), and production `npm run build` passes.

This improvement does not authorize any Meta customer send or change app permissions. Keep Ishikeit **App Review submission HOLD #169** until actual product-specific signature and OAuth token origin checks, fresh provider canaries, per-product Standard/Advanced Access determination and explicit owner authorization are complete. No secrets or production messages were used for the tests.
