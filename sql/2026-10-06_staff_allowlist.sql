-- ═══════════════════════════════════════════════════════════════════════════
-- Staff are a LIST, not "anyone signed in who isn't a client"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Found Oct 2026 while preparing two-step sign-in. Every staff policy since
-- sql/2026-08-31_portal_client_isolation.sql reads
--     using (not pi_is_portal_client())
-- i.e. staff = any `authenticated` session whose email is not in
-- pi_client_access. But the portal's email sign-in sends create_user: true
-- (so a newly granted client can sign in without being invited first), which
-- means ANYONE can type ANY email on client-portal.html, click the link in
-- their own inbox, and hold an authenticated session for an address that is
-- in no table at all. Not a client, so every staff policy let them in: every
-- project, every contact, every interaction, the report files, and even
-- insert into pi_client_access to grant themselves a project. The portal
-- screen would show "no access yet"; a raw REST call with that session's
-- token would not. Two-step sign-in does not close it either — any user can
-- enroll an authenticator on their own account.
--
-- The fix is positive: pi_staff holds the staff logins, pi_is_staff() reads
-- it, and ONE restrictive policy per table requires the caller to be staff
-- or a portal client. Restrictive policies AND with the existing permissive
-- ones, so no existing policy is rewritten and nothing a staff member or a
-- client can do today changes — only a session that is neither now gets
-- nothing. anon (token links) is untouched: the policy is for authenticated.
--
-- ── RUNNING IT ─────────────────────────────────────────────────────────────
-- The staff emails are NOT in this file (the repo is public). Add them in
-- the marked spot below before running. If pi_staff is still empty the file
-- stops with an error and changes nothing — an empty list would lock every
-- staff member out (recoverable from the SQL Editor, which bypasses RLS, but
-- confusing). New staff later:
--     insert into pi_staff (email) values ('name@example.com');
-- Removing someone: delete their row; their next request gets nothing.
-- Never add a client's email here, and never grant a staff email portal
-- access (see the warning on pi_is_portal_client in CLAUDE.md).
--
-- Rollback:
--   do $$ declare t text; begin
--     for t in select tablename from pg_policies where policyname = 'pi_staff_or_client' and schemaname = 'public'
--     loop execute format('drop policy pi_staff_or_client on public.%I', t); end loop; end $$;
--   drop policy if exists report_files_staff_or_client on storage.objects;

create table if not exists pi_staff (
  email     text primary key check (email = lower(trim(email)) and email <> ''),
  added_at  timestamptz not null default now(),
  note      text
);
alter table pi_staff enable row level security;
revoke all on pi_staff from anon, authenticated;
grant select on pi_staff to authenticated;

-- ▼▼▼ ADD THE STAFF LOGINS HERE (lower-case), then run the whole file ▼▼▼
-- insert into pi_staff (email) values
--   ('first@example.com'),
--   ('second@example.com')
-- on conflict do nothing;
-- ▲▲▲

create or replace function pi_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from pi_staff
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function pi_is_staff() to authenticated;

drop policy if exists pi_staff_read on pi_staff;
create policy pi_staff_read on pi_staff for select to authenticated
  using ((select pi_is_staff()));

do $$
declare t text;
begin
  -- In the test harness auth.users starts empty, so the guard only bites
  -- against a real project that has logins but no staff list.
  if not exists (select 1 from pi_staff) and exists (select 1 from auth.users) then
    raise exception 'pi_staff is empty — add the staff logins in the marked spot at the top of this file, then run it again. Nothing was changed.';
  end if;

  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'pi\_%' and c.relrowsecurity
  loop
    execute format('drop policy if exists pi_staff_or_client on public.%I', t);
    execute format($p$create policy pi_staff_or_client on public.%I as restrictive for all to authenticated
                      using ((select pi_is_staff()) or (select pi_is_portal_client()))
                      with check ((select pi_is_staff()) or (select pi_is_portal_client()))$p$, t);
  end loop;
end $$;

-- The final .docx files. Scoped to this bucket so it says nothing about any
-- other bucket in the project.
drop policy if exists report_files_staff_or_client on storage.objects;
create policy report_files_staff_or_client on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'report-files' or (select pi_is_staff()) or (select pi_is_portal_client()))
  with check (bucket_id <> 'report-files' or (select pi_is_staff()) or (select pi_is_portal_client()));

-- Verify: every pi_ table should list the policy, and pi_staff your logins.
--   select tablename from pg_policies where policyname = 'pi_staff_or_client' order by 1;
--   select email from pi_staff order by 1;

notify pgrst, 'reload schema';
