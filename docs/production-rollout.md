# Production rollout runbook

This runbook is the required launch sequence for Ishikeit's durable inbound processor and provider action dispatcher.

The goal is to prove the production runtime in controlled stages without replaying old conversations or allowing a canary test to fan out to unrelated customers.

## Safety model

Two independent execution gates exist:

```text
PROCESSOR_ENABLED
ACTION_DISPATCH_ENABLED
```

The processor converts accepted inbound events into durable provider-neutral actions. The dispatcher executes durable actions through registered provider adapters.

Production processor activation also requires an explicit cutover timestamp:

```text
PROCESSOR_CUTOVER_AT=<ISO-8601 timestamp>
```

Events received before that timestamp are durably acknowledged as processed **without** calling the AI bridge and without creating actions. The timestamp is a launch boundary, not a normal restart time. Keep it unchanged across ordinary restarts so messages received during a later service outage can still be recovered.

An optional canary allowlist accepts comma-separated SHA-256 conversation partition keys:

```text
PROCESSOR_CANARY_PARTITION_KEYS=<partition-1>,<partition-2>
```

When the list is non-empty, only those partitions may invoke the AI handler. Other claimed events are durably acknowledged with no AI call and no action. The list contains hashes rather than customer identifiers.

## Stage 0 — prerequisites

Before deploying the processor build, verify:

- canonical application repository is `ishinaillab/ishikeit`, branch `main`
- canonical database migrations are on `ishinaillab/ishikeit-db`
- PostgreSQL readiness passes the current schema checks
- the WordPress `Ishi AI Bridge` plugin is active
- authenticated `/wp-json/ishi-ai/v1/health` reports AI Engine and file APIs ready
- unauthenticated and incorrect bridge credentials return HTTP 401
- WordPress bridge responses are not cached
- Messenger, Instagram, and WhatsApp transport tokens are stored only in runtime secret storage
- `npm run check` and the GitHub Actions workflow are green on the exact commit to deploy

## Stage 1 — deploy code with execution disabled

Deploy the current `main` to `apps.ishinaillab.com` with:

```text
PROCESSOR_ENABLED=false
ACTION_DISPATCH_ENABLED=false
```

Do not enable either worker during the first deployment.

Verify:

```text
GET /health/live
GET /health/ready
GET /health/capabilities
```

`/health/capabilities` must identify the current event/action contract and report both runtime gates as false. This endpoint intentionally exposes no credentials.

Also verify Meta's existing GET challenge and signed POST ingress still work after deployment.

## Stage 2 — choose a canary conversation

Use a known test conversation that has already been authorized for transport testing.

Read its persisted `inbound_events.partition_key` from PostgreSQL. Use the hash only; do not put a phone number, PSID, Instagram ID, or other customer identifier into the canary environment variable.

Set:

```text
PROCESSOR_CANARY_PARTITION_KEYS=<that partition key>
```

Choose a fresh UTC cutover immediately before processor activation:

```text
PROCESSOR_CUTOVER_AT=<fresh ISO-8601 UTC timestamp>
```

The cutover must be later than any historical message that should not receive a delayed AI reply.

## Stage 3 — enable processor only

Set:

```text
PROCESSOR_ENABLED=true
ACTION_DISPATCH_ENABLED=false
```

Restart/deploy and verify `/health/capabilities` reports:

- processor enabled
- dispatcher disabled
- the expected cutover timestamp
- canary partition count greater than zero

Send one new message from the canary conversation.

Verify in PostgreSQL:

1. the inbound event is persisted
2. its `partition_key` equals the configured canary key
3. the source event becomes `processed`
4. exactly the expected `action.dispatch` record is created
5. the action remains unpublished because the dispatcher is disabled
6. no non-canary event creates an action

If any check fails, disable the processor before investigating.

## Stage 4 — enable dispatcher for the canary

Keep the canary partition allowlist in place and set:

```text
PROCESSOR_ENABLED=true
ACTION_DISPATCH_ENABLED=true
```

Verify the queued canary action is delivered by its provider adapter, then verify the provider delivery/status event where the platform supports one.

For messaging, confirm the reply content, recipient, account, provider message ID, and dead-letter/retry state.

Do not remove the canary allowlist until the complete round trip is proven.

## Stage 5 — full rollout

Choose a new cutover timestamp immediately before moving from canary to general processing. This prevents events intentionally skipped during the canary phase from becoming delayed replies.

Set:

```text
PROCESSOR_CUTOVER_AT=<new full-rollout timestamp>
PROCESSOR_CANARY_PARTITION_KEYS=
PROCESSOR_ENABLED=true
ACTION_DISPATCH_ENABLED=true
```

After restart, `/health/capabilities` should report a canary partition count of zero.

Monitor:

- inbound processing failures
- outbox retries
- dead letters
- delivery-ambiguous provider failures
- provider rate-limit responses
- WordPress bridge errors
- media size/type failures

## Rollback

To stop new AI work immediately while keeping webhook ingestion durable:

```text
PROCESSOR_ENABLED=false
```

To stop all provider-side actions immediately:

```text
ACTION_DISPATCH_ENABLED=false
```

If only the dispatcher is disabled, already-generated actions remain durable and can execute when it is re-enabled. Inspect or intentionally seal unwanted actions before re-enabling.

If the processor is disabled during an ordinary outage after full launch, do **not** move the original cutover timestamp forward unless intentionally discarding the backlog.

## Future providers and capabilities

The rollout controls are intentionally provider-neutral. Telegram messaging, Meta Marketing API actions, lead-management actions, and other adapters use the same durable event/action gates.

A future adapter must still define its own:

- authentication and credential scope
- provider rate limits
- idempotency semantics
- media/resource constraints
- retry classification
- policy windows and approval requirements
- canary validation procedure

The generic processor must not absorb provider-specific policy into its core.
