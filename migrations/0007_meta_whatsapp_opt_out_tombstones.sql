-- Signed STOP must be remembered even when no prior opt-in exists.
-- Private, hashed recipient keys only: no raw phone numbers/message bodies.
BEGIN;

CREATE TABLE IF NOT EXISTS public.meta_whatsapp_template_opt_outs (
  recipient_key text NOT NULL CHECK (recipient_key ~ '^[a-f0-9]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('appointment_updates')),
  source_event_id uuid NOT NULL REFERENCES public.inbound_events(id),
  opted_out_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipient_key,purpose)
);

ALTER TABLE public.meta_whatsapp_template_opt_outs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_whatsapp_template_opt_outs FROM anon,authenticated;

COMMIT;
