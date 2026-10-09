-- The project's PI Lead as the client's "Your PI contact" (Oct 2026).
--
-- pi_team_members is staff-only (sql/2026-10-09_team_and_project_lead.sql),
-- so the portal cannot read it. This function hands back ONE row — the lead
-- of ONE project — with only the four fields a client card shows, and only
-- to a caller who can already see that project:
--   * a token-link visitor (anon) holding that project's link
--     (pi_portal_project_ids() reads the x-portal-token header), or
--   * a signed-in portal client granted that project in pi_client_access.
-- Anyone else gets no row. Nothing about other staff, other projects or the
-- lead history is reachable through it.
--
-- show_on_portal lets a member be kept off client screens (default on). An
-- inactive lead is not shown either — they have left the project's team.
--
-- Idempotent.

alter table pi_team_members add column if not exists show_on_portal boolean not null default true;

create or replace function pi_portal_contact(p_project bigint)
returns table(name text, title text, phone text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select m.name, nullif(trim(m.title), ''), nullif(trim(m.phone), ''), nullif(trim(m.email), '')
    from pi_projects p
    join pi_team_members m on upper(trim(m.initials)) = upper(trim(p.lead))
   where p.id = p_project
     and m.active and m.show_on_portal
     and (
       p_project::text in (select project_id from pi_portal_project_ids())
       or exists (select 1 from pi_client_access a
                   where a.project_id::text = p_project::text
                     and lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
     )
   limit 1;
$$;

revoke all on function pi_portal_contact(bigint) from public;
grant execute on function pi_portal_contact(bigint) to anon, authenticated;

notify pgrst, 'reload schema';

-- ── Verify (run after) ───────────────────────────────────────────────────────
-- The SQL Editor sends no portal token and no client JWT, so as anon:
--   set role anon; select * from pi_portal_contact(1); reset role;   -- expect 0 rows
-- Then open a real token link: the Overview shows "Your PI contact" once the
-- project has an active PI Lead.
