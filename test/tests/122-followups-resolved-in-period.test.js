// PI report "Follow-up status" section (Jeff, Nov 2026): every OPEN follow-up
// shows (overdue ones whatever their date); a RESOLVED one only when it was
// resolved inside the report period. Same rule in the live preview (which the
// archive snapshot reuses), the .docx and the AI draft facts.
module.exports = {
  name: 'PI report follow-up status — resolved only within the report period',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const pid = String((await t.sql(`select id from pi_projects where pid='25-154-001'`))[0].id);
      const r = await app.page.evaluate(async (pid) => {
        S.projectFilter = pid;
        const mk = (id, o) => Object.assign({ id, projectId: pid, date: '2025-01-05', channel: 'Phone', summary: 'x', followUp: true }, o);
        _syncCache.interactions = (DB.get('interactions') || []).filter(i => String(i.projectId) !== pid).concat([
          mk('f1', { followUpDone: false, followUpDue: '2025-02-01', followUpNote: 'MARK_OPEN_OLD_OVERDUE' }),
          mk('f2', { followUpDone: false, followUpDue: '2099-01-01', followUpNote: 'MARK_OPEN_FUTURE' }),
          mk('f3', { followUpDone: true, followUpDue: '2026-08-02', followUpResolved: '2026-08-12', followUpNote: 'MARK_RESOLVED_IN' }),
          mk('f4', { followUpDone: true, followUpDue: '2025-03-01', followUpResolved: '2025-03-04', followUpNote: 'MARK_RESOLVED_OLD' }),
          mk('f5', { followUpDone: true, followUpDue: '2026-08-20', followUpNote: 'MARK_RESOLVED_NODATE_IN' }),
          mk('f6', { followUpDone: true, followUpDue: '2026-08-05', followUpResolved: '2026-09-15', followUpNote: 'MARK_RESOLVED_AFTER' }),
        ]);
        const tbl = _buildSectionPreviewTable('auto-followups', pid, '2026-08-01', '2026-08-31', false);
        const all = _buildSectionPreviewTable('auto-followups', pid, '', '', false);
        _syncCache.reports = [];
        localStorage.setItem('pir4_pi_reports_' + pid, JSON.stringify({
          reportNum: '1', reportTitle: 'PI Progress Report', periodStart: '2026-08-01', periodEnd: '2026-08-31',
          sections: [{ id: 's1', title: 'Follow-up status', type: 'auto-followups', showTable: true }], distGroups: [],
        }));
        const facts = _buildSectionDraftBase('auto-followups');
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
        const real = URL.createObjectURL.bind(URL); let blob = null;
        URL.createObjectURL = x => { blob = x; return real(x); };
        try { await exportPIDocx(); } catch (e) {}
        for (let i = 0; i < 80 && !blob; i++) await new Promise(r => setTimeout(r, 100));
        URL.createObjectURL = real;
        const doc = blob ? await (await JSZip.loadAsync(blob)).file('word/document.xml').async('string') : '';
        return { tbl, all, facts, doc };
      }, pid);
      for (const [name, src] of [['preview', r.tbl], ['.docx', r.doc]]) {
        t.ok(src.includes('MARK_OPEN_OLD_OVERDUE'), `${name}: an open follow-up overdue since before the period still shows`);
        t.ok(src.includes('MARK_OPEN_FUTURE'), `${name}: an open follow-up due later shows`);
        t.ok(src.includes('MARK_RESOLVED_IN'), `${name}: resolved inside the period shows`);
        t.ok(src.includes('MARK_RESOLVED_NODATE_IN'), `${name}: resolved with no resolved date falls back to its due date (in the period)`);
        t.ok(!src.includes('MARK_RESOLVED_OLD'), `${name}: resolved before the period is left out`);
        t.ok(!src.includes('MARK_RESOLVED_AFTER'), `${name}: resolved after the period end is left out`);
      }
      t.ok(/Open: 2 \| Resolved in this period: 2 \| Total: 4/.test(r.doc), '.docx: counts line reflects the period');
      t.ok(['MARK_RESOLVED_OLD', 'MARK_RESOLVED_AFTER'].every(m => r.all.includes(m)), 'no period set → every follow-up shows');
      t.ok(/2 follow-up items are currently open/.test(r.facts) && /2 items were resolved during this report period/.test(r.facts), 'AI facts: open count + resolved in the period (' + r.facts + ')');
    } finally { await app.close(); }
  },
};
