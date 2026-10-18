-- Hotline menu recordings (Oct 2026, Jeff).
--
-- A menu hotline can play an uploaded recording of its menu ("For the SR-154
-- project, press 1 … for anything else, press 0") instead of the computer
-- voice, in English and optionally in Spanish (heard after pressing 9).
-- "Para español, oprima 9" stays the computer's Spanish voice, between the
-- greeting and the menu. Everything after a key press stays computer voice.
--
-- *_for holds the exact menu script the recording was made for. The receiver
-- plays the recording only while the hotline's current script still matches;
-- once a project is added, removed or renumbered it falls back to the computer
-- voice on its own, so a caller never hears a wrong menu. The app shows the
-- recording as out of date with the new script to read.
--
-- No grant or policy change: pi_hotlines' existing staff-only policies cover
-- new columns. Apply on DEV first; paste on LIVE with the hotline release.

alter table pi_hotlines add column if not exists menu_audio_path         text;
alter table pi_hotlines add column if not exists menu_audio_for          text;
alter table pi_hotlines add column if not exists spanish_menu_audio_path text;
alter table pi_hotlines add column if not exists spanish_menu_audio_for  text;
