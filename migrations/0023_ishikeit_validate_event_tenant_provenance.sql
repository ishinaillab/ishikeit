-- #230: finish validating the previously deployed nullable tenant provenance
-- constraints added by 0012. Existing legacy rows retain NULL ownership.
-- PostgreSQL 17 VALIDATE CONSTRAINT uses SHARE UPDATE EXCLUSIVE, permits normal
-- application reads/writes, and does not rewrite or backfill customer data.
-- This is NOT tenant-aware ingress, dispatch or provider account cutover.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '25s';

ALTER TABLE public.inbound_events
  VALIDATE CONSTRAINT ishikeit_inbound_tenant_shape_ck;
ALTER TABLE public.inbound_events
  VALIDATE CONSTRAINT ishikeit_inbound_workspace_fk;
ALTER TABLE public.inbound_events
  VALIDATE CONSTRAINT ishikeit_inbound_connection_fk;

ALTER TABLE public.outbox
  VALIDATE CONSTRAINT ishikeit_outbox_tenant_shape_ck;
ALTER TABLE public.outbox
  VALIDATE CONSTRAINT ishikeit_outbox_workspace_fk;
ALTER TABLE public.outbox
  VALIDATE CONSTRAINT ishikeit_outbox_connection_fk;
COMMIT;
