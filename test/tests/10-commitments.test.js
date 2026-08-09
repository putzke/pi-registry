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

      // The status filter defaults to "Open & overdue" (see below), so widen it
      // to All statuses first — these checks are about the PROJECT selector.
      await app.page.evaluate(() => {
        S.projectFilter = null; setView('commitments');
        S.commStatus = ''; renderCommitments(document.getElementById('main'));
      });
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

      // ── status filter: the nav badge has to be reachable ────────────────
      // The badge counts open + overdue. The filter select was built from
      // COMM_STATUSES (['Open','Fulfilled']), so "Overdue" could not be picked
      // and no single choice matched the badge — an overdue commitment was
      // counted in the sidebar and invisible in every selectable filter.
      const stored = (await t.sql(`
        select count(*) filter (where status='Open')::int open_stored,
               count(*) filter (where status='Open' and due_date < current_date)::int overdue,
               count(*) filter (where status='Fulfilled')::int fulfilled
          from pi_commitments`))[0];
      t.gt(stored.overdue, 0, 'seed has at least one overdue commitment');
      const open = stored.open_stored - stored.overdue;   // Open but not yet past due

      const view = () => app.page.evaluate(() => {
        const s = [...document.querySelectorAll('#main select')]
          .find(x => /All statuses/.test(x.innerHTML));
        const txt = document.getElementById('main').textContent;
        return {
          value: s ? s.value : null,
          options: s ? [...s.options].map(o => o.value) : [],
          labels: s ? [...s.options].map(o => o.text) : [],
          shown: (/(\d+) commitments?/.exec(txt) || [])[1],
          badge: (document.getElementById('nb-comm') || {}).textContent,
          rowsOverdue: (txt.match(/Overdue/g) || []).length,
        };
      });

      // Arriving through the nav is the case that matters.
      await app.page.evaluate(() => { S.projectFilter = null; setView('commitments'); });
      await app.page.waitForTimeout(200);
      let s = await view();
      t.eq(s.value, 'open-overdue', 'the view opens on "Open & overdue"');
      t.ok(s.options.includes('Overdue'), 'Overdue is now a selectable option');
      t.ok(s.labels.some(l => /open & overdue/i.test(l)), 'so is the combined choice');
      t.eq(s.shown, String(open + stored.overdue),
           'the default list is exactly what the nav badge counts');
      t.eq(s.badge, String(open + stored.overdue),
           'and the badge agrees with it');
      t.gt(s.rowsOverdue, 0, 'the overdue commitment is visible on arrival');

      // Each narrower choice still works, and the select stops lying about it.
      for (const [val, want] of [['Open', open], ['Overdue', stored.overdue],
                                 ['Fulfilled', stored.fulfilled]]) {
        await app.page.evaluate(v => {
          const el = [...document.querySelectorAll('#main select')]
            .find(x => /All statuses/.test(x.innerHTML));
          el.value = v; el.dispatchEvent(new Event('change'));
        }, val);
        await app.page.waitForTimeout(150);
        s = await view();
        t.eq(s.shown, String(want), `filtering to ${val} shows ${want}`);
        t.eq(s.value, val, `and the select still reads "${val}" after re-render`);
      }

      // Clicking the red tile is the other way in, and it used to leave the
      // select displaying "All statuses" while showing only overdue rows.
      await app.page.evaluate(() => {
        S.commStatus = 'Overdue'; renderCommitments(document.getElementById('main'));
      });
      await app.page.waitForTimeout(150);
      s = await view();
      t.eq(s.value, 'Overdue', 'the tile shortcut is reflected in the select');
      t.eq(s.shown, String(stored.overdue), 'and shows the overdue commitments');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
