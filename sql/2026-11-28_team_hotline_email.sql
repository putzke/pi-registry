-- Each PI team member chooses whether they get the "new hotline voicemail"
-- email (Jeff, Nov 2026). Default on, so nothing changes for anyone until
-- they untick "Email me about new hotline voicemails" in Settings → PI team.
-- The hotline receiver reads the row with select=*, so it works before this
-- runs (no column = emails on, as before).
alter table pi_team_members add column if not exists hotline_email boolean not null default true;
