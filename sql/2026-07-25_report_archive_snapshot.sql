-- Archived reports: store a FROZEN, self-contained snapshot.
--
-- Problem: pi_report_archive stored only the narrative (title/period/section
-- text). The auto-populated data — interaction log tables, deliverable status,
-- issues, events — plus the "Distributed to" recipient list were computed at
-- render time from LIVE project data and never captured. So the desktop Archive
-- viewer and the client portal could only show a "data snapshot" placeholder
-- where the tables belonged, and the archived record did not match the .docx
-- that was actually sent to the client.
--
-- Fix: capture everything the report rendered at archive time into `snapshot`.
-- An archived report is a point-in-time compliance record — it must NOT be
-- recomputed from current data later, or a report sent months ago would
-- silently change (different interaction counts than the client's copy).
--
-- snapshot shape (jsonb):
--   {
--     projName, projPid, generatedAt, periodLabel,
--     recipients: ["Name", ...],        -- the Distributed To list, frozen
--     includeInternal: bool,
--     sections: [ { title, type, summary, content,
--                   countsLabel,        -- e.g. "19-day report period · 8 interactions in period"
--                   tableHtml } ]       -- rendered table markup (inline-styled, self-contained)
--   }
--
-- SAFE / ADDITIVE. Run once in the Supabase SQL Editor. Existing archived rows
-- keep snapshot = null and continue to render narrative-only (their table data
-- was never captured and cannot be recovered) — new archives are complete.

alter table pi_report_archive
  add column if not exists snapshot jsonb;

-- The portal reads shared archives with the anon key; the column is covered by
-- the existing table-level grants + anon_portal_read policy from
-- 2026-07-06_portal_shared_reports.sql, so no new grant is required. Re-assert
-- idempotently in case this migration is run on a database that skipped it.
grant select, insert, update, delete on pi_report_archive to anon;
grant select, insert, update, delete on pi_report_archive to authenticated;
