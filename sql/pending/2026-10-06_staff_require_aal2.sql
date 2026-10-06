-- ═══════════════════════════════════════════════════════════════════════════
-- Require two-step sign-in for staff, in the database
-- ═══════════════════════════════════════════════════════════════════════════
--
-- NOT YET RUN, deliberately — it sits in sql/pending/ so the test harness
-- does not apply it either (test 66 applies it inside a rolled-back
-- transaction to prove it). Run it only when ALL of these are true:
--   1. sql/2026-10-06_staff_allowlist.sql has been run (this replaces the
--      policy that file creates).
--   2. Every login in pi_staff has set up Microsoft Authenticator. Check:
--        select s.email, count(f.id) filter (where f.status = 'verified') as factors
--          from pi_staff s left join auth.users u on lower(u.email) = s.email
--          left join auth.mfa_factors f on f.user_id = u.id
--         group by s.email order by 1;
--      Anyone at 0 would see empty lists the moment this runs.
--   3. MFA_REQUIRED is set to true in index.html, mobile.html and
--      importer.html and pushed, so the apps walk a user without a factor
--      through set-up instead of opening onto empty lists.
--
-- What it does: the one restrictive policy per table becomes
--     portal client  OR  (staff AND this session is aal2)
-- A password-only session (aal1) gets nothing back; the code step upgrades
-- it to aal2. The apps cannot skip this — it is the database deciding.
-- Portal clients (email link) and token links (anon) are unaffected.
--
-- A session already open when this runs stays aal1 until that person signs
-- in again, so tell staff to sign out and back in.
--
-- Lost phone: an admin removes the factor in the SQL Editor, the user signs
-- in with the password (lists empty until set-up) and sets up again —
--     delete from auth.mfa_factors
--      where user_id = (select id from auth.users where lower(email) = 'name@example.com');
--
-- Rollback = re-run sql/2026-10-06_staff_allowlist.sql (same policy name,
-- without the aal2 condition).

do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'pi\_%' and c.relrowsecurity
  loop
    execute format('drop policy if exists pi_staff_or_client on public.%I', t);
    execute format($p$create policy pi_staff_or_client on public.%I as restrictive for all to authenticated
                      using ((select pi_is_portal_client()) or ((select pi_is_staff()) and (select auth.jwt() ->> 'aal') = 'aal2'))
                      with check ((select pi_is_portal_client()) or ((select pi_is_staff()) and (select auth.jwt() ->> 'aal') = 'aal2'))$p$, t);
  end loop;
end $$;

drop policy if exists report_files_staff_or_client on storage.objects;
create policy report_files_staff_or_client on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'report-files' or (select pi_is_portal_client()) or ((select pi_is_staff()) and (select auth.jwt() ->> 'aal') = 'aal2'))
  with check (bucket_id <> 'report-files' or (select pi_is_portal_client()) or ((select pi_is_staff()) and (select auth.jwt() ->> 'aal') = 'aal2'));

notify pgrst, 'reload schema';
