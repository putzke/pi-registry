-- Outreach log (Part B, step 2b). See CLAUDE.md "Outreach log".
--
-- A dated record of outreach ACTIONS (press release, newsletter, website
-- update, 511 alert, social post, news coverage, trucking/industry
-- publication, agency/partner coordination, other), grouped by optional
-- campaigns, with dated engagement READINGS taken from the link, a screenshot
-- or typed. Not interactions: a press release is not a conversation with a
-- stakeholder, and nothing here is counted as one.
--
-- pi_outreach_campaigns  a named push on one project ("I-84 closures, Oct 2026").
-- pi_outreach_actions    one row per action: date, type, who did it, link,
--                        title, outlet, note.
-- pi_outreach_readings   counts on one date (reactions / comments / shares /
--                        views) and where they came from: 'automatic' (read
--                        from the link), 'screenshot', or 'typed'. Readings are
--                        kept, never overwritten, so a post's numbers can be
--                        shown as of the day they were read.
--
-- STAFF-ONLY (the closeouts / hotline pattern): the portal reads nothing here
-- yet. Idempotent.

create table if not exists pi_outreach_campaigns (
  id          bigint generated always as identity primary key,
  project_id  text   not null,
  name        text   not null,
  notes       text,
  created_by  text,
  created_at  timestamptz default now()
);
create unique index if not exists pi_outreach_campaigns_name_uniq
  on pi_outreach_campaigns (project_id, lower(trim(name)));

create table if not exists pi_outreach_actions (
  id           bigint generated always as identity primary key,
  project_id   text   not null,
  campaign_id  bigint references pi_outreach_campaigns(id) on delete set null,
  action_date  date   not null,
  action_type  text   not null,
  party        text   not null default 'PI team',  -- 'PI team' | 'Client' (shown as the project's client) | 'Media & third party'
  url          text,
  title        text   not null,
  outlet       text,
  author       text,
  description  text,
  note         text,
  delivery     text,                                -- how it went out: Hand-delivered | Mailed | Emailed | Posted online | Posted on site
  reach        integer check (reach >= 0),          -- how many it reached: doors, mailers, recipients
  logged_by    text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  updated_by   text
);
create index if not exists pi_outreach_actions_proj_idx on pi_outreach_actions (project_id, action_date);

create table if not exists pi_outreach_readings (
  id         bigint generated always as identity primary key,
  action_id  bigint not null references pi_outreach_actions(id) on delete cascade,
  read_on    date   not null,
  reactions  integer check (reactions >= 0),
  comments   integer check (comments >= 0),
  shares     integer check (shares >= 0),
  views      integer check (views >= 0),
  source     text   not null default 'typed' check (source in ('automatic','screenshot','typed')),
  logged_by  text,
  created_at timestamptz default now()
);
create index if not exists pi_outreach_readings_action_idx on pi_outreach_readings (action_id, read_on);

-- ── Policies: staff only ─────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['pi_outreach_campaigns','pi_outreach_actions','pi_outreach_readings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                      using (not pi_is_portal_client()) with check (not pi_is_portal_client())$p$,
                   t || '_staff_all', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    if exists (select 1 from pg_proc where proname = 'pi_is_staff') then
      execute format('drop policy if exists pi_staff_or_client on public.%I', t);
      execute format($p$create policy pi_staff_or_client on public.%I as restrictive for all to authenticated
                        using ((select pi_is_staff()) or (select pi_is_portal_client()))
                        with check ((select pi_is_staff()) or (select pi_is_portal_client()))$p$, t);
    end if;
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated;

-- Verify (expect 3 tables × 2 policies, rls on):
-- select tablename, policyname, permissive from pg_policies
--  where tablename like 'pi_outreach_%' order by 1, 2;

-- "UDOT" became "Client" (Oct 2026) so the log fits any client; the app shows
-- the project's own client name. Renames rows saved on DEV before the change.
update public.pi_outreach_actions set party = 'Client' where party = 'UDOT';

-- Outreach vs events (2026-10-22): a flyer, mailer or email blast is outreach,
-- with how it went out and how many it reached. For a database where this file
-- already ran before those columns existed (DEV):
alter table public.pi_outreach_actions add column if not exists delivery text;
alter table public.pi_outreach_actions add column if not exists reach integer check (reach >= 0);
update public.pi_outreach_actions set action_type = 'Shared with a partner to distribute' where action_type = 'Agency/partner coordination';
