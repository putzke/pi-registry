-- pi_issue_interactions: close the last table open to the public key (Oct 2026).
--
-- Found by a live audit on 2026-10-20: this table (the links between an issue
-- and its interactions) still carried `anon_all` — FOR ALL TO anon USING (true)
-- — plus a full anon grant. Anyone holding the anon key (it is in
-- client-portal.html, which needs no login) could read, add, change or delete
-- these links on every project. The rows are id pairs only (no names), but
-- deleting them would silently take interactions off their issues. Nothing on
-- the portal reads this table; staff use it through their signed-in session.
--
-- Same shape as every other staff-only table: anon gets nothing, signed-in
-- staff get everything, a portal client gets nothing (the two old
-- `using (true)` authenticated policies let a client read every project's
-- links). The restrictive pi_staff_or_client rule stays as it is.
--
-- Idempotent. Paste on DEV first, then LIVE.

alter table public.pi_issue_interactions enable row level security;

drop policy if exists anon_all on public.pi_issue_interactions;
drop policy if exists auth_all on public.pi_issue_interactions;
drop policy if exists authenticated_all_pi_issue_interactions on public.pi_issue_interactions;
drop policy if exists pi_issue_interactions_staff_all on public.pi_issue_interactions;

revoke all on public.pi_issue_interactions from anon;
grant select, insert, update, delete on public.pi_issue_interactions to authenticated;

create policy pi_issue_interactions_staff_all on public.pi_issue_interactions
  for all to authenticated
  using (not public.pi_is_portal_client())
  with check (not public.pi_is_portal_client());

-- The restrictive staff-or-client rule (sql/2026-10-06_staff_allowlist.sql) is
-- already on this table in production; add it where it is missing (a fresh
-- database where RLS was off when that file ran).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='pi_issue_interactions' and policyname='pi_staff_or_client') then
    execute 'create policy pi_staff_or_client on public.pi_issue_interactions as restrictive
             for all to authenticated
             using ((select public.pi_is_staff()) or (select public.pi_is_portal_client()))
             with check ((select public.pi_is_staff()) or (select public.pi_is_portal_client()))';
  end if;
end $$;

-- Check (should list exactly two policies, neither naming anon, and no anon grant):
-- select policyname, roles, permissive from pg_policies where tablename='pi_issue_interactions';
-- select privilege_type from information_schema.role_table_grants
--   where grantee='anon' and table_name='pi_issue_interactions';
