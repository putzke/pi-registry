-- ═══════════════════════════════════════════════════════════════════════════
-- FIX — pi_meetings.attendee_ids is TEXT; the app writes a JSON array.
--
-- THE BUG
--   saveMeeting() collects the ticked attendees as an array of stakeholder ids
--   and toSB() passes it straight through, so the PATCH body carries
--   "attendee_ids": ["12","34"]. PostgREST refuses an array into a text column
--   and answers 400. Writes are local-first, so the names appeared on the
--   Events list immediately and were replaced by the server's copy — without
--   them — the next time the view refreshed. Nothing was ever stored.
--
--   Every other structured column in this schema is jsonb: nepa_checklist,
--   phase_history, nepa_stage_history, sections, snapshot, dist_groups.
--   attendee_ids is the odd one out, which is why it is the one that broke.
--
-- WHY jsonb RATHER THAN CHANGING THE APP
--   A list of ids IS structured data, and jsonb is what the rest of the schema
--   already uses for exactly this. Encoding it as a string in a text column
--   would mean every reader has to remember to JSON.parse it — and forgetting
--   is silent, because a string is truthy and Array.isArray() just returns
--   false. That is the same class of failure as the one being fixed.
--
-- SAFETY
--   Existing text values are converted row by row, not with a blanket cast, so
--   one unparseable value cannot abort the migration. Anything that will not
--   parse is reported by name and left empty rather than guessed at.
--
-- Idempotent: re-running finds the column already jsonb and stops.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  cur_type text;
  r        record;
  v        jsonb;
  bad      int := 0;
  moved    int := 0;
begin
  select data_type into cur_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'pi_meetings'
     and column_name = 'attendee_ids';

  if cur_type is null then
    raise notice 'pi_meetings.attendee_ids does not exist — nothing to do.';
    return;
  end if;
  if cur_type <> 'text' then
    raise notice 'pi_meetings.attendee_ids is already %, nothing to do.', cur_type;
    return;
  end if;

  alter table pi_meetings add column if not exists attendee_ids_new jsonb;

  for r in select id, attendee_ids from pi_meetings where attendee_ids is not null loop
    begin
      if btrim(r.attendee_ids) = '' then
        v := null;
      elsif btrim(r.attendee_ids) like '[%' then
        v := btrim(r.attendee_ids)::jsonb;          -- already a JSON array
      else
        -- A comma-separated list, which is the only other shape anything could
        -- plausibly have written to this column.
        v := to_jsonb(array(
               select btrim(x) from unnest(string_to_array(r.attendee_ids, ',')) x
                where btrim(x) <> ''));
      end if;
    exception when others then
      bad := bad + 1;
      raise notice 'pi_meetings id=%: attendee_ids could not be parsed (%), left empty.',
        r.id, left(r.attendee_ids, 60);
      v := null;
    end;
    if v is not null then
      update pi_meetings set attendee_ids_new = v where id = r.id;
      moved := moved + 1;
    end if;
  end loop;

  alter table pi_meetings drop column attendee_ids;
  alter table pi_meetings rename column attendee_ids_new to attendee_ids;

  raise notice 'pi_meetings.attendee_ids is now jsonb — % row(s) carried over, % unparseable.',
    moved, bad;
end $$;

-- Verify: should report jsonb.
--   select data_type from information_schema.columns
--    where table_name='pi_meetings' and column_name='attendee_ids';
