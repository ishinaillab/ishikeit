-- #230: bind a future workspace OAuth connection attempt to the exact
-- prevalidated identity-provider login SESSION, not just user + browser nonce.
-- Additive: old unused intents are NULL, and no public callbacks are enabled.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.ishikeit_connection_intents
  ADD COLUMN IF NOT EXISTS auth_session_id uuid;
CREATE INDEX IF NOT EXISTS ishikeit_intents_session_idx
  ON public.ishikeit_connection_intents(auth_session_id,expires_at)
  WHERE auth_session_id IS NOT NULL AND consumed_at IS NULL;
-- Do not FK to auth.sessions: a sign-out should cause the trusted Auth verifier
-- to deny consumption while the now-inert intent expires and gets pruned.
COMMIT;
