-- Private, transactional, monotonic release-owner fencing for Ishikeit.
-- Not an external GitHub/Hostinger branch lock by itself: the actual
-- protected release controller MUST check this before EACH irreversible
-- release action, and branch/deploy protection must prevent bypass.
-- No production deployment or ownership is acquired by this migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS public.ishikeit_release_ownership (
  scope text PRIMARY KEY
    CHECK (scope ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  generation bigint NOT NULL CHECK (generation>0),
  holder_digest bytea
    CHECK (holder_digest IS NULL OR octet_length(holder_digest)=32),
  app_main_sha text NOT NULL CHECK (app_main_sha ~ '^[0-9a-f]{40}$'),
  db_main_sha text NOT NULL CHECK (db_main_sha ~ '^[0-9a-f]{40}$'),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ishikeit_release_ownership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ishikeit_release_ownership FROM PUBLIC;
DO $ishikeit$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON public.ishikeit_release_ownership FROM anon';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.ishikeit_release_ownership FROM authenticated';
  END IF;
END
$ishikeit$;
COMMIT;
