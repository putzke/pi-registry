// Team view, "No report 30+ days": On hold projects are paused, so they are
// NOT counted (Jeff, Nov 2026). The column counts Active projects only and
// says "on hold" for the rest; an On hold project's button is not amber and
// carries "· on hold".
module.exports = {
  name: 'team view — On hold projects are left out of "No report 30+ days"',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(() => {
        const mk = (id, pid, status, lead) => ({ id, pid, name: 'P' + pid, status, lead });
        _syncCache.projects = [mk('901', 'A1', 'Active', 'ZQA'), mk('902', 'H1', 'On hold', 'ZQA'),
          mk('903', 'H2', 'On hold', 'ZQB')];
        _syncCache.report_archive = []; _syncCache.client_summaries = [];
        const w = _teamWorkload();
        const a = w.rows.find(x => x.ini === 'ZQA'), b = w.rows.find(x => x.ini === 'ZQB');
        S.view = 'team'; render();
        const cell = ini => { const tr = document.querySelector(`.team-row[data-ini="${ini}"]`); return tr ? tr.lastElementChild.textContent.replace(/\s+/g, ' ').trim() : null; };
        const btn = pid => [...document.querySelectorAll('.team-row button')].find(x => x.textContent.includes(pid));
        const h = btn('H1'), ac = btn('A1');
        return { aStale: a.stale.length, aHeld: a.held, bStale: b.stale.length, cellA: cell('ZQA'), cellB: cell('ZQB'),
          hTag: h && /on hold/.test(h.textContent), hAmber: h && /232,160,32/.test(h.getAttribute('style')),
          aAmber: ac && /232,160,32/.test(ac.getAttribute('style')) };
      });
      t.eq(r.aStale, 1, 'the Active project with no report still counts');
      t.eq(r.aHeld, 1, 'the On hold project is set aside');
      t.eq(r.bStale, 0, 'a lead with only On hold projects has nothing counted');
      t.ok(/1 of 1/.test(r.cellA) && /1 on hold/.test(r.cellA), 'mixed lead reads "1 of 1" + "1 on hold": ' + r.cellA);
      t.eq(r.cellB, 'On hold', 'a lead with only On hold projects reads "On hold"');
      t.ok(r.hTag, 'the On hold project button says on hold');
      t.ok(!r.hAmber, 'the On hold project button is not amber');
      t.ok(r.aAmber, 'the stale Active project button is still amber');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
