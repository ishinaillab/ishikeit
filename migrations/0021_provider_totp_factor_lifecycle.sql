-- Provider-backed TOTP lifecycle: native factors are deleted through GoTrue.
-- Store only user-chosen display aliases; never mirror secrets or enable flags.
-- Expand schema before application deployment; retain legacy flag table during
-- rolling deploy, then retire it only after the old app is no longer serving.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

CREATE TABLE IF NOT EXISTS public.ishikeit_browser_totp_labels (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_id uuid NOT NULL REFERENCES auth.mfa_factors(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (
    char_length(display_name) BETWEEN 1 AND 64 AND
    display_name=btrim(display_name)
  ),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,factor_id)
);
ALTER TABLE public.ishikeit_browser_totp_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ishikeit_browser_totp_labels FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE public.ishikeit_browser_totp_labels FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE public.ishikeit_browser_totp_labels FROM authenticated;
  END IF;
END
$roles$;

-- Replace only the known event_kind check; never drop unrelated constraints.
ALTER TABLE public.ishikeit_browser_mfa_security_events
  DROP CONSTRAINT IF EXISTS ishikeit_browser_mfa_security_events_event_kind_check;
ALTER TABLE public.ishikeit_browser_mfa_security_events
  ADD CONSTRAINT ishikeit_browser_mfa_security_events_event_kind_check
  CHECK (event_kind IN (
    'sign_in_2fa_enabled','sign_in_2fa_disabled',
    'authenticator_enabled','authenticator_disabled', -- historical records
    'authenticator_removed','authenticator_renamed','totp_method_disabled',
    'authenticator_removal_partial'
  ));
COMMIT;
