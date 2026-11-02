-- Issue #230, Phase 2: server-private, one-use workspace-bound OAuth
-- authorization intent. No public routes and no changes to legacy OAuth flows.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ishikeit_connection_intents (
  intent_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.ishikeit_workspaces(workspace_id),
  actor_issuer text NOT NULL CHECK (char_length(actor_issuer) BETWEEN 1 AND 200),
  actor_subject text NOT NULL CHECK (char_length(actor_subject) BETWEEN 1 AND 256),
  provider text NOT NULL CHECK (provider ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_application_key text NOT NULL
    CHECK (provider_application_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  redirect_uri text NOT NULL
    CHECK (char_length(redirect_uri) BETWEEN 12 AND 2048
      AND left(redirect_uri,8) = 'https://'),
  state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  browser_nonce_hash text NOT NULL CHECK (browser_nonce_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT ishikeit_intent_member_fk FOREIGN KEY
    (workspace_id,actor_issuer,actor_subject)
    REFERENCES public.ishikeit_workspace_memberships(workspace_id,auth_issuer,auth_subject),
  CONSTRAINT ishikeit_intent_expiry_ck CHECK
    (expires_at > created_at AND expires_at <= created_at + interval '15 minutes'),
  CONSTRAINT ishikeit_intent_consumed_ck CHECK
    (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX IF NOT EXISTS ishikeit_intent_expiry_idx
  ON public.ishikeit_connection_intents(expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS ishikeit_intent_owner_idx
  ON public.ishikeit_connection_intents(workspace_id,actor_issuer,actor_subject,created_at DESC);

ALTER TABLE public.ishikeit_connection_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ishikeit_connection_intents FROM PUBLIC;
DO $ishikeit$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.ishikeit_connection_intents FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$ishikeit$;
COMMIT;
