// adjDel() (the +/- counter on the Deliverables & scope tracking view) derived
// `status` from the new delivered count on every click, but only in two
// directions: full count -> 'Complete', any partial count -> 'In progress'.
// The third branch, hit when the count lands back on zero, just kept
// whatever status was already stored. So a qty-1 milestone clicked "+" (count
// 1, status set to 'Complete' by this same function) then "-" (count back to
// 0) left deliveredCount:0 with status STILL 'Complete' — the progress bar
// correctly read 0% (renderDeliverables recomputes it fresh from
// contractedQty/deliveredCount on every render, never from a stored field),
// but the status badge stayed wrong. Reported live on "Final PI closeout
// report": 1 contracted, 0 delivered, badge reading Complete.
//
// Fixed by having adjDel revert to 'Not started' only when the count hits
// zero AND the existing status is one THIS function could have set
// ('Complete' or 'In progress') — a status set independently via the Edit
// modal ('On hold' / 'Cancelled') is never implied wrong by a count of zero
// and must survive an adjDel click untouched.
module.exports = {
  name: 'deliverables — the +/- counter reverts a status it set itself, never one it did not',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      const projId = String(proj.id);

      // Creating a deliverable starts an async Supabase insert that swaps the
      // temporary local id for the real one shortly after saveDel() returns
      // (the same tmp_-id race documented elsewhere in this app) — wait for
      // it to settle before handing back the id, or a later adjDel(id, …)
      // call can miss the row entirely once the cache's id has moved on.
      const addDel = async (extra) => {
        const before = await app.page.evaluate(() => DB.get('deliverables').length);
        await app.page.evaluate(async a => {
          openDelModal();
          document.getElementById('f-dp').value = a.pid;
          document.getElementById('f-ds').value = a.scopeType || 'milestone';
          document.getElementById('f-dst').value = a.status || 'Not started';
          document.getElementById('f-dcq').value = a.contractedQty != null ? a.contractedQty : 1;
          document.getElementById('f-ddc').value = a.deliveredCount || 0;
          saveDel();
        }, Object.assign({ pid: projId }, extra || {}));
        await app.page.waitForTimeout(600);
        return app.page.evaluate((n) => DB.get('deliverables')[n].id, before);
      };

      const readDel = (id) => app.page.evaluate(did =>
        DB.get('deliverables').find(x => String(x.id) === String(did)), id);

      // ── the exact reported bug: qty-1 milestone, + then - ────────────────
      const id1 = await addDel({ scopeType: 'milestone', contractedQty: 1, deliveredCount: 0, status: 'Not started' });
      await app.page.evaluate(id => adjDel(id, 1), id1);
      let d = await readDel(id1);
      t.eq(d.deliveredCount, 1, 'delivered count incremented to full');
      t.eq(d.status, 'Complete', 'a full delivered count sets status Complete');

      await app.page.evaluate(id => adjDel(id, -1), id1);
      d = await readDel(id1);
      t.eq(d.deliveredCount, 0, 'delivered count decremented back to zero');
      t.eq(d.status, 'Not started', 'and status reverts to Not started — the exact reported bug, now fixed');

      // ── partial delivery still reads In progress ─────────────────────────
      const id2 = await addDel({ scopeType: 'fixed', contractedQty: 4, deliveredCount: 0, status: 'Not started' });
      await app.page.evaluate(id => adjDel(id, 1), id2);
      d = await readDel(id2);
      t.eq(d.deliveredCount, 1, 'one of four delivered');
      t.eq(d.status, 'In progress', 'a partial delivered count sets status In progress');

      await app.page.evaluate(id => adjDel(id, -1), id2);
      d = await readDel(id2);
      t.eq(d.deliveredCount, 0, 'back to zero');
      t.eq(d.status, 'Not started', 'and In progress also reverts to Not started at zero');

      // ── an independently-set status must NOT be overwritten by a count
      // adjustment that leaves the count at zero ───────────────────────────
      const id3 = await addDel({ scopeType: 'milestone', contractedQty: 1, deliveredCount: 0, status: 'On hold' });
      d = await readDel(id3);
      t.eq(d.status, 'On hold', 'sanity: saved as On hold with zero delivered');
      // adjDel(id, -1) at deliveredCount 0 is a no-op count-wise (Math.max(0, -1)=0)
      // but must still not touch a status this function never set.
      await app.page.evaluate(id => adjDel(id, -1), id3);
      d = await readDel(id3);
      t.eq(d.deliveredCount, 0, 'count stays at zero (cannot go negative)');
      t.eq(d.status, 'On hold', 'On hold survives an adjDel click that leaves the count at zero');

      const id4 = await addDel({ scopeType: 'milestone', contractedQty: 1, deliveredCount: 0, status: 'Cancelled' });
      await app.page.evaluate(id => adjDel(id, -1), id4);
      d = await readDel(id4);
      t.eq(d.status, 'Cancelled', 'Cancelled survives the same way');

      // ── but a genuinely counter-set status must still revert even after
      // going through On-hold-style territory is avoided — i.e. Complete set
      // by a real full delivery still reverts once emptied out again, even
      // if contractedQty is larger than 1 ────────────────────────────────
      const id5 = await addDel({ scopeType: 'fixed', contractedQty: 2, deliveredCount: 0, status: 'Not started' });
      await app.page.evaluate(id => adjDel(id, 1), id5);
      await app.page.evaluate(id => adjDel(id, 1), id5);
      d = await readDel(id5);
      t.eq(d.deliveredCount, 2, 'both delivered');
      t.eq(d.status, 'Complete', 'full count sets Complete');
      await app.page.evaluate(id => adjDel(id, -1), id5);
      d = await readDel(id5);
      t.eq(d.deliveredCount, 1, 'one step back');
      t.eq(d.status, 'In progress', 'and status correctly drops to In progress, not stuck on Complete');
      await app.page.evaluate(id => adjDel(id, -1), id5);
      d = await readDel(id5);
      t.eq(d.deliveredCount, 0, 'back to zero');
      t.eq(d.status, 'Not started', 'and finally reverts to Not started');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
