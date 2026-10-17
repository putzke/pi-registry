// Follow-up "Assign to" offers the ACTIVE PI team list only (Oct 2026), and
// "Log next contact": next contacts link to the original; the follow-up lives
// only on the original; "This resolves the follow-up" closes it.
//  - No "Someone else…", no initials picked up from old logs, no inactive member.
//  - A member with no email is labelled, and picking them warns (they can't see
//    it under "Assigned to me", which finds people by their sign-in email).
//  - An existing off-list assignment is kept and labelled, not dropped on save.
//  - "Assigned to me" matches my team-list initials as well as my email's.
module.exports = {
  name: 'follow-ups — Assign to is the team list; Log next contact builds one conversation',
  async run({ t }) {
    t.seed();
    const [A] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 1`)).map(r => String(r.id));
    await t.sql(`update pi_projects set lead=null where id=$1`, [A]);
    await t.sql(`insert into pi_team_members (name, initials, email, active) values
      ('Jeff P','PUT','jeff.p@demo.test',true),('Bo Field','BNE',null,true),('Old Hand','OLD','old@demo.test',false)`);
    const [{ sid: parStake }] = await t.sql(`select stakeholder_id as sid from pi_project_stakeholders where project_id=$1 limit 1`, [A]);
    const [par] = await t.sql(`insert into pi_interactions (project_id, stakeholder_id, interaction_date, channel, direction, summary, logged_by, follow_up, follow_up_note, follow_up_due, follow_up_done, follow_up_assigned_to)
      values ($1, $2, '2026-10-01', 'Phone', 'Incoming', 'PARENT CALL', 'ZZQ', true, 'Call back at 555', '2026-10-03', false, 'JERRY') returning id`, [A, parStake]);
    const [mine] = await t.sql(`insert into pi_interactions (project_id, interaction_date, channel, direction, summary, logged_by, follow_up, follow_up_note, follow_up_due, follow_up_done, follow_up_assigned_to)
      values ($1, '2026-10-02', 'Phone', 'Incoming', 'MINE CALL', 'ZZQ', true, 'Send exhibit', '2026-10-04', false, 'PUT') returning id`, [A]);
    // Signed in as jeff.p@ → email initials "JEF"; on the team list as "PUT".
    const app = await t.open('index.html', { email: 'jeff.p@demo.test' });
    try {
      await app.ready();
      const opts = () => app.page.evaluate(() => [...document.getElementById('f-ifua').options].map(o => ({ v: o.value, t: o.textContent, sel: o.selected, dis: o.disabled })));

      await app.page.evaluate(pid => { S.projectFilter = pid; openIntModal(); }, A);
      let o = await opts();
      t.ok(!o.some(x => x.v === '__new' || /Someone else/.test(x.t)), 'no "Someone else…" option');
      t.ok(o.some(x => x.v === 'PUT' && /Jeff P \(PUT\)/.test(x.t)), 'an active member is offered by name');
      t.ok(o.some(x => x.v === 'BNE' && /no email/.test(x.t)), 'a member with no email is labelled');
      t.ok(!o.some(x => x.v === 'OLD'), 'an inactive member is not offered');
      t.ok(!o.some(x => x.v === 'ZZQ' || x.v === 'JERRY'), 'initials from old logs are not offered');
      await app.page.evaluate(() => { const s = document.getElementById('f-ifua'); s.value = 'BNE'; s.dispatchEvent(new Event('change')); });
      t.ok(/no email/.test(await app.page.evaluate(() => document.getElementById('f-ifua-warn').textContent)), 'picking a member with no email warns');
      await app.page.evaluate(() => { const s = document.getElementById('f-ifua'); s.value = 'PUT'; s.dispatchEvent(new Event('change')); });
      t.eq(await app.page.evaluate(() => document.getElementById('f-ifua-warn').textContent), '', 'a member with an email: no warning');
      await app.page.evaluate(() => closeM());

      // An existing off-list assignment survives the edit dialog.
      await app.page.evaluate(id => openEditIntModal(id), String(par.id));
      await app.page.waitForFunction(() => document.getElementById('f-ifua'));
      o = await opts();
      t.ok(o.some(x => x.v === 'JERRY' && x.sel && /not on the team list/.test(x.t)), 'an off-list assignee is kept, selected and labelled');
      t.ok(/not on the PI team list/.test(await app.page.evaluate(() => document.getElementById('f-ifua-warn').textContent)), 'and warned about');
      await app.page.evaluate(() => closeM());

      // Follow-ups table picker: same list.
      await app.page.evaluate(() => { S.fuUser = 'all'; S.fuStatus = 'open'; setView('followups'); });
      const tbl = await app.page.evaluate(() => [...document.querySelectorAll('select[onchange^="assignFollowUp"] option')].map(x => x.value));
      t.ok(tbl.length && !tbl.includes('__new') && tbl.includes('BNE') && !tbl.includes('OLD'), 'the Follow-ups table picker offers the team list only');

      // "Assigned to me" finds a follow-up assigned to my team-list initials.
      t.ok(await app.page.evaluate(id => _fuIsMine(DB.get('interactions').find(i => String(i.id) === id)), String(mine.id)), 'Mine matches my team-list initials (PUT) though my email gives JEF');
      await app.page.evaluate(() => { S.fuUser = 'mine'; render(); });
      t.ok(await app.page.evaluate(() => document.getElementById('main').textContent.includes('Send exhibit')), 'and it shows under "Assigned to me"');

      // Log next contact: original's contact by default (changeable), project locked.
      const nextOpen = async id => { await app.page.evaluate(() => closeM()); await app.page.evaluate(x => logRelatedInt(x), String(id)); await app.page.waitForFunction(() => /Next contact on/.test(document.getElementById('modal-ov').textContent)); };
      const saveNext = async (summary, resolve, otherStake) => app.page.evaluate(async ([sm, res, os]) => {
        const cb = document.getElementById('f-irelres'); if (cb) cb.checked = res;
        if (os) _intSetStake(os);
        document.getElementById('f-isu').value = sm; await saveInt();
      }, [summary, resolve, otherStake || null]);
      await nextOpen(par.id);
      t.eq(await app.page.evaluate(() => document.getElementById('f-idr').value), 'Outgoing', 'a next contact opens as Outgoing');
      t.eq(await app.page.evaluate(() => document.getElementById('f-is').value), String(parStake), 'it opens with the original contact');
      t.ok(await app.page.evaluate(() => !document.getElementById('f-is-search').disabled && document.getElementById('f-ip').disabled), 'the contact can be changed; the project cannot');
      t.ok(await app.page.evaluate(() => !document.querySelector('input[name="f-inext"]') && document.getElementById('f-ifu').offsetParent === null), 'no What’s next?, no follow-up box of its own');
      t.ok(await app.page.evaluate(() => document.getElementById('f-irelres').checked), '“This resolves the follow-up” starts ticked');
      // Still waiting: untick — the follow-up stays open on the original.
      const [{ sid: other }] = await t.sql(`select stakeholder_id as sid from pi_project_stakeholders where project_id=$1 and stakeholder_id<>$2 limit 1`, [A, parStake]);
      await saveNext('LEFT VOICEMAIL', false, String(other));
      const [w] = await t.until(async () => t.sql(`select stakeholder_id::text s, project_id::text p, follow_up, related_to::text r from pi_interactions where summary='LEFT VOICEMAIL'`));
      t.ok(w && w.s === String(other) && w.p === A && w.follow_up === false && w.r === String(par.id), 'saved with the changed contact, on the project, linked to the original, no follow-up');
      let [p1] = await t.sql(`select follow_up_done from pi_interactions where id=$1`, [par.id]);
      t.eq(p1.follow_up_done, false, 'unticked: the original’s follow-up stays open');
      // From the NEXT contact, Log next contact still links to the original.
      const [wid] = await t.sql(`select id from pi_interactions where summary='LEFT VOICEMAIL'`);
      await app.page.evaluate(id => openEditIntModal(id), String(wid.id));
      t.ok(await app.page.evaluate(() => /lives on the original/.test(document.getElementById('modal-ov').textContent) && document.getElementById('f-ifu').offsetParent === null && /Follow-up open: Call back at 555/.test(document.getElementById('modal-ov').textContent)), 'a next contact shows no follow-up of its own, and the conversation shows the open one');
      await nextOpen(wid.id);
      t.eq(await app.page.evaluate(() => document.getElementById('f-is').value), String(parStake), 'from a next contact it still defaults to the original’s contact');
      t.ok(await app.page.evaluate(() => !!document.querySelector('#modal-ov button[onclick^="saveIntAndNext"]')), 'a next contact can be saved straight into another one');
      await app.page.evaluate(async () => { document.getElementById('f-irelres').checked = false; document.getElementById('f-isu').value = 'SECOND TRY'; await saveIntAndNext(S.intOpts.relatedTo); });
      await app.page.waitForFunction(() => /Next contact on/.test(document.getElementById('modal-ov').textContent) && document.getElementById('f-isu').value === '');
      const [st] = await t.until(async () => t.sql(`select related_to::text r from pi_interactions where summary='SECOND TRY'`));
      t.eq(st && st.r, String(par.id), 'Save & log next contact saves it and opens the next one');
      await saveNext('CALLED BACK', true);
      const [c] = await t.until(async () => t.sql(`select related_to::text r from pi_interactions where summary='CALLED BACK'`));
      t.eq(c && c.r, String(par.id), 'and links to the original, not to the previous contact');
      [p1] = await t.sql(`select follow_up_done, follow_up_resolution from pi_interactions where id=$1`, [par.id]);
      t.ok(p1.follow_up_done === true && /Replied by phone/.test(p1.follow_up_resolution || ''), 'ticked: the original’s follow-up closes');
      await app.page.evaluate(id => openEditIntModal(id), String(par.id));
      t.ok(await app.page.evaluate(() => /Conversation · 4 contacts/.test(document.getElementById('modal-ov').textContent) && !!document.querySelector('#modal-ov button[onclick^="logRelatedInt"]')), 'the original lists the conversation and still offers Log next contact');
      await nextOpen(par.id);
      t.ok(await app.page.evaluate(() => !document.getElementById('f-irelres') && /lives on the original/.test(document.getElementById('modal-ov').textContent)), 'with the follow-up closed, no resolve box is offered');
      await app.page.evaluate(() => closeM());
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
