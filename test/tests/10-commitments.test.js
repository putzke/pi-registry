// The Commitments view's project selector.
//
// It was the one list view without one: Interactions, Follow-ups, Deliverables,
// Reports and Meetings all carry a project select, and Issues and Comments have
// their own. On Commitments the only way to see a single project's commitments
// was to select that project somewhere else and navigate in — and once there,
// no way back to all projects without leaving the view.
module.exports = {
  name: 'commitments — project selector scopes the view',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const totals = await t.sql(
        `select p.id, p.pid, count(c.id)::int n
           from pi_projects p left join pi_commitments c on c.project_id::text = p.id::text
          group by p.id, p.pid order by p.id`);
      t.gt(totals.length, 1, 'seed has commitments across more than one project');
      const grand = totals.reduce((a, r) => a + r.n, 0);

      await app.page.evaluate(() => { S.projectFilter = null; setView('commitments'); });
      await app.page.waitForTimeout(200);

      const sel = () => app.page.evaluate(() => {
        const s = [...document.querySelectorAll('#main select')]
          .find(x => /All projects/.test(x.innerHTML));
        return s ? { opts: s.options.length, value: s.value,
                     count: (document.querySelector('#main [style*="margin-left:auto"]') || {}).textContent || '' }
                 : null;
      });

      let v = await sel();
      t.ok(v, 'the view renders a project select');
      t.eq(v.opts, totals.length + 1, 'it lists every project plus "All projects"');
      t.eq(v.value, '', 'defaults to All projects when nothing is scoped');
      t.ok(v.count.includes(String(grand)),
           `unscoped shows every commitment (${grand}) — got "${v.count.trim()}"`);

      // Scoping through the select must filter the list and stick in the control.
      const target = totals.find(r => r.n > 0);
      await app.page.evaluate(id => {
        const s = [...document.querySelectorAll('#main select')]
          .find(x => /All projects/.test(x.innerHTML));
        s.value = id; s.dispatchEvent(new Event('change'));
      }, String(target.id));
      await app.page.waitForTimeout(200);

      v = await sel();
      t.eq(v.value, String(target.id), 'the chosen project stays selected after re-render');
      t.ok(v.count.includes(String(target.n)),
           `scoped shows only that project's commitments (${target.n}) — got "${v.count.trim()}"`);

      // It writes the shared scope, so arriving from elsewhere pre-selects.
      const shared = await app.page.evaluate(() => String(S.projectFilter));
      t.eq(shared, String(target.id), 'it sets the same S.projectFilter the other views use');

      // And there is a way back to all projects without leaving the view.
      await app.page.evaluate(() => {
        const s = [...document.querySelectorAll('#main select')]
          .find(x => /All projects/.test(x.innerHTML));
        s.value = ''; s.dispatchEvent(new Event('change'));
      });
      await app.page.waitForTimeout(200);
      v = await sel();
      t.ok(v.count.includes(String(grand)), 'selecting All projects restores the full list');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
