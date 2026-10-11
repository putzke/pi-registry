-- Project hotlines (Twilio voicemail → Hotline inbox → logged interaction).
-- Design agreed with Jeff 2026-10-11; see CLAUDE.md "Project hotlines".
--
-- pi_hotlines           one row per phone number. Greeting (computer voice text
--                       or an uploaded recording), Spanish option on/off, and
--                       a project for a single-project number (no menu).
-- pi_hotline_extensions menu choices on a multi-project number: a digit (1-8)
--                       sends the caller to a project. 9 is the Spanish
--                       option and 0 / no choice is the hotline's general
--                       mailbox, so neither can be an extension.
-- pi_hotline_messages   one row per voicemail. PENDING until a staff member
--                       logs it (an interaction is created) or dismisses it
--                       (hang-up, spam, duplicate). Nothing reaches a report
--                       until it is logged — the locked rule that interactions
--                       are entered deliberately.
-- pi_interactions.related_to  the interaction a call came out of, so a
--                       voicemail, the callback and the calls that follow
--                       read as one thread. Each still counts once.
--
-- The Twilio receiver (supabase/functions/hotline) writes messages with the
-- service role, which bypasses RLS. Everything here is STAFF-ONLY: anon and
-- portal clients get nothing — recordings and caller numbers are private.
--
-- Recordings live in the private `hotline-audio` bucket (messages/<id>.mp3,
-- greetings/<hotline>-<lang>.mp3), deleted 90 days after the message is logged
-- or dismissed (audio_purge_after). The transcript and summary stay.
--
-- Idempotent.

create table if not exists pi_hotlines (
  id                  bigint generated always as identity primary key,
  name                text    not null,
  phone_number        text    not null,          -- E.164, e.g. +18015550123
  project_id          text,                      -- single-project number (no menu)
  greeting_mode       text    not null default 'voice',   -- 'voice' | 'recording'
  greeting_text       text,
  greeting_audio_path text,
  spanish_enabled     boolean not null default true,
  spanish_greeting_text       text,
  spanish_greeting_audio_path text,
  active              boolean not null default true,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  updated_by          text
);
create unique index if not exists pi_hotlines_number_uniq on pi_hotlines (phone_number);

create table if not exists pi_hotline_extensions (
  id          bigint generated always as identity primary key,
  hotline_id  bigint  not null references pi_hotlines(id) on delete cascade,
  digit       text    not null check (digit ~ '^[1-8]$'),
  project_id  text    not null,
  label       text,                              -- what the menu says: "the 400 North project"
  label_es    text,
  active      boolean not null default true,
  created_at  timestamptz default now()
);
create unique index if not exists pi_hotline_ext_digit_uniq
  on pi_hotline_extensions (hotline_id, digit) where active;

create table if not exists pi_hotline_messages (
  id                 bigint generated always as identity primary key,
  hotline_id         bigint references pi_hotlines(id) on delete set null,
  extension_digit    text,
  project_id         text,                       -- null = the hotline's general mailbox
  language           text not null default 'en', -- 'en' | 'es'
  caller_number      text,
  call_sid           text,
  recording_sid      text,
  recording_path     text,                       -- hotline-audio bucket
  recording_seconds  integer,
  transcript         text,
  transcript_status  text not null default 'pending',  -- pending | done | failed | none
  status             text not null default 'pending',  -- pending | logged | dismissed
  assigned_to        text,                       -- initials, like follow_up_assigned_to
  assigned_by        text,
  assigned_at        timestamptz,
  received_at        timestamptz not null default now(),
  logged_interaction_id bigint references pi_interactions(id) on delete set null,
  closed_at          timestamptz,                -- logged or dismissed
  closed_by          text,
  dismiss_reason     text,
  audio_purge_after  timestamptz,
  audio_deleted_at   timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
-- Not partial: the receiver upserts on call_sid (on_conflict needs a plain
-- unique index). Nulls stay distinct, so rows without one never collide.
create unique index if not exists pi_hotline_messages_call_uniq
  on pi_hotline_messages (call_sid);
create index if not exists pi_hotline_messages_status_idx on pi_hotline_messages (status);

alter table pi_interactions add column if not exists related_to bigint
  references pi_interactions(id) on delete set null;

-- ── Policies: staff only ─────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['pi_hotlines','pi_hotline_extensions','pi_hotline_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                      using (not pi_is_portal_client()) with check (not pi_is_portal_client())$p$,
                   t || '_staff_all', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    if exists (select 1 from pg_proc where proname = 'pi_is_staff') then
      execute format('drop policy if exists pi_staff_or_client on public.%I', t);
      execute format($p$create policy pi_staff_or_client on public.%I as restrictive for all to authenticated
                        using ((select pi_is_staff()) or (select pi_is_portal_client()))
                        with check ((select pi_is_staff()) or (select pi_is_portal_client()))$p$, t);
    end if;
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated;

-- ── Storage: private bucket, staff only ──────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('hotline-audio', 'hotline-audio', false)
on conflict (id) do nothing;

drop policy if exists hotline_audio_staff_all on storage.objects;
create policy hotline_audio_staff_all on storage.objects
  for all to authenticated
  using (bucket_id = 'hotline-audio' and (select pi_is_staff()))
  with check (bucket_id = 'hotline-audio' and (select pi_is_staff()));

-- ── Verify (run after) ───────────────────────────────────────────────────────
--   select tablename, policyname, permissive from pg_policies
--    where tablename like 'pi_hotline%' order by 1, 2;
-- Expect *_staff_all (PERMISSIVE) and pi_staff_or_client (RESTRICTIVE) on all three.
--   select has_table_privilege('anon', 'pi_hotline_messages', 'SELECT');   -- false
--   select column_name from information_schema.columns
--    where table_name = 'pi_interactions' and column_name = 'related_to';  -- one row
--   select id, public from storage.buckets where id = 'hotline-audio';     -- false
