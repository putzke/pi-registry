// Deliverable / scope status quick report: Contracted, Delivered and Due are
// narrow so the Type column has room (Jeff, Nov 2026). The report frame uses
// table-layout:fixed, which split the eight columns evenly before.
const SHOT = process.env.SHOT_DIR;
module.exports = {
  name: 'quick reports — column widths and content margin',
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
        // Content margin: the frame's td{padding:5px 8px!important} used to win
        // over the body cell's own padding, so content printed 8px from the edge.
        const pad = await app.page.evaluate(() => {
          const doc = document.getElementById('inline-rpt-frame').contentDocument;
          const b = doc.querySelector('.rpt-body-cell'), h = doc.querySelector('.rpt-hdr-cell');
          return { body: parseFloat(getComputedStyle(b).paddingLeft), bodyR: parseFloat(getComputedStyle(b).paddingRight), hdr: parseFloat(getComputedStyle(h).paddingLeft) };
        });
        t.ok(pad.body >= 40 && pad.bodyR >= 40, `${mode}: report content has a side margin (${pad.body}px / ${pad.bodyR}px)`);
        t.ok(pad.hdr < pad.body, `${mode}: the letterhead row keeps its own (narrower) margin`);
        await app.page.evaluate(() => { const o = document.getElementById('inline-rpt-overlay'); if (o) o.remove(); });
      }
      // Other quick reports: short columns (dates, channel, by/owner) narrowed,
      // text columns widened.
      const w = await app.page.evaluate(() => {
        const out = {};
        const P = DB.get('projects').find(p => p.pid === '25-154-001'); S.projectFilter = P.id;
        for (const id of ['interaction-log', 'followup-status', 'contact-list']) {
          let h = ''; const real = window.showInlineReport; window.showInlineReport = (x) => { h = x; };
          generateReport(id); window.showInlineReport = real;
          const f = document.createElement('iframe'); f.style.width = '1100px'; document.body.appendChild(f);
          f.contentDocument.open(); f.contentDocument.write(h); f.contentDocument.close();
          const t = [...f.contentDocument.querySelectorAll('.rpt-body-cell table')].find(x => x.querySelector('th'));
          const W = t.getBoundingClientRect().width;
          out[id] = Object.fromEntries([...t.rows[0].cells].map(c => [c.textContent.trim(), Math.round(c.getBoundingClientRect().width / W * 100)]));
          f.remove();
        }
        return out;
      });
      t.ok(w['interaction-log'].Summary >= 54 && w['interaction-log'].Date <= 9 && w['interaction-log'].By <= 6, `interaction log: Summary ${w['interaction-log'].Summary}%, Date ${w['interaction-log'].Date}%, By ${w['interaction-log'].By}%`);
      t.ok(w['followup-status'].Action >= 40 && w['followup-status']['Due date'] <= 9, `follow-ups: Action ${w['followup-status'].Action}%`);
      t.ok(w['contact-list'].Phone <= 11 && w['contact-list'].Organization >= 23, `contact list: Phone ${w['contact-list'].Phone}%, Organization ${w['contact-list'].Organization}%`);
    } finally { await app.close(); }
  },
};
