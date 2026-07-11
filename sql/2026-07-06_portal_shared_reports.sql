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

-- NOTE: RLS is intentionally left as-is. The internal app relies on reading ALL
-- archive rows via anon; enabling RLS here with only a project-scoped policy
-- would break that. Token-scoped, server-side isolation for the portal is the
-- separate hardening project (tracked with the multi-tenant / org_id work).
-- Portal-side, the shared-reports query filters client_visible = true.
