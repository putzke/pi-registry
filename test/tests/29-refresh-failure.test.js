// A failed read must never masquerade as an empty table.
//
// sbGet() answered a 401 or a 500 by returning [], which made a broken request
// indistinguishable from a table with no rows. _refreshData then assigned that
// [] straight into _syncCache — so one failed background refresh ERASED the
// stakeholder list in place. The Master List badge read 0, and every name in the
// PI report's interaction table resolved to "Anonymous", because the lookup had
// nothing left to find. The rows were still in the database the whole time.
//
// The comment in _refreshData claimed the cache was left alone on failure. That
// was only ever true for a thrown network error; an HTTP error, which is the
// common case when a session expires, sailed straight through.
module.exports = {
  name: 'refresh failure — a bad response never empties the cache',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const seeded = await app.page.evaluate(() => _syncCache.stakeholders.length);
      t.gt(seeded, 50, 'stakeholders loaded at boot');

      // ── the exact failure that emptied it ────────────────────────────────
      const after = await app.page.evaluate(async () => {
        const realFetch = window.fetch;
        const toasts = [];
        const realToast = window.showToast;
        window.showToast = (m, k) => toasts.push({ m: String(m), k });
        // Every read of pi_stakeholders now 401s, as it does once a token expires.
        window.fetch = (url, opts) => /pi_stakeholders/.test(String(url))
          ? Promise.resolve({ ok: false, status: 401,
                              text: async () => 'JWT expired', json: async () => ({}) })
          : realFetch(url, opts);
        await _refreshData(['stakeholders', 'interactions']);
        window.fetch = realFetch; window.showToast = realToast;
        return { count: _syncCache.stakeholders.length, toasts };
      });
      t.eq(after.count, seeded, 'the cached stakeholders survived a 401 refresh');
      t.eq(after.toasts.length, 1, 'and the user is told once');
      t.eq(after.toasts[0].k, 'warn', 'as a warning, since the data on screen is still good');
      t.ok(/could not refresh/i.test(after.toasts[0].m), 'saying what failed');
      t.ok(/stakeholders/.test(after.toasts[0].m), 'and naming the table');
      t.eq(/interactions/.test(after.toasts[0].m), false,
           'without blaming the table that refreshed fine');

      // ── the visible symptoms are gone ────────────────────────────────────
      const symptoms = await app.page.evaluate(() => {
        const p = _syncCache.projects.find(x => x.pid === '25-154-001');
        const html = _buildSectionPreviewTable('auto-concerns', String(p.id),
                                               '2020-01-01', '2030-01-01', true);
        const names = (html.match(/<strong>([^<]*)<\/strong>/g) || []);
        refreshBadges();
        return {
          badge: document.getElementById('nb-master').textContent,
          rows: names.length,
          anon: names.filter(n => /Anonymous/.test(n)).length,
        };
      });
      t.gt(Number(symptoms.badge), 0, 'the Master List badge is not zero');
      t.gt(symptoms.rows, 10, 'the report table has rows');
      t.ok(symptoms.anon < symptoms.rows,
           `and they are not all Anonymous (${symptoms.anon} of ${symptoms.rows})`);

      // ── strict is opt-in; the tolerant default still works ───────────────
      // A 404 means the table does not exist yet, which IS an empty result.
      const modes = await app.page.evaluate(async () => {
        const realFetch = window.fetch;
        window.fetch = url => /pi_issues/.test(String(url))
          ? Promise.resolve({ ok: false, status: 500, text: async () => 'boom' })
          : realFetch(url);
        cacheClear('issues');
        const tolerant = await sbGet('issues');
        cacheClear('issues');
        let threw = null;
        try { await sbGet('issues', { strict: true }); } catch (e) { threw = e.message; }
        window.fetch = url => /pi_issues/.test(String(url))
          ? Promise.resolve({ ok: false, status: 404, text: async () => '' })
          : realFetch(url);
        cacheClear('issues');
        let notFound = 'threw';
        try { notFound = await sbGet('issues', { strict: true }); } catch (e) {}
        window.fetch = realFetch;
        return { tolerant, threw, notFound };
      });
      t.eq(modes.tolerant, [], 'the tolerant default still returns [] on a 500');
      t.ok(modes.threw && /500/.test(modes.threw), 'strict throws instead, with the status');
      t.eq(modes.notFound, [], 'but a 404 is still a genuinely empty table, not a failure');

      // ── boot reports a table it could not load ───────────────────────────
      const boot = await t.open('index.html', { email: 'putzke@demo.test' });
      try {
        await boot.page.evaluate(() => {
          const realFetch = window.fetch;
          window.__bootToasts = [];
          window.showToast = (m, k) => window.__bootToasts.push({ m: String(m), k });
          window.fetch = (url, opts) => /pi_parcels\?/.test(String(url))
            ? Promise.resolve({ ok: false, status: 500, text: async () => 'boom' })
            : realFetch(url, opts);
        });
        const res = await boot.page.evaluate(async () => {
          // sbGet caches for 30s, so a second loadAllData() would return the
          // copy fetched at boot and never make the request being stubbed.
          Object.keys(SB_TABLES).forEach(cacheClear);
          await loadAllData();
          await new Promise(r => setTimeout(r, 1000));
          return { parcels: _syncCache.parcels.length,
                   projects: _syncCache.projects.length,
                   toasts: window.__bootToasts };
        });
        t.eq(res.parcels, 0, 'the failed table is empty — boot stays tolerant');
        t.gt(res.projects, 0, 'and everything else still loaded');
        t.gt(res.toasts.length, 0, 'but the user is told rather than shown a silent blank');
        t.ok(res.toasts.some(x => /could not load/i.test(x.m) && /parcels/.test(x.m)),
             'naming the table that failed');
      } finally { await boot.close(); }

      t.eq(app.errors.filter(e => !/SB GET error|Background refresh failed|Load failed/.test(e)), [],
           'no unexpected page errors');
    } finally {
      await app.close();
    }
  },
};
