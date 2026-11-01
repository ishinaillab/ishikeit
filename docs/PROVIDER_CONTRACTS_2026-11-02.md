# Ishikeit provider contracts — reviewed 2026-11-02

## Required architecture

Do not hardcode an account, a paid/free plan, a verified badge, or a provider policy interval as an entitlement. No third-party integration can automatically implement an API the provider has not officially exposed. Unknown or future provider features are **unverified**, not permanently forbidden. An approved provider capability does not become callable until Ishikeit has a separately registered, supported official adapter and fresh authorization evidence for the specific connected account. Any additional customer-level consent remains independently required.

## Data source and policy revisions

- `src/policy/provider-contracts.json` is the **reviewed, versioned policy and feature catalog**, not proof of the permissions actually granted to any account. Add, modify or retire provider features and rules there; do not edit scattered TypeScript constants or use a wildcard rule.
- Each entry has a provider, channel/operation or feature ID, source URL and revision/review date. The policy engine validates schema, duplicates and impossible ranges at startup; unknown operations fail closed.
- Change workflow: check the **current provider's official documentation and developer policies**, record source and reviewed date, change the catalog in a reviewed PR, add allow/deny/expiry/mutation tests, run Node24/Postgres17 checks, then deploy and verify. A changed service-window restriction does not automatically unlock a new messaging tag, template, marketing use case or 7-day exception; those require their own approved integration and eligibility model.
- Never use public-client payloads or raw unverified webhook text as a policy source. Policy changes require authorized repository release controls. Never claim an automated policy scrape is authoritative without provider verification.

## Actual account capability evidence

`evaluateAccountFeature` consumes *server-verified, expiring* facts with source, source reference, observed timestamp, expiry and grant/denial state. `accountCapabilities` now projects available features from the catalog, without fixed switch cases. To get **available** all of these must hold: a reviewed feature contract, a real installed integration, eligible verified account type, and *all* fresh server-validated provider/OAuth/connection proofs. Old grants, unverified plan labels, manual guesses and missing/expired proofs never make a feature available. A newer revocation defeats old grants. Future features can be added without rewriting a provider switch, but still need a legitimate official adapter and authorization.

**Important unfinished work**: these new generic functions are an evaluation/transport-policy foundation. Live providers do not yet feed a durable per-account evidence store or scheduled/on-change safe capability refresh into this registry. Do not present catalog results as production-discovered account capabilities until real provider readback, token revocation, app role permissions, webhook reconciliation, and verified expiry refresh are connected. Separate customer/recipient consent from account-level permissions. Phase 3 admin UI must read only verified backend projections. No new permissions or tokens are created by this change.

## Reviewed authoritative documentation (2026-11-02)

- Meta Developer Policies (Messenger/Instagram standard window, messaging exceptions and opt-in/out): https://developers.facebook.com/devpolicy/
- Meta official Instagram API collection: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- Meta WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api/
- Telegram BusinessBotRights and BusinessConnection: https://core.telegram.org/bots/api#businessbotrights and https://core.telegram.org/bots/features
- TikTok Business API developer docs: https://business-api.tiktok.com/portal/docs

### Release tests

`scripts/test-docker.ps1` runs the disposable Node24/Postgres17 check. Existing Meta and Telegram outbound unit tests preserve the actual supported 24-hour customer reply behavior. The new provider-contract tests verify versioned policy edits, missing policies fail closed, expiry/revocation, unknown features, account-type exclusions and no adapter => no entitlement.

Note: provider policy pages can change. These source links are **review references**, not a machine-readable live authorization API; changing source policy requires a reviewed catalog release.
