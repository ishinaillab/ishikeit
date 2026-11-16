-- Priority 3 dormant outbound fence. Expand only: existing legacy dispatch
-- and published messages remain unchanged. A future native tenant sender must
-- use an authenticated, leased, current-generation admission immediately
-- before its provider call. Any attempted send is conservatively uncertain
-- during disconnect until provider-specific reconciliation proves its outcome.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

ALTER TABLE public.outbox
  ADD COLUMN IF NOT EXISTS tenant_send_started_at timestamptz;

ALTER TABLE public.outbox
  ADD CONSTRAINT ishikeit_outbox_tenant_send_shape_ck CHECK (
    tenant_send_started_at IS NULL
    OR (workspace_id IS NOT NULL AND connection_id IS NOT NULL
        AND connection_generation IS NOT NULL)
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS ishikeit_outbox_tenant_send_unresolved_idx
  ON public.outbox(connection_id,workspace_id,created_at)
  WHERE tenant_send_started_at IS NOT NULL
    AND published_at IS NULL;

-- RLS and grants were already closed by the original tenant provenance
-- migration. No new permissions or default/legacy sender behavior are added.
COMMIT;
