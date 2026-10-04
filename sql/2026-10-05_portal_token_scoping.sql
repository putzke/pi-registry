-- ═══════════════════════════════════════════════════════════════════════════
-- Portal token links: scope every read to the link the visitor ACTUALLY HOLDS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Closes the residual gap documented in sql/2026-08-31_portal_client_isolation.sql.
-- Until now every token-link (anon) policy asked "does this project have SOME
-- active portal link?" — pi_portal_project_ids() returned every linked
-- project. So anyone holding the public anon key (it is in the page source)
-- could read ANY linked project by asking for its id, and project ids are
-- small sequential integers: no leaked link was needed, only a guess.
--
-- Now pi_portal_project_ids() returns only the project of the token the
-- request itself carries, in an `x-portal-token` header that
-- client-portal.html sends on every token-mode request. PostgREST and the
-- Storage API expose request headers to SQL as the `request.headers` setting
-- (lower-cased names). No header, an unknown token or a revoked one (its
-- pi_portal_links row is deleted on revoke) → no project → no rows.
--
-- Every anon policy already funnels through this one function — every
-- anon_portal_read policy from the isolation migration (pi_projects and the
-- other portal tables, pi_parcels, pi_parcel_owners, pi_client_summaries,
-- pi_report_archive) and the report-files Storage policy — so redefining it
-- tightens all of them at once. No policy is rewritten; the function's signature is unchanged.
--
-- NOT affected: staff (authenticated, their own policies), and OTP-logged-in
-- clients (authenticated, scoped by pi_client_access). Only anon.
--
-- ── ORDER MATTERS ──────────────────────────────────────────────────────────
--   1. Run sql/probes/2026-10-05_portal_header_probe.sql and confirm Supabase
--      passes the header through (REST and Storage) and CORS allows it.
--   2. Deploy the client-portal.html that sends x-portal-token (pushed to
--      main). Sending an extra header to the old database is harmless.
--   3. THEN run this file. Run before step 2 and every token link would load
--      an empty portal until the new page is live.
--
-- Rollback (restores the previous "any linked project" behaviour exactly):
--   create or replace function pi_portal_project_ids()
--   returns table(project_id text) language sql stable security definer
--   set search_path = public as $$ select project_id::text from pi_portal_links; $$;

create or replace function pi_portal_project_ids()
returns table(project_id text)
language sql
stable
security definer
set search_path = public
as $$
  -- Compared as text so a malformed header can never raise a uuid cast
  -- error inside someone else's policy check; it simply matches nothing.
  select l.project_id::text
    from pi_portal_links l
   where l.token::text = lower(trim(coalesce(
           nullif(current_setting('request.headers', true), '')::json ->> 'x-portal-token',
           '')));
$$;

grant execute on function pi_portal_project_ids() to anon, authenticated;

notify pgrst, 'reload schema';

-- ── Verify (run after, in the SQL Editor) ────────────────────────────────
-- The SQL Editor sends no request headers, so as anon it must now see
-- nothing at all, where before it saw every linked project:
--
--   set role anon;
--   select count(*) as linked_projects_visible_to_a_headerless_anon
--     from pi_portal_project_ids();          -- expect 0
--   select count(*) from pi_projects;       -- expect 0
--   reset role;
--
-- Then open a real portal link in a private window: the project loads, and a
-- shared report's "Download report (.docx)" works.
