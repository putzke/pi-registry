-- ═══════════════════════════════════════════════════════════════════════════
-- SR-154 (25-154-001) · client-reporting end-to-end test
-- 0 of 5 — cleanup
--
-- Removes only rows this test created (tagged updated_by = 'sr154-rpt-test', a
-- provenance column displayed nowhere) and the three named commitments. The
-- project's real history is untouched. Safe to run at any point to start over.
--
-- ▸ NEXT: run 01-period-1.sql
--
-- Full walkthrough and the reasoning behind the sequence: README.md in this
-- folder. Run these IN ORDER, and do the archive step between them — each
-- block advances the project, and an archived report freezes the state at the
-- moment you archive it. That movement is what gives the Project Status
-- Report something to compare.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare p_id text;
begin
  select id::text into p_id from pi_projects where pid = '25-154-001';
  if p_id is null then raise exception 'project 25-154-001 not found'; end if;

  delete from pi_interactions
   where project_id::text = p_id and updated_by = 'sr154-rpt-test';
  delete from pi_issues
   where project_id::text = p_id and updated_by = 'sr154-rpt-test';
  delete from pi_commitments
   where project_id::text = p_id
     and commitment in (
       'Complete the corridor noise study before the final environmental document',
       'Report the noise study results back to the Harvest Hills HOA board',
       'Provide the noise wall determination to the HOA in writing');

  raise notice 'BLOCK 0: prior test rows removed for project %', p_id;
end $$;
