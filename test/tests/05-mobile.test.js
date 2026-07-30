// mobile.html against real seeded data.
//
// Narrow on purpose: mobile is a field logging tool, and the thing worth
// guarding here is that its SB_TO_INT actually resolves against the database.
// It has its own copy of the mapping, separate from index.html, which is how
// raisedBy came to point at a pi_issues.raised_by column that never existed —
// the issue detail screen rendered a "Raised by" row that was always blank
// because fromSB had nothing to read.
module.exports = {
  name: 'mobile — boots and its own SB_TO_INT resolves against real rows',
  async run({ t }) {
    t.seed();
    const app = await t.open('mobile.html', { email: 'putzke@demo.test',
                                              viewport: { width: 414, height: 896 } });
    try {
      await app.page.waitForFunction(
        () => typeof _syncCache !== 'undefined' && Array.isArray(_syncCache.issues),
        null, { timeout: 15000 });

      const data = await app.page.evaluate(() => ({
        projects: _syncCache.projects.length,
        issues: _syncCache.issues.length,
        interactions: _syncCache.interactions.length,
        // Every issue in the seed has created_by set, so after repointing the
        // mapping this must be populated for all of them.
        raisedByFilled: _syncCache.issues.filter(i => !!i.raisedBy).length,
        sampleRaisedBy: (_syncCache.issues[0] || {}).raisedBy,
        dateRaisedFilled: _syncCache.issues.filter(i => !!i.dateRaised).length,
      }));

      t.eq(data.projects, 2, 'mobile loaded both projects');
      t.eq(data.issues, 8, 'mobile loaded all issues');
      t.gt(data.interactions, 500, 'mobile loaded interactions');
      t.eq(data.raisedByFilled, data.issues, 'raisedBy resolves for every issue');
      t.ok(/^[A-Z]{3}$/.test(data.sampleRaisedBy || ''),
           `raisedBy holds the logger's initials (got ${JSON.stringify(data.sampleRaisedBy)})`);
      t.eq(data.dateRaisedFilled, data.issues, 'dateRaised resolves too');

      t.eq(app.errors, [], 'no page errors on boot');
    } finally {
      await app.close();
    }
  },
};
