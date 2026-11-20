-- Priority 3 external-step safety fence: additive and dormant until
-- a protected release controller exists. A started hosted DB migration or
-- Hostinger build can outlive the PostgreSQL lease expiry. Retain that
-- uncertainty durably; never reassign an expired release owner while the
-- external outcome remains unverified. No hosted action is initiated here.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

ALTER TABLE public.ishikeit_release_ownership
  ADD COLUMN IF NOT EXISTS pending_external_step text,
  ADD COLUMN IF NOT EXISTS pending_external_step_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_schema_migration_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_app_deploy_at timestamptz;

ALTER TABLE public.ishikeit_release_ownership
  ADD CONSTRAINT ishikeit_release_external_step_pair_ck
    CHECK ((pending_external_step IS NULL) = (pending_external_step_at IS NULL))
    NOT VALID;

ALTER TABLE public.ishikeit_release_ownership
  ADD CONSTRAINT ishikeit_release_external_step_kind_ck
    CHECK (pending_external_step IS NULL
       OR pending_external_step IN ('schema_migration','app_deploy'))
    NOT VALID;

-- The pre-existing RLS/no-client-grants controls remain enforced.
-- Do not introduce a browser action, automatic provider call or retry here.
COMMIT;
