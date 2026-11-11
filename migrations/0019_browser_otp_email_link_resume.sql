-- Private, account-bound email OTP link resume in a different browser.
-- Additive only: preserves all existing owner sessions and TOTP factors.
-- The raw email remains AES-GCM encrypted; this indexed lookup is keyed
-- HMAC-SHA256 (server secret), so DB readers cannot offline-guess addresses.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
ALTER TABLE public.ishikeit_browser_login_attempts
  ADD COLUMN IF NOT EXISTS email_lookup_hash text
    CHECK(email_lookup_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS otp_sent_at timestamptz;
CREATE INDEX IF NOT EXISTS ishikeit_browser_login_email_resume_idx
  ON public.ishikeit_browser_login_attempts(email_lookup_hash,expires_at DESC)
  WHERE completed_at IS NULL AND otp_sent_at IS NOT NULL;
COMMENT ON COLUMN public.ishikeit_browser_login_attempts.email_lookup_hash IS
  'HMAC-SHA256 of normalized email with BFF private CSRF key; never plain SHA-256.';
COMMENT ON COLUMN public.ishikeit_browser_login_attempts.otp_sent_at IS
  'Present only after an eligible, successful Supabase OTP dispatch. Never a login authorization.';
COMMIT;
