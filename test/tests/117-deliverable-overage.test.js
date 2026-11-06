// A deliverable delivered beyond its contract shows its TRUE percentage.
// Reported live on 3600 West: "Door-to-door canvass / door hanger", 1
// contracted, 8 delivered — the Deliverables view read 800% "+7 over", but
// the Deliverable / scope status quick report read "8 (100%)": every report
// surface capped each item at 100, so the extra work the team did vanished.
// Now each item's own % is real (800%) with "+7 over"; the OVERALL % still
// counts each item only up to its own target (the one rule in _delProgress),
// and the quick report adds a "Beyond contract" tile.
module.exports = {
  name: 'deliverables — overage shows the real % and "+N over" in reports',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const P = String(proj.id);
    await t.sql(`delete from pi_deliverables where project_id::text=$1`, [P]);
    await t.sql(`insert into pi_deliverables (project_id, deliverable_type, title, scope_type, status, contracted_qty, delivered_count)
                 values ($1,'Door-to-door canvass / door hanger','Door hangers','fixed','Complete',1,8),
                        ($1,'Social media post','Posts','fixed','In progress',3,2)`, [P]);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const html = await app.page.evaluate(pid => {
        S.view = 'reports'; S.rptTab = 'reports'; S.projectFilter = pid; render();
        generateReport('deliverable-status');
        const f = document.getElementById('inline-rpt-frame');
        return f ? f.srcdoc : '';
      }, P);
      const div = (h) => { return h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); };
      const text = div(html);
      t.ok(/8 \(800%\)/.test(text), 'quick report: 8 delivered on 1 contracted reads 800%, not 100%');
      t.ok(/\+7 over/.test(text), 'quick report: says +7 over');
      t.ok(!/8 \(100%\)/.test(text), 'quick report: the capped 100% is gone');
      t.ok(/2 \(67%\)/.test(text), 'an item short of target keeps its own %');
      t.ok(/3\/4 \(75%\)/.test(text), 'the overall figure still counts each item only up to its target');
      t.ok(/\+7 Beyond contract · 1 item/.test(text), 'a "Beyond contract" tile names the extra');

      // PI report section table (also what an archive freezes) and the .xlsx export use the same rule.
      const row = await app.page.evaluate(pid => {
        const d = document.createElement('div');
        d.innerHTML = _buildSectionPreviewTable('auto-del', pid);
        const tr = [...d.querySelectorAll('tr')].find(r => r.textContent.includes('Door hangers'));
        return tr ? [...tr.children].map(c => c.textContent) : null;
      }, P);
      t.ok(row && row.includes('800%'), 'PI report table: 800%');
      t.ok(row && row.some(c => /\+7 over/.test(c)), 'PI report table: +7 over beside the status');
      t.eq(await app.page.evaluate(() => _delPct({ contractedQty: 1, deliveredCount: 8 })), 800, '_delPct is not capped');
      t.eq(await app.page.evaluate(() => _delPct({ contractedQty: 0, deliveredCount: 8 })), null, 'no target → no %');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }

    const tok = (await t.sql(`select token from pi_portal_links where project_id::text=$1 limit 1`, [P]))[0];
    const portal = await t.open('client-portal.html', { portalToken: tok.token });
    try {
      await portal.page.waitForTimeout(1200);
      const cell = await portal.page.evaluate(() => progCell({ contracted_qty: 1, delivered_count: 8 }));
      t.ok(/800%/.test(cell), 'portal shows 800%');
      t.ok(/width:100%/.test(cell), 'and its bar stays full, not 800 wide');
    } finally { await portal.close(); }
  },
};
