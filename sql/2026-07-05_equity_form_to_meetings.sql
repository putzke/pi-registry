-- Move equity/civil rights compliance tracking from interactions to meetings.
-- Step 1: Add the column to pi_meetings (run this first, before deploying app changes).
-- Step 2: Drop from pi_interactions (run this after the new app is live).

-- Step 1 — add to meetings
alter table pi_meetings
  add column if not exists equity_form_submitted boolean default false;

-- Step 2 — drop from interactions (run after confirming app is deployed)
-- alter table pi_interactions drop column if exists equity_form_submitted;
