// Project hotlines stay on DEV (Jeff, 2026-10-24): the rest of develop went to
// LIVE without them. HOTLINE_ON = CC_ENV !== 'live' in index.html and
// mobile.html. Off: no hotline table is read, and there is no nav item, view or
// Settings card — even if a hotline row were somehow in the cache.
const fs = require('fs'), path = require('path');
module.exports = {
  name: 'hotline switch — off on LIVE: no tables read, no nav, view or Settings card',
  async run({ t }) {
    t.seed();
    const root = path.join(__dirname, '..', '..');
    for (const f of ['index.html', 'mobile.html']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      t.ok(/var HOTLINE_ON = CC_ENV !== 'live';/.test(src), `${f}: the switch follows the environment`);
      t.ok(/HOTLINE_ON\|\|HOTLINE_TABLES\.indexOf\(t\)<0/.test(src), `${f}: boot skips the hotline tables when off`);
    }

    // DEV (the harness): on, as before.
    const app = await t.open('index.html', { email: 'staff@sunrise.example' });
    try {
      await app.ready();
      const p = app.page;
      t.eq(await p.evaluate(() => HOTLINE_ON), true, 'on DEV the hotline is on');

      const off = await p.evaluate(() => {
        HOTLINE_ON = false;
        _syncCache.hotlines = [{ id: 1, name: 'Test', phoneNumber: '+18015550100', active: true }];
        refreshBadges();
        const nav = getComputedStyle(document.getElementById('nav-hotline')).display;
        setView('settings');
        const card = document.getElementById('hotline-card');
        const before = S.view; setView('hotline');
        return { nav, card: card ? card.style.display : 'missing', cardBody: document.getElementById('hotline-card-body').innerHTML, view: S.view, before };
      });
      t.eq(off.nav, 'none', 'off: no Hotline nav item, even with a hotline in the cache');
      t.eq(off.card, 'none', 'off: the Settings card is hidden');
      t.eq(off.cardBody, '', 'off: and nothing is drawn into it');
      t.eq(off.view, off.before, 'off: the Hotline view cannot be opened');
      const fu = await p.evaluate(() => { setView('interactions'); return document.getElementById('int-fu').textContent; });
      t.ok(/Resolved/.test(fu) && !/Hotline/.test(fu), 'off: the follow-up filter offers no hotline options');
      const tables = await p.evaluate(async () => {
        const seen = []; const real = window.sbGet;
        window.sbGet = async (tb, o) => { seen.push(tb); return []; };
        try { await loadAllData(); await _hotReload(); } catch (e) {} finally { window.sbGet = real; }
        return seen;
      });
      t.ok(tables.length > 10 && !tables.some((x) => /^hotline/.test(x)), 'off: no hotline table is read at boot or on reload');
      t.ok(tables.includes('outreach_actions'), '(the Outreach tables still load)');
    } finally { await app.close(); }

    const mob = await t.open('mobile.html', { email: 'staff@sunrise.example', viewport: { width: 414, height: 896 } });
    try {
      await mob.page.waitForFunction(() => typeof _syncCache !== 'undefined' && document.querySelector('nav.bottom-nav .nav-item'), null, { timeout: 15000 });
      const m = await mob.page.evaluate(() => {
        _syncCache.hotlines = [{ id: 1, name: 'Test', active: true }];
        const on = _mobHasHotline();
        HOTLINE_ON = false;
        return { on, off: _mobHasHotline() };
      });
      t.eq(m, { on: true, off: false }, 'mobile: a hotline replaces the Dashboard only while the switch is on');
    } finally { await mob.close(); }
  },
};
