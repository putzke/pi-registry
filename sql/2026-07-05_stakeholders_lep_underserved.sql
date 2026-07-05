-- Add LEP and EJ/underserved flags to pi_stakeholders.
-- These were tracked in the app and importer but never added to Supabase.
-- Safe to run multiple times (uses IF NOT EXISTS).

alter table pi_stakeholders
  add column if not exists lep         boolean default false,
  add column if not exists underserved boolean default false;
