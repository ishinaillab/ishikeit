-- Durable private human-handoff suppression for Meta messaging. No customer
-- message bodies, account IDs or identity IDs are stored in this table.
BEGIN;

CREATE TABLE IF NOT EXISTS public.meta_handoff_blocks (
  partition_key text PRIMARY KEY CHECK (partition_key ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 128),
  opened_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);

ALTER TABLE public.meta_handoff_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_handoff_blocks FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS meta_handoff_blocks_active_idx
  ON public.meta_handoff_blocks (opened_at)
  WHERE released_at IS NULL;

COMMIT;
