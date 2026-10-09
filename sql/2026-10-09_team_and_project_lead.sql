-- Team list + a PI Lead on every project (Oct 2026).
--
-- pi_team_members is the firm's PI staff as PEOPLE: name, initials, title,
-- phone, and an email once one exists. It is NOT a login list — pi_staff
-- (sql/2026-10-06_staff_allowlist.sql) is still what lets someone sign in.
-- A new hire can be on the team (and lead projects) before they have an
-- address or an account.
--
-- Initials are the join key everywhere in the app (interactions.logged_by,
-- follow_up_assigned_to, and now pi_projects.lead), so they are unique,
-- case-insensitively. getLoggedBy() derives a signed-in user's initials from
-- their email prefix; when a member's email is filled in, their initials
-- should match that derivation so their own logs line up with their row.
--
-- pi_projects.lead holds the lead's initials (text, like logged_by).
-- pi_projects.lead_history is a jsonb list of {from, to, date, by}, the same
-- shape as phase_history, appended by the app whenever the lead changes.
--
-- STAFF-ONLY, like pi_closeouts: anon gets nothing, portal clients get
-- nothing. The portal reads pi_projects with explicit column lists, so the
-- new project columns do not reach a client.
--
-- Idempotent.

create table if not exists pi_team_members (
  id          bigint generated always as identity primary key,
  name        text    not null,
  initials    text    not null,
  title       text,
  phone       text,
  email       text,
  active      boolean not null default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  updated_by  text
);

create unique index if not exists pi_team_members_initials_uniq
  on pi_team_members (upper(trim(initials)));
create unique index if not exists pi_team_members_email_uniq
  on pi_team_members (lower(trim(email)))
  where email is not null and trim(email) <> '';

alter table pi_team_members enable row level security;

drop policy if exists pi_team_members_staff_all on pi_team_members;
create policy pi_team_members_staff_all on pi_team_members
  for all to authenticated
  using (not pi_is_portal_client())
  with check (not pi_is_portal_client());

grant select, insert, update, delete on pi_team_members to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on pi_team_members from anon;

-- The staff-or-client rule every other pi_ table carries (if that migration
-- has been run).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'pi_is_staff') then
    execute 'drop policy if exists pi_staff_or_client on public.pi_team_members';
    execute $p$create policy pi_staff_or_client on public.pi_team_members as restrictive for all to authenticated
      using ((select pi_is_staff()) or (select pi_is_portal_client()))
      with check ((select pi_is_staff()) or (select pi_is_portal_client()))$p$;
  end if;
end $$;

alter table pi_projects add column if not exists lead text;
alter table pi_projects add column if not exists lead_history jsonb default '[]'::jsonb;

-- ── Verify (run after) ───────────────────────────────────────────────────────
--   select policyname, permissive from pg_policies where tablename = 'pi_team_members';
-- Expect pi_team_members_staff_all (PERMISSIVE) and pi_staff_or_client (RESTRICTIVE).
--   select has_table_privilege('anon', 'pi_team_members', 'SELECT');
-- Expect false.
--   select column_name from information_schema.columns
--    where table_name = 'pi_projects' and column_name in ('lead','lead_history');
-- Expect two rows.
