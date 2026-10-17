-- Hotline voicemail transcripts from Twilio's LIVE transcription with
-- Deepgram Nova-3 (Oct 2026), replacing <Record transcribe> (English only,
-- two-minute cap, rough on names, $0.05/min vs $0.027/min).
--
-- Live transcription sends the message as several finished pieces while the
-- caller speaks, each with a sequence number, and they can arrive at the same
-- moment. pi_hotline_transcript_part() adds one piece and rebuilds the text in
-- ONE statement under the row lock, so two pieces arriving together can never
-- overwrite each other. It creates the voicemail row if the recording
-- callback has not arrived yet (both upsert on call_sid, as before).
--
-- Only the hotline function (service_role) calls it. Apply on DEV first.

alter table pi_hotline_messages add column if not exists transcript_parts jsonb;

create or replace function pi_hotline_transcript_part(p_call_sid text, p_seq integer, p_text text, p_row jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  part jsonb := jsonb_build_object(p_seq::text, p_text);
begin
  if coalesce(p_call_sid, '') = '' or coalesce(trim(p_text), '') = '' then return; end if;
  insert into pi_hotline_messages
    (call_sid, hotline_id, extension_digit, project_id, language, caller_number, transcript_parts, transcript)
  values
    (p_call_sid, nullif(p_row->>'hotline_id', '')::bigint, p_row->>'extension_digit', p_row->>'project_id',
     coalesce(p_row->>'language', 'en'), p_row->>'caller_number', part, p_text)
  on conflict (call_sid) do update
    set transcript_parts = coalesce(pi_hotline_messages.transcript_parts, '{}'::jsonb) || part,
        transcript = (select string_agg(value, ' ' order by key::int)
                        from jsonb_each_text(coalesce(pi_hotline_messages.transcript_parts, '{}'::jsonb) || part)),
        updated_at = now();
end $$;

revoke all on function pi_hotline_transcript_part(text, integer, text, jsonb) from public;
revoke all on function pi_hotline_transcript_part(text, integer, text, jsonb) from anon, authenticated;
-- service_role exists on Supabase, not in the test harness.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function pi_hotline_transcript_part(text, integer, text, jsonb) to service_role;
  end if;
end $$;
