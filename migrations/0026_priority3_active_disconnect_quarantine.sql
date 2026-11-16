-- Priority 3: private, durable active-connection disconnect reconciliation.
-- Expand-only: does not change legacy writers, provider credentials or routing.
-- A disconnect request freezes the verified registry generation and quarantines
-- tenant work; this ledger retains global ownership until actual provider
-- cleanup and any in-flight sends are independently reconciled.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS public.ishikeit_active_disconnect_cleanup (
  connection_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  frozen_generation bigint NOT NULL CHECK (frozen_generation > 1),
  provider text NOT NULL CHECK (provider ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_account_id text NOT NULL CHECK (length(provider_account_id) BETWEEN 1 AND 256),
  provider_application_key text NOT NULL
    CHECK (provider_application_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_connection_id text,
  credential_account_id text,
  cleanup_state text NOT NULL DEFAULT 'pending'
    CHECK (cleanup_state IN ('pending','retry_required','provider_verified','complete')),
  quarantined_jobs bigint NOT NULL DEFAULT 0 CHECK (quarantined_jobs >= 0),
  uncertain_inflight_jobs bigint NOT NULL DEFAULT 0 CHECK (uncertain_inflight_jobs >= 0),
  cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  last_error_code text CHECK (last_error_code IS NULL
    OR last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  next_retry_at timestamptz,
  provider_cleanup_method text CHECK (provider_cleanup_method IS NULL
    OR provider_cleanup_method ~ '^[a-z][a-z0-9_]{0,63}$'),
  provider_verified_at timestamptz,
  completed_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id,workspace_id)
    REFERENCES public.ishikeit_account_connections(connection_id,workspace_id),
  CONSTRAINT ishikeit_disconnect_verified_state_ck CHECK (
    (cleanup_state IN ('provider_verified','complete'))
       = (provider_verified_at IS NOT NULL)),
  CONSTRAINT ishikeit_disconnect_method_ck CHECK (
    (cleanup_state IN ('provider_verified','complete'))
       = (provider_cleanup_method IS NOT NULL)),
  CONSTRAINT ishikeit_disconnect_completed_state_ck CHECK (
    (cleanup_state = 'complete') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ishikeit_disconnect_pending_retry_idx
  ON public.ishikeit_active_disconnect_cleanup(next_retry_at,requested_at)
  WHERE cleanup_state IN ('pending','retry_required');

ALTER TABLE public.ishikeit_active_disconnect_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ishikeit_active_disconnect_cleanup FROM PUBLIC;
DO $ishikeit$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ishikeit_active_disconnect_cleanup FROM anon';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ishikeit_active_disconnect_cleanup FROM authenticated';
  END IF;
END
$ishikeit$;
COMMIT;
