-- Follow-up to sql/2026-08-31_portal_client_isolation.sql.
--
-- Running that migration's own verify query against the live database turned
-- up eight policies that exist in production but were NEVER in any file in
-- this repo — "client viewer can read own project <table>" on
-- pi_comment_periods, pi_commitments, pi_interactions, pi_issues,
-- pi_meetings, pi_projects, pi_public_comments, and pi_tribal_consultations.
-- They were presumably added directly in the Supabase SQL editor at some
-- point, extending sql/2026-07-02_client_portal_step1.sql's per-table
-- pattern (pi_deliverables only, in that file) to the rest of
-- sql/2026-07-04_portal_links.sql's nine tables — but never written back to
-- a migration, so nothing in this codebase's history or this migration's own
-- audit could see them. The isolation migration's `_pi_drop_blanket_policies`
-- helper correctly left them alone: it only removes a bare `qual = 'true'`,
-- and these have a real (if broken) condition.
--
-- WHY THEY HAVE TO GO, not just be left as harmless duplicates:
--   1. Role `{public}` means EVERY role, anon included — not `authenticated`
--      the way the rest of this migration's client-facing policies are
--      scoped. A `public` policy is the same "stays open no matter what else
--      is added" problem sql/2026-08-31_portal_client_isolation.sql's own
--      header explains RLS policies being OR'd together causes.
--   2. The condition (`pi_client_access.user_id = auth.uid()`) is dead ONLY
--      because every grant's `user_id` is NULL today (the same email-only
--      provisioning gap documented in CLAUDE.md and in the isolation
--      migration). If `user_id` is ever backfilled on any row — a plausible
--      future fix, not a hypothetical — these eight policies reactivate
--      instantly, bypassing pi_is_portal_client() entirely and (worst case)
--      granting anon access via the same JWT-`sub`-is-null coincidence that
--      keeps auth.uid() null for an unauthenticated caller too.
--   3. pi_tribal_consultations is the one that matters most: this migration
--      deliberately made it staff-only, full stop, because tribal
--      consultation is a government-to-government process too sensitive for
--      a half-validated client-facing surface (see CLAUDE.md). This leftover
--      policy is the one thing standing between that decision and a client
--      reading it the moment user_id stops being null.
--
-- Confirmed inert before dropping (their WHERE clause matches nothing today)
-- — this removes latent risk, it does not change any current behavior.
--
-- Idempotent — safe to run more than once. Run in the Supabase SQL Editor
-- immediately after sql/2026-08-31_portal_client_isolation.sql.

drop policy if exists "client viewer can read own project comment periods" on pi_comment_periods;
drop policy if exists "client viewer can read own project commitments" on pi_commitments;
drop policy if exists "client viewer can read own project interactions" on pi_interactions;
drop policy if exists "client viewer can read own project issues" on pi_issues;
drop policy if exists "client viewer can read own project meetings" on pi_meetings;
drop policy if exists "client viewer can read own project info" on pi_projects;
drop policy if exists "client viewer can read own project public comments" on pi_public_comments;
drop policy if exists "client viewer can read own project tribal" on pi_tribal_consultations;

-- ── Verify (run after) ───────────────────────────────────────────────────────
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public' and roles::text[] @> array['public']::text[];
-- Should return zero rows — nothing left in this table list should apply to
-- `public` (every legitimate policy names anon or authenticated explicitly).
