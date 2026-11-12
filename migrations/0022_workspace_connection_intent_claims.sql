-- #230: consume exactly one authenticated, session-bound provider authorization
-- intent per account claim. Additive to the private (no client grants) registry.
-- No historical credentials, traffic, owner MFA, or existing claims touched.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Every newly initiated connection intent has a real BFF login session.
-- Live preflight confirms there are no existing NULL-session intents.
ALTER TABLE public.ishikeit_connection_intents
  ALTER COLUMN auth_session_id SET NOT NULL,
  ADD COLUMN claimed_connection_id uuid,
  ADD COLUMN claimed_at timestamptz;

ALTER TABLE public.ishikeit_connection_intents
  ADD CONSTRAINT ishikeit_intent_claim_state_ck CHECK (
    (claimed_connection_id IS NULL) = (claimed_at IS NULL)
    AND (claimed_at IS NULL OR consumed_at IS NOT NULL)
  ),
  ADD CONSTRAINT ishikeit_intent_claimed_connection_fk
    FOREIGN KEY (claimed_connection_id,workspace_id)
    REFERENCES public.ishikeit_account_connections(connection_id,workspace_id)
    NOT VALID;
ALTER TABLE public.ishikeit_connection_intents
  VALIDATE CONSTRAINT ishikeit_intent_claimed_connection_fk;
CREATE UNIQUE INDEX ishikeit_intent_claimed_connection_unique
  ON public.ishikeit_connection_intents(claimed_connection_id)
  WHERE claimed_connection_id IS NOT NULL;

-- Keep the existing RLS/default-deny and role REVOKEs in force.
-- No policies, direct client grants, or SECURITY DEFINER functions.
COMMIT;
