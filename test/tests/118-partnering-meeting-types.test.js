// Construction/partnering meetings are scoped as "up to X attended in person,
// the rest remotely" (Jeff, Nov 2026). Two deliverable types carry that, so an
// in-person count past its contract shows "+N over" under a real name, not "Other".
module.exports = {
  name: 'deliverables — Partnering Meetings (In-person) / (Remote) types',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(() => {
        const g = DEL_GROUPS.find(x => x.group === 'Government & Agency');
        openDelModal();
        const opts = [...document.querySelectorAll('#f-dt option')].map(o => o.value);
        return { inGroup: g.types, opts };
      });
      for (const ty of ['Partnering Meetings (In-person)', 'Partnering Meetings (Remote)']) {
        t.ok(r.inGroup.includes(ty), `${ty} is under Government & Agency`);
        t.ok(r.opts.includes(ty), `${ty} is offered in the Add deliverable dialog`);
      }
      t.eq(await app.page.evaluate(() => _delOver({ type: 'Partnering Meetings (In-person)', contractedQty: 10, deliveredCount: 14 })), 4,
        'an in-person count past its contract reads +4 over');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
