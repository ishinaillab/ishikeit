-- #230, opt-in private browser BFF. No legacy webhook, OAuth, customer or
-- provider tables are changed. No signup endpoint is created.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.ishikeit_browser_login_attempts (
  challenge_hash text PRIMARY KEY CHECK (challenge_hash ~ '^[0-9a-f]{64}$'),
  email_address text NOT NULL CHECK (char_length(email_address) BETWEEN 3 AND 320),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  tries integer NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),
  completed_at timestamptz,
  CHECK(expires_at > requested_at AND expires_at <= requested_at + interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS ishikeit_browser_login_expiry_idx
 ON public.ishikeit_browser_login_attempts(expires_at);

CREATE TABLE IF NOT EXISTS public.ishikeit_browser_auth_limits (
  bucket_hash text PRIMARY KEY CHECK(bucket_hash ~ '^[0-9a-f]{64}$'),
  hits integer NOT NULL DEFAULT 1 CHECK(hits >= 1),
  reset_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ishikeit_browser_sessions (
  session_hash text PRIMARY KEY CHECK(session_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL,
  auth_session_id uuid NOT NULL,
  access_ciphertext bytea NOT NULL,
  access_iv bytea NOT NULL CHECK(octet_length(access_iv)=12),
  access_tag bytea NOT NULL CHECK(octet_length(access_tag)=16),
  refresh_ciphertext bytea NOT NULL,
  refresh_iv bytea NOT NULL CHECK(octet_length(refresh_iv)=12),
  refresh_tag bytea NOT NULL CHECK(octet_length(refresh_tag)=16),
  access_expires_at timestamptz NOT NULL,
  session_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK(session_expires_at>created_at),
  CHECK(session_expires_at<=created_at+interval '1 day')
);
CREATE INDEX IF NOT EXISTS ishikeit_browser_sessions_expiry_idx
 ON public.ishikeit_browser_sessions(session_expires_at);
CREATE INDEX IF NOT EXISTS ishikeit_browser_sessions_user_idx
 ON public.ishikeit_browser_sessions(user_id,auth_session_id)
 WHERE revoked_at IS NULL;

ALTER TABLE public.ishikeit_browser_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ishikeit_browser_auth_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ishikeit_browser_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ishikeit_browser_login_attempts,
 public.ishikeit_browser_auth_limits,public.ishikeit_browser_sessions FROM PUBLIC;
DO $ishikeit$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
       'REVOKE ALL ON TABLE public.ishikeit_browser_login_attempts, public.ishikeit_browser_auth_limits, public.ishikeit_browser_sessions FROM %I',
       role_name);
    END IF;
  END LOOP;
END
$ishikeit$;
COMMIT;
