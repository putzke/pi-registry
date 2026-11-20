// Mobile catch-up for two desktop changes (Nov 2026, Jeff):
//  - Home's "Open F/U" card opens Follow-ups for that project, ALL follow-ups,
//    and names the overdue count (desktop dashboard card's tag);
//  - an issue's linked interactions open the interaction (desktop issue panes).
module.exports = {
  name: 'mobile — follow-up card opens Follow-ups; issue linked interactions open',
  async run({ t }) {
    t.seed();
    const mob = await t.open('mobile.html', { email: 'putzke@demo.test', viewport: { width: 414, height: 896 } });
    try {
      await mob.page.waitForFunction(() => typeof _syncCache !== 'undefined' && (_syncCache.projects || []).length > 0, null, { timeout: 15000 });
      const r = await mob.page.evaluate(() => {
        const pid = String(_syncCache.projects[0].id);
        _syncCache.interactions = [
          { id: '901', projectId: pid, date: '2030-01-01', channel: 'Phone', summary: 'OD', followUp: true, followUpDone: false, followUpDue: '2020-01-01', loggedBy: 'ZZ' },
          { id: '902', projectId: pid, date: '2030-01-02', channel: 'Phone', summary: 'LINKED', followUp: false },
        ];
        populateProjectDropdowns && populateProjectDropdowns();
        const hp = document.getElementById('home-proj'); hp.value = pid; refreshHome();
        const card = [...document.querySelectorAll('#home-stats .stat-card')].find(c => /F\/U/.test(c.textContent));
        const label = card.textContent.trim();
        document.getElementById('fu-user').value = 'mine';
        card.click();
        const onFu = document.getElementById('screen-followups').classList.contains('active');
        const fuProj = document.getElementById('fu-proj').value, fuUser = document.getElementById('fu-user').value;
        const fuText = document.getElementById('fu-list').textContent;
        _syncCache.issues = [{ id: '77', projectId: pid, title: 'T', status: 'Open', assignedTo: 'Region PM', description: '<b>x</b>' }];
        _syncCache.issue_interactions = [{ id: '1', issueId: '77', interactionId: '902' }];
        openIssueDetail('77');
        const row = [...document.querySelectorAll('#iss-detail-body .list-item')].find(e => /LINKED/.test(e.textContent));
        row.click();
        const body = document.getElementById('iss-detail-body');
        const asg = /Assigned to\s*Region PM/.test(body.textContent), esc = !body.querySelector('b') && /<b>x<\/b>/.test(body.textContent);
        const sheetOpen = document.getElementById('sheet-log').classList.contains('open');
        return { label, onFu, fuProj, pid, fuUser, fuHasOd: /OD/.test(fuText), sheetOpen, asg, esc };
      });
      t.ok(/1 overdue F\/U/.test(r.label), 'card names the overdue count: ' + r.label);
      t.ok(r.onFu, 'card opens Follow-ups');
      t.eq(r.fuProj, r.pid, 'scoped to the same project');
      t.eq(r.fuUser, 'all', 'all follow-ups, not just mine');
      t.ok(r.fuHasOd, "a colleague's overdue follow-up is listed");
      t.ok(r.sheetOpen, 'tapping a linked interaction on an issue opens it');
      t.ok(r.asg, "the issue's Assigned to shows");
      t.ok(r.esc, 'issue text is shown as text, not HTML');
      t.eq(mob.errors, [], 'no page errors');
    } finally { await mob.close(); }
  },
};
