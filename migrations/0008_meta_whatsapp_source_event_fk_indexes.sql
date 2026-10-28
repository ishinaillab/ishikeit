-- Ensure signed WhatsApp consent/STOP evidence foreign keys have covering indexes.
-- Idempotent and additive: no customer records or consent state changes.
BEGIN;

CREATE INDEX IF NOT EXISTS meta_whatsapp_opt_ins_source_event_idx
  ON public.meta_whatsapp_template_opt_ins (source_event_id);

CREATE INDEX IF NOT EXISTS meta_whatsapp_opt_outs_source_event_idx
  ON public.meta_whatsapp_template_opt_outs (source_event_id);

COMMIT;
