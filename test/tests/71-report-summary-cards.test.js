// The four summary cards at the top of Reports → Quick Reports were ~180px
// tall each, pushing the report cards themselves below the fold. Compacted
// (Oct 2026): label on top, figure with its breakdown beside it. Every number
// is still shown; only the sentiment bar went (its three counts remain).
module.exports = {
  name: 'reports — the summary cards are compact and still carry every figure',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(pid => {
        S.view = 'reports'; S.rptTab = 'reports'; S.projectFilter = pid; render();
        const label = [...document.querySelectorAll('#main div')].find(d => d.textContent.trim() === 'Stakeholders' && d.children.length === 0);
        const grid = label && label.parentElement.parentElement;
        const cards = grid ? [...grid.children] : [];
        return { n: cards.length, heights: cards.map(c => Math.round(c.getBoundingClientRect().height)),
                 text: grid ? grid.textContent.replace(/\s+/g, ' ') : '' };
      }, String(proj.id));
      if (process.env.SHOT) await app.page.screenshot({ path: process.env.SHOT, clip: { x: 0, y: 0, width: 1440, height: 420 } });
      t.eq(r.n, 4, 'four summary cards');
      t.ok(r.heights.every(h => h > 0 && h <= 100), `each card is at most 100px tall (${r.heights.join(', ')})`);
      for (const w of ['external', 'internal', 'champ', 'neutral', 'opp', 'incoming', 'outgoing', 'complete', '%'])
        t.ok(r.text.includes(w), `still shows "${w}"`);
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
