-- PI report draft: persist the two report-wide options.
--
-- Bug being fixed: "Include internal stakeholders in the interaction log" and the
-- Report Distribution group checkboxes were never saved. captureFormState() didn't
-- capture them and the editor re-rendered them from hardcoded defaults, so leaving
-- the editor and returning always reset internal-stakeholders to OFF and the
-- distribution groups to just "Project team".
--
-- These are real report settings — they change which interactions the report
-- includes and who the "Distributed To" header lists — so they belong in the saved
-- draft alongside the title/period/sections.
--
-- dist_groups is jsonb (an array of group names, e.g. ["Project team","Media"]).
-- NULL means "never saved" so the editor still applies the Project-team default on
-- a brand-new draft; an empty array [] is an explicit "none selected" and is kept.
--
-- SAFE / ADDITIVE. Run once in the Supabase SQL Editor.

alter table pi_reports
  add column if not exists include_internal boolean default false,
  add column if not exists dist_groups      jsonb;
