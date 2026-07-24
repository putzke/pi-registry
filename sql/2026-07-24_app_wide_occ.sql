-- App-wide optimistic concurrency (OCC) for the most-edited shared records.
--
-- Extends the same "don't silently clobber a concurrent edit" guard already used
-- by the PI report editor to ordinary modal edits of:
--   • pi_stakeholders — shared contact records edited from master + project views
--   • pi_interactions — compliance log entries that flow into FHWA/NEPA reports
--   • pi_issues       — tracked concerns with status/resolution
--
-- The app now sends every UPDATE to these tables conditional on updated_at
-- matching the value it loaded; if another user saved in the meantime the app
-- detects it and asks the editor how to resolve, instead of overwriting blindly.
-- updated_by records who last saved (login email) for the "changed by <who>"
-- prompt and the self-write guard.
--
-- SAFE / ADDITIVE. Run once in the Supabase SQL Editor BEFORE deploying the
-- app-wide OCC code (the app reads these columns as the conflict baseline and
-- writes them on every save). Existing rows get a uniform updated_at baseline
-- from the column default; new rows get now() per insert.

alter table pi_stakeholders
  add column if not exists updated_at timestamptz default now(),
  add column if not exists updated_by text;

alter table pi_interactions
  add column if not exists updated_at timestamptz default now(),
  add column if not exists updated_by text;

alter table pi_issues
  add column if not exists updated_at timestamptz default now(),
  add column if not exists updated_by text;

-- Backfill: give pre-existing rows a sensible baseline. Any consistent value
-- works for OCC (the app adopts the server's value after the first save), but
-- created_at is more meaningful where the table has it.
update pi_issues        set updated_at = coalesce(created_at, updated_at, now()) where updated_at is null;
update pi_stakeholders  set updated_at = now() where updated_at is null;
update pi_interactions  set updated_at = now() where updated_at is null;
