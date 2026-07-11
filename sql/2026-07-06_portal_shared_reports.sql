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

-- ── Grant (the piece that bites if forgotten) ───────────────────────────────
-- The internal app already reads pi_report_archive with the anon key, so anon
-- access exists; this re-asserts it idempotently so the portal's anon read of
-- shared reports is guaranteed. GRANT is checked before RLS — without it you get
-- "permission denied for table pi_report_archive" (cf. the pi_client_summaries
-- incident, sql/2026-07-06_client_summaries_grant_fix.sql).
grant select on pi_report_archive to anon;
grant select on pi_report_archive to authenticated;

-- NOTE: RLS is intentionally left as-is. The internal app relies on reading ALL
-- archive rows via anon; enabling RLS here with only a project-scoped policy
-- would break that. Token-scoped, server-side isolation for the portal is the
-- separate hardening project (tracked with the multi-tenant / org_id work).
-- Portal-side, the shared-reports query filters client_visible = true.
