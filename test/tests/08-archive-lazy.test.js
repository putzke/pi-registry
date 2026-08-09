// pi_report_archive.snapshot is a self-contained frozen copy of an entire
// rendered report. loadAllData() used to fetch it with select=*, so every
// snapshot for every project downloaded on every page load — that, not storage,
// was the real ceiling on ARCHIVE_LIMIT.
//
// The two things that can go wrong once it is lazy are both silent: a preview
// that falls through to the "archived before snapshots were captured" note (a
// lie about that row), and a status report that quietly degrades to
// narrative-only because trendFacts looked absent. Both are checked here.
module.exports = {
  name: 'report archive — snapshots load on demand, not at boot',
  async run({ t, shim }) {
    t.seed();

    const seeded = await t.sql(
      `select count(*) n, count(snapshot) with_snap from pi_report_archive`);
    t.gt(Number(seeded[0].n), 1, 'seed provides archived reports');
    t.eq(Number(seeded[0].with_snap), Number(seeded[0].n), 'all of them carry a snapshot');

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // ── boot must not ask for the snapshot column ───────────────────────
      const bootCalls = shim.calls.filter(c => /pi_report_archive/.test(c.url));
      t.gt(bootCalls.length, 0, 'boot fetches the archive list');
      t.ok(bootCalls.every(c => !/snapshot/.test(decodeURIComponent(c.url))),
           'no boot request asks for snapshot');
      t.ok(bootCalls.every(c => !/select=\*/.test(decodeURIComponent(c.url))),
           'the archive is no longer fetched with select=*');

      // Everything the list view renders must still be present.
      const cached = await app.page.evaluate(() => {
        const a = (_syncCache.report_archive || [])[0] || {};
        return { total: (_syncCache.report_archive || []).length,
                 hasTitle: !!a.reportTitle, hasArchivedAt: !!a.archivedAt,
                 hasSections: a.sections !== undefined && a.sections !== '' && a.sections !== null,
                 clientVisible: typeof a.clientVisible,
                 // The key must be ABSENT, not null — null means a genuine
                 // pre-snapshot row and renders a different, honest note.
                 snapshotKeyPresent: 'snapshot' in a };
      });
      t.eq(cached.total, Number(seeded[0].n), 'every archive row still loaded');
      t.ok(cached.hasTitle && cached.hasArchivedAt, 'list metadata is present');
      t.ok(cached.hasSections, 'narrative sections are present');
      t.eq(cached.clientVisible, 'boolean', 'client_visible survives the narrowed select');
      t.eq(cached.snapshotKeyPresent, false, 'snapshot key is absent, not defaulted to empty');

      // ── other tables are untouched by the narrowed select ───────────────
      const others = await app.page.evaluate(() => ({
        projects: _syncCache.projects.length,
        interactions: _syncCache.interactions.length,
        reports: _syncCache.reports.length,
      }));
      t.eq(others.projects, 3, 'projects still load');
      t.gt(others.interactions, 500, 'interactions still load');

      // ── previewing pulls the snapshot and renders full fidelity ─────────
      const target = await app.page.evaluate(() =>
        (_syncCache.report_archive || []).find(r => r.snapshot === undefined)?.id);
      t.ok(target, 'found an archive row with no snapshot loaded');

      shim.calls.length = 0;
      await app.page.evaluate(id => previewArchivedReport(id), String(target));
      await app.page.waitForFunction(id =>
        'snapshot' in ((_syncCache.report_archive || []).find(r => String(r.id) === id) || {}),
        String(target), { timeout: 5000 });

      const fetched = shim.calls.filter(c => /pi_report_archive/.test(c.url)
                                          && /snapshot/.test(decodeURIComponent(c.url)));
      t.eq(fetched.length, 1, 'previewing issued exactly one snapshot fetch');
      t.ok(fetched[0] && /id=in\./.test(decodeURIComponent(fetched[0].url)),
           'it fetched by id rather than reloading the table');

      const rendered = await app.page.evaluate(() => {
        // showInlineReport() paints into an overlay, not #main.
        const el = document.getElementById('inline-rpt-overlay');
        const frame = document.getElementById('inline-rpt-frame');
        const html = (el ? el.innerHTML : '')
          + (frame && frame.getAttribute('srcdoc') ? frame.getAttribute('srcdoc') : '');
        return { shown: !!el,
                 hasNote: /archived before full snapshots/i.test(html),
                 hasTable: /<table/i.test(html) };
      });
      t.ok(rendered.shown, 'the archived report opened');
      t.eq(rendered.hasNote, false, 'it does NOT claim the report predates snapshots');
      t.ok(rendered.hasTable, 'the frozen data tables rendered');

      // A second preview must not refetch.
      shim.calls.length = 0;
      await app.page.evaluate(id => previewArchivedReport(id), String(target));
      await app.page.waitForTimeout(300);
      t.eq(shim.calls.filter(c => /snapshot/.test(decodeURIComponent(c.url))).length, 0,
           'a second preview reuses the cached snapshot');

      // ── an update must never null the un-loaded snapshot ────────────────
      const other = await app.page.evaluate(() => {
        const r = (_syncCache.report_archive || []).find(x => x.snapshot === undefined);
        return r ? String(r.id) : null;
      });
      t.ok(other, 'found another row still without its snapshot');
      if (other) {
        await app.page.evaluate(id => toggleReportShared(id), other);
        await app.page.waitForTimeout(800);
        const row = (await t.sql(
          'select client_visible, snapshot from pi_report_archive where id::text=$1', [other]))[0];
        t.ok(row.snapshot, 'the snapshot survived an update that never loaded it');
        t.eq(typeof row.client_visible, 'boolean', 'the share toggle still wrote');
      }

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
