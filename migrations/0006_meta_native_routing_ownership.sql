-- Provider-native thread ownership must be tracked separately from AI-to-human
-- handoff. A user may be under both restrictions simultaneously.
BEGIN;

CREATE TABLE IF NOT EXISTS public.meta_native_routing_ownership (
  partition_key text PRIMARY KEY CHECK (partition_key ~ '^[a-f0-9]{64}$'),
  owner_state text NOT NULL CHECK (owner_state IN ('this_app','other_app')),
  provider_event_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_native_routing_ownership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_native_routing_ownership FROM anon, authenticated;

-- Backfill any historical native blocks conservatively before changing
-- read-path semantics. Pre-migration blocks use server processing time.
INSERT INTO public.meta_native_routing_ownership
  (partition_key, owner_state, provider_event_at)
SELECT partition_key, 'other_app', opened_at
FROM public.meta_handoff_blocks
WHERE reason='native_thread_control_other_app' AND released_at IS NULL
ON CONFLICT (partition_key) DO NOTHING;

-- Human handoff table is now exclusively for user/AI human escalation.
UPDATE public.meta_handoff_blocks SET released_at=now()
WHERE reason='native_thread_control_other_app' AND released_at IS NULL;

COMMIT;
