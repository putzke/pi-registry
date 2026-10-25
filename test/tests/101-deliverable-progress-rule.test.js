// ONE rule for deliverable progress (Oct 2026, Jeff). Reported live on SR-201:
// the Deliverables header bar read 100% (35 delivered against 13 contracted,
// capped — inflated by items with no contracted number and by social posts at
// 6 of 2) while the AI summary said 55% (items marked Complete) and called two
// deliverables past due that were not: an open-ended press release, and a
// recurring report that was on pace but whose contract-window date had passed.
// Now: progress = delivered against contracted, each item capped at its own
// target, open-ended items left out; past due = an item with a target, not
// Complete / Cancelled / On hold, whose date (for recurring: next due by pace)
// has passed. Applied to the desktop bar, the AI facts and the client portal.
const fs = require('fs');
const path = require('path');
module.exports = {
  name: 'deliverables — one progress rule: capped per item, open-ended excluded, past due by pace',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(() => {
        const iso = d => d.toISOString().slice(0, 10);
        const day = n => iso(new Date(Date.now() + n * 86400000));
        const proj = { id: 'p_rule', name: 'Rule test', status: 'Active', startDate: day(-63), preconDate: '' };
        _syncCache.projects = (_syncCache.projects || []).concat([proj]);
        const D = (o) => Object.assign({ projectId: 'p_rule', status: 'In progress', deliveredCount: 0, contractedQty: 0 }, o);
        const dels = [
          D({ id: 'd1', title: 'Social media posts', scopeType: 'fixed', contractedQty: 2, deliveredCount: 6 }),
          D({ id: 'd2', title: 'Newsletter', scopeType: 'fixed', contractedQty: 4, deliveredCount: 3 }),
          D({ id: 'd3', title: 'PI summary report', scopeType: 'recurring', freq: 'Bi-weekly', contractedQty: 6, deliveredCount: 5, dueDate: day(-2) }),
          D({ id: 'd4', title: 'Open house', scopeType: 'milestone', contractedQty: 1, deliveredCount: 1, status: 'Complete' }),
          D({ id: 'd5', title: 'Media/press release', deliveredCount: 2, dueDate: day(-45) }),
          D({ id: 'd6', title: 'Website update', deliveredCount: 8 }),
          D({ id: 'd7', title: 'Lane closure graphic', deliveredCount: 10, status: 'Not started' }),
        ];
        const g = _delProgress(dels);
        const facts = _delFactLines(dels).join(' ');
        // a genuinely late item, and a recurring item that has fallen behind
        const late = D({ id: 'd8', title: 'Door hangers', scopeType: 'fixed', contractedQty: 3, deliveredCount: 1, dueDate: day(-1) });
        const behind = D({ id: 'd9', title: 'Weekly update', scopeType: 'recurring', freq: 'Weekly', contractedQty: 20, deliveredCount: 2 });
        const held = D({ id: 'd10', title: 'Held item', scopeType: 'fixed', contractedQty: 3, deliveredCount: 0, dueDate: day(-1), status: 'On hold' });
        // the desktop header
        _syncCache.deliverables = (_syncCache.deliverables || []).concat(dels);
        const html = renderDelScope('p_rule');
        return {
          pct: g.pct, delivered: g.delivered, contracted: g.contracted, open: g.open.length, openDelivered: g.openDelivered,
          over: g.over.map(d => d.id), pastDue: g.pastDue.map(d => d.id), facts,
          late: _delPastDue(late), behind: _delPastDue(behind), held: _delPastDue(held),
          header: html.slice(0, 4000),
        };
      });
      t.eq(r.contracted, 13, 'contracted counts only items with a target');
      t.eq(r.delivered, 11, 'each item counted up to its own target (social posts 6 of 2 → 2)');
      t.eq(r.pct, 85, 'progress is 11 of 13 = 85%, not 100% and not the share marked Complete');
      t.eq(r.open, 3, 'three open-ended items, outside the %');
      t.eq(r.openDelivered, 20, 'their deliveries are reported as a count');
      t.eq(r.over.join(','), 'd1', 'over-delivery is listed');
      t.eq(r.pastDue.length, 0, 'no false past due: open-ended press release and on-pace recurring report are not late');
      t.ok(/11 of 13 delivered \(85%\)/.test(r.facts), 'AI facts carry the same 85%');
      t.ok(/ongoing item/.test(r.facts) && /never "unfinished"/.test(r.facts), 'AI facts say open-ended items are ongoing');
      t.ok(/No deliverable is past due/.test(r.facts), 'AI facts say nothing is past due');
      t.ok(r.late, 'a fixed item with a passed date and work left IS past due');
      t.ok(r.behind, 'a recurring item behind its pace IS past due');
      t.ok(!r.held, 'an On hold item is never past due');
      t.ok(/<b>11\/13<\/b>/.test(r.header), 'desktop header shows 11/13 delivered vs contracted');
      t.ok(/>85%</.test(r.header), 'desktop header bar reads 85%');
      t.ok(!/>100%</.test(r.header), 'desktop header no longer reads 100%');
    } finally { await app.close(); }

    // the client portal reads the same rule
    const src = fs.readFileSync(path.join(__dirname, '../../client-portal.html'), 'utf8');
    const fn = src.match(/function devProgress\(devs\) \{[\s\S]*?\n\}/);
    t.ok(!!fn, 'portal has devProgress');
    const devProgress = new Function('const isComplete = s => /complete/i.test(s || "");' + fn[0] + '; return devProgress;')();
    const p = devProgress([
      { contracted_qty: 2, delivered_count: 6, status: 'In progress' },
      { contracted_qty: 4, delivered_count: 3, status: 'In progress' },
      { contracted_qty: 6, delivered_count: 5, status: 'In progress' },
      { contracted_qty: 1, delivered_count: 1, status: 'Complete' },
      { contracted_qty: null, delivered_count: 2, status: 'In progress' },
      { contracted_qty: 5, delivered_count: 0, status: 'Cancelled' },
    ]);
    t.eq(p.pct, 85, 'portal progress matches the desktop (85%)');
    t.eq(p.open, 1, 'portal counts open-ended items separately');
    t.ok(/devProgress\(projDevs\)/.test(src) && /const prog\s+= devProgress\(devs\)/.test(src), 'portal overview tile and health card use it');
  }
};
