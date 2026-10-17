// Follow-up "Assign to" offers the ACTIVE PI team list only (Oct 2026), and
// "+ Related contact" warns before leaving a thread with two open follow-ups.
//  - No "Someone else…", no initials picked up from old logs, no inactive member.
//  - A member with no email is labelled, and picking them warns (they can't see
//    it under "Assigned to me", which finds people by their sign-in email).
//  - An existing off-list assignment is kept and labelled, not dropped on save.
//  - "Assigned to me" matches my team-list initials as well as my email's.
module.exports = {
  name: 'follow-ups — Assign to is the team list; related contact warns about two open follow-ups',
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

      // + Related contact: two open follow-ups are called out.
      await app.page.evaluate(id => logRelatedInt(id), String(par.id));
      await app.page.waitForFunction(() => document.getElementById('f-irelres'));
      t.eq(await app.page.evaluate(() => document.getElementById('f-idr').value), 'Outgoing', 'a related contact opens as Outgoing');
      t.eq(await app.page.evaluate(() => document.getElementById('f-is').value), String(parStake), 'a related contact opens with the same contact');
      const warn = () => app.page.evaluate(() => { const w = document.getElementById('f-irel-warn'); return w.style.display !== 'none' ? w.textContent : ''; });
      await app.page.evaluate(() => { const f = document.getElementById('f-ifu'); f.checked = true; f.dispatchEvent(new Event('change')); });
      t.eq(await warn(), '', 'resolves ticked + new follow-up: no warning (a handoff)');
      await app.page.evaluate(() => { const r = document.getElementById('f-irelres'); r.checked = false; r.dispatchEvent(new Event('change')); });
      const w = await warn();
      t.ok(/stay open/.test(w) && /Call back at 555/.test(w), 'resolves unticked + new follow-up: warns the original stays open, by name');
      await app.page.evaluate(() => { const f = document.getElementById('f-ifu'); f.checked = false; f.dispatchEvent(new Event('change')); });
      t.eq(await warn(), '', 'no new follow-up: no warning');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
