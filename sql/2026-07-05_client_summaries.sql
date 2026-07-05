-- Client Portal Summary table
-- Stores consultant-approved AI summaries published to the client portal.
-- Each row is one published snapshot; latest row per project is the active summary.

create table if not exists pi_client_summaries (
  id              bigint generated always as identity primary key,
  project_id      bigint not null references pi_projects(id) on delete cascade,
  content_recent  text,
  content_full    text,
  period_start    date,
  period_end      date,
  published_at    timestamptz not null default now(),
  published_by    text
);

create index if not exists pi_client_summaries_project_id on pi_client_summaries(project_id);

-- RLS: anon key can read and insert (same policy pattern as other pi_ tables)
alter table pi_client_summaries enable row level security;

create policy "anon read pi_client_summaries"
  on pi_client_summaries for select using (true);

create policy "anon insert pi_client_summaries"
  on pi_client_summaries for insert with check (true);

create policy "anon update pi_client_summaries"
  on pi_client_summaries for update using (true);

create policy "anon delete pi_client_summaries"
  on pi_client_summaries for delete using (true);
