-- The voicemail prompt as a recording (Oct 2026, Jeff).
--
-- One recording for EVERY hotline, played wherever the computer voice used to
-- say "Please leave your name, your phone number and your message after the
-- tone…" — after an unanswered ring (where it also replaces "Sorry, nobody can
-- take your call right now"), after hours, and after a menu choice. The
-- greeting and menu already said which project the caller reached, so the
-- prompt is the same for all of them. English, and optionally Spanish (heard
-- by a caller who pressed 9). No recording = the computer voice, as before.
--
-- Files live in the private hotline-audio bucket at prompts/voicemail-<lang>.*
-- No grant or policy change: pi_hotline_settings' existing staff policies
-- cover new columns, and the receiver reads it as service_role.
-- Apply on DEV first; paste on LIVE with the hotline release.

alter table pi_hotline_settings add column if not exists voicemail_audio_path         text;
alter table pi_hotline_settings add column if not exists spanish_voicemail_audio_path text;
