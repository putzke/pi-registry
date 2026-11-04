// Mobile lists same-day interactions in the order they were logged, newest
// first (Nov 2026, Jeff) — the rule desktop uses (_intLoggedOrder): ids
// compared as NUMBERS ("100" after "99"), a not-yet-saved tmp_ id newest.
module.exports = {
  name: 'mobile — same-day interactions in logged order, newest first, like desktop',
  async run({ t }) {
    t.seed();
    const mob = await t.open('mobile.html', { email: 'putzke@demo.test', viewport: { width: 414, height: 896 } });
    try {
      await mob.page.waitForFunction(() => typeof _syncCache !== 'undefined' && (_syncCache.interactions || []).length > 0, null, { timeout: 15000 });
      const r = await mob.page.evaluate(() => {
        const mk = (id, date, summary) => ({ id, date, summary, projectId: '', channel: 'Phone', stakeholderId: 'zz' });
        _syncCache.interactions = [mk('99', '2030-05-01', 'S99'), mk('tmp_x', '2030-05-01', 'STMP'),
          mk('100', '2030-05-01', 'S100'), mk('7', '2030-05-02', 'SNEXT'), mk('5', '2030-04-30', 'SPREV')];
        const sel = document.getElementById('ints-proj'); sel.value = '';
        document.getElementById('ints-search').value = '';
        renderInteractionsList();
        const list = [...document.querySelectorAll('#ints-list .int-summary')].map(e => e.textContent.trim());
        return { list, same: String(_intLoggedOrder) .replace(/\s+/g, '') };
      });
      t.eq(r.list.join(','), 'SNEXT,STMP,S100,S99,SPREV', 'newest date first; same day newest logged first (tmp, then 100 before 99)');
      const fs = require('fs');
      const desk = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8')
        .match(/function _intLoggedOrder\(a,b\)\{[\s\S]*?\n\}/)[0].replace(/^function _intLoggedOrder/, 'function _intLoggedOrder').replace(/\s+/g, '');
      t.eq(r.same, desk, 'mobile uses the same logged-order rule as desktop');
      t.eq(mob.errors, [], 'no page errors');
    } finally { await mob.close(); }
  },
};
