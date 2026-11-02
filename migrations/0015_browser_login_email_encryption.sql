-- Private browser auth data minimization. Safe only before login is enabled:
-- refuse migration if any previous pending-login email records exist, rather
-- than silently erasing evidence. Production BFF flag is currently OFF.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
LOCK TABLE public.ishikeit_browser_login_attempts IN ACCESS EXCLUSIVE MODE;
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ishikeit_browser_login_attempts LIMIT 1) THEN
    RAISE EXCEPTION 'Login attempt migration blocked: existing attempts need verified backfill';
  END IF;
END
$migration$;
ALTER TABLE public.ishikeit_browser_login_attempts
  DROP COLUMN email_address,
  ADD COLUMN email_ciphertext bytea NOT NULL,
  ADD COLUMN email_iv bytea NOT NULL
    CHECK(octet_length(email_iv)=12),
  ADD COLUMN email_tag bytea NOT NULL
    CHECK(octet_length(email_tag)=16);
COMMIT;
