-- ── pi_interactions — follow-up assignment ──────────────────────────────────
--
-- Lets a follow-up be handed to another Horizon user without rewriting who
-- logged the interaction.
--
-- WHY A NEW COLUMN RATHER THAN REUSING logged_by
--   logged_by is provenance on a compliance record: it is rendered into the PI
--   report tables and frozen into pi_report_archive.snapshot. Overwriting it to
--   re-route a task would make the log — and every report already issued to the
--   client — assert that someone took a call they never took. Assignment is a
--   separate, mutable fact; attribution is not.
--
-- SAFE / ADDITIVE / NON-BREAKING. Nullable with no default, so Postgres records
-- it as catalog metadata only — no table rewrite, and not one existing row is
-- touched. Idempotent.
--
-- EXISTING ROWS KEEP WORKING UNCHANGED. The app treats ownership as
-- COALESCE(follow_up_assigned_to, logged_by) — see _fuOwner() in index.html — so
-- every follow-up that predates this migration stays with whoever logged it and
-- appears in exactly the same lists as before. Nobody's queue changes on the day
-- this ships.
--
-- APP-SIDE CHANGES (already committed alongside this file):
--   • SB_TO_INT.pi_interactions gains followUpAssignedTo -> follow_up_assigned_to
--   • It is TEXT, so it must NOT be added to DATE_FIELDS.
--   • mobile.html and importer.html do not map the column. That is safe: both
--     write with a partial PATCH built from their own toSB(), and PATCH only
--     updates the keys it is given — neither can blank an assignment. Add the
--     mapping there when mobile grows an "assigned to me" view.

alter table pi_interactions
  add column if not exists follow_up_assigned_to text;

-- Filtering is always "open follow-ups owned by me", so index the open ones.
create index if not exists idx_pi_interactions_fu_assigned
  on pi_interactions (follow_up_assigned_to)
  where follow_up = true and follow_up_done is not true;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='pi_interactions'
                and column_name='follow_up_assigned_to') then
    raise notice 'pi_interactions.follow_up_assigned_to present. % existing follow-up(s) remain owned by their logger.',
      (select count(*) from pi_interactions where follow_up = true);
  else
    raise warning 'pi_interactions.follow_up_assigned_to was NOT created.';
  end if;
end $$;
