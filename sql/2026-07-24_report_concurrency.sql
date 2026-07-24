-- Report editor: auto-save + presence + optimistic-concurrency (OCC).
--
-- Adds the columns needed to (1) show "Last updated by <who> · <when>",
-- (2) warn when another user is actively editing the same project's report
-- (advisory presence, auto-expires), and (3) detect a conflicting save
-- (someone else changed the row since you loaded it) instead of silently
-- overwriting.
--
-- SAFE / ADDITIVE. Run once in the Supabase SQL Editor BEFORE deploying the
-- report auto-save/concurrency code (the app writes these columns).
--
-- updated_at already exists on pi_reports (the app has always written it).

alter table pi_reports
  add column if not exists updated_by      text,          -- who last saved (login email)
  add column if not exists editing_email   text,          -- who currently has the editor open
  add column if not exists editing_session text,          -- their per-tab session id
  add column if not exists editing_at       timestamptz;  -- last heartbeat; presence is stale after ~60s
