# TikTok automatic-message metadata snapshot comparisons

Status: source-only, **not deployed**, no TikTok provider API calls or changes.

This standalone pure function (`diffTikTokAutoMessageSnapshots`) compares two complete,
already-sanitized four-type responses from the read-only `TikTokAutoMessageReader.getAll()`
foundation of draft PR #76.

It can detect changes in:
- whether each type is enabled;
- how many provider message identifiers appeared or disappeared;
- how many unchanged identifiers changed moderation status.

It does **not** detect modifications to configured message text or prompt bodies, because
the reader intentionally does not return that sensitive content. It does **not** output
provider message IDs, usernames, user content or credentials; it reports only the business
account ID, affected types and integer counts. It rejects account mismatches, incomplete
types, invalid review states, duplicated identifiers, unexpected type membership and
abnormally large sets instead of inferring valid state.

**Security and activation:** The function is synchronous and side-effect-free. It has no
HTTP registration, polling task, provider token, database write, provider call, outbound
message, or auto-reconciliation. This branch does not claim TikTok Business Messaging
account authorization, test a provider request method, or enable Comment-to-Message.

After TikTok Business Messaging account authorization and a verified official
`/open_api/v1.3/business/message/auto_message/get/` method/response contract,
an authorized read-only status controller may use two snapshots to surface
moderation/enablement changes to an operator. Do not automate settings writes or
persist identities/contents without a reviewed access, retention and safety design.

Derived from `feature/tiktok-automatic-messages-read-20261024` (draft PR #76).
Node 24: check lint, typecheck, tests, build and dependency audit before proposing merge.
