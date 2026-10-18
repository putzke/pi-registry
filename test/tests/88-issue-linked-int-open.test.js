// An issue's linked interactions open the interaction (Jeff, Oct 2026).
//
//  - On both issue screens (Project contacts → Issues, and the Issues view)
//    each linked-interaction card is clickable and opens that interaction's
//    Edit window.
//  - Afterwards the same issue is still shown.
//  - A next contact logged from that window ("Log next contact") inherits the
//    original's issue, so the call-back shows under the issue too.
module.exports = {
  name: 'issues — linked interactions open the interaction; next contacts keep the issue',
  async run({ t }) {
    t.seed();
    const [A] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 1`)).map(r => String(r.id));
    const [st] = await t.sql(`select s.id from pi_stakeholders s join pi_project_stakeholders l on l.stakeholder_id = s.id::text
                               where l.project_id=$1 and coalesce(s.is_archived,false)=false order by s.id limit 1`, [A]);
    const [iss] = await t.sql(`insert into pi_issues (project_id, title, status, priority, category, date_raised) values ($1,'ISSUE BAKERY','Open','High','Traffic & Access','2026-10-01') returning id`, [A]);
    const [orig] = await t.sql(`insert into pi_interactions (project_id, stakeholder_id, interaction_date, channel, direction, summary, logged_by)
                                values ($1,$2,'2026-10-14','Phone','Incoming','ORIGINAL CALL ABOUT BAKERY','PUT') returning id`, [A, String(st.id)]);
    await t.sql(`insert into pi_issue_interactions (issue_id, interaction_id) values ($1,$2)`, [String(iss.id), String(orig.id)]);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const card = () => app.page.evaluate(() => [...document.querySelectorAll('.iss-int')].find(c => /ORIGINAL CALL/.test(c.textContent)));
      const opened = () => app.page.waitForFunction(() => document.getElementById('f-isu') && /ORIGINAL CALL ABOUT BAKERY/.test(document.getElementById('f-isu').value));

      // ── Project contacts → Issues ───────────────────────────────────────
      await app.page.evaluate(({ A, id }) => { S.projectFilter = A; S.skView = 'issues'; S.selIssue = id; setView('stakeholders'); }, { A, id: String(iss.id) });
      t.ok(await app.page.evaluate(() => { const c = [...document.querySelectorAll('.iss-int')].find(c => /ORIGINAL CALL/.test(c.textContent)); return !!c && /openEditIntModal/.test(c.getAttribute('onclick')) && getComputedStyle(c).cursor === 'pointer'; }),
        'Project contacts → Issues: the linked interaction is a clickable card');
      await app.page.evaluate(() => [...document.querySelectorAll('.iss-int')].find(c => /ORIGINAL CALL/.test(c.textContent)).click());
      await opened();
      t.ok(true, 'clicking it opens that interaction’s Edit window');

      // Log next contact from it: the issue carries over.
      await app.page.evaluate(id => logRelatedInt(id), String(orig.id));
      await app.page.waitForFunction(() => /Next contact on/.test(document.getElementById('modal-ov').textContent));
      t.eq(await app.page.evaluate(() => document.getElementById('f-iissue').value), String(iss.id), 'a next contact opens linked to the same issue');
      await app.page.evaluate(() => { document.getElementById('f-isu').value = 'CALLED BACK THE BAKERY'; return saveInt(); });
      const child = await t.until(async () => (await t.sql(`select id from pi_interactions where summary='CALLED BACK THE BAKERY'`))[0]);
      t.ok(child && (await t.until(async () => (await t.sql(`select 1 from pi_issue_interactions where issue_id=$1 and interaction_id=$2`, [String(iss.id), String(child.id)]))[0])),
        '…and is saved under the issue');
      t.ok(await app.page.evaluate(() => S.skView === 'issues' && /ISSUE BAKERY/.test(document.getElementById('issues-detail-pane').textContent)
        && /CALLED BACK THE BAKERY/.test(document.getElementById('issues-detail-pane').textContent)),
        'back on the same issue, with the call-back listed under it');

      // ── Issues view ─────────────────────────────────────────────────────
      await app.page.evaluate(id => { closeM(); setView('issues'); _selectIssueView(id); }, String(iss.id));
      t.ok(await app.page.evaluate(() => [...document.querySelectorAll('.iss-int')].some(c => /ORIGINAL CALL/.test(c.textContent))), 'Issues view: the linked interaction is a clickable card too');
      await app.page.evaluate(() => [...document.querySelectorAll('.iss-int')].find(c => /ORIGINAL CALL/.test(c.textContent)).click());
      await opened();
      t.ok(true, 'and opens the Edit window');
      await app.page.evaluate(() => closeM());
      t.ok(await app.page.evaluate(() => S.view === 'issues' &&  /ISSUE BAKERY/.test(document.querySelector('.content, #main').textContent)), 'closing it leaves you on the issue');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
