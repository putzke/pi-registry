-- ═══════════════════════════════════════════════════════════════════════════
-- SR-154 (25-154-001) · client-reporting end-to-end test
-- 3 of 5 — Period 3 — the matrix completes
--
-- 17 interactions · resolves the LEP issue · fulfils a commitment and opens a
-- new one · two deliverables move. The Harvest Hills noise wall issue is left
-- OPEN on purpose: a persisting high-priority item is the most useful thing the
-- trend can surface, and it can't be tested without one.
--
-- ▸ NEXT: archive report #3, share it, then in the Archive press
--         "AI: Project Status Report" -> edit -> "Publish trend to client
--         portal". Then open the SR-154 portal link -> Project Updates.
--
-- Full walkthrough and the reasoning behind the sequence: README.md in this
-- folder. Run these IN ORDER, and do the archive step between them — each
-- block advances the project, and an archived report freezes the state at the
-- moment you archive it. That movement is what gives the Project Status
-- Report something to compare.
-- ═══════════════════════════════════════════════════════════════════════════

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
