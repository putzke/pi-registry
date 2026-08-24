-- ═══════════════════════════════════════════════════════════════════════════
-- SR-154 (25-154-001) · client-reporting end-to-end test
-- 1 of 5 — Period 1 — the noise wall request lands
--
-- 14 interactions · opens 2 issues · opens 2 commitments.
-- The period dates are printed below the editor, in the Messages/Notices panel.
--
-- ▸ NEXT: archive report #1 in COMPASS with the dates this prints, tick
--         "Share with client", then run 02-period-2.sql
--
-- Full walkthrough and the reasoning behind the sequence: README.md in this
-- folder. Run these IN ORDER, and do the archive step between them — each
-- block advances the project, and an archived report freezes the state at the
-- moment you archive it. That movement is what gives the Project Status
-- Report something to compare.
-- ═══════════════════════════════════════════════════════════════════════════

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
