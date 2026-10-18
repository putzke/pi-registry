-- Hotline clean-up of junk voicemails (Oct 2026, Jeff's choice "B").
--
-- A voicemail DISMISSED as "Spam / robocall" or "Hang-up / no message" is
-- deleted 90 days after it was dismissed. Nothing else is ever deleted:
-- logged voicemails are linked from their interaction, and a wrong number,
-- a duplicate or "Other" stays as the record that a call came in.
--
-- The rule lives HERE, in one SECURITY DEFINER function, so the app can only
-- ask for the clean-up — it cannot delete anything the rule doesn't cover.
-- Only signed-in staff (pi_is_staff()) get a result; anyone else deletes
-- nothing. A row whose recording has not been removed from storage yet is
-- left for the next run, so no audio file is ever orphaned.
-- The app calls it from _hotPurgeExpired (when the Hotline inbox opens, at
-- most hourly), right after removing expired recordings.
--
-- Mirrored in index.html as HOT_JUNK_REASONS / HOT_JUNK_KEEP_DAYS (test 83
-- asserts they agree). Apply on DEV first.

create or replace function pi_hotline_cleanup()
returns table (id bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not pi_is_staff() then return; end if;
  return query
    delete from pi_hotline_messages m
     where m.status = 'dismissed'
       -- A typed note is stored after the reason ("Spam / robocall — note").
       and split_part(m.dismiss_reason, ' — ', 1) in ('Spam / robocall', 'Hang-up / no message')
       and m.closed_at < now() - interval '90 days'
       and (m.recording_path is null or m.audio_deleted_at is not null)
    returning m.id;
end $$;

revoke all on function pi_hotline_cleanup() from public;
revoke all on function pi_hotline_cleanup() from anon;
grant execute on function pi_hotline_cleanup() to authenticated;
