-- Priority 3 dormant, fail-closed native outbox write boundary.
-- Legacy and workspace-only rows remain unchanged. Native connection-bound
-- jobs must be allocated under a current activated connection generation.
-- A FOR SHARE lock keeps a concurrent pause/disconnect (FOR UPDATE) from
-- passing an uncommitted native enqueue. All checks are at PostgreSQL level.
-- Provider ownership, per-send rights, dispatch and live cutover are separate.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.ishikeit_guard_native_outbox_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $ishikeit$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Never silently relabel an existing job, including legacy => native,
    -- native => legacy, or another account/generation in the same workspace.
    -- The existing outbox worker may update leases, attempts and state.
    IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR OLD.connection_id IS DISTINCT FROM NEW.connection_id
       OR OLD.connection_generation IS DISTINCT FROM NEW.connection_generation THEN
      RAISE EXCEPTION 'Native outbox provenance is immutable'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.connection_id IS NULL THEN
    -- Workspace-only, connectionless tasks and historical unassigned legacy
    -- traffic have no native provider send claim. Existing CHECK/FK apply.
    RETURN NEW;
  END IF;

  -- Tenant ingress and every native sender must still independently verify
  -- provider webhook/grant, recipient permission, policy and a leased job.
  -- This row lock only prevents a concurrent disconnect from committing
  -- ahead of an in-progress native queue allocation.
  PERFORM 1
    FROM public.ishikeit_account_connections c
    JOIN public.ishikeit_workspaces w
      ON w.workspace_id=c.workspace_id
   WHERE c.connection_id=NEW.connection_id
     AND c.workspace_id=NEW.workspace_id
     AND c.generation=NEW.connection_generation
     AND c.status='connected'
     AND c.activated_at IS NOT NULL
     AND w.state='active'
   FOR SHARE OF c,w;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Native outbox connection unavailable or stale'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$ishikeit$;

REVOKE ALL ON FUNCTION public.ishikeit_guard_native_outbox_write()
  FROM PUBLIC;
CREATE OR REPLACE TRIGGER ishikeit_native_outbox_write_fence
  BEFORE INSERT OR UPDATE OF workspace_id,connection_id,connection_generation
  ON public.outbox
  FOR EACH ROW EXECUTE FUNCTION public.ishikeit_guard_native_outbox_write();
COMMIT;
