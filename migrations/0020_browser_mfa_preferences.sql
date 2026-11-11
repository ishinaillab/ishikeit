-- Ishikeit scoped MFA preferences. Official Supabase Auth verified TOTP factors
-- are NOT removed or weakened by a local enable/disable switch.
-- AAL2 remains mandatory for all sensitive actions regardless of sign-in
-- preference. No anonymous or authenticated Data API write privileges.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
CREATE TABLE IF NOT EXISTS public.ishikeit_browser_mfa_policies (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  sign_in_2fa_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ishikeit_browser_disabled_totp_factors (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_id uuid NOT NULL REFERENCES auth.mfa_factors(id) ON DELETE CASCADE,
  disabled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,factor_id)
);
CREATE TABLE IF NOT EXISTS public.ishikeit_browser_mfa_security_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_kind text NOT NULL CHECK(event_kind IN
    ('sign_in_2fa_enabled','sign_in_2fa_disabled','authenticator_enabled','authenticator_disabled')),
  factor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ishikeit_browser_mfa_events_recent
 ON public.ishikeit_browser_mfa_security_events(user_id,occurred_at DESC);
DO $hardening$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ishikeit_browser_mfa_policies',
    'ishikeit_browser_disabled_totp_factors',
    'ishikeit_browser_mfa_security_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',t);
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',t);
    END IF;
  END LOOP;
END
$hardening$;
COMMIT;
