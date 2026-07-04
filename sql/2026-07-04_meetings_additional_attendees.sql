-- Add free-text additional attendees field to pi_meetings.
-- Stores names of attendees not in the stakeholder list (e.g. general public at open houses).
-- Safe to run multiple times (uses IF NOT EXISTS).

alter table pi_meetings
  add column if not exists additional_attendees text;
