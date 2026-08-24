-- ═══════════════════════════════════════════════════════════════════════════
-- SR-154 (25-154-001) · client-reporting end-to-end test
-- 2 of 5 — Period 2 — the study lands, one issue closes
--
-- 9 interactions · resolves the wildlife-crossing issue · opens a Title VI/LEP
-- issue · fulfils one commitment · comment matrix 65% -> 85%.
--
-- ▸ NEXT: archive report #2 with the dates this prints, share it, then run
--         03-period-3.sql
--
-- Full walkthrough and the reasoning behind the sequence: README.md in this
-- folder. Run these IN ORDER, and do the archive step between them — each
-- block advances the project, and an archived report freezes the state at the
-- moment you archive it. That movement is what gives the Project Status
-- Report something to compare.
-- ═══════════════════════════════════════════════════════════════════════════

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
