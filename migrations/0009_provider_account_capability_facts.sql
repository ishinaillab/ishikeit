-- Provider API capability evidence: server-owned, no tokens, customer messages,
-- username guesses, paid plan assumptions or provider-response bodies.
-- Facts are kept per exact provider account. The latest denied result wins ties.
BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_account_capability_facts (
  provider text NOT NULL CHECK (provider ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  account_id text NOT NULL CHECK (length(account_id) BETWEEN 1 AND 256),
  evidence_key text NOT NULL CHECK (evidence_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  state text NOT NULL CHECK (state IN ('granted','denied')),
  evidence_source text NOT NULL CHECK (evidence_source IN ('provider_api','oauth_grant','signed_webhook','provider_connection_readback')),
  source_reference text NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 256),
  observed_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, account_id, evidence_key),
  CHECK (valid_until > observed_at)
);
ALTER TABLE public.provider_account_capability_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_account_capability_facts FROM PUBLIC;
-- Supabase provides these client roles; disposable vanilla PostgreSQL does not.
DO $
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.provider_account_capability_facts FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.provider_account_capability_facts FROM authenticated';
  END IF;
END
$;
-- Existing rows persist until an authenticated provider revalidation replaces
-- them or the account's deletion workflow removes them.
CREATE INDEX IF NOT EXISTS provider_account_capability_facts_expiry_idx
  ON public.provider_account_capability_facts(valid_until);
COMMIT;
