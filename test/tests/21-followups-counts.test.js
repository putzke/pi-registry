// The Follow-ups counts have to be readable as a set, not as three numbers to
// add up.
//
// Overdue is a SUBSET of open here — an overdue follow-up is still open, it is
// just late — which is the opposite of Commitments, where a past-due row is
// promoted out of Open into its own Overdue status. Two views using the same
// word for different sets is what made "14 Open / 12 Overdue" read as 26
// outstanding when the real answer is 14.
//
// So the arithmetic is asserted here in both directions: the badge equals the
// open-and-overdue list, and overdue is contained within it, never added to it.
module.exports = {
  name: 'follow-ups — overdue is part of the open count, and the labels say so',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // Truth from the database, scoped the way the view scopes by default:
      // assigned to the signed-in user, all projects.
      const n = (await t.sql(`
        with mine as (
          select * from pi_interactions
           where follow_up and coalesce(nullif(follow_up_assigned_to,''), logged_by) = 'PUT')
        select count(*) filter (where not coalesce(follow_up_done,false))::int outstanding,
               count(*) filter (where not coalesce(follow_up_done,false)
                                  and follow_up_due < current_date)::int overdue,
               count(*) filter (where not coalesce(follow_up_done,false)
                                  and (follow_up_due is null or follow_up_due >= current_date))::int notdue,
               count(*) filter (where coalesce(follow_up_done,false))::int resolved
          from mine`))[0];
      t.gt(n.outstanding, 0, 'the signed-in user has outstanding follow-ups');
      t.gt(n.overdue, 0, 'some of them are overdue');
      t.eq(n.overdue + n.notdue, n.outstanding,
           'overdue and not-yet-due partition the outstanding set');

      await app.page.evaluate(() => { S.fuProj = ''; S.projectFilter = ''; setView('followups'); });
      await app.page.waitForTimeout(200);

      const view = () => app.page.evaluate(() => {
        const main = document.getElementById('main');
        const stats = [...main.querySelectorAll('.scope-stat')].map(el => ({
          n: Number((el.querySelector('b') || {}).textContent),
          label: (el.querySelector('span') || {}).textContent.trim(),
          title: el.getAttribute('title') || '',
        }));
        const sel = document.getElementById('fu-status');
        return { stats, badge: Number(document.getElementById('nb-fu').textContent),
                 badgeTitle: document.getElementById('nb-fu').getAttribute('title') || '',
                 value: sel.value, options: [...sel.options].map(o => o.value),
                 labels: [...sel.options].map(o => o.text),
                 rows: main.querySelectorAll('tbody tr').length };
      });

      let v = await view();

      // ── the number the user asked about ─────────────────────────────────
      t.eq(v.badge, n.outstanding, 'the sidebar badge counts everything outstanding');
      t.eq(v.stats[0].n, n.outstanding, 'the first tile is the same number');
      t.eq(v.stats[1].n, n.overdue, 'the second tile is the overdue subset');
      t.eq(v.stats[2].n, n.resolved, 'the third is resolved');
      t.ok(v.stats[0].n + v.stats[1].n !== v.badge || v.stats[1].n === 0,
           'the first two tiles are NOT meant to be summed');

      // ── and the labels have to say so ───────────────────────────────────
      t.ok(/open\s*&\s*overdue/i.test(v.stats[0].label),
           `the open tile names both states — got "${v.stats[0].label}"`);
      t.ok(/of those/i.test(v.stats[1].label),
           `the overdue tile says it is part of them — got "${v.stats[1].label}"`);
      t.ok(/not additional/i.test(v.stats[1].title), 'and its tooltip is explicit');
      t.ok(/overdue ones included/i.test(v.badgeTitle),
           'the badge tooltip explains what it counts');

      // ── the default list matches the badge ──────────────────────────────
      t.eq(v.value, 'open', 'the view opens on open & overdue');
      t.eq(v.rows, n.outstanding, 'and lists exactly that many');
      t.ok(/open\s*&\s*overdue/i.test(v.labels[v.options.indexOf('open')]),
           'the dropdown option is named for what it does');

      // ── the set people ASSUME "Open" means is now selectable ────────────
      for (const [val, want] of [['notdue', n.notdue], ['overdue', n.overdue],
                                 ['resolved', n.resolved],
                                 ['all', n.outstanding + n.resolved]]) {
        await app.page.evaluate(x => {
          const s = document.getElementById('fu-status');
          s.value = x; s.dispatchEvent(new Event('change'));
        }, val);
        await app.page.waitForTimeout(150);
        v = await view();
        t.eq(v.rows, want, `"${val}" lists ${want}`);
        t.eq(v.value, val, `and the select still reads "${val}"`);
      }

      // The two halves must reconstruct the whole — that is the check that
      // would have caught a filter quietly dropping rows with no due date.
      t.eq(n.notdue + n.overdue, n.outstanding,
           'not-yet-due plus overdue equals the open & overdue list');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
