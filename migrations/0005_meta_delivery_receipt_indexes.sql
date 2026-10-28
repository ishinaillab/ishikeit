-- Selective indexes for the three-channel Meta outbound delivery lifecycle.
-- Separate receipt search from the general message/event ingestion index.
-- Scope excludes TikTok and does not alter provider account state.
BEGIN;

CREATE INDEX IF NOT EXISTS inbound_meta_delivery_receipt_lookup_idx
  ON public.inbound_events (channel, account_id, provider_message_id, received_at DESC)
  WHERE provider = 'meta'
    AND provider_message_id IS NOT NULL
    AND event_type IN ('delivery.sent', 'delivery.delivered', 'delivery.read', 'delivery.failed');

CREATE INDEX IF NOT EXISTS outbox_published_dispatch_window_idx
  ON public.outbox (published_at DESC)
  WHERE topic = 'action.dispatch'
    AND published_at IS NOT NULL;

COMMIT;
