# Ishikeit Phase 2 provider hardening — 2026-11-01

## Source of truth and boundaries

This document describes the production-candidate changes to the previously deployed `cac9301be7b95361b351f75e3386977ab41725f4` commit. Follow GitHub PR, CI, Hostinger exact-SHA deployment, PostgreSQL evidence and legitimate provider-origin messages; **do not claim production success from isolated tests alone**. Preserve the seven dirty unpublished files in the canonical Windows checkout. The fixes are in a separate D: worktree.

Authoritative references:
- Telegram [Bot API](https://core.telegram.org/bots/api) and [May 7 2026 universal Chat Automation update](https://telegram.org/blog/ai-bot-revolution-11-new-features).
- Meta [WhatsApp Webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview): body up to 3 MB; retry up to 7 days.
- Meta [Instagram webhook examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples): both entry.field/value and entry.changes shapes.
- Meta [Messenger and IG messaging policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy): standard 24-hour window, automation disclosure, responsiveness/opt-out guidance.
- Meta [Instagram Platform overview](https://developers.facebook.com/documentation/instagram-platform/overview): owned/managed Standard Access vs unrelated accounts needing Advanced Access and App Review.
- Minimatch [upstream advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249): patched at 11.0.1, major from development-tool 10.x.

## Code changes with safety rationale

1. **Telegram no-duplicate reply fence:** `src/persistence/outbox.ts` adds a provider-specific `prepareTelegramSend` arm using the *existing* `meta_send_started_at` durable column, intentionally avoiding production schema changes. `src/workers/outbox-worker.ts` requires this arm before `message.send`, quarantines a timed-out or indeterminate POST, and keeps explicit unambiguous 429 backoff/retry. The expired-lease quarantiner now attributes its attempt to the real provider, not Meta. At-most-once attempted delivery is chosen over silent duplicate replies; indeterminate outcomes require manual reconciliation. Keep the older legacy column name for migration compatibility. PostgreSQL integration proves an arm survives worker death and prevents second claiming.
2. **Telegram bot-to-bot and self-loop isolation:** only verified private human-originated regular bot messages reach the AI. Other Telegram updates remain observable, but regular bot messages and self echoes do not trigger AI. Existing `business_message` safety and free Chat Automation continue unchanged.
3. **Telegram owner and transport:** optional `TELEGRAM_BUSINESS_OWNER_ID` pins immutable provider user ID when owner-verified; when unset, retain the existing verified `@ishinaillab` username check. Do *not* copy any guessed user ID or replace masked Hostinger secrets. Bounded JSON response parser (64KiB) and explicit redirect rejection prevent unbounded bodies and token leaks. Additional permissions beyond Read/Reply are not needed.
4. **WhatsApp large signed webhooks:** dedicated Meta route parser and request body limit allow up to 3MiB (bounded) while keeping the global Fastify default and Telegram/TikTok limits unchanged. Raw body signature verification remains mandatory *before* parsing; larger signed 1.5MiB WABA and oversized requests are covered by regression tests.
5. **Instagram notification capture:** both official shapes (entry.field/value and entry.changes) are ingested with stable content hashes as non-AI `engagement` events for comments, live comments, mentions, and other subscribed fields. **This is observation, not authorization for posting comments or sending DMs.** No proactive message is sent for these events. Unrelated unrecognized fields remain stored only as permitted and do not reach the AI.
6. **Messenger/Instagram customer opt-out:** exact commands `stop bot`, `stop automation`, `stop automated replies`, `turn off automated replies`, and `disable bot` create a durable conversation-scoped customer handoff using existing `meta_handoff_blocks` transactional persistence; no automated acknowledgement is queued because the durable handoff blocks all automated outbound messages (including previous pending replies); an authenticated human can follow up manually. No AI call. Authenticated operator can release a handoff. Explicit opt-outs do not globally disable unrelated legitimate service.
7. **Evidence-driven capability model:** `src/channels/account-capabilities.ts` separates Instagram Personal vs free professional Creator/Business type, optional observed paid subscription, OAuth grants, Standard/Advanced app privileges, Telegram bot vs account connection/rights, WhatsApp consent and TikTok Messaging API approval. No speculative paid entitlement discovery. This is a **pure backend groundwork**, not a claim that the Phase 3 feature-permission UI has been built or that every real account has been auto-discovered.

## Regression and deployment acceptance

- Isolated Docker tests use Node 24/PostgreSQL 17, `scripts/test-docker.ps1`, ESLint + TypeScript + Vitest + build. Record exact counts after the final test run.
- GitHub CI must pass all required jobs on the current PR head including context continuity. Merge only after validation, then inspect Hostinger deployed SHA and /health/live, /health/ready and runtime logs.
- Production user traffic already verified free Telegram Chat Automation in Issue #205, but any *new* patch must preserve it. Never send synthetic real-customer messages or use unapproved Meta/TikTok actions as a canary.

## Remaining external and environment-dependent gates (must not be presented as implemented)

- **Meta App Review** is under explicit owner hold; current Standard Access suffices only for managed/owned account use per Meta docs; do not request Advanced Access or modify global App Secret settings without owner authorization and full compatibility proof.
- **TikTok Business API approval is distinct from Messaging API approval.** Do not turn on TikTok messaging before it is separately granted.
- **Telegram immutable owner ID pin:** implementation is optional; *live activation* requires verified provider-owned ID and safe Hostinger credential handling (never perform a full env replacement using masked values).
- **Instagram premium plans:** no demonstrated, authorized external API to inspect subscription entitlements; the UI must show `unverified` rather than infer features from a badge or paid tier.
- **WhatsApp proactive reminders:** template `ishi_appointment_reminder_v1` is approved UTILITY, but zero active opt-ins at last inspection. No unsolicited reminder traffic.
- **Front-end and Phase 3 unified conversations:** not part of Phase 2, and account capability registry is not yet wired to UI.
- **Hostinger dependency advisory:** minimatch 10.2.6 is transitive via `eslint`, `@eslint/config-array`, `@typescript-eslint/typescript-estree` in devDependencies only; upstream currently patches at 11.0.1, incompatible with these pinned 10.x ranges. Do not `npm audit fix --force`. Recheck compatible toolchain releases and deployment's production dependency scope independently. Not evidence of runtime attacker-controlled glob access.
- **True responsiveness, AI disclosure and account-specific monitoring** require an operational, consent-aware rollout with observed production metrics and validated provider policies, not speculative SLA claims.
- **Live WABA 1.5–3MB transport** may additionally be restricted by Hostinger/LiteSpeed ingress. The in-process signed webhook regression test does not prove proxy ingress acceptance.
- **Provider authorization and ongoing health are dynamic**; test accounts, permission changes, token refresh and real ingress still need continuous monitoring.

Security holds: do not touch WordPress premium plugins, WordPress production keys, live Supabase DDL, Meta global settings, or protected Hostinger secrets as an incidental side effect of this patch.


## Security advisory correction — dev-only minimatch (2026-11-01)
The authoritative [upstream GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) identifies potential DoS under pattern amplification and fixes all versions below 11.0.1 in **11.0.1**. Because ESLint 10 and TypeScript-ESLint 8 still transitively depend on minimatch 10.x, an explicit exact-version npm **override** for minimatch 11.0.1 in the development tool dependency graph is deliberately compatibility-tested rather than blindly forcing `npm audit fix --force`. The production app does not call minimatch directly. The lockfile is updated and full Node24/PostgreSQL17 tests, lint, typecheck and build must pass after override. This is a transitive-major override that should be revisited when upstream dev tools support patched minimatch natively.
