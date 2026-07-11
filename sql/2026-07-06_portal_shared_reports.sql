-- Client reporting redesign — Phase 1: shared PI reports in the client portal.
--
-- Adds a per-report "client_visible" flag so the consultant can choose which
-- archived PI reports appear in the client portal. The portal fetches archive
-- rows filtered by client_visible = true.
--
-- Idempotent — safe to run multiple times. Run in the Supabase SQL Editor.

-- ── The flag ────────────────────────────────────────────────────────────────
-- Defaults to false: nothing is exposed to clients until the consultant opts a
-- specific report in via the "Share with client" toggle in the Report Archive.
alter table pi_report_archive
  add column if not exists client_visible boolean not null default false;

-- ── Grants (the piece that bites if forgotten) ──────────────────────────────
-- SELECT: the portal reads shared reports (anon key).
-- UPDATE: the desktop "Share with client" toggle PATCHes client_visible (also
--   anon key). This was the missing grant — without UPDATE the toggle's write
--   is silently rejected, the desktop optimistically shows "Shared", but the DB
--   never changes and the portal finds nothing.
-- INSERT/DELETE: the app already archives (INSERT) and deletes (DELETE) reports;
--   re-asserted here idempotently.
grant select, insert, update, delete on pi_report_archive to anon;
grant select, insert, update, delete on pi_report_archive to authenticated;

-- ── Anon RLS read policy (the OTHER piece that bites if forgotten) ──────────
-- With RLS enabled and no anon policy, a GRANT alone still yields ZERO rows for
-- the anon role — Postgres lets anon touch the table but RLS filters every row
-- out (no error, just empty). The portal uses the anon key, so it needs an
-- explicit SELECT policy, exactly like the sibling portal tables got in
-- 2026-07-04_portal_links.sql. Scoped to projects that have an active portal
-- link. (The internal app reads the archive as the authenticated role, which is
-- why the desktop list works even without this — but the portal did not.)
do $$ begin
  if not exists (select 1 from pg_policies where policyname='anon_portal_read' and tablename='pi_report_archive') then
    create policy "anon_portal_read" on pi_report_archive
      for select to anon
      using (project_id::text in (select project_id::text from pi_portal_links));
  end if;
end $$;

-- Token-scoped, server-side isolation (so a tokenholder for project A can't read
-- project B) remains the separate hardening project with the multi-tenant work.
-- Portal-side, the shared-reports query additionally filters client_visible = true.
