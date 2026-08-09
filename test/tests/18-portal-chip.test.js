// The "✦ Portal: <date>" chip on the dashboard project cards.
//
// It reads like a status ("this project has a portal", "the client has these
// reports") and is neither — it is the last publishClientTrend() date and
// nothing else. A project can have a live portal link the client opens weekly
// and carry no chip. That ambiguity is what this guards: the tooltip has to say
// what the date means, and the colour has to go amber once the narrative is
// stale, since a client who has not heard from you in a month is the only
// reason to show a date instead of a tick.
module.exports = {
  name: 'dashboard — the portal chip says what it means and goes stale',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // Give one project a fresh trend and one a stale one, leaving the third
      // with none — the three states the chip has to distinguish.
      const projs = await app.page.evaluate(() =>
        _syncCache.projects.map(p => ({ id: String(p.id), pid: p.pid })));
      const fresh = projs.find(p => p.pid === '25-154-001');
      const stale = projs.find(p => p.pid === '25-LC-400N');
      const none  = projs.find(p => p.pid === '25-3W-DESIGN');
      t.ok(fresh && stale && none, 'found the three demo projects');

      const chips = await app.page.evaluate(([freshId, staleId, noneId]) => {
        const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
        // Straight into _syncCache — DB.get() hands back a copy — and drop any
        // seeded trend first so "no trend published" is really that.
        _syncCache.client_summaries = [
          { id: 'x1', projectId: freshId, contentFull: 'fresh', publishedAt: day(3) },
          { id: 'x2', projectId: staleId, contentFull: 'old',   publishedAt: day(45) },
        ];
        setView('dashboard');
        const out = {};
        document.querySelectorAll('#main *').forEach(el => {
          if (!/^✦ Portal: /.test(el.textContent || '') || el.children.length) return;
          out[el.textContent.trim()] = { color: el.getAttribute('style') || '',
                                         title: el.getAttribute('title') || '' };
        });
        return { chips: out, cards: document.querySelectorAll('#main *').length };
      }, [fresh.id, stale.id, none.id]);

      const keys = Object.keys(chips.chips);
      t.eq(keys.length, 2, 'exactly two chips — the project with no trend has none');

      const freshChip = chips.chips[keys.find(k => /Portal/.test(k)
        && chips.chips[k].color.includes('--teal'))];
      const staleChip = chips.chips[keys.find(k => chips.chips[k].color.includes('--amber'))];
      t.ok(freshChip, 'a trend published 3 days ago renders teal');
      t.ok(staleChip, 'a trend published 45 days ago renders amber');

      // The tooltip is the whole point — without it the date is ambiguous.
      [freshChip, staleChip].forEach((c, n) => {
        const which = n ? 'stale' : 'fresh';
        t.ok(c && /Project Status Report last published/i.test(c.title),
             `${which} chip's tooltip names what the date is`);
        t.ok(c && /shared reports/i.test(c.title) && /portal link exists/i.test(c.title),
             `${which} chip's tooltip rules out the two things it is NOT`);
      });
      t.ok(staleChip && /\d+(d|mo) ago|Today|Yesterday/.test(staleChip.title),
           'the tooltip carries the age, not just the date');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
