// Client reporting, end to end: archive → share → publish trend → portal.
//
// Roadmap item 5. Every piece of this shipped and none of it was covered, which
// is the exact risk profile that produced four separate bugs in one week — a
// letterhead repeating on every page, a batched AI call quietly using a capped
// prompt, a deadline card printing one date three times, a logo updated in one
// of the two places it lives. All of them rendered fine and all of them were
// wrong.
//
// The assertion that matters most is the last one. An archived report is a
// point-in-time COMPLIANCE RECORD: a report issued in July has to still read
// identically in September even if someone later back-dates an interaction into
// its period. That is why _buildReportSnapshot freezes the rendered tables
// rather than storing a query. Nothing tested it.
module.exports = {
  name: 'client reporting — archive, share, publish, and the portal renders it',
  async run({ t }) {
    t.seed();

    const proj = (await t.sql(
      `select id, pid, name from pi_projects where pid='25-154-001'`))[0];
    t.ok(proj, 'SR-154 is in the seed');
    const P = String(proj.id);
    const token = (await t.sql(
      `select token from pi_portal_links where project_id::text=$1 limit 1`, [P]))[0];
    t.ok(token, 'and it has a portal link');

    const SHARED  = { num: '1', start: '2026-05-01', end: '2026-05-31', title: 'PI Progress Report — May' };
    const PRIVATE = { num: '2', start: '2026-06-01', end: '2026-06-30', title: 'PI Progress Report — June' };
    const TREND    = 'Engagement held steady through the spring. The Harvest Hills noise '
                   + 'wall request remains the single open item and is the one thing needing '
                   + 'a decision before the final environmental document.';

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    let sharedId, privateId, frozen;
    try {
      await app.ready();

      // ── archive two reports, one per period ──────────────────────────────
      // Fill the EDITOR, not localStorage. loadReportSections() prefers the
      // Supabase draft and writes it back over localStorage on open, so
      // pre-seeding the key is silently discarded once a draft exists — the
      // second report came out as a copy of the first. Driving the inputs is
      // also what a person actually does.
      const archive = async (p) => app.page.evaluate(async ([pid, per]) => {
        S.projectFilter = pid;
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        set('rpt-title', per.title);
        set('rpt-num', per.num);
        set('rpt-pstart', per.start);
        set('rpt-pend', per.end);
        set('rpt-overall-summary', 'Overall summary for ' + per.title + '.');
        document.querySelectorAll('.rpt-sec-summary').forEach((ta, i) => {
          ta.value = 'Narrative ' + (i + 1) + ' for ' + per.title + '.';
        });
        document.querySelectorAll('.rpt-sec-table').forEach(cb => { cb.checked = true; });
        await manualArchiveReport();
        const mine = (_syncCache.report_archive || [])
          .filter(r => String(r.projectId) === String(pid) && r.reportTitle === per.title);
        return mine.length ? String(mine[0].id) : null;
      }, [P, p]);

      sharedId  = await archive(SHARED);
      privateId = await archive(PRIVATE);
      t.ok(sharedId,  'the first report archived');
      t.ok(privateId, 'and the second');
      t.ok(sharedId !== privateId, 'as two distinct records');

      // A snapshot must actually have reached the database — _archiveReport
      // used to swallow a failed insert while the caller said "saved".
      const rows = await t.sql(
        `select id, report_title, period_start, period_end, client_visible,
                snapshot is not null has_snap,
                snapshot->'sections' secs
           from pi_report_archive where project_id::text=$1 order by archived_at`, [P]);
      const mine = rows.filter(r => /PI Progress Report — (May|June)/.test(r.report_title));
      t.eq(mine.length, 2, 'both rows are in pi_report_archive');
      t.ok(mine.every(r => r.has_snap), 'each carries a frozen snapshot');
      t.ok(mine.every(r => !r.client_visible), 'and neither is shared yet');
      t.ok(mine[0].secs && mine[0].secs.length >= 2,
           `the snapshot froze its sections (${mine[0].secs && mine[0].secs.length})`);
      frozen = mine.find(r => String(r.id) === sharedId).secs
                 .find(s => s.type === 'auto-concerns');
      t.ok(frozen && frozen.tableHtml && /<table/i.test(frozen.tableHtml),
           'including the rendered interaction table, not a query to re-run');

      // ── share ONE of them ────────────────────────────────────────────────
      await app.page.evaluate(id => toggleReportShared(id), sharedId);
      await app.page.waitForTimeout(900);
      const shared = (await t.sql(
        `select id, client_visible from pi_report_archive where project_id::text=$1`, [P]))
        .filter(r => [sharedId, privateId].includes(String(r.id)));
      t.eq(shared.find(r => String(r.id) === sharedId).client_visible, true,
           'the shared report is flagged client_visible');
      // NOT `=== false`. Production declares `client_visible boolean not null
      // default false`; the harness schema is generated from column types with
      // no defaults, so an untouched row is null here and false in the field.
      // The requirement is that it is not TRUE — that is what the portal filters
      // on — so assert that, and pin the production shape separately below.
      t.ok(shared.find(r => String(r.id) === privateId).client_visible !== true,
           'and the other is not — sharing is per report, not per project');
      const mig = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'sql',
                             '2026-07-06_portal_shared_reports.sql'), 'utf8');
      t.ok(/client_visible boolean not null default false/.test(mig),
           'and production defaults the column to false, so an archived report '
           + 'is never shared by accident');

      // ── publish a trend ──────────────────────────────────────────────────
      // publishClientTrend reads the editor's textarea, so the human gate is
      // real: nothing reaches the client without someone approving the text.
      await app.page.evaluate(async ([txt]) => {
        const ta = document.createElement('textarea');
        ta.id = 'trend-edit'; ta.value = txt;
        document.body.appendChild(ta);
        const by = document.createElement('input');
        by.id = 'trend-pub-by'; by.value = 'Jeff Putzke';
        document.body.appendChild(by);
        await publishClientTrend();
      }, [TREND]);
      await app.page.waitForTimeout(900);
      const trend = await t.sql(
        `select content_full, published_by from pi_client_summaries
          where project_id=$1::bigint order by published_at desc limit 1`, [P]);
      t.eq(trend.length, 1, 'the trend reached pi_client_summaries');
      t.eq(trend[0].content_full, TREND, 'with the text that was approved, verbatim');
      t.eq(trend[0].published_by, 'Jeff Putzke', 'attributed to whoever published it');

      t.eq(app.errors, [], 'no page errors on the consultant side');
    } finally { await app.close(); }

    // ── the client's view ──────────────────────────────────────────────────
    const portal = await t.open(`client-portal.html?token=${token.token}`);
    try {
      await portal.page.waitForFunction(
        () => typeof renderSection === 'function' && document.querySelector('.nav-item, nav'),
        { timeout: 15000 });
      await portal.page.evaluate(() => renderSection('summary'));
      await portal.page.waitForFunction(
        () => /Project Status/.test(document.body.innerHTML), { timeout: 8000 });

      const seen = await portal.page.evaluate(() => document.body.innerHTML);
      t.ok(seen.includes('Harvest Hills noise wall request'),
           'the published trend is on the client\'s screen');
      t.ok(seen.includes('PI Progress Report — May'), 'so is the shared report');
      t.eq(seen.includes('PI Progress Report — June'), false,
           'and the UNSHARED one is not — this is the whole point of the toggle');

      // The report has to RENDER, not just be listed. It previously fell back
      // to a "archived before full snapshots" note whenever the snapshot did
      // not load, which is a lie about that row.
      const rendered = await portal.page.evaluate(() => {
        const btn = [...document.querySelectorAll('button, .sum-toggle, a')]
          .find(b => /PI Progress Report — May/.test(b.textContent));
        if (btn) btn.click();
        return document.body.innerHTML;
      });
      await portal.page.waitForTimeout(400);
      const body = await portal.page.evaluate(() => document.body.innerHTML);
      t.eq(/archived before full snapshots/i.test(body), false,
           'it does not claim the report predates snapshots');
      t.ok(/<table/i.test(body), 'the frozen data table renders in the portal');

      t.eq(portal.errors, [], 'no page errors on the client side');
    } finally { await portal.close(); }

    // ── the compliance guarantee ───────────────────────────────────────────
    // Back-date an interaction INTO the archived period. The live report would
    // now count one more; the archived one must not move. This is the single
    // reason snapshots exist, and nothing was checking it.
    const beforeHtml = frozen.tableHtml;
    const beforeLabel = frozen.countsLabel;
    await t.sql(`
      insert into pi_interactions
        (project_id, stakeholder_id, interaction_date, channel, subject, nature,
         direction, summary, logged_by)
      select $1, ps.stakeholder_id::text, $2::date, 'Phone', 'BACKDATED PROBE',
             'Inquiry', 'Incoming', 'Logged after the report was archived.', 'ZZ'
        from pi_project_stakeholders ps
       where ps.project_id::text = $1
         and coalesce(ps.stakeholder_role,'External')='External'
       limit 1`, [P, SHARED.start]);

    const after = (await t.sql(
      `select snapshot->'sections' secs from pi_report_archive where id::text=$1`,
      [sharedId]))[0].secs.find(s => s.type === 'auto-concerns');
    t.eq(after.tableHtml, beforeHtml,
         'the archived table is byte-identical after an interaction is back-dated into its period');
    t.eq(after.countsLabel, beforeLabel, 'and so is its counts label');
    t.eq(/BACKDATED PROBE/.test(after.tableHtml), false,
         'the row logged after archiving does not appear in the issued report');

    // And the client still sees the frozen copy, not a recomputed one.
    const p2 = await t.open(`client-portal.html?token=${token.token}`);
    try {
      await p2.page.waitForFunction(() => typeof renderSection === 'function', { timeout: 15000 });
      await p2.page.evaluate(() => renderSection('summary'));
      await p2.page.waitForFunction(
        () => /Project Status/.test(document.body.innerHTML), { timeout: 8000 });
      await p2.page.evaluate(() => {
        const btn = [...document.querySelectorAll('button, .sum-toggle, a')]
          .find(b => /PI Progress Report — May/.test(b.textContent));
        if (btn) btn.click();
      });
      await p2.page.waitForTimeout(400);
      const html = await p2.page.evaluate(() => document.body.innerHTML);
      t.eq(/BACKDATED PROBE/.test(html), false,
           'and the client re-reading it months later still sees what was issued');
    } finally { await p2.close(); }
  },
};
