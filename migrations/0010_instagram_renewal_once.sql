-- Ephemeral, operator-only one-time Instagram renewal proof claim.
-- Must be removed after the single verified production attempt.
-- Contains no tokens, provider messages or customer data.
CREATE TABLE public.ishikeit_instagram_renewal_once (
  run_id text PRIMARY KEY,
  outcome text NOT NULL CHECK (outcome IN ('claimed','succeeded','failed')),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT run_id_bounded CHECK (char_length(run_id) BETWEEN 20 AND 100)
);
ALTER TABLE public.ishikeit_instagram_renewal_once ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ishikeit_instagram_renewal_once FROM PUBLIC, anon, authenticated;
