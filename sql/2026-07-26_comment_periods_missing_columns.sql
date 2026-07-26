-- ── pi_comment_periods — add the five columns the app already writes ────────
--
-- WHY THIS EXISTS
--   `SB_TO_INT.pi_comment_periods` in index.html maps venue, hearing_date,
--   first_ad_date, second_ad_date and federal_register_date, and `savePeriod()`
--   sets all five on every save. None of them exist in the database, so:
--
--     • Saving a comment period from the desktop app fails with
--       42703 "column ... does not exist".
--     • The client portal's Comment Periods tab fails too — `renderComments()`
--       selects hearing_date, so the request 400s and the tab falls back to
--       "Comment period data couldn't be loaded at this time."
--
--   Found on 2026-07-26 while seeding the UDOT conference demo data. The app is
--   the source of truth for intent here — the columns were mapped and written
--   but never migrated — so this adds them rather than removing the mappings.
--
-- SAFE / ADDITIVE. All columns are nullable with no default; no existing row
-- changes and no existing query breaks. Idempotent — safe to re-run.
--
-- PAIRED APP FIX (already committed): `hearing_date`, `first_ad_date`,
--   `second_ad_date` and `federal_register_date` were added to `DATE_FIELDS` in
--   index.html. Without that, `savePeriod()` sends '' for an unset date and
--   Postgres rejects it with 22007 'invalid input syntax for type date: ""'.
--   The columns alone are not enough; both halves are required.

alter table pi_comment_periods add column if not exists venue                 text;
alter table pi_comment_periods add column if not exists hearing_date          date;
alter table pi_comment_periods add column if not exists first_ad_date         date;
alter table pi_comment_periods add column if not exists second_ad_date        date;
alter table pi_comment_periods add column if not exists federal_register_date date;

-- Verify
do $$
declare missing text;
begin
  select string_agg(c, ', ') into missing
    from unnest(array['venue','hearing_date','first_ad_date',
                      'second_ad_date','federal_register_date']) c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'pi_comment_periods'
        and column_name = c);
  if missing is null then
    raise notice 'pi_comment_periods: all five columns present.';
  else
    raise warning 'pi_comment_periods: still missing %', missing;
  end if;
end $$;
