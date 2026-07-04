-- ── Portal Links — shareable token-based client access ───────────────────────
-- One row per project; the UUID token IS the credential (unguessable).
-- Token validation is client-side; DB policy gates which projects anon can read.

create table if not exists pi_portal_links (
  token      uuid    primary key default gen_random_uuid(),
  project_id bigint  not null references pi_projects(id) on delete cascade,
  label      text,
  created_at timestamptz default now()
);

-- One link per project
create unique index if not exists pi_portal_links_proj_uniq
  on pi_portal_links(project_id);

alter table pi_portal_links enable row level security;

-- Authenticated PMs can create / read / delete links
create policy "auth_all" on pi_portal_links
  for all to authenticated using (true) with check (true);

-- Anon can read (UUID is unguessable; token validated client-side)
create policy "anon_select" on pi_portal_links
  for select to anon using (true);

grant select                     on pi_portal_links to anon;
grant select, insert, delete     on pi_portal_links to authenticated;

-- ── Anon read policies on portal data tables ──────────────────────────────────
-- Anon can only read rows for projects that have an active portal link.
-- pi_deliverables.project_id is TEXT; all others are BIGINT.

create policy "anon_portal_read" on pi_projects
  for select to anon
  using (id in (select project_id from pi_portal_links));

create policy "anon_portal_read" on pi_deliverables
  for select to anon
  using (project_id::bigint in (select project_id from pi_portal_links));

create policy "anon_portal_read" on pi_issues
  for select to anon
  using (project_id in (select project_id from pi_portal_links));

create policy "anon_portal_read" on pi_commitments
  for select to anon
  using (project_id in (select project_id from pi_portal_links));

create policy "anon_portal_read" on pi_comment_periods
  for select to anon
  using (project_id in (select project_id from pi_portal_links));

create policy "anon_portal_read" on pi_public_comments
  for select to anon
  using (project_id in (select project_id from pi_portal_links));

create policy "anon_portal_read" on pi_meetings
  for select to anon
  using (project_id in (select project_id from pi_portal_links));

create policy "anon_portal_read" on pi_interactions
  for select to anon
  using (project_id in (select project_id from pi_portal_links));

create policy "anon_portal_read" on pi_tribal_consultations
  for select to anon
  using (project_id in (select project_id from pi_portal_links));

grant select on pi_projects             to anon;
grant select on pi_deliverables         to anon;
grant select on pi_issues               to anon;
grant select on pi_commitments          to anon;
grant select on pi_comment_periods      to anon;
grant select on pi_public_comments      to anon;
grant select on pi_meetings             to anon;
grant select on pi_interactions         to anon;
grant select on pi_tribal_consultations to anon;
