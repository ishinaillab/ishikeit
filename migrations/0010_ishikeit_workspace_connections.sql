-- Issue #230: additive server-private multi-workspace account foundation.
-- No historical ownership assignment, credentials, webhooks or routing changes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.ishikeit_workspaces (
  workspace_id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Issuer/subject MUST originate from authenticated server verification;
-- never from a browser-provided claim or editable user metadata.
CREATE TABLE IF NOT EXISTS public.ishikeit_workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES public.ishikeit_workspaces(workspace_id),
  auth_issuer text NOT NULL CHECK (char_length(auth_issuer) BETWEEN 1 AND 200),
  auth_subject text NOT NULL CHECK (char_length(auth_subject) BETWEEN 1 AND 256),
  role text NOT NULL CHECK (role IN ('owner','admin','agent','viewer')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,auth_issuer,auth_subject)
);
CREATE INDEX IF NOT EXISTS ishikeit_memberships_subject_idx
  ON public.ishikeit_workspace_memberships(auth_issuer,auth_subject,workspace_id)
  WHERE state='active';

-- Provider ID is immutable identity; username/handle is never an identity key.
-- No tokens, grant response bodies or customer message data are stored here.
CREATE TABLE IF NOT EXISTS public.ishikeit_provider_accounts (
  provider text NOT NULL CHECK (provider ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_account_id text NOT NULL CHECK (char_length(provider_account_id) BETWEEN 1 AND 256),
  verification_source text NOT NULL
    CHECK (verification_source IN ('provider_api','oauth_grant','provider_connection_readback')),
  verification_reference text NOT NULL
    CHECK (verification_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider,provider_account_id)
);

-- One active automation owner, including while cleanup is pending; a completed
-- disconnected historical link permits a NEW, separately verified link.
CREATE TABLE IF NOT EXISTS public.ishikeit_account_connections (
  connection_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.ishikeit_workspaces(workspace_id),
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  provider_application_key text NOT NULL
    CHECK (provider_application_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_connection_id text
    CHECK (provider_connection_id IS NULL OR char_length(provider_connection_id) BETWEEN 1 AND 256),
  credential_account_id text
    CHECK (credential_account_id IS NULL OR char_length(credential_account_id) BETWEEN 1 AND 256),
  status text NOT NULL DEFAULT 'verifying'
    CHECK (status IN ('verifying','connected','attention_required','paused','disconnecting','disconnected','revoked')),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  activated_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ishikeit_connection_verified_account_fk
    FOREIGN KEY (provider,provider_account_id)
    REFERENCES public.ishikeit_provider_accounts(provider,provider_account_id),
  CONSTRAINT ishikeit_connection_ws_id_unique UNIQUE (connection_id,workspace_id),
  CONSTRAINT ishikeit_disconnected_timestamp_ck CHECK (
    (status='disconnected') = (disconnected_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ishikeit_one_active_owner_per_account
  ON public.ishikeit_account_connections(provider,provider_account_id)
  WHERE status <> 'disconnected';
CREATE UNIQUE INDEX IF NOT EXISTS ishikeit_one_active_provider_connection
  ON public.ishikeit_account_connections(provider,provider_connection_id)
  WHERE provider_connection_id IS NOT NULL AND status <> 'disconnected';
CREATE INDEX IF NOT EXISTS ishikeit_connections_workspace_idx
  ON public.ishikeit_account_connections(workspace_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS public.ishikeit_connection_audit (
  event_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('link_verified','activated','paused','disconnect_requested','disconnected','revoked')),
  actor_issuer text,
  actor_subject text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ishikeit_audit_actor_pair_ck CHECK ((actor_issuer IS NULL) = (actor_subject IS NULL)),
  CONSTRAINT ishikeit_audit_connection_fk
    FOREIGN KEY (connection_id,workspace_id)
    REFERENCES public.ishikeit_account_connections(connection_id,workspace_id)
);
CREATE INDEX IF NOT EXISTS ishikeit_audit_workspace_time_idx
  ON public.ishikeit_connection_audit(workspace_id,recorded_at DESC);

-- Supabase public schema is potentially Data API exposed. No client grants
-- and no permissive RLS policies until a complete tenant-aware auth layer exists.
ALTER TABLE public.ishikeit_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ishikeit_workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ishikeit_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ishikeit_account_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ishikeit_connection_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ishikeit_workspaces,
  public.ishikeit_workspace_memberships, public.ishikeit_provider_accounts,
  public.ishikeit_account_connections, public.ishikeit_connection_audit FROM PUBLIC;
DO $ishikeit$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.ishikeit_workspaces, public.ishikeit_workspace_memberships, public.ishikeit_provider_accounts, public.ishikeit_account_connections, public.ishikeit_connection_audit FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$ishikeit$;
COMMIT;
