-- Phase 2 account-scoped user invitations, separate from platform-superadmin.
-- No existing account, role or message routing is changed on deployment.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
CREATE TABLE IF NOT EXISTS public.ishikeit_workspace_invitations (
  invitation_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.ishikeit_workspaces(workspace_id),
  auth_issuer text NOT NULL CHECK(length(auth_issuer) BETWEEN 1 AND 200),
  invitee_email text NOT NULL CHECK(invitee_email=lower(invitee_email)
    AND char_length(invitee_email) BETWEEN 3 AND 320),
  requested_role text NOT NULL CHECK(requested_role IN ('admin','agent','viewer')),
  inviter_subject uuid NOT NULL,
  state text NOT NULL DEFAULT 'invite_requested'
    CHECK(state IN ('invite_requested','invited','activated','cancelled')),
  auth_user_id uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  invited_at timestamptz,
  activated_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT ishikeit_workspace_invitation_state_ck CHECK(
    (state='invite_requested' AND auth_user_id IS NULL
      AND invited_at IS NULL AND activated_at IS NULL AND cancelled_at IS NULL)
    OR (state='invited' AND auth_user_id IS NOT NULL
      AND invited_at IS NOT NULL AND activated_at IS NULL AND cancelled_at IS NULL)
    OR (state='activated' AND auth_user_id IS NOT NULL
      AND invited_at IS NOT NULL AND activated_at IS NOT NULL AND cancelled_at IS NULL)
    OR (state='cancelled' AND cancelled_at IS NOT NULL AND activated_at IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ishikeit_workspace_invite_unique_pending
  ON public.ishikeit_workspace_invitations(workspace_id,invitee_email)
  WHERE state IN ('invite_requested','invited');
CREATE INDEX IF NOT EXISTS ishikeit_workspace_invite_pending_reconcile_idx
  ON public.ishikeit_workspace_invitations(requested_at,invitation_id)
  WHERE state IN ('invite_requested','invited');
ALTER TABLE public.ishikeit_workspace_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ishikeit_workspace_invitations FROM PUBLIC;
DO $private$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ishikeit_workspace_invitations FROM %I',r);
    END IF;
  END LOOP;
END
$private$;
COMMIT;
