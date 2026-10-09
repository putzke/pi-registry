// "Last report: <date>" on the dashboard project cards (Oct 2026; was
// "✦ Portal: <date>", which counted only published Project Status Reports and
// so stayed blank on every project reported by shared PI report PDFs).
//
// The date is the newest report the client received — a PI report shared to
// the portal or a published Project Status Report — amber at 30 days, and an
// active project with neither reads "No report shared yet". The Team view
// counts staleness from the same rule.
module.exports = {
  name: 'dashboard — last report date counts shared PDFs and status reports',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const projs = await app.page.evaluate(() => _syncCache.projects.map(p => ({ id: String(p.id), pid: p.pid })));
      const viaPdf = projs.find(p => p.pid === '25-154-001');
      const viaSum = projs.find(p => p.pid === '25-LC-400N');
      const none   = projs.find(p => p.pid === '25-3W-DESIGN');
      t.ok(viaPdf && viaSum && none, 'found the three demo projects');

      const out = await app.page.evaluate(([a, b, c]) => {
        const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
        try { localStorage.setItem('cc_proj_scope', 'all'); } catch (e) {}
        _syncCache.client_summaries = [{ id: 'x2', projectId: b, contentFull: 'old', publishedAt: day(45) + 'T12:00:00Z' }];
        _syncCache.report_archive = [
          { id: 'r1', projectId: a, reportTitle: 'PI Update', reportNum: '7', clientVisible: true, docxPath: a + '/r1.pdf', docxUploadedAt: day(3) + 'T12:00:00Z', archivedAt: day(10) + 'T12:00:00Z' },
          { id: 'r2', projectId: a, reportTitle: 'PI Update', reportNum: '8', clientVisible: false, docxPath: a + '/r2.pdf', docxUploadedAt: day(1) + 'T12:00:00Z' },
          { id: 'r3', projectId: c, reportTitle: 'Draft', clientVisible: false, archivedAt: day(2) + 'T12:00:00Z' },
        ];
        setView('dashboard');
        const card = id => [...document.querySelectorAll('#dash-proj-cards > div[onclick]')].find(d => d.getAttribute('onclick').includes("'" + id + "'"));
        const chip = id => { const el = [...card(id).querySelectorAll('span')].find(s => /^(Last report|No report)/.test(s.textContent)); return el ? { text: el.textContent, style: el.getAttribute('style'), title: el.getAttribute('title') } : null; };
        return { a: chip(a), b: chip(b), c: chip(c), old: /Portal:/.test(document.getElementById('dash-proj-cards').textContent),
                 day3: day(3), day45: day(45) };
      }, [viaPdf.id, viaSum.id, none.id]);

      t.ok(out.a && out.a.style.includes('--teal') && /PI Update #7/.test(out.a.title), 'a PDF shared 3 days ago counts, teal, and names the report (an unshared newer one does not)');
      t.ok(out.b && out.b.style.includes('--amber') && /Project Status Report/.test(out.b.title), 'a status report 45 days ago still counts, amber');
      t.ok(out.c && /^No report shared yet/.test(out.c.text) && out.c.style.includes('--amber'), 'a project whose only report is unshared says "No report shared yet"');
      t.ok(!out.old, 'the old "Portal:" chip is gone');
      t.ok(/\d+(d|mo) ago|Today|Yesterday/.test(out.a.title), 'the tooltip carries the age');

      const team = await app.page.evaluate(id => {
        const w = _teamWorkload();
        for (const r of w.rows) { const x = r.projects.find(q => String(q.p.id) === id); if (x) return x.lastPub; }
        return 'no lead';
      }, viaPdf.id);
      t.ok(team === out.day3 || team === 'no lead', 'the Team view reads the same date: ' + team);
      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
