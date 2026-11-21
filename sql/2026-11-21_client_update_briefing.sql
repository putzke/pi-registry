-- Client update briefing (Nov 2026, Jeff).
--
-- A short, staff-approved note on the client portal: what is new since the
-- last PI report the client received. Stored in the EXISTING
-- pi_client_summaries table (no new table, no new grants or policies):
--
--   kind = 'status'  the AI Project Status Report (every row written before
--                    this migration; the default)
--   kind = 'update'  a published client update; content_full holds the text,
--                    since_date the date of the report it follows on from
--   kind = 'kept'    "Keep the current one" in the review dialog: no text, just
--                    the moment staff decided nothing new needed publishing
--                    (the Update due button stays quiet until something new
--                    happens after it). The portal ignores these rows.
--
-- Idempotent. Paste on LIVE BEFORE the code release: the portal asks for these
-- columns (it falls back to the old column list if they are missing, but the
-- desktop cannot publish an update without them).

alter table pi_client_summaries add column if not exists kind text not null default 'status';
alter table pi_client_summaries add column if not exists since_date date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pi_client_summaries_kind_check') then
    alter table pi_client_summaries add constraint pi_client_summaries_kind_check
      check (kind in ('status', 'update', 'kept'));
  end if;
end $$;

-- Verify:
-- select kind, count(*) from pi_client_summaries group by kind;
