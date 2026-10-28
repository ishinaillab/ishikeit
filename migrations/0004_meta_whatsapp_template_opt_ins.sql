-- Consent evidence for optional, approved WhatsApp service templates.
-- No phone numbers, message bodies or plaintext customer identities are stored.
BEGIN;

CREATE TABLE IF NOT EXISTS public.meta_whatsapp_template_opt_ins (
  recipient_key text NOT NULL CHECK (recipient_key ~ '^[a-f0-9]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('appointment_updates')),
  source_event_id uuid NOT NULL REFERENCES public.inbound_events(id),
  consented_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY(recipient_key,purpose),
  CHECK (revoked_at IS NULL OR revoked_at >= consented_at)
);

ALTER TABLE public.meta_whatsapp_template_opt_ins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_whatsapp_template_opt_ins FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS meta_whatsapp_opt_ins_active_idx
  ON public.meta_whatsapp_template_opt_ins (purpose,consented_at)
  WHERE revoked_at IS NULL;

COMMIT;
