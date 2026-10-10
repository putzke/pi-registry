-- Remove the demo projects and one staff test project from the LIVE database.
-- Paste in the Supabase SQL Editor. One transaction: all of it or none of it.
--
--   45  SR-154 Corridor Safety Improvements   (demo seed, 25-154-001)
--   46  Logan City 400 North Reconstruction   (demo seed, 25-LC-400N)
--   47  3600 West Corridor Widening           (demo seed, 25-3W-DESIGN)
--   25  1200 South Wastewater                 (PIN 700, created for testing)
--
-- Checked 2026-10-10 before writing this: the 156 contacts linked to these four
-- projects are linked to no other project and have no interactions, commitments,
-- groups or parcels on any other project; no report files in storage; no
-- close-outs. The block below re-checks the first point and aborts if it fails.
--
-- The demo data lives on in sql/2026-07-26_udot_conference_demo_seed.sql — run
-- that on the DEV database, never on live again.

begin;

do $$
declare
  pids text[] := array['25','45','46','47'];
  sids text[];
begin
  select coalesce(array_agg(distinct stakeholder_id), '{}') into sids
    from pi_project_stakeholders where project_id = any(pids);

  if exists (select 1 from pi_project_stakeholders
              where stakeholder_id = any(sids) and not project_id = any(pids)) then
    raise exception 'A contact is shared with a project being kept — nothing deleted.';
  end if;

  delete from pi_issue_interactions
   where issue_id in (select id from pi_issues where project_id = any(pids))
      or interaction_id in (select id::text from pi_interactions where project_id = any(pids));
  delete from pi_interactions          where project_id = any(pids);
  delete from pi_public_comments       where project_id = any(pids);
  delete from pi_comment_periods       where project_id = any(pids);
  delete from pi_commitments           where project_id::text = any(pids);
  delete from pi_deliverables          where project_id = any(pids);
  delete from pi_meetings              where project_id = any(pids);
  delete from pi_issues                where project_id = any(pids);
  delete from pi_tribal_consultations  where project_id = any(pids);
  delete from pi_group_members where group_id in (select id from pi_groups where project_id::text = any(pids));
  delete from pi_groups                where project_id::text = any(pids);
  delete from pi_parcel_outreach where parcel_id in (select id::text from pi_parcels where project_id = any(pids));
  delete from pi_parcel_owners   where parcel_id in (select id::text from pi_parcels where project_id = any(pids));
  delete from pi_parcels               where project_id = any(pids);
  delete from pi_closeouts             where project_id::text = any(pids);
  delete from pi_reports               where project_id::text = any(pids);
  delete from pi_report_archive        where project_id::text = any(pids);
  delete from pi_client_summaries      where project_id::text = any(pids);
  delete from pi_portal_links          where project_id::text = any(pids);
  delete from pi_client_access         where project_id::text = any(pids);
  delete from pi_project_stakeholders  where project_id = any(pids);
  delete from pi_dismissed_pairs where id_a::text = any(sids) or id_b::text = any(sids);
  delete from pi_stakeholders          where id::text = any(sids);
  delete from pi_projects              where id::text = any(pids);
end $$;

commit;

-- Expected after: 2 projects (16, 44), 103 contacts, 103 project links,
-- 104 interactions, 7 archived reports, 18 deliverables, 18 events, 2 issues,
-- 2 portal links — i.e. the kept projects exactly as they were.
select
  (select count(*) from pi_projects)              as projects,
  (select count(*) from pi_stakeholders)          as contacts,
  (select count(*) from pi_project_stakeholders)  as project_links,
  (select count(*) from pi_interactions)          as interactions,
  (select count(*) from pi_report_archive)        as archived_reports,
  (select count(*) from pi_deliverables)          as deliverables,
  (select count(*) from pi_meetings)              as events,
  (select count(*) from pi_issues)                as issues,
  (select count(*) from pi_portal_links)          as portal_links;
