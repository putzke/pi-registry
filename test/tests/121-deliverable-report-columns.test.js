// Deliverable / scope status quick report: Contracted, Delivered and Due are
// narrow so the Type column has room (Jeff, Nov 2026). The report frame uses
// table-layout:fixed, which split the eight columns evenly before.
const SHOT = process.env.SHOT_DIR;
module.exports = {
  name: 'deliverable status report — column widths',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      for (const mode of ['single', 'pkg']) {
        await app.page.evaluate((mode) => {
          const P = DB.get('projects').find(p => p.pid === '25-LC-400N');
          const projF = P.id; S.projectFilter = projF;
          _syncCache.deliverables = (DB.get('deliverables') || []).filter(d => String(d.projectId) !== String(projF)).concat([
            { id: 'c1', projectId: projF, type: 'Stakeholder database / registry', scopeType: 'milestone', contractedQty: 1, deliveredCount: 1, status: 'Complete' },
            { id: 'c2', projectId: projF, type: 'Door-to-door canvass / door hanger', scopeType: 'fixed', contractedQty: 1, deliveredCount: 8, status: 'Complete', dueDate: '2026-09-17' },
            { id: 'c3', projectId: projF, type: 'Partnering Meetings (In-person)', scopeType: 'fixed', contractedQty: 6, deliveredCount: 13, status: 'In progress', dueDate: '2026-10-16' },
          ]);
          S.view = 'reports'; S.rptTab = 'reports'; render();
          if (mode === 'single') generateReport('deliverable-status');
          else {
            openReportSequenceModal();
            document.querySelector('.rpt-seq-sel[data-rid="deliverable-status"]').value = '1';
            generateReportSequence();
          }
        }, mode);
        await app.page.waitForFunction(() => {
          const f = document.getElementById('inline-rpt-frame');
          return f && f.contentDocument && f.contentDocument.querySelector('colgroup');
        });
        const r = await app.page.evaluate(() => {
          const doc = document.getElementById('inline-rpt-frame').contentDocument;
          const tbl = [...doc.querySelectorAll('table.dtable')].find(x => /Contracted/i.test(x.textContent));
          const ths = [...tbl.querySelectorAll('thead th')];
          const w = Object.fromEntries(ths.map(th => [th.textContent.trim(), th.getBoundingClientRect().width]));
          const typeBadges = [...tbl.querySelectorAll('tbody tr td:first-child .badge')].map(b => b.getClientRects().length);
          return { w, typeBadges };
        });
        if (SHOT) await (await app.page.$('#inline-rpt-frame')).screenshot({ path: SHOT + '/del-cols-' + mode + '.png' });
        const W = r.w;
        t.ok(W.Type > W.Contracted * 2, `${mode}: Type (${Math.round(W.Type)}px) is well over twice Contracted (${Math.round(W.Contracted)}px)`);
        t.ok(W.Type > W.Delivered * 1.8, `${mode}: Type wider than Delivered`);
        t.ok(W.Type > W.Due * 2, `${mode}: Type well over twice Due`);
        t.ok(W.Due < W.Milestone, `${mode}: Due narrower than Milestone`);
        t.ok(r.typeBadges.every(n => n === 1), `${mode}: every Type badge fits on one line (${r.typeBadges.join(',')})`);
        await app.page.evaluate(() => { const o = document.getElementById('inline-rpt-overlay'); if (o) o.remove(); });
      }
    } finally { await app.close(); }
  },
};
