// Flags that only updated after a page refresh (Oct 2026).
//
//  1. Exporting a project wrote lastExported into the cache and never redrew,
//     so the card's "Exported today" flag appeared only after a reload.
//     Reported live on 1200 South Wastewater (PIN 700). Same for the
//     portfolio export.
//  2. The sidebar counts were refreshed only by render(), but ~20 save paths
//     redraw just their own view (deleteIssue → renderStakeholders,
//     saveMeeting → renderMeetings, attachOwner → the parcel modal…), so a
//     count stayed stale until the next full render. Every DB.set and every
//     database write now schedules one refreshBadges().
const STUB_XLSX = () => {
  window.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: () => {} },
                  write: () => new Uint8Array([0]) };
};

module.exports = {
  name: 'stale flags — export date and sidebar counts update without a refresh',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    await t.sql(`update pi_projects set last_exported = null`);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      await app.page.evaluate(STUB_XLSX);

      // ── 1. single-project export ────────────────────────────────────────
      // The export date lives in the card's More ▾ menu (Nov 2026): "Export ·
      // last <date>". It must show the new date straight after exporting.
      const card = (pid) => app.page.evaluate(pid => {
        const btn = [...document.querySelectorAll('#main .proj-more-btn')].find(b => (b.getAttribute('onclick') || '').includes(`'${pid}'`));
        if (!btn) return null;
        _pmClose(); btn.click();
        const m = document.querySelector('.proj-more-menu');
        const exp = m && [...m.querySelectorAll('.pm-item')].find(x => /Export/.test(x.textContent));
        const txt = exp ? exp.textContent.replace(/\s+/g, ' ') : null;
        _pmClose();
        return txt;
      }, pid);
      const today = await app.page.evaluate(() => fmt(localToday()));
      await app.page.evaluate(() => { S.view = 'projects'; render(); });
      const before = await card(P);
      t.ok(before && /never/.test(before), 'the More menu says the project was never exported: ' + before);
      await app.page.evaluate(pid => exportProject(pid), P);
      const after = await card(P);
      t.ok(after && after.includes('last ' + today), 'straight after exporting it shows today, no refresh: ' + after);

      // ── 1b. portfolio export ────────────────────────────────────────────
      const others = await app.page.evaluate(pid => DB.get('projects').filter(p => String(p.id) !== pid && p.status !== 'Archived').map(p => String(p.id)), P);
      await app.page.evaluate(() => { S.view = 'projects'; render(); exportPortfolio(); });
      let flagged = 0;
      for (const id of others) { const x = await card(id); if (x && x.includes('last ' + today)) flagged++; }
      t.ok(flagged > 0, `after a portfolio export the other projects show today too (${flagged})`);

      // ── 2. sidebar counts follow the data ───────────────────────────────
      const badge = () => app.page.evaluate(() => {
        const b = document.getElementById('issues-badge');
        return b && b.style.display !== 'none' ? parseInt(b.textContent, 10) : 0;
      });
      await app.page.evaluate(() => { S.view = 'dashboard'; render(); });
      const n0 = await badge();
      // A write that redraws nothing at all.
      await app.page.evaluate(async pid => {
        const all = DB.get('issues');
        all.push({ id: DB.uid(), projectId: pid, title: 'Badge test', status: 'Open', priority: 'Low' });
        await DB.set('issues', all);
        await new Promise(r => setTimeout(r, 50));
      }, P);
      t.eq(await badge(), n0 + 1, 'the Issues count goes up the moment an issue is saved');

      // A real save path that redraws only its own view.
      const id = await t.until(async () => (await t.sql(`select id from pi_issues where title='Badge test'`))[0]);
      await app.page.evaluate(async ([iid, pid]) => {
        window.confirm = () => true;
        S.view = 'stakeholders'; S.projectFilter = pid; render();
        await deleteIssue(String(iid), pid);
        await new Promise(r => setTimeout(r, 50));
      }, [id.id, P]);
      t.eq(await badge(), n0, 'deleting it (which redraws only the contacts view) brings the count back down');

      // A burst of writes costs one refresh, not one per write.
      const calls = await app.page.evaluate(async () => {
        let n = 0; const real = refreshBadges; window.refreshBadges = () => { n++; real(); };
        try {
          for (let i = 0; i < 5; i++) _syncCache.issues = _syncCache.issues.slice(), DB.set('issues', DB.get('issues'));
          await new Promise(r => setTimeout(r, 50));
        } finally { window.refreshBadges = real; }
        return n;
      });
      t.ok(calls >= 1 && calls <= 2, `five quick writes refresh the counts once or twice, not five times (${calls})`);
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
