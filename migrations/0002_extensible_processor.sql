BEGIN;

ALTER TABLE inbound_events
  DROP CONSTRAINT IF EXISTS inbound_events_channel_check;

ALTER TABLE inbound_events
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS capability text,
  ADD COLUMN IF NOT EXISTS last_error text;

UPDATE inbound_events SET provider = 'meta' WHERE provider IS NULL;
UPDATE inbound_events SET capability = 'messaging' WHERE capability IS NULL;

ALTER TABLE inbound_events
  ALTER COLUMN provider SET NOT NULL,
  ALTER COLUMN capability SET NOT NULL,
  ALTER COLUMN provider SET DEFAULT 'meta',
  ALTER COLUMN capability SET DEFAULT 'messaging';

CREATE INDEX IF NOT EXISTS inbound_events_route_idx
  ON inbound_events (provider, channel, capability, event_type, received_at);

-- Foundation events existed before the processor had an execution contract.
-- Seal that historical queue so enabling the processor cannot reply to old tests/customers.
UPDATE outbox
SET published_at = COALESCE(published_at, now())
WHERE topic = 'inbound.event.accepted'
  AND published_at IS NULL
  AND dead_lettered_at IS NULL;

COMMIT;
