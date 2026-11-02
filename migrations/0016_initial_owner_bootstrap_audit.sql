-- One-time, operator-approved initial-workspace bootstrap audit.
-- Does NOT create an owner, auth user, workspace, membership, or invite.
-- Never exposes bootstrap or identity records through the Supabase Data API.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
CREATE TABLE IF NOT EXISTS public.ishikeit_initial_owner_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  workspace_id uuid NOT NULL UNIQUE
    REFERENCES public.ishikeit_workspaces(workspace_id),
  owner_user_id uuid NOT NULL,
  auth_issuer text NOT NULL
    CHECK (char_length(auth_issuer) BETWEEN 1 AND 200),
  approved_by text NOT NULL
    CHECK (char_length(approved_by) BETWEEN 3 AND 120),
  approval_reference text NOT NULL
    CHECK (char_length(approval_reference) BETWEEN 8 AND 160),
  completed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ishikeit_initial_owner_bootstrap ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ishikeit_initial_owner_bootstrap FROM PUBLIC;
DO $private$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON public.ishikeit_initial_owner_bootstrap FROM %I',
        role_name);
    END IF;
  END LOOP;
END
$private$;
COMMIT;
