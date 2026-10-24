-- pi_interactions.related_to — "Log next contact" (Oct 2026).
--
-- A next contact points at the ORIGINAL interaction of its conversation, so a
-- call-back, a reply email or a second visit lists under the first contact and
-- the follow-up lives only on the original. The column was first added inside
-- sql/2026-10-12_hotlines.sql; it is split out here because the 2026-10-24
-- release takes "Log next contact" to LIVE while the hotline stays on DEV.
-- Running both files is harmless (add column if not exists).
--
-- No policy or grant change: pi_interactions' existing rules cover new columns.
-- Until this runs the app leaves related_to out of every write (window._relCol),
-- so nothing breaks — a next contact just isn't linked to its original.
--
-- Paste on LIVE before the code push. Idempotent.

alter table public.pi_interactions add column if not exists related_to bigint
  references public.pi_interactions(id) on delete set null;

-- Check (one row):
-- select column_name, data_type from information_schema.columns
--   where table_name = 'pi_interactions' and column_name = 'related_to';
