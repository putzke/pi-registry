// A waiting voicemail says how long it has waited (Jeff, Nov 2026).
// Plain the day it arrives; amber after 1 business day; red after 2.
// Weekends don't count: Friday's message is amber on Monday, not red.
// The helper is one block, identical in index.html and mobile.html.
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'hotline — how long a voicemail has waited',
  async run({ t }) {
    const root = path.join(__dirname, '..', '..');
    const block = (f) => { const s = fs.readFileSync(path.join(root, f), 'utf8'); const m = s.match(/\/\/ ── HOTLINE WAIT \(begin\)[\s\S]*?\/\/ ── HOTLINE WAIT \(end\)/); return m && m[0]; };
    const bi = block('index.html'), bm = block('mobile.html');
    t.ok(bi && bm, 'both apps carry the wait block');
    t.eq(bi, bm, 'the block is identical in index.html and mobile.html');

    t.seed();
    const app = await t.open('index.html');
    const r = await app.page.evaluate(() => {
      // Local times; Fri 2026-11-20 4:00 pm.
      const at = new Date(2026, 10, 20, 16, 0).toISOString();
      const w = (y, mo, d, h, mi) => _hotWait({ receivedAt: at }, new Date(y, mo, d, h, mi || 0));
      return {
        min: w(2026, 10, 20, 16, 20), hrs: w(2026, 10, 20, 19), sat: w(2026, 10, 21, 10),
        mon: w(2026, 10, 23, 9), tue: w(2026, 10, 24, 9), none: _hotWait({}),
        card: _hotCardHTML({ id: 'x1', receivedAt: new Date(Date.now() - 5 * 864e5).toISOString(), callerNumber: '+18015550100', transcript: 'hi', transcriptStatus: 'done' }),
      };
    });
    t.eq(r.min.text, 'Waiting 20 minutes', 'minutes under an hour');
    t.eq(r.min.level, 'ok', 'same day is plain');
    t.eq(r.hrs.text, 'Waiting 3 hours', 'hours under a day');
    t.eq(r.sat.level, 'ok', 'Saturday after a Friday message: no business day has passed');
    t.eq(r.mon.level, 'amber', 'Monday after a Friday message: amber, not red');
    t.eq(r.mon.text, 'Waiting 2 days', 'the text counts calendar days');
    t.eq(r.tue.level, 'red', 'Tuesday: two business days — red');
    t.eq(r.none, null, 'no received time, no pill');
    t.ok(/class="hot-wait hot-wait-red"/.test(r.card) && /Waiting 5 days/.test(r.card), 'the desktop card shows the pill');
    await app.close();

    const mob = await t.open('mobile.html');
    const mc = await mob.page.evaluate(() => _hotCardHTML({ id: 'x2', receivedAt: new Date(Date.now() - 2 * 36e5).toISOString(), callerNumber: '+18015550100', transcript: 'hi', transcriptStatus: 'done' }));
    t.ok(/class="hot-wait hot-wait-(ok|amber)"/.test(mc) && /Waiting 2 hours/.test(mc), 'the mobile card shows the pill');
    await mob.close();
  },
};
