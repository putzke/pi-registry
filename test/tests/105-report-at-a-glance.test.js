// "Report at a glance" — the PI report's opener (Oct 2026, Jeff). It replaced
// the AI executive summary, which could only retell the sections in fewer
// words. Counted, never AI-written: what the report covers, key figures (this
// period vs the one before) for the sections IN the report only, and what
// needs attention or is coming up. Same model in the preview, the frozen
// snapshot (archive + portal) and the .docx.
// Also: the concerns AI facts carry each change already worked out (up/down),
// after a draft said "80 outbound, down from 52".
module.exports = {
  name: 'report at a glance — counted opener on every surface; concerns changes worked out',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async (pid) => {
        const P = DB.get('projects').find(p => String(p.id) === pid);
        const projF = P.id; S.projectFilter = projF;
        const mine = (k) => (DB.get(k) || []).filter(x => String(x.projectId) !== String(projF));
        const mk = (date, dir) => ({ id: 'g' + Math.random(), projectId: projF, date, direction: dir, channel: 'Phone', subject: 'Noise', summary: 'x' });
        _syncCache.interactions = mine('interactions').concat([
          mk('2030-02-02', 'Incoming'), mk('2030-02-03', 'Incoming'), mk('2030-02-05', 'Outgoing'),
          mk('2030-01-25', 'Incoming'),
          Object.assign(mk('2030-02-04', 'Incoming'), { followUp: true, followUpDue: '2030-02-10' }),
        ]);
        _syncCache.meetings = mine('meetings').concat([
          { id: 'm1', projectId: projF, title: 'Open house', type: 'Public meeting', date: '2030-02-06', status: 'Completed', attendanceCount: 40 },
          { id: 'm2', projectId: projF, title: 'Business briefing', type: 'Briefing', date: '2030-02-20', status: 'Planned' },
          { id: 'm3', projectId: projF, title: 'Far-off event', type: 'Briefing', date: '2030-05-20', status: 'Planned' },
        ]);
        _syncCache.issues = mine('issues').concat([
          { id: 'i1', projectId: projF, title: 'Driveway access at 400 N', status: 'Open', priority: 'High', dateRaised: '2030-02-03' },
          { id: 'i2', projectId: projF, title: 'Low issue', status: 'Open', priority: 'Low', dateRaised: '2030-01-22' },
        ]);
        _syncCache.commitments = mine('commitments').concat([
          { id: 'c1', projectId: projF, commitment: 'Mail the detour map to the HOA', status: 'Open', dueDate: '2030-02-01' },
          { id: 'c2', projectId: projF, commitment: 'Kept one', status: 'Fulfilled', dueDate: '2030-01-01' },
        ]);
        const secs = [
          { type: 'auto-concerns', title: 'Recent public concerns and inquiries' },
          { type: 'auto-events', title: 'Events & outreach log' },
          { type: 'auto-issues', title: 'Issues tracker' },
          { type: 'auto-commitments', title: 'Commitments tracker' },
          { type: 'auto-followups', title: 'Follow-up status' },
        ];
        const g = _reportGlance(projF, { pstart: '2030-02-01', pend: '2030-02-14', sections: secs.map(s => Object.assign({ showTable: true }, s)), today: '2030-02-14' });
        const gOff = _reportGlance(projF, { pstart: '2030-02-01', pend: '2030-02-14', sections: secs, today: '2030-02-14' });
        const gManual = _reportGlance(projF, { pstart: '2030-02-01', pend: '2030-02-14', sections: [{ type: 'manual', title: 'Planned PI activities' }], today: '2030-02-14' });
        const gZero = _reportGlance(projF, { pstart: '2040-02-01', pend: '2040-02-14', sections: [{ type: 'auto-outreach', title: 'Outreach' }, { type: 'auto-events', title: 'Events' }], today: '2030-02-14' });
        const chg = [_concernsChange(80, 52), _concernsChange(52, 80), _concernsChange(5, 5), _concernsChange(3, 0)];

        // Editor, preview, snapshot, archive, .docx
        _syncCache.reports = [{ id: 1, projectId: projF, reportNum: '1', reportTitle: 'PI', periodStart: '2030-02-01', periodEnd: '2030-02-14',
          overallSummary: 'A NOTE TO THE CLIENT.', sections: secs.map((s, i) => Object.assign({ id: 's' + i, showTable: false }, s)) }];
        localStorage.removeItem('pir4_pi_reports_' + projF);
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport(); renderLivePreview();
        const pane = document.getElementById('rpt-live-preview').innerHTML;
        const paneText = document.getElementById('rpt-live-preview').textContent;
        const noAIButton = !document.getElementById('overall-draft-btn') && typeof window.generateOverallDraft === 'undefined';
        const snap = _buildReportSnapshot(projF, loadReportSections(projF));
        // Freeze: change the data after archiving — the archived copy must not move.
        _syncCache.interactions.push(mk('2030-02-07', 'Incoming'));
        const arch = _buildArchivedPreviewHTML({ reportTitle: 'PI', overallSummary: 'A NOTE TO THE CLIENT.', snapshot: snap }, P);
        const real = URL.createObjectURL.bind(URL); let blob = null;
        URL.createObjectURL = x => { blob = x; return real(x); };
        await exportPIDocx();
        for (let i = 0; i < 100 && !blob; i++) await new Promise(res => setTimeout(res, 100));
        URL.createObjectURL = real;
        const doc = blob ? await (await JSZip.loadAsync(blob)).file('word/document.xml').async('string') : '';
        return { g, gOff, gManual, gZero, chg, pane, paneText, noAIButton, snapGlance: snap.atGlanceHtml || '', arch, doc, phase: P.phase };
      }, String(proj.id));

      const row = (label) => r.g.rows.find(x => x[0] === label);
      t.eq(r.chg.join(' | '), '80 this period, 52 in the previous period — up 28 | 52 this period, 80 in the previous period — down 28 | '
        + '5 this period, 5 in the previous period — no change | 3 this period, 0 in the previous period — up 3 (none before)',
        'concerns changes are worked out in code, direction included');
      t.ok(/^This report covers February 1–14, 2030/.test(r.g.intro), 'intro names the period');
      t.ok(!r.phase || r.g.intro.includes('during the ' + r.phase + ' phase'), 'intro names the phase');
      t.ok(r.g.intro.includes('includes: Recent public concerns and inquiries; Events & outreach log; Issues tracker'), 'intro lists the sections that follow');
      t.eq((row('Inbound and in-person contacts') || []).slice(1).join('/'), '3/1', 'inbound contacts: this period / previous');
      t.eq((row('Outbound notifications by the team') || []).slice(1).join('/'), '1/0', 'outbound contacts: this period / previous');
      t.eq((row('Events held') || []).slice(1).join('/'), '1/0', 'events held');
      t.eq((row('Attendance at events held') || []).slice(1).join('/'), '40/0', 'attendance');
      t.eq((row('Issues raised') || []).slice(1).join('/'), '1/1', 'issues raised, both periods');
      t.ok(/\(1 past due\)/.test((row('Open commitments to the public now') || [])[1] || ''), 'open commitments, with past due');
      t.ok(!r.g.rows.some(x => /Deliverables|Outreach actions|parcels/i.test(x[0])), 'no figure for a section not in the report');
      t.ok(r.g.attention.some(x => /Commitment past due \(due 02\/01\/2030\): Mail the detour map/.test(x)), 'attention: past-due commitment');
      t.ok(r.g.attention.some(x => /Open high-priority issue: Driveway access/.test(x)), 'attention: high-priority issue');
      t.ok(!r.g.attention.some(x => /Low issue/.test(x)), 'not a low-priority issue');
      t.ok(r.g.attention.some(x => /Coming up 02\/20\/2030: Business briefing/.test(x)), 'coming up: event within two weeks');
      t.ok(!r.g.attention.some(x => /Far-off/.test(x)), 'not an event months away');
      t.ok(r.g.attention.some(x => /1 follow-up is past due/.test(x)), 'attention: past-due follow-up');
      t.ok(r.gOff.attention.includes('1 commitment to the public is past due.') && r.gOff.attention.includes('1 high-priority issue is open.')
        && r.gOff.attention.includes('1 event is scheduled in the next two weeks.'), 'data table off: attention items counted, not named');
      t.ok(!r.gOff.attention.some(x => /Mail the detour|Driveway|Business briefing/.test(x)), 'and no item text leaks');
      t.eq(r.gZero.rows.length, 0, 'a count that is zero in both periods is left out');
      t.eq(r.gManual.rows.length, 0, 'a report with only typed sections has no figures');
      t.eq(r.gManual.showAttention, false, 'and no attention block (nothing to check it against)');

      t.ok(r.pane.includes('Report at a glance') && r.paneText.includes('Key figures'), 'live preview opens with Report at a glance');
      t.ok(r.paneText.indexOf('Report at a glance') < r.paneText.indexOf('A NOTE TO THE CLIENT.'), 'the optional note follows it');
      t.ok(r.noAIButton, 'the AI overall-summary button and its code are gone');
      t.ok(r.snapGlance.includes('Report at a glance') && r.snapGlance.includes('high-priority issue'), 'snapshot freezes the glance');
      t.ok(r.arch.includes(r.snapGlance), 'archived copy shows the frozen glance unchanged after data changed');
      t.ok(/Report at a Glance/.test(r.doc) && r.doc.includes('Inbound and in-person contacts') && r.doc.includes('Needs attention and coming up'), '.docx carries the glance');
      t.ok(r.doc.indexOf('Report at a Glance') < r.doc.indexOf('A NOTE TO THE CLIENT.'), '.docx: note follows the glance');

      const portal = require('fs').readFileSync(require('path').join(__dirname, '../../client-portal.html'), 'utf8');
      t.ok(/snap\.atGlanceHtml/.test(portal), 'portal renders the frozen glance');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
