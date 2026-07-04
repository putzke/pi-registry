-- Add three fields that were saved locally but never persisted to Supabase
-- because they were missing from SB_TO_INT['pi_interactions'].
-- Safe to run multiple times (all use IF NOT EXISTS).

alter table pi_interactions
  add column if not exists anon_label            text,
  add column if not exists nepa_stage            text,
  add column if not exists equity_form_submitted boolean default false;
