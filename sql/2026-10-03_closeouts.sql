-- PI Close-Out reports — step 1: the intake.
--
-- One row per close-out (not per project): a project can have a "Final"
-- close-out and, where the PI scope calls for it, an interim one (17894's scope
-- listed a "year-1 and final close-out PI report").
--
-- report_type decides which intake sections and report sections apply.
-- 'udot-construction' (UDOT Construction-Phase PI Close-Out) is the only type
-- today. A ROW, NEPA/EA or study close-out becomes another type value with its
-- own section list in index.html's CLOSEOUT_TYPES — no schema change.
--
-- intake is jsonb because the field set differs by type and holds lists (news
-- links, social posts, newsletter editions, visit readings, per-deliverable
-- evidence wording). Nothing here is counted from the project — counts are
-- computed live from the project's own tables when the report is drafted, so
-- the intake only ever holds what COMPASS cannot know.
--
-- STAFF-ONLY, like pi_tribal_consultations. The intake carries internal
-- narrative pointers ("concerns of note", who complained about what) and is a
-- working draft, never a client-facing record — the portal has no reason to
-- read it, so anon gets no grant at all and there is no client policy.
--
-- Idempotent.

create table if not exists pi_closeouts (
  id          bigint generated always as identity primary key,
  project_id  bigint not null,
  report_type text   not null default 'udot-construction',
  label       text   not null default 'Final',
  intake      jsonb  not null default '{}'::jsonb,
  created_at  timestamptz default now(),
  created_by  text,
  updated_at  timestamptz default now(),
  updated_by  text
);

create index if not exists pi_closeouts_project_idx on pi_closeouts (project_id);

alter table pi_closeouts enable row level security;

drop policy if exists pi_closeouts_staff_all on pi_closeouts;
create policy pi_closeouts_staff_all on pi_closeouts
  for all to authenticated
  using (not pi_is_portal_client())
  with check (not pi_is_portal_client());

grant select, insert, update, delete on pi_closeouts to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- Explicit, not just "never granted": a table created from the Supabase
-- dashboard is auto-granted to anon, and the test harness mimics that.
revoke all on pi_closeouts from anon;

-- ── Verify (run after) ───────────────────────────────────────────────────────
--   select policyname, roles from pg_policies where tablename = 'pi_closeouts';
-- Expect one row: pi_closeouts_staff_all, {authenticated}.
--   select has_table_privilege('anon', 'pi_closeouts', 'SELECT');
-- Expect false.
