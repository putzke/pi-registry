-- Client Portal — Step 1: access mapping table + first curated RLS policy
--
-- SAFE TO RUN: this is additive only. It does not modify, drop, or replace
-- any existing table or policy. Row Level Security policies in Postgres are
-- OR'd together — a new policy only ever grants additional access, it can
-- never narrow what an existing policy already allows. The internal app's
-- anon-key access to pi_deliverables (and everything else) is unaffected.
--
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query).
-- There is no server-side automation wired up for this yet — access grants
-- (inserting rows into pi_client_access) are done by hand for now, e.g.:
--
--   insert into pi_client_access (user_id, project_id)
--   values ('<auth.users.id of invited client>', <pi_projects.id>);
--
-- (Invite the client first via Supabase Authentication > Users > Invite,
-- then copy their generated user id into the insert above.)

-- ── Access mapping table ────────────────────────────────────────────────
-- Maps a Supabase Auth user (a client contact) to the one or more projects
-- they're allowed to view. org_id is reserved for future multi-tenant use
-- and intentionally unused for now — see CLAUDE.md roadmap.
create table if not exists pi_client_access (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id bigint not null references pi_projects(id) on delete cascade,
  org_id bigint,
  created_at timestamptz not null default now(),
  unique (user_id, project_id)
);

create index if not exists idx_pi_client_access_user on pi_client_access(user_id);

alter table pi_client_access enable row level security;

-- A client user can read their own access-grant rows (needed so the future
-- client portal can ask "which project(s) am I scoped to?" after login).
-- No insert/update/delete policy is defined for this role on purpose —
-- clients can never grant themselves access to anything; only an admin
-- using the Supabase service-role key (which bypasses RLS) can do that.
create policy "client can read own access grants"
  on pi_client_access for select
  using (auth.uid() = user_id);

-- ── First curated view: deliverable progress ────────────────────────────
-- Additive policy on the existing pi_deliverables table: an authenticated
-- client user can read deliverable rows for any project they've been
-- granted access to via pi_client_access. Nothing else about
-- pi_deliverables changes.
create policy "client viewer can read own project deliverables"
  on pi_deliverables for select
  using (
    project_id in (
      select project_id from pi_client_access where user_id = auth.uid()
    )
  );
