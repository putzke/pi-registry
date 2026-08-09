-- ═══════════════════════════════════════════════════════════════════════════
-- ONE-TIME CLEANUP — remove the stale duplicate demo projects
--
-- WHY THEY EXIST
--   An earlier run of sql/2026-07-26_udot_conference_demo_seed.sql created
--   SR-154 and Logan City 400 North. Their project numbers were then edited by
--   hand to the 5-digit UDOT standard (22825 and 705). The seed's purge matches
--   on `pid`, so from that moment the renamed copies were invisible to it: every
--   subsequent run rebuilt a fresh pair under the seed's own pids while the
--   renamed pair survived untouched.
--
--   That is also what produced the "duplicate key value violates unique
--   constraint" failures on pi_comment_periods and pi_portal_links. Those two
--   tables carry FIXED literal keys, and their rows stayed attached to the
--   renamed copies — out of reach of a purge scoped to the new pids, but still
--   holding the exact ids the seed re-inserts.
--
-- WHAT THIS DELETES
--   Only projects matching BOTH a stale pid AND the demo project name. The
--   name check is the safety catch: a mistyped pid cannot take out something
--   unintended. Confirmed with the project owner that no real work was logged
--   against these copies.
--
-- WHAT THIS LEAVES ALONE
--   Everything else, explicitly including the live projects 15905 (3600 West
--   Reconstruction) and 700 (1200 South Wastewater), and the current demo trio
--   25-154-001 / 25-LC-400N / 25-3W-DESIGN.
--
-- Safe to run more than once; a second run finds nothing and says so.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  stale_pids  text[] := array['22825','705'];
  stale_names text[] := array['SR-154 Corridor Safety Improvements',
                              'Logan City 400 North Reconstruction'];
  ids          text[];
  stale_stakes text[];
begin
  select coalesce(array_agg(id::text), '{}'::text[]) into ids
    from pi_projects
   where pid = any(stale_pids)
     and name = any(stale_names);        -- both must match

  if coalesce(array_length(ids, 1), 0) = 0 then
    raise notice 'No stale demo copies found — nothing to do.';
    return;
  end if;

  raise notice 'Removing % stale demo project(s): %', array_length(ids, 1),
    (select string_agg(pid || ' (' || name || ')', ', ')
       from pi_projects where id::text = any(ids));

  -- Child rows first, in foreign-key-safe order — same order the seed's own
  -- purge uses.
  delete from pi_issue_interactions
   where interaction_id::text in (select id::text from pi_interactions
                                   where project_id::text = any(ids));
  delete from pi_interactions         where project_id::text = any(ids);
  delete from pi_public_comments      where project_id::text = any(ids);
  delete from pi_comment_periods      where project_id::text = any(ids);
  delete from pi_commitments          where project_id::text = any(ids);
  delete from pi_deliverables         where project_id::text = any(ids);
  delete from pi_meetings             where project_id::text = any(ids);
  delete from pi_issues               where project_id::text = any(ids);
  delete from pi_tribal_consultations where project_id::text = any(ids);
  delete from pi_parcel_owners
   where parcel_id::text in (select id::text from pi_parcels
                              where project_id::text = any(ids));
  delete from pi_parcels              where project_id::text = any(ids);
  delete from pi_group_members
   where group_id::text in (select id::text from pi_groups
                             where project_id::text = any(ids));
  delete from pi_groups               where project_id::text = any(ids);
  delete from pi_reports              where project_id::text = any(ids);
  delete from pi_report_archive       where project_id::text = any(ids);
  delete from pi_client_summaries     where project_id::text = any(ids);
  delete from pi_portal_links         where project_id::text = any(ids);
  delete from pi_client_access        where project_id::text = any(ids);

  -- Contacts that belong ONLY to these copies. A contact also linked to a live
  -- project is left alone. Ids are captured BEFORE the link rows go, because
  -- the link rows are what identify them, and deleted AFTER, because of the
  -- foreign key.
  select coalesce(array_agg(s.id::text), '{}'::text[]) into stale_stakes
    from pi_stakeholders s
   where s.id::text in (select stakeholder_id::text from pi_project_stakeholders
                         where project_id::text = any(ids))
     and not exists (
       select 1 from pi_project_stakeholders ps
        where ps.stakeholder_id::text = s.id::text
          and not (ps.project_id::text = any(ids)));

  delete from pi_project_stakeholders where project_id::text = any(ids);
  delete from pi_group_members where stakeholder_id::text = any(stale_stakes);
  delete from pi_stakeholders  where id::text        = any(stale_stakes);
  delete from pi_projects      where id::text        = any(ids);

  raise notice 'Removed % project(s) and % contact(s) that belonged only to them.',
    array_length(ids, 1), coalesce(array_length(stale_stakes, 1), 0);
end $$;

commit;

-- Verify: should list 5 projects — 15905, 700, 25-154-001, 25-LC-400N, 25-3W-DESIGN.
--   select pid, name, status from pi_projects order by pid;
