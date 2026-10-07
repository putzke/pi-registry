// A deliverable with no contracted quantity ("As needed", "Per phase") has no
// target, so it has no percentage. Every surface used to fall back to the
// stored `progress` field — which saveDel() fills with a placeholder derived
// from the STATUS (In progress = 50, Not started = 0), never a measurement.
// Reported live on SR-201: "Website update" read 6 delivered · 50% · In
// progress, and "Lane closure graphic" read 6 delivered · 0% · Not started.
//
// Two rules now:
//  1. No contracted quantity → the count, never a %: desktop view, PI report
//     preview table, and the client portal.
//  2. saveDel() won't store 'Not started' with something delivered — the same
//     rule adjDel() already applied on "+". Deliberate statuses are kept.
module.exports = {
  name: 'deliverables — no contracted quantity shows the count, never a placeholder %',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const projId = String(proj.id);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const addDel = async (a) => {
        const before = await app.page.evaluate(() => DB.get('deliverables').length);
        await app.page.evaluate(async a => {
          openDelModal();
          document.getElementById('f-dp').value = a.pid;
          document.getElementById('f-dt').value = a.type;
          document.getElementById('f-ds').value = 'recurring';
          document.getElementById('f-dst').value = a.status;
          document.getElementById('f-dcq').value = a.contractedQty;
          document.getElementById('f-ddc').value = a.deliveredCount;
          saveDel();
        }, Object.assign({ pid: projId }, a));
        await app.page.waitForTimeout(600);
        return app.page.evaluate(n => DB.get('deliverables')[n], before);
      };

      // ── rule 2: the status ──────────────────────────────────────────────
      const lane = await addDel({ type: 'Lane closure graphic', status: 'Not started', contractedQty: '', deliveredCount: 6 });
      t.eq(lane.status, 'In progress', 'six delivered saved as Not started is stored as In progress');
      const held = await addDel({ type: 'Website update', status: 'On hold', contractedQty: '', deliveredCount: 6 });
      t.eq(held.status, 'On hold', 'On hold is a deliberate choice and is kept');
      const none = await addDel({ type: 'Media / press release', status: 'Not started', contractedQty: 3, deliveredCount: 0 });
      t.eq(none.status, 'Not started', 'nothing delivered stays Not started');
      const done = await addDel({ type: 'Project email', status: 'Complete', contractedQty: '', deliveredCount: 1 });
      t.eq(done.status, 'Complete', 'Complete is kept');

      // ── rule 1: the desktop view ────────────────────────────────────────
      const rowText = (title) => app.page.evaluate(([pid, title]) => {
        S.view = 'deliverables'; S.projectFilter = pid; render();
        const tr = [...document.querySelectorAll('#main tr')].find(r => r.textContent.includes(title));
        return tr ? tr.textContent.replace(/\s+/g, ' ') : null;
      }, [projId, title]);
      const laneRow = await rowText('Lane closure graphic');
      t.ok(laneRow && /no target/.test(laneRow), 'open-ended row says "no target"');
      t.ok(laneRow && !/\d+%/.test(laneRow), 'and shows no percentage (was the 50 placeholder)');
      const pressRow = await rowText('Media / press release');
      t.ok(pressRow && /0%/.test(pressRow), 'a row WITH a contracted quantity still shows its %');

      // ── rule 1: the PI report preview table (also what an archive freezes)
      const tbl = await app.page.evaluate(pid => {
        const div = document.createElement('div');
        div.innerHTML = _buildSectionPreviewTable('auto-del', pid);
        const tr = [...div.querySelectorAll('tr')].find(r => r.textContent.includes('Lane closure graphic'));
        return tr ? [...tr.children].map(c => c.textContent) : null;
      }, projId);
      t.ok(tbl && tbl.includes('—') && !tbl.some(c => /%$/.test(c)), 'report table prints — in the % column, not a placeholder');

      t.eq(app.errors, [], 'no page errors on the desktop');
    } finally {
      await app.close();
    }

    // ── rule 1: the client portal ─────────────────────────────────────────
    const tok = (await t.sql(`select token from pi_portal_links where project_id::text='${projId}' limit 1`))[0];
    const portal = await t.open('client-portal.html', { portalToken: tok.token });
    try {
      await portal.page.waitForTimeout(1500);
      const cell = await portal.page.evaluate(() =>
        progCell({ contracted_qty: 0, delivered_count: 6, progress: 50 }));
      t.eq(cell, '6 delivered', 'portal shows the count for an open-ended deliverable, not 50%');
      t.eq(await portal.page.evaluate(() => progCell({ contracted_qty: 0, delivered_count: 0, progress: 0 })), '—',
        'and — when nothing is delivered');
      const real = await portal.page.evaluate(() => progCell({ contracted_qty: 4, delivered_count: 1, progress: 0 }));
      t.ok(/25%/.test(real), 'a contracted deliverable still gets its real %');
      t.eq(portal.errors, [], 'no page errors in the portal');
    } finally {
      await portal.close();
    }
  },
};
