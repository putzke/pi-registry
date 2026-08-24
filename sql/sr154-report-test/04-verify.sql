-- ═══════════════════════════════════════════════════════════════════════════
-- SR-154 (25-154-001) · client-reporting end-to-end test
-- 4 of 5 — verify
--
-- Interaction volume per period, so you can confirm the three reports are
-- drawing on different activity. Expect roughly 14 / 9 / 17.
--
-- ▸ NEXT: nothing — you are done. Check the portal.
--
-- Full walkthrough and the reasoning behind the sequence: README.md in this
-- folder. Run these IN ORDER, and do the archive step between them — each
-- block advances the project, and an archived report freezes the state at the
-- moment you archive it. That movement is what gives the Project Status
-- Report something to compare.
-- ═══════════════════════════════════════════════════════════════════════════

-- Interaction volume per period, so the engagement delta on the status report
-- has something to compare. Expect roughly 14 / 9 / 17.
select case
         when i.interaction_date between current_date - 90 and current_date - 61 then '1 · 90-61 days ago'
         when i.interaction_date between current_date - 60 and current_date - 31 then '2 · 60-31 days ago'
         when i.interaction_date between current_date - 30 and current_date      then '3 · 30-0 days ago'
       end as period,
       count(*) as interactions,
       count(*) filter (where i.stakeholder_id is null) as anonymous
  from pi_interactions i
  join pi_projects p on p.id::text = i.project_id::text
 where p.pid = '25-154-001'
   and i.updated_by = 'sr154-rpt-test'
 group by 1 order by 1;
