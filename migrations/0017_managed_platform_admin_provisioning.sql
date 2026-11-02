-- Server-managed first administrator enrollment. No account or role is
-- assigned by this migration. Subsequent grants require a verified user
-- and an explicit approved provisioning operation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
CREATE TABLE IF NOT EXISTS public.ishikeit_initial_admin_provisioning (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  email_address text NOT NULL CHECK (email_address=lower(email_address)
    AND length(email_address) BETWEEN 3 AND 320),
  approval_reference text NOT NULL CHECK (length(approval_reference) BETWEEN 8 AND 160),
  approved_by text NOT NULL CHECK (length(approved_by) BETWEEN 3 AND 120),
  state text NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved','invite_requested','invited','activated')),
  auth_user_id uuid UNIQUE,
  requested_at timestamptz,
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ishikeit_initial_provisioning_state_ck CHECK (
    (state='reserved' AND requested_at IS NULL AND invited_at IS NULL AND activated_at IS NULL AND auth_user_id IS NULL)
    OR (state='invite_requested' AND requested_at IS NOT NULL AND invited_at IS NULL AND activated_at IS NULL)
    OR (state='invited' AND requested_at IS NOT NULL AND invited_at IS NOT NULL AND activated_at IS NULL AND auth_user_id IS NOT NULL)
    OR (state='activated' AND requested_at IS NOT NULL AND invited_at IS NOT NULL AND activated_at IS NOT NULL AND auth_user_id IS NOT NULL)
  )
);
CREATE TABLE IF NOT EXISTS public.ishikeit_platform_administrators (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  auth_issuer text NOT NULL CHECK(length(auth_issuer) BETWEEN 1 AND 200),
  role text NOT NULL DEFAULT 'super_admin' CHECK(role='super_admin'),
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),
  approval_reference text NOT NULL CHECK(length(approval_reference) BETWEEN 8 AND 160),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT ishikeit_platform_admin_state_ck CHECK
    ((state='active' AND revoked_at IS NULL)
      OR (state='revoked' AND revoked_at IS NOT NULL))
);
-- Platform administrators are different from per-workspace roles;
-- no implicit grants to other tenants, provider accounts, or user metadata.
ALTER TABLE public.ishikeit_initial_admin_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ishikeit_platform_administrators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ishikeit_initial_admin_provisioning,
  public.ishikeit_platform_administrators FROM PUBLIC;
DO $private$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON public.ishikeit_initial_admin_provisioning,public.ishikeit_platform_administrators FROM %I',
        role_name);
    END IF;
  END LOOP;
END
$private$;
COMMIT;
