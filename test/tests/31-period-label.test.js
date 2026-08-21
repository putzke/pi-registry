// The "N-day report period ·" prefix belongs only to the section the period
// actually bounds.
//
// Every auto section's counts label carried it, so a Deliverable/Scope Status
// section read "19-day report period · 6 deliverables" and the Stakeholder
// Contact List read "19-day report period · 41 external contacts". Neither is
// filtered by the header dates at all — both show the project's current state —
// so the label claimed a window that was never applied. auto-intlog is worse
// than noise: it lists interactions from BEFORE pstart, so the prefix described
// the exact period those rows are excluded from.
//
// Only auto-concerns is bounded by pstart/pend. Both label sites — the live
// preview and the archive snapshot — must agree, or an archived report's header
// contradicts the one that was on screen when it was issued.
module.exports = {
  name: 'report period label — only on the section the period bounds',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(
        `select id, pid from pi_projects where pid='25-154-001'`))[0];
      t.ok(proj, 'found a demo project');

      // ── the rule itself ──────────────────────────────────────────────────
      const rule = await app.page.evaluate(() => ({
        concerns: _periodLabel('auto-concerns', '2026-07-20', '2026-08-07'),
        del:      _periodLabel('auto-del', '2026-07-20', '2026-08-07'),
        contacts: _periodLabel('auto-contacts', '2026-07-20', '2026-08-07'),
        intlog:   _periodLabel('auto-intlog', '2026-07-20', '2026-08-07'),
        parcels:  _periodLabel('auto-parcels', '2026-07-20', '2026-08-07'),
        noDates:  _periodLabel('auto-concerns', '', ''),
        halfDates:_periodLabel('auto-concerns', '2026-07-20', ''),
        list:     PERIOD_SCOPED_TYPES.slice(),
      }));
      t.eq(rule.concerns, '19-day report period · ',
           'concerns is bounded by the period and says so — inclusive of both ends');
      t.eq(rule.del, '', 'deliverables are not — they show current state');
      t.eq(rule.contacts, '', 'nor is the stakeholder contact list');
      t.eq(rule.intlog, '',
           'nor the prior-interaction log, which is the period\'s inverse');
      t.eq(rule.parcels, '', 'nor the parcel register');
      t.eq(rule.noDates, '', 'no dates, no claim');
      t.eq(rule.halfDates, '', 'and half a range is not a range');
      t.eq(rule.list, ['auto-concerns'],
           'exactly one section type is period-scoped');

      // ── the live preview ─────────────────────────────────────────────────
      const SECS = [
        { id: 'concerns', title: 'Recent Public Concerns and Inquiries',
          type: 'auto-concerns', showTable: true },
        { id: 'del',      title: 'Deliverable / Scope Status', type: 'auto-del' },
        { id: 'contacts', title: 'Stakeholder Contact List', type: 'auto-contacts' },
        { id: 'intlog',   title: 'Prior Interaction Log', type: 'auto-intlog' },
      ];
      const preview = await app.page.evaluate(async ([pid, secs]) => {
        S.projectFilter = pid;
        // Drive the editor off a known draft rather than whatever the seed left.
        _syncCache.reports = [];
        localStorage.setItem('pir4_pi_reports_' + pid, JSON.stringify({
          reportNum: '1', reportTitle: 'PI Progress Report',
          periodStart: '2026-07-20', periodEnd: '2026-08-07',
          sections: secs, distGroups: [],
        }));
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
        renderLivePreview();
        const html = document.getElementById('rpt-live-preview').innerHTML;
        // The counts label is the italic grey chip under each section heading.
        const labels = [...html.matchAll(
          /font-style:italic;background:#f0f0f0[^>]*>([^<]*)</g)].map(m => m[1]);
        return { labels, days: (html.match(/-day report period/g) || []).length,
                 hasDelCount: /deliverable/.test(html) };
      }, [String(proj.id), SECS]);

      t.gt(preview.labels.length, 2, 'the preview rendered several counts labels');
      t.ok(preview.hasDelCount, 'the deliverables section still reports its count');
      t.eq(preview.days, 1, 'the period is claimed exactly once in the whole report');
      const withPeriod = preview.labels.filter(l => /-day report period/.test(l));
      t.eq(withPeriod.length, 1, 'and only one label carries it');
      t.ok(withPeriod[0] && /interaction/.test(withPeriod[0]),
           `it is the concerns label ("${withPeriod[0]}")`);
      preview.labels.filter(l => /deliverable|external contact|prior interaction/.test(l))
        .forEach(l => t.eq(/-day report period/.test(l), false,
          `"${l}" makes no claim about the period`));

      // ── the frozen snapshot says the same thing ──────────────────────────
      // A mismatch here is the failure that matters: the archived copy is the
      // compliance record, and it must read as the report did when issued.
      const snap = await app.page.evaluate(([pid, secs]) => {
        const s = _buildReportSnapshot(pid, {
          periodStart: '2026-07-20', periodEnd: '2026-08-07',
          sections: secs, distGroups: [],
        });
        const out = {};
        s.sections.forEach(sec => { out[sec.type] = sec.countsLabel || ''; });
        return out;
      }, [String(proj.id), SECS]);

      t.ok(/^19-day report period · /.test(snap['auto-concerns']),
           `the archived concerns label keeps the period ("${snap['auto-concerns']}")`);
      ['auto-del', 'auto-contacts', 'auto-intlog'].forEach(ty => {
        t.ok(snap[ty], `${ty} still has a counts label`);
        t.eq(/-day report period/.test(snap[ty]), false,
             `${ty} does not claim the period ("${snap[ty]}")`);
      });

      // The two sites must be built by the same helper — this drifted apart
      // once already, which is how an archive can contradict a live preview.
      const shared = await app.page.evaluate(() => ({
        preview:  /_periodLabel\(/.test(String(renderLivePreview)),
        snapshot: /_periodLabel\(/.test(String(_buildReportSnapshot)),
        rawPrev:  /-day report period/.test(String(renderLivePreview)),
        rawSnap:  /-day report period/.test(String(_buildReportSnapshot)),
      }));
      t.ok(shared.preview, 'the live preview uses the shared helper');
      t.ok(shared.snapshot, 'so does the snapshot');
      t.eq(shared.rawPrev, false, 'neither hand-rolls the string any more');
      t.eq(shared.rawSnap, false, 'in either place');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
