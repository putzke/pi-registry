-- ═══════════════════════════════════════════════════════════════════════════
-- SR-154 (25-154-001) — three periods of activity for an end-to-end test of
-- the client reporting flow (archive → share → publish trend → portal).
--
-- WHY THIS IS THREE BLOCKS AND NOT ONE SCRIPT
-- Only the "Recent public concerns and inquiries" section is bounded by the
-- report period. Deliverables, issues, commitments and the contact list all
-- show the project's CURRENT state whatever dates are in the header — and
-- snapshot.trendFacts freezes exactly those. So three reports run over static
-- data produce three different concerns narratives and three IDENTICAL
-- everything-else sections, and the Project Status Report correctly reports
-- that nothing moved. Which is a real run, but an empty test.
--
-- To give the trend something to diff, the project has to CHANGE between
-- archives. Hence: run a block, archive that report, run the next block.
--
-- ── HOW TO USE ────────────────────────────────────────────────────────────
--   1. Run BLOCK 0 (cleanup) + BLOCK 1.
--      In COMPASS: Reports → PI Report Editor, project = 25-154-001.
--      Period start / end = the dates BLOCK 1 prints. Draft the sections,
--      then "Save to archive". In the Archive, toggle "Share with client".
--   2. Run BLOCK 2. Archive report #2 the same way, with its dates.
--   3. Run BLOCK 3. Archive report #3, share it.
--   4. In the Archive, press "AI: Project Status Report" → edit → "Publish
--      trend to client portal".
--   5. Open the SR-154 portal link → Project Updates. All three reports and
--      the trend should be there.
--
-- Dates are relative to current_date, so this stays valid whenever it is run.
--
-- ⚠ Re-running the demo seed (2026-07-26_udot_conference_demo_seed.sql) wipes
--   pi_reports and pi_report_archive for this project. Do this AFTER any final
--   seed re-run, not before.
--
-- Idempotent: BLOCK 0 removes this script's own prior output and nothing else.
--   Interactions and issues are tagged updated_by = 'sr154-rpt-test' (a
--   provenance column, not displayed anywhere); commitments are matched on
--   their exact text.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ BLOCK 0 — cleanup (safe to run any time) ═════════════════════════════
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


-- ═══ BLOCK 1 — Period 1, and the state report #1 should capture ═══════════
-- Period: 90 to 61 days ago.  Story: the noise wall request lands, the
-- wildlife crossing question is live, the comment matrix is mid-flight.
do $$
declare
  p_id  text;
  d_from date := current_date - 90;
  d_to   date := current_date - 61;
  sk     text[];
begin
  select id::text into p_id from pi_projects where pid = '25-154-001';

  -- External contacts already linked to this project, so every interaction
  -- resolves to a real name in the report table rather than "Anonymous".
  select array_agg(ps.stakeholder_id::text order by ps.stakeholder_id)
    into sk
    from pi_project_stakeholders ps
   where ps.project_id::text = p_id
     and coalesce(ps.stakeholder_role, 'External') = 'External';
  if sk is null or array_length(sk, 1) < 6 then
    raise exception 'SR-154 has too few external contacts linked (%). Run the demo seed first.',
                    coalesce(array_length(sk, 1), 0);
  end if;

  insert into pi_interactions
    (project_id, stakeholder_id, interaction_date, channel, subject, nature,
     direction, summary, logged_by, follow_up, follow_up_done, updated_by)
  select p_id, v.sid, v.d::date, v.ch, v.subj, v.nat, v.dir, v.summ, v.by,
         v.fu, v.fud, 'sr154-rpt-test'
  from (values
    (sk[1], d_from + 1,  'Phone','Noise wall request — Harvest Hills','Complaint','Incoming',
     'HOA board president called about the subdivision noise wall request. Asked for a written commitment that the noise study will be finished before the final environmental document. Explained the study scope and the schedule.','JP',true,false),
    (sk[2], d_from + 3,  'Email','Wildlife crossing at MP 14.2','Inquiry','Incoming',
     'Resident forwarded UDWR correspondence and asked whether the proposed crossing width is adequate for deer movement. Referred to the biological resources section and offered a follow-up call.','SB',true,false),
    (sk[3], d_from + 4,  'Phone','Redwood Road turning movements','Inquiry','Incoming',
     'Business owner asked whether the Redwood Road intersection changes will restrict left turns into the shopping centre. Confirmed the current design retains the southbound left.','JP',false,false),
    (null,  d_from + 6,  'Phone','Construction timing','Inquiry','Incoming',
     'Caller did not give a name. Wanted to know when construction would start and whether the corridor would stay open. Explained the project is still in environmental review.','JP',false,false),
    (sk[4], d_from + 8,  'Email','Noise study scope','Inquiry','Incoming',
     'Asked what the noise study will actually measure and whether existing readings will be used. Sent the study scope summary.','SB',false,false),
    (sk[5], d_from + 10, 'In-person','Corridor walk — south end','Coordination','Outgoing',
     'Walked the south end of the corridor with the property owner to look at the proposed alignment near their frontage.','JP',false,false),
    (sk[6], d_from + 12, 'Phone','Spanish-language materials','Request','Incoming',
     'Asked whether the corridor fact sheet is available in Spanish. Two households on their street prefer Spanish. Logged as a Title VI/LEP request.','SB',true,false),
    (sk[1], d_from + 15, 'Email','Noise wall — follow-up','Complaint','Outgoing',
     'Sent the HOA board the noise study scope and the schedule showing completion ahead of the final document.','JP',false,false),
    (sk[2], d_from + 17, 'Phone','Wildlife crossing — follow-up call','Inquiry','Outgoing',
     'Returned the call about crossing width. Walked through the UDWR coordination and the design criteria being applied.','SB',false,false),
    (null,  d_from + 19, 'Phone','Property access','Inquiry','Incoming',
     'Anonymous caller asked whether driveway access would be maintained during construction. Confirmed access is maintained throughout.','JP',false,false),
    (sk[3], d_from + 21, 'Email','Business access during construction','Inquiry','Incoming',
     'Asked about delivery truck access during the Redwood Road work. Explained phasing keeps at least one approach open.','JP',false,false),
    (sk[5], d_from + 23, 'Phone','Alignment near frontage','Inquiry','Incoming',
     'Called after the corridor walk with a question about the drainage on the east side. Referred to the drainage exhibit.','SB',false,false),
    (sk[4], d_from + 26, 'Email','Comment period timing','Inquiry','Incoming',
     'Asked when the next comment opportunity will be. Explained the schedule for the final document.','JP',false,false),
    (sk[6], d_from + 28, 'Mail','Spanish fact sheet delivered','Request','Outgoing',
     'Mailed the Spanish-language corridor fact sheet to the two households identified.','SB',false,false)
  ) as v(sid, d, ch, subj, nat, dir, summ, by, fu, fud);

  -- Two issues open in this period. The noise wall one PERSISTS through all
  -- three reports, which is what makes the trend comparison meaningful.
  insert into pi_issues
    (project_id, title, category, description, status, priority, date_raised,
     assigned_to, created_by, updated_by)
  values
    (p_id, 'Harvest Hills noise wall request', 'Noise',
     'Subdivision HOA has formally requested a noise wall along the east side of the corridor. Resolution depends on the corridor noise study.',
     'Open', 'High', d_from + 1, 'JP', 'JP', 'sr154-rpt-test'),
    (p_id, 'Wildlife crossing adequacy at MP 14.2', 'Environmental',
     'UDWR raised whether the proposed crossing width is adequate for deer movement through the south end of the corridor.',
     'Open', 'Medium', d_from + 3, 'SB', 'SB', 'sr154-rpt-test');

  insert into pi_commitments
    (project_id, commitment, made_to, made_by, date_made, due_date, category, status)
  values
    (p_id::bigint, 'Complete the corridor noise study before the final environmental document',
     'Harvest Hills HOA', 'JP', d_from + 1, current_date - 20, 'Technical study', 'Open'),
    (p_id::bigint, 'Report the noise study results back to the Harvest Hills HOA board',
     'Harvest Hills HOA', 'JP', d_from + 1, current_date - 45, 'Communication', 'Open');

  raise notice '── BLOCK 1 done ──────────────────────────────────────────────';
  raise notice 'ARCHIVE REPORT #1 with period start % and period end %', d_from, d_to;
  raise notice '14 interactions · 2 issues open · 2 commitments open';
end $$;


-- ═══ BLOCK 2 — Period 2, and the state that MOVED since report #1 ═════════
-- Period: 60 to 31 days ago.  Story: the study is delivered, one issue closes,
-- a Title VI issue opens, the comment matrix advances.
do $$
declare
  p_id  text;
  d_from date := current_date - 60;
  d_to   date := current_date - 31;
  sk     text[];
begin
  select id::text into p_id from pi_projects where pid = '25-154-001';
  select array_agg(ps.stakeholder_id::text order by ps.stakeholder_id) into sk
    from pi_project_stakeholders ps
   where ps.project_id::text = p_id
     and coalesce(ps.stakeholder_role, 'External') = 'External';

  insert into pi_interactions
    (project_id, stakeholder_id, interaction_date, channel, subject, nature,
     direction, summary, logged_by, follow_up, follow_up_done, updated_by)
  select p_id, v.sid, v.d::date, v.ch, v.subj, v.nat, v.dir, v.summ, v.by,
         v.fu, v.fud, 'sr154-rpt-test'
  from (values
    (sk[1], d_from + 2,  'Email','Noise study delivered','Complaint','Outgoing',
     'Sent the completed corridor noise study to the HOA board with a summary of the findings at the subdivision frontage.','JP',false,false),
    (sk[1], d_from + 5,  'Phone','Noise study — board questions','Complaint','Incoming',
     'Board president called with questions about the modelled receptor locations. Walked through the three nearest receptors and the decibel results.','JP',true,false),
    (sk[2], d_from + 7,  'Email','Wildlife crossing — UDWR concurrence','Inquiry','Outgoing',
     'Forwarded the UDWR concurrence letter confirming the crossing width meets their criteria. Issue closed on the project record.','SB',false,false),
    (sk[6], d_from + 9,  'Phone','Spanish materials — more households','Request','Incoming',
     'Reported four more Spanish-speaking households on the adjacent street. Asked whether the mailing list can be flagged so future notices go out in both languages.','SB',true,false),
    (null,  d_from + 12, 'Phone','School access on Mustang Trail','Inquiry','Incoming',
     'Anonymous caller asked about school drop-off access during the eventual construction. Explained no work is scheduled yet.','JP',false,false),
    (sk[3], d_from + 15, 'In-person','Business owner meeting','Coordination','Outgoing',
     'Met at the shopping centre to review the Redwood Road approach layout. Owner satisfied with the southbound left retention.','JP',false,false),
    (sk[4], d_from + 19, 'Email','Comment matrix status','Inquiry','Incoming',
     'Asked how many of the DEIS comments have been responded to. Confirmed the matrix is being finalised.','SB',false,false),
    (sk[5], d_from + 23, 'Phone','Drainage exhibit question','Inquiry','Incoming',
     'Follow-up on the east-side drainage. Confirmed the ditch relocation stays inside existing right-of-way.','SB',false,false),
    (sk[2], d_from + 27, 'Email','Biological resources section','Inquiry','Incoming',
     'Asked for the biological resources section of the environmental document. Sent the chapter.','SB',false,false)
  ) as v(sid, d, ch, subj, nat, dir, summ, by, fu, fud);

  -- ── state MOVES: this is what report #2 will show and #1 did not ──
  update pi_issues
     set status = 'Resolved', date_resolved = d_from + 7,
         resolution_summary = 'UDWR issued written concurrence that the proposed crossing width meets their criteria for deer movement.',
         updated_at = now()
   where project_id::text = p_id and title = 'Wildlife crossing adequacy at MP 14.2';

  insert into pi_issues
    (project_id, title, category, description, status, priority, date_raised,
     assigned_to, created_by, updated_by)
  values
    (p_id, 'Spanish-language materials for the corridor mailing', 'Title VI / LEP',
     'Six Spanish-speaking households identified on the corridor notification list. Notices need to go out in both languages.',
     'Open', 'Medium', d_from + 9, 'SB', 'SB', 'sr154-rpt-test');

  update pi_commitments
     set status = 'Fulfilled', fulfilled_date = d_from + 2,
         fulfilled_notes = 'Noise study delivered to the HOA board with a findings summary.'
   where project_id = p_id::bigint
     and commitment = 'Report the noise study results back to the Harvest Hills HOA board';

  update pi_deliverables
     set progress = 85, status = 'In progress'
   where project_id::text = p_id and title = 'Comment Period Summary (DEIS)';

  raise notice '── BLOCK 2 done ──────────────────────────────────────────────';
  raise notice 'ARCHIVE REPORT #2 with period start % and period end %', d_from, d_to;
  raise notice '9 interactions · 1 issue closed, 1 new, 1 persisting · 1 commitment fulfilled · deliverable 65%% -> 85%%';
end $$;


-- ═══ BLOCK 3 — Period 3, and the state that MOVED since report #2 ═════════
-- Period: 30 days ago to today.  Story: the comment matrix completes, the LEP
-- issue closes, the noise wall issue is STILL open — a persisting item across
-- all three reports is the most useful thing the trend can surface.
do $$
declare
  p_id  text;
  d_from date := current_date - 30;
  d_to   date := current_date;
  sk     text[];
begin
  select id::text into p_id from pi_projects where pid = '25-154-001';
  select array_agg(ps.stakeholder_id::text order by ps.stakeholder_id) into sk
    from pi_project_stakeholders ps
   where ps.project_id::text = p_id
     and coalesce(ps.stakeholder_role, 'External') = 'External';

  insert into pi_interactions
    (project_id, stakeholder_id, interaction_date, channel, subject, nature,
     direction, summary, logged_by, follow_up, follow_up_due, follow_up_done, updated_by)
  select p_id, v.sid, v.d::date, v.ch, v.subj, v.nat, v.dir, v.summ, v.by,
         v.fu, v.fdue::date, v.fud, 'sr154-rpt-test'
  from (values
    (sk[1], d_from + 1,  'Phone','Noise wall determination timing','Complaint','Incoming',
     'Board president asked when a decision on the wall will be issued. Committed to a written determination once the final document is under way.','JP',true,current_date + 21,false),
    (sk[6], d_from + 2,  'Email','Bilingual notice confirmed','Request','Outgoing',
     'Confirmed the corridor notification list is now flagged for bilingual distribution. Six households receive both versions.','SB',false,null,false),
    (sk[4], d_from + 4,  'Email','Comment matrix complete','Inquiry','Outgoing',
     'Notified that all 23 DEIS comments now have finalised responses in the comment response matrix.','JP',false,null,false),
    (null,  d_from + 5,  'Phone','General project question','Inquiry','Incoming',
     'Caller would not give a name. Asked whether the project is still moving forward. Confirmed it is in environmental review.','JP',false,null,false),
    (sk[2], d_from + 7,  'Email','Final document schedule','Inquiry','Incoming',
     'Asked when the final environmental document is expected. Gave the current schedule with the caveat that it depends on agency review.','SB',false,null,false),
    (sk[3], d_from + 9,  'Phone','Construction window','Inquiry','Incoming',
     'Business owner asked for the earliest realistic construction window so they can plan inventory. Explained no date is committed yet.','JP',false,null,false),
    (sk[5], d_from + 11, 'In-person','Site visit — drainage','Coordination','Outgoing',
     'Second site visit to confirm the ditch relocation footprint with the owner present.','SB',false,null,false),
    (null,  d_from + 12, 'Phone','Noise concern — evening work','Complaint','Incoming',
     'Anonymous caller concerned about evening work noise once construction starts. Explained no work is scheduled and noise commitments will be in the final document.','JP',false,null,false),
    (sk[1], d_from + 14, 'Email','Noise wall — written response','Complaint','Outgoing',
     'Sent the HOA a written summary of the noise study findings and the process for the wall determination.','JP',false,null,false),
    (sk[4], d_from + 16, 'Media inquiry','Reporter question — corridor schedule','Inquiry','Incoming',
     'Local reporter asked about the corridor schedule and the comment period outcome. Referred to the public information officer and provided the approved fact sheet.','JP',true,current_date + 7,false),
    (sk[6], d_from + 18, 'Phone','Bilingual notice — thanks','Request','Incoming',
     'Called to say the Spanish notice was received and understood. No further action requested.','SB',false,null,false),
    (sk[2], d_from + 20, 'Email','Crossing design detail','Inquiry','Incoming',
     'Asked for the crossing cross-section now that UDWR has concurred. Sent the detail sheet.','SB',false,null,false),
    (sk[3], d_from + 22, 'Phone','Access during survey work','Inquiry','Incoming',
     'Asked whether upcoming survey crews will block the frontage. Confirmed survey work is in the shoulder only.','JP',false,null,false),
    (sk[5], d_from + 24, 'Email','Drainage exhibit — final','Inquiry','Outgoing',
     'Sent the final drainage exhibit following the site visit.','SB',false,null,false),
    (null,  d_from + 25, 'Phone','Wildlife crossing question','Inquiry','Incoming',
     'Anonymous caller asked whether the wildlife crossing is still in the design. Confirmed it is, with UDWR concurrence.','JP',false,null,false),
    (sk[4], d_from + 27, 'Email','Event in the corridor','Request','Incoming',
     'Event organiser asked whether an autumn charity run can use the corridor shoulder. Referred to UDOT Region 2 permits and offered to coordinate.','JP',true,current_date + 14,false),
    (sk[1], d_from + 28, 'Phone','Board meeting request','Complaint','Incoming',
     'HOA asked for a team representative at their next board meeting to present the noise findings. Agreed to attend.','JP',true,current_date + 30,false)
  ) as v(sid, d, ch, subj, nat, dir, summ, by, fu, fdue, fud);

  -- ── state MOVES again ──
  update pi_issues
     set status = 'Resolved', date_resolved = d_from + 2,
         resolution_summary = 'Corridor notification list flagged for bilingual distribution; Spanish materials mailed to all six households.',
         updated_at = now()
   where project_id::text = p_id and title = 'Spanish-language materials for the corridor mailing';

  -- 'Harvest Hills noise wall request' is deliberately left OPEN across all
  -- three reports. A persisting high-priority item is the single most useful
  -- thing the Project Status Report can surface, and it cannot be tested
  -- without one.

  update pi_commitments
     set status = 'Fulfilled', fulfilled_date = d_from + 4,
         fulfilled_notes = 'Corridor noise study completed and issued ahead of the final environmental document.'
   where project_id = p_id::bigint
     and commitment = 'Complete the corridor noise study before the final environmental document';

  insert into pi_commitments
    (project_id, commitment, made_to, made_by, date_made, due_date, category, status)
  values
    (p_id::bigint, 'Provide the noise wall determination to the HOA in writing',
     'Harvest Hills HOA', 'JP', d_from + 1, current_date + 21, 'Communication', 'Open');

  update pi_deliverables
     set progress = 100, status = 'Complete'
   where project_id::text = p_id and title = 'Comment Period Summary (DEIS)';
  update pi_deliverables
     set progress = 20, status = 'In progress'
   where project_id::text = p_id and title = 'Final EIS Support';

  raise notice '── BLOCK 3 done ──────────────────────────────────────────────';
  raise notice 'ARCHIVE REPORT #3 with period start % and period end %', d_from, d_to;
  raise notice '17 interactions · 1 issue closed, 1 STILL open · 1 commitment fulfilled, 1 new · 2 deliverables moved';
  raise notice 'Then: AI Project Status Report -> edit -> Publish trend to client portal.';
end $$;


-- ═══ Verify ═══════════════════════════════════════════════════════════════
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
