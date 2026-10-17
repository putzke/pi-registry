// Follow-up "Assign to" offers the ACTIVE PI team list only (Oct 2026), and
// "Log next contact": one question, one open follow-up per thread.
//  - No "Someone else…", no initials picked up from old logs, no inactive member.
//  - A member with no email is labelled, and picking them warns (they can't see
//    it under "Assigned to me", which finds people by their sign-in email).
//  - An existing off-list assignment is kept and labelled, not dropped on save.
//  - "Assigned to me" matches my team-list initials as well as my email's.
module.exports = {
  name: 'follow-ups — Assign to is the team list; one open follow-up per thread',
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

      // Log next contact: ONE question, one open task per thread.
      const nextOpen = async () => { await app.page.evaluate(() => closeM()); await app.page.evaluate(id => logRelatedInt(id), String(par.id)); await app.page.waitForFunction(() => document.querySelector('input[name="f-inext"]')); };
      const saveNext = async (choice, summary) => app.page.evaluate(async ([c, sm]) => {
        document.querySelector(`input[name="f-inext"][value="${c}"]`).click();
        if (c === 'new') { document.getElementById('f-ifun').value = 'Email the exhibit'; document.getElementById('f-ifud').value = '2026-11-01'; }
        document.getElementById('f-isu').value = sm; await saveInt();
      }, [choice, summary]);
      await nextOpen();
      t.eq(await app.page.evaluate(() => document.getElementById('f-idr').value), 'Outgoing', 'a next contact opens as Outgoing');
      t.eq(await app.page.evaluate(() => document.getElementById('f-is').value), String(parStake), 'a next contact opens with the same contact');
      t.ok(await app.page.evaluate(() => !document.getElementById('f-irelres') && !document.getElementById('f-irel-warn')), 'the two checkboxes and the warning are gone');
      t.eq(await app.page.evaluate(() => [...document.querySelectorAll('input[name="f-inext"]')].map(r => r.value).join(',')), 'done,wait,new', 'What’s next? offers Done / Still waiting / New next step');
      // Still waiting: the original stays open, due moves.
      await saveNext('wait', 'LEFT VOICEMAIL');
      let p1 = (await t.sql(`select follow_up_done, follow_up_due::text d from pi_interactions where id=$1`, [par.id]))[0];
      t.ok(p1.follow_up_done === false && p1.d > '2026-10-03', 'Still waiting keeps the follow-up open and moves its due date');
      const [w] = await t.sql(`select follow_up from pi_interactions where summary='LEFT VOICEMAIL'`);
      t.ok(w && w.follow_up === false, 'and the new contact carries no follow-up of its own');
      // The edit dialog of the new contact shows the thread's open task, not an empty checkbox.
      const [wid] = await t.sql(`select id from pi_interactions where summary='LEFT VOICEMAIL'`);
      await app.page.evaluate(id => openEditIntModal(id), String(wid.id));
      await app.page.waitForFunction(() => document.getElementById('fu-own'));
      t.ok(await app.page.evaluate(() => /open follow-up: Call back at 555/.test(document.getElementById('modal-ov').textContent) && document.getElementById('fu-own').style.display === 'none'), 'a thread member shows the conversation’s open follow-up instead of its own checkbox');
      t.ok(await app.page.evaluate(() => /⏳ Open: Call back at 555/.test(document.getElementById('modal-ov').textContent)), 'the thread list marks the open task');
      // New next step: old closes, new opens on the new contact — still one open.
      await nextOpen();
      await saveNext('new', 'CALLED BACK');
      const open = await t.sql(`select summary, follow_up_note from pi_interactions where follow_up and not coalesce(follow_up_done,false) and (id::text=$1 or related_to::text=$1)`, [String(par.id)]);
      t.ok(open.length === 1 && open[0].summary === 'CALLED BACK' && open[0].follow_up_note === 'Email the exhibit', 'New next step closes the old follow-up and opens one on the new contact — one open task');
      // Done: closes the thread's open task, even when it sits on a later contact.
      await nextOpen();
      await saveNext('done', 'ALL SORTED');
      const open2 = await t.sql(`select id from pi_interactions where follow_up and not coalesce(follow_up_done,false) and (id::text=$1 or related_to::text=$1)`, [String(par.id)]);
      t.eq(open2.length, 0, 'Done closes the thread’s open task wherever it sits');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
