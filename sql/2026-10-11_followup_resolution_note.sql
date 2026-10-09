-- Optional "how it was resolved" note on a follow-up (Oct 2026).
--
-- follow_up_note is the ACTION ("Email the detour exhibit"); this is the
-- outcome, typed in the Edit interaction dialog when "Follow-up resolved" is
-- ticked. Optional: the one-click Resolve button in the Follow-ups view still
-- resolves with no note. Cleared when a follow-up is reopened.
--
-- No grant change: existing table-level policies cover new columns.
-- Until this runs the app leaves the column out of every write (toSB gate,
-- window._fuResCol), so saving an interaction never fails.
--
-- Idempotent.

alter table pi_interactions add column if not exists follow_up_resolution text;
