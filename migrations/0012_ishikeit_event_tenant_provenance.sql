-- #230: nullable tenant provenance slots for future authenticated ingress and
-- outbound dispatch. Legacy rows remain NULL; no ownership is inferred.
-- A connection ID must be accompanied by exact workspace and generation.
-- Current processors do NOT yet populate these columns. They are not a
-- tenant-aware routing or cancellation implementation by themselves.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '25s';

ALTER TABLE public.inbound_events
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS connection_id uuid,
  ADD COLUMN IF NOT EXISTS connection_generation bigint;
ALTER TABLE public.outbox
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS connection_id uuid,
  ADD COLUMN IF NOT EXISTS connection_generation bigint;

ALTER TABLE public.inbound_events
  ADD CONSTRAINT ishikeit_inbound_tenant_shape_ck CHECK (
    (connection_id IS NULL OR workspace_id IS NOT NULL)
    AND ((connection_id IS NULL) = (connection_generation IS NULL))
    AND (connection_generation IS NULL OR connection_generation > 0)
  ) NOT VALID;
ALTER TABLE public.outbox
  ADD CONSTRAINT ishikeit_outbox_tenant_shape_ck CHECK (
    (connection_id IS NULL OR workspace_id IS NOT NULL)
    AND ((connection_id IS NULL) = (connection_generation IS NULL))
    AND (connection_generation IS NULL OR connection_generation > 0)
  ) NOT VALID;

-- Composite FK prevents a record from referencing an account belonging to
-- another workspace. A NULL connection is legitimate for workspace-scoped
-- non-provider tasks; NULL workspace means legacy unassigned data ONLY.
ALTER TABLE public.inbound_events
  ADD CONSTRAINT ishikeit_inbound_workspace_fk
    FOREIGN KEY(workspace_id) REFERENCES public.ishikeit_workspaces(workspace_id)
    NOT VALID,
  ADD CONSTRAINT ishikeit_inbound_connection_fk
    FOREIGN KEY(connection_id,workspace_id)
      REFERENCES public.ishikeit_account_connections(connection_id,workspace_id)
    NOT VALID;
ALTER TABLE public.outbox
  ADD CONSTRAINT ishikeit_outbox_workspace_fk
    FOREIGN KEY(workspace_id) REFERENCES public.ishikeit_workspaces(workspace_id)
    NOT VALID,
  ADD CONSTRAINT ishikeit_outbox_connection_fk
    FOREIGN KEY(connection_id,workspace_id)
      REFERENCES public.ishikeit_account_connections(connection_id,workspace_id)
    NOT VALID;

CREATE INDEX IF NOT EXISTS ishikeit_inbound_workspace_time_idx
  ON public.inbound_events(workspace_id,received_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ishikeit_outbox_workspace_time_idx
  ON public.outbox(workspace_id,created_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ishikeit_inbound_connection_fk_idx
  ON public.inbound_events(connection_id,workspace_id)
  WHERE connection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ishikeit_outbox_connection_fk_idx
  ON public.outbox(connection_id,workspace_id)
  WHERE connection_id IS NOT NULL;

-- Existing RLS/private grants must remain in force. Explicitly harden them:
ALTER TABLE public.inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inbound_events,public.outbox FROM PUBLIC;
DO $ishikeit$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.inbound_events, public.outbox FROM %I',client_role);
    END IF;
  END LOOP;
END
$ishikeit$;
COMMIT;
