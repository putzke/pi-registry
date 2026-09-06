-- Renames the deliverable type "Email management" to "Project email"
-- (index.html's DEL_GROUPS, Community Outreach group).
--
-- WHY THIS NEEDS A DATA MIGRATION, NOT JUST A CODE CHANGE
--   The Edit Deliverable select marks an option `selected` by exact string
--   match against the stored `deliverable_type` (see DEL_GROUPS usage at
--   index.html ~6123/~7824). Renaming the option in the dropdown without
--   updating rows that already say the old name orphans them: no option
--   matches, the browser defaults to selecting the FIRST option in the list
--   instead, and clicking Save on that record — without ever touching the
--   dropdown — would silently recategorize it to "Public meeting / open
--   house". This updates every existing row so the rename doesn't corrupt
--   data on the next unrelated edit.
--
-- Idempotent — safe to run more than once (the second run matches zero rows).

update pi_deliverables
   set deliverable_type = 'Project email'
 where deliverable_type = 'Email management';

-- ── Verify (run after) ───────────────────────────────────────────────────────
--   select count(*) from pi_deliverables where deliverable_type = 'Email management';
-- Expect 0.
