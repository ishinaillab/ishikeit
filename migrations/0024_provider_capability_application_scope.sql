-- Expand-only, additive transition to application-bound provider evidence.
-- Keep the ORIGINAL account-only table and its original three-key PK intact:
-- the currently deployed server still writes there during rolling releases.
-- New application versions exclusively read/write the v2 private table.
-- Historical records are copied as 'legacy-unbound' and NEVER grant new
-- OAuth applications access. Do not drop the old table here.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS public.provider_account_capability_facts_v2 (
  provider text NOT NULL CHECK
    (provider ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  account_id text NOT NULL CHECK (length(account_id) BETWEEN 1 AND 256),
  provider_application_key text NOT NULL CHECK
    (provider_application_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  -- NULL for historical/legacy facts, never proof of a native workspace.
  source_connection_id uuid,
  evidence_key text NOT NULL CHECK
    (evidence_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  state text NOT NULL CHECK (state IN ('granted','denied')),
  evidence_source text NOT NULL CHECK
    (evidence_source IN
      ('provider_api','oauth_grant','signed_webhook','provider_connection_readback')),
  source_reference text NOT NULL CHECK
    (length(source_reference) BETWEEN 1 AND 256),
  observed_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, account_id, provider_application_key, evidence_key),
  CHECK (valid_until > observed_at)
);

ALTER TABLE public.provider_account_capability_facts_v2
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_account_capability_facts_v2 FROM PUBLIC;
-- The disposable PG17 test image lacks Supabase's client roles.
DO $ishikeit$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.provider_account_capability_facts_v2 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.provider_account_capability_facts_v2 FROM authenticated';
  END IF;
END
$ishikeit$;

CREATE INDEX IF NOT EXISTS provider_account_capability_facts_v2_expiry_idx
  ON public.provider_account_capability_facts_v2(valid_until);

-- Preserve the existing history only as explicitly unattributed evidence.
-- Do not infer provider app from an account, token or earlier workspace.
INSERT INTO public.provider_account_capability_facts_v2
  (provider,account_id,provider_application_key,evidence_key,state,
   evidence_source,source_reference,observed_at,valid_until,recorded_at)
SELECT provider,account_id,'legacy-unbound',evidence_key,state,
       evidence_source,source_reference,observed_at,valid_until,recorded_at
FROM public.provider_account_capability_facts
ON CONFLICT (provider,account_id,provider_application_key,evidence_key)
  DO NOTHING;

-- No changes to the original writer's table, primary key, or default.
COMMIT;
