// Events & outreach log + "Follow-ups resolved" (DEV, Nov 2026, Jeff).
// Seen live on 3600 West: the section listed every event the project ever had
// and no outreach at all. Now ONE model (_eventsLogModel) used by the preview,
// the frozen snapshot, the .docx, the counts chip, the AI facts and Report at a
// glance: events HELD and outreach DONE inside the window; everything still
// PLANNED since the project began, with "date passed N days ago"; outreach left
// out when the report has its own Outreach section. Report at a glance shows
// "Follow-ups resolved" (this period / to date) instead of "Open follow-ups now".
module.exports = {
  name: 'events & outreach log — held/done in the window, planned since the start; glance counts resolved follow-ups',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async (pid) => {
        const projF = DB.get('projects').find(p => String(p.id) === pid).id;
        S.projectFilter = projF;
        const today = localToday(), d = n => _isoAddDays(today, n);
        const a = d(-14), b = today;
        const others = k => (_syncCache[k] || []).filter(x => String(x.projectId) !== String(projF));
        _syncCache.meetings = others('meetings').concat([
          { id: 'e1', projectId: projF, date: d(-3), title: 'HELD_IN_WINDOW', type: 'Partnering meeting', status: 'Completed', attendanceCount: 12 },
          { id: 'e2', projectId: projF, date: d(-60), title: 'HELD_LONG_AGO', type: 'Open house', status: 'Completed', attendanceCount: 50 },
          { id: 'e3', projectId: projF, date: d(-30), title: 'PLANNED_PASSED', type: 'Open house', status: 'Planned' },
          { id: 'e4', projectId: projF, date: d(20), title: 'PLANNED_FUTURE', type: 'Briefing', status: 'Planned' },
          { id: 'e5', projectId: projF, date: d(-5), title: 'CANCELLED_ONE', type: 'Briefing', status: 'Cancelled' },
        ]);
        _syncCache.outreach_actions = others('outreach_actions').concat([
          { id: 901, projectId: projF, actionDate: d(-2), actionType: 'Flyer / door hanger', title: 'OUT_IN_WINDOW', party: 'PI team', reach: 450, delivery: 'Hand-delivered' },
          { id: 902, projectId: projF, actionDate: d(-90), actionType: 'Press release', title: 'OUT_OLD', party: 'PI team' },
          { id: 903, projectId: projF, actionDate: d(10), actionType: 'Email blast', title: 'OUT_SCHEDULED', party: 'PI team' },
        ]);
        _syncCache.outreach_readings = others('outreach_readings');
        _syncCache.interactions = others('interactions').concat([
          { id: 8001, projectId: projF, date: d(-5), direction: 'Incoming', channel: 'Phone', followUp: true, followUpDone: true, followUpResolved: d(-4) },
          { id: 8002, projectId: projF, date: d(-80), direction: 'Incoming', channel: 'Phone', followUp: true, followUpDone: true, followUpResolved: d(-70) },
          { id: 8003, projectId: projF, date: d(-1), direction: 'Incoming', channel: 'Phone', followUp: true, followUpDone: false, followUpDue: d(5) },
        ]);
        const evSec = { type: 'auto-events', title: 'Events & outreach log', showTable: true };
        const md = _eventsLogModel(projF, a, b, [evSec]);
        const mdOwn = _eventsLogModel(projF, a, b, [evSec, { type: 'auto-outreach', title: 'Outreach' }]);
        const g = _reportGlance(projF, { pstart: a, pend: b, sections: [evSec, { type: 'auto-followups', title: 'Follow-up status' }] });
        // Editor → preview, snapshot, .docx, AI request
        localStorage.removeItem('pir4_pi_reports_' + projF);
        _syncCache.reports = [{ id: 1, projectId: projF, reportNum: '3', reportTitle: 'PI', periodStart: a, periodEnd: b,
          sections: [Object.assign({ id: 's0' }, evSec), { id: 's1', type: 'auto-followups', title: 'Follow-up status', showTable: false }] }];
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport(); renderLivePreview();
        const pane = document.getElementById('rpt-live-preview').textContent;
        const snap = _buildReportSnapshot(projF, loadReportSections(projF));
        const snapEv = (snap.sections || []).find(s => s.type === 'auto-events') || {};
        const req = _sectionAIRequest('auto-events', _buildSectionDraft('auto-events'));
        const base = _buildSectionDraftBase('auto-events');
        const real = URL.createObjectURL.bind(URL); let blob = null;
        URL.createObjectURL = x => { blob = x; return real(x); };
        await exportPIDocx();
        for (let i = 0; i < 100 && !blob; i++) await new Promise(res => setTimeout(res, 100));
        URL.createObjectURL = real;
        const doc = blob ? await (await JSZip.loadAsync(blob)).file('word/document.xml').async('string') : '';
        return {
          held: md.held.map(m => m.title), planned: md.planned.map(p => p.m.title + ':' + p.late),
          outDone: md.out.rows.map(x => x.a.title), outPlanned: md.outPlanned.map(x => x.title),
          own: { withOutreach: mdOwn.withOutreach, out: mdOwn.out, outPlanned: mdOwn.outPlanned.length },
          counts: _eventsLogCounts(md), rows: g.rows, attention: g.attention,
          pane, snapTable: snapEv.tableHtml || '', snapCounts: snapEv.countsLabel || '', req: req.userContent, base, doc,
        };
      }, String(proj.id));

      t.eq(r.held.join(','), 'HELD_IN_WINDOW', 'completed events: only those held inside the window');
      t.eq(r.planned.join(','), 'PLANNED_PASSED:30,PLANNED_FUTURE:0', 'planned events since the project began, oldest first, days past their date; cancelled left out');
      t.eq(r.outDone.join(','), 'OUT_IN_WINDOW', 'outreach done: only actions dated inside the window');
      t.eq(r.outPlanned.join(','), 'OUT_SCHEDULED', 'outreach dated after today is scheduled');
      t.ok(!r.own.withOutreach && !r.own.out && !r.own.outPlanned, 'with its own Outreach section in the report, outreach is left out here');
      t.eq(r.counts.join(' · '), '1 event held this period · 1 outreach action this period · 3 planned (1 past their date)', 'counts chip');
      for (const [label, txt] of [['preview', r.pane], ['snapshot', r.snapTable]]) {
        t.ok(txt.includes('HELD_IN_WINDOW') && txt.includes('OUT_IN_WINDOW') && txt.includes('OUT_SCHEDULED') && txt.includes('PLANNED_FUTURE'), label + ': held, done and planned rows');
        t.ok(/date passed 30 days ago/.test(txt), label + ': a planned date that passed says how long ago');
        t.ok(!txt.includes('HELD_LONG_AGO') && !txt.includes('OUT_OLD') && !txt.includes('CANCELLED_ONE'), label + ': nothing completed before the window, nothing cancelled');
      }
      t.ok(r.pane.includes(r.counts.join(' · ')) && r.snapCounts.includes(r.counts.join(' · ')), 'preview and snapshot carry the same counts chip');
      t.ok(r.doc.includes('OUT_IN_WINDOW') && r.doc.includes('date passed 30 days ago') && !r.doc.includes('HELD_LONG_AGO'), '.docx: same rows');
      t.ok(/30 days ago/.test(r.req) && /OUT_IN_WINDOW/.test(r.req) && /not yet held/.test(r.req), 'AI facts: outreach done and the elapsed days on the passed date');
      t.ok(!/SINCE THE LAST REPORT|use exactly as given/i.test(r.base) && /1 of them has a planned date that has passed/.test(r.base), 'no-key text: plain sentences');
      const row = l => (r.rows.find(x => x[0] === l) || []).slice(1).join('/');
      t.eq(row('Follow-ups resolved'), '1/2', 'glance: follow-ups resolved this period / to date');
      t.ok(!r.rows.some(x => /Open follow-ups now/.test(x[0])), 'glance: "Open follow-ups now" is gone');
      t.eq(row('Outreach actions (releases, posts, flyers, coverage)'), '1/2', 'glance: outreach done (scheduled ones not counted)');
      t.eq(row('Events held'), '1/2', 'glance: events held');
      t.ok(r.attention.some(x => /Planned for .*, not marked held: PLANNED_PASSED/.test(x)), 'attention: a planned event whose date passed');
    } finally { await app.close(); }
  },
};
