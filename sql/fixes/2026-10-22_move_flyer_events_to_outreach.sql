-- LIVE only, AFTER sql/2026-10-20_outreach_log.sql has been pasted (the
-- Outreach log release). Moves four entries that were logged as EVENTS but are
-- distributions (0 attendance, nobody gathered) into the Outreach log, then
-- deletes the events. Checked 2026-10-22: project 16, no attendees, no linked
-- interactions on any of them.
--   172 Secondary Water Outage Notice      → Website update, Posted online
--   179 Intersection Closure Flyers Delivered → Flyer / door hanger, Hand-delivered
--   206 Access Restrictions Flyer (Sep 21) → Flyer / door hanger, Hand-delivered
--   209 Access Restrictions Flyer (Oct 15) → Flyer / door hanger, Hand-delivered
-- Safe to run twice: the insert skips any event already moved, the delete only
-- removes events that now have an Outreach entry carrying their marker.

begin;

-- BEFORE: should list the 4 events.
select id, title, meeting_date, meeting_type, attendance_count from pi_meetings where id in (172,179,206,209) order by id;

insert into pi_outreach_actions (project_id, action_date, action_type, party, title, description, delivery, note, logged_by)
select m.project_id::text, m.meeting_date,
       case when m.id = 172 then 'Website update' else 'Flyer / door hanger' end,
       'PI team', m.title, nullif(m.handouts, ''),
       case when m.id = 172 then 'Posted online' else 'Hand-delivered' end,
       'Moved from Events (event #' || m.id || ', ' || coalesce(m.location, '') || ') on 2026-10-22.',
       null
from pi_meetings m
where m.id in (172,179,206,209)
  and coalesce(m.attendance_count, 0) = 0
  and not exists (select 1 from pi_outreach_actions a where a.note like 'Moved from Events (event #' || m.id || ',%');

delete from pi_meetings m
where m.id in (172,179,206,209)
  and coalesce(m.attendance_count, 0) = 0
  and exists (select 1 from pi_outreach_actions a where a.note like 'Moved from Events (event #' || m.id || ',%');

-- AFTER: 4 outreach rows, 0 events left.
select id, action_date, action_type, delivery, title from pi_outreach_actions where note like 'Moved from Events%' order by action_date;
select count(*) as events_left from pi_meetings where id in (172,179,206,209);

commit;
