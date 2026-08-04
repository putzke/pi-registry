// The sidebar's project switcher and "Next up" deadline panel.
//
// The switcher replaced an uncapped list of every project — including every
// completed one, forever — that crowded itself out as projects accumulated. Two
// properties matter and are easy to regress: archived projects must stay out of
// the default list, and switching project must not move you to another view (the
// old list called setView('stakeholders') on every click).
//
// The deadline panel's own trap is that a purely date-sorted list gets
// permanently occupied by abandoned items from two years ago and never shows
// what is actually coming, so anything past DL_STALE is summarised instead.
module.exports = {
  name: 'sidebar — project switcher and the Next up deadline panel',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // ── switcher: default state ─────────────────────────────────────────
      let sw = await app.page.evaluate(() => ({
        name: document.getElementById('ps-name').textContent,
        popHidden: document.getElementById('ps-pop').style.display === 'none',
      }));
      t.eq(sw.name, 'All projects', 'switcher shows "All projects" when unscoped');
      t.ok(sw.popHidden, 'the picker starts closed');

      // ── archived projects stay out of the default list ──────────────────
      const listed = await app.page.evaluate(() => {
        // Mark one project Complete, then rebuild the list. Has to go through
        // _syncCache — DB.get() hands back a copy, so mutating its result is a
        // no-op against the live data the app renders from.
        const p = _syncCache.projects[1];
        p.status = 'Complete';
        toggleProjSwitch();
        const rows = [...document.querySelectorAll('#ps-list .proj-btn')]
          .map(b => b.textContent.trim());
        return { archivedPid: p.pid, rows, hasArchivedHdr: /Archived/.test(
          document.getElementById('ps-list').innerHTML) };
      });
      t.ok(listed.rows.some(r => /All projects/.test(r)), 'the All projects row is offered');
      t.eq(listed.rows.some(r => r.includes(listed.archivedPid)), false,
           'a Complete project is not listed by default');
      t.eq(listed.hasArchivedHdr, false, 'no Archived section until you search');

      // ── but a search reaches them ───────────────────────────────────────
      const searched = await app.page.evaluate(pid => {
        document.getElementById('ps-search').value = pid;
        buildProjSwitchList();
        const html = document.getElementById('ps-list').innerHTML;
        return { found: html.includes(pid), hasHdr: /Archived/.test(html) };
      }, listed.archivedPid);
      t.ok(searched.found, 'searching finds the archived project');
      t.ok(searched.hasHdr, 'and groups it under an Archived heading');

      const noMatch = await app.page.evaluate(() => {
        document.getElementById('ps-search').value = 'zzzz-no-such-project';
        buildProjSwitchList();
        return document.getElementById('ps-list').innerHTML;
      });
      t.ok(/No project matches/.test(noMatch), 'an empty search says so');

      // ── picking a project must not move you off the current view ────────
      const picked = await app.page.evaluate(() => {
        setView('reports');
        const before = S.view;
        const p = _syncCache.projects.find(x => x.status === 'Active');
        pickProject(p.id);
        return { before, after: S.view, filter: String(S.projectFilter), id: String(p.id),
                 name: document.getElementById('ps-name').textContent,
                 popHidden: document.getElementById('ps-pop').style.display === 'none',
                 projName: p.name };
      });
      t.eq(picked.before, 'reports', 'started on the reports view');
      t.eq(picked.after, 'reports', 'switching project stays on the same view');
      t.eq(picked.filter, picked.id, 'the project filter was applied');
      t.eq(picked.name, picked.projName, 'the switcher shows the chosen project');
      t.ok(picked.popHidden, 'the picker closed after choosing');

      const cleared = await app.page.evaluate(() => {
        pickProject('');
        return { filter: S.projectFilter, name: document.getElementById('ps-name').textContent };
      });
      t.eq(cleared.filter, null, 'choosing All projects clears the filter');
      t.eq(cleared.name, 'All projects', 'and the switcher says so');

      // ── deadline panel ──────────────────────────────────────────────────
      const dl = await app.page.evaluate(() => ({
        rows: document.querySelectorAll('#dl-list .dl-item').length,
        scope: document.getElementById('dl-scope').textContent,
        text: document.getElementById('dl-list').textContent,
      }));
      t.ok(dl.rows > 0, 'the panel renders deadlines from the seed');
      t.ok(dl.rows <= 6, `capped at 5 plus the stale summary (got ${dl.rows})`);
      t.eq(dl.scope, 'all projects', 'scope label reflects no project filter');

      // Stale items are summarised, never listed individually.
      const stale = await app.page.evaluate(() => {
        const el = document.getElementById('dl-list');
        const days = [...el.querySelectorAll('.dl-when')].map(d => d.textContent)
          .map(s => (s.match(/^(\d+) days overdue/) || [])[1]).filter(Boolean).map(Number);
        return { worst: days.length ? Math.max(...days) : 0,
                 hasSummary: /long overdue/.test(el.textContent) };
      });
      t.ok(stale.hasSummary, 'the seed has long-overdue items and they are summarised');
      t.ok(stale.worst <= 90,
           `no individually listed item is past the stale cutoff (worst ${stale.worst}d)`);

      // Sorted most-urgent first, and scoping follows the project filter.
      const sorted = await app.page.evaluate(() => {
        const el = document.getElementById('dl-list');
        return [...el.querySelectorAll('.dl-item')].map(b => {
          const w = b.querySelector('.dl-when').textContent;
          if (/long overdue/.test(w)) return -99999;
          const od = w.match(/^(\d+) days? overdue/);
          if (od) return -Number(od[1]);
          if (/today/i.test(w)) return 0;
          if (/tomorrow/i.test(w)) return 1;
          return Number((w.match(/In (\d+)/) || [])[1] || 0);
        });
      });
      t.eq(sorted, sorted.slice().sort((a, b) => a - b), 'rows are ordered most urgent first');

      const scoped = await app.page.evaluate(() => {
        const p = _syncCache.projects.find(x => x.status === 'Active');
        pickProject(p.id);
        const metas = [...document.querySelectorAll('#dl-list .dl-meta')].map(m => m.textContent);
        return { scope: document.getElementById('dl-scope').textContent,
                 // With one project selected the pid is redundant and omitted.
                 anyPid: metas.some(m => /·/.test(m)) };
      });
      t.eq(scoped.scope, 'this project', 'scope label follows the project filter');
      t.eq(scoped.anyPid, false, 'the project code is dropped when already scoped');

      // A comment period closing soon must appear, typed as a comment period.
      const periodHTML = await app.page.evaluate(() => {
        const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
        _syncCache.comment_periods = [{ id: 'cp-test', projectId: S.projectFilter,
          name: 'Draft EA public review', status: 'Open', endDate: soon }];
        buildDeadlines();
        return document.getElementById('dl-list').innerHTML;
      });
      t.ok(/Draft EA public review closes/.test(periodHTML),
           'a comment period closing in 2 days appears in the panel');
      t.ok(/Comment period/.test(periodHTML), 'and is labelled as one');

      // Clicking a row navigates somewhere useful.
      await app.page.evaluate(() => { setView('dashboard'); _dlGo[0](); });
      const nav = await app.page.evaluate(() => S.view);
      t.ok(['comments', 'commitments', 'followups'].includes(nav),
           `a deadline row navigates to its view (went to ${nav})`);

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
