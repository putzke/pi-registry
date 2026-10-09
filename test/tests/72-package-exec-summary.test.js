// Build report package → "Generate with AI" (Oct 2026).
// Reported live: a package of Interaction log + Deliverables + Events opened
// with an executive summary citing sentiment, follow-ups and issues — reports
// it didn't contain. _buildPackageFacts gathered every report type regardless
// of the selection, and the call used _claudeSystemPrompt(), capped at 2-4
// sentences. Now: facts for the numbered reports only, in package order, one
// paragraph each; the interaction log's paragraph reads the log itself.
// Also: the Quick Reports' external filter dropped anonymous callers (a raw
// indexOf the Aug 2026 _intIsExternal fix missed), so a package's interaction
// log left out every unnamed member of the public.
module.exports = {
  name: 'report package — the AI summary covers only the reports chosen',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id, name from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    await t.sql(`insert into pi_interactions (project_id, interaction_date, channel, direction, subject, nature, summary, logged_by)
                 values ($1, current_date, 'Phone', 'Incoming', 'Access', 'Concern', 'ANONMARK caller asked about driveway access', 'JP')`, [P]);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const run = async (picks) => app.page.evaluate(async ([pid, picks]) => {
        S.view = 'reports'; S.rptTab = 'reports'; S.projectFilter = pid; render();
        openReportSequenceModal();
        document.querySelectorAll('.rpt-seq-sel').forEach(sel => { sel.value = picks[sel.getAttribute('data-rid')] || ''; });
        const calls = []; const real = window._claudeNarrative;
        window._claudeNarrative = async (sys, user, max) => { calls.push({ sys, user, max }); return 'Drafted summary.'; };
        window._getClaudeKey = () => 'sk-test';
        try { await genPackageExecSummary(document.getElementById('pkg-exec-btn')); }
        finally { window._claudeNarrative = real; }
        const ta = document.getElementById('pkg-exec-summary');
        const out = { calls, text: ta ? ta.value : null };
        closeM();
        return out;
      }, [P, picks]);

      // ── the reported shape: Interaction log 1, Deliverables 2, Events 3 ──
      const r = await run({ 'interaction-log': '1', 'deliverable-status': '2', 'events-log': '3' });
      t.eq(r.calls.length, 1, 'one AI call');
      const u = r.calls[0].user;
      const order = ['REPORT: Interaction log', 'REPORT: Deliverable / scope status', 'REPORT: Events & outreach log'].map(x => u.indexOf(x));
      t.ok(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2], 'the three chosen reports, in package order');
      for (const absent of ['External stakeholder positions', 'Follow-ups:', 'Issues:', 'Formal public comments', 'Contacts on the list'])
        t.ok(!u.includes(absent), `nothing from an unchosen report ("${absent}")`);
      t.ok(/INTERACTION LOG, newest first/.test(u) && /ANONMARK/.test(u), 'the interaction paragraph reads the log itself, anonymous callers included');
      t.ok(/Outbound from the team: \d+; inbound/.test(u), 'outbound and inbound counted separately');
      t.ok(!r.calls[0].sys.includes('2-4 sentence'), 'not the 2-4-sentence generic prompt');
      t.ok(r.calls[0].max >= 500, `room for a paragraph per report (${r.calls[0].max} tokens)`);
      t.ok(!u.includes(proj.name), 'the project is not named');
      const names = await t.sql(`select s.first_name||' '||s.last_name n from pi_stakeholders s join pi_project_stakeholders l on l.stakeholder_id=s.id::text
                                  where l.project_id::text=$1 and coalesce(s.first_name,'')<>'' and coalesce(s.last_name,'')<>''`, [P]);
      t.ok(names.length > 0 && names.every(x => !u.includes(x.n)), `no contact's personal name reaches the model (${names.length} checked)`);
      t.eq(r.text, 'Drafted summary.', 'the draft lands in the box for review');

      // ── a different selection gets a different summary ──
      const r2 = await run({ 'sentiment-summary': '1' });
      t.ok(r2.calls[0].user.includes('External stakeholder positions') && !r2.calls[0].user.includes('INTERACTION LOG'),
        'sentiment only → sentiment facts only');

      // ── nothing numbered → no call ──
      const r3 = await run({});
      t.eq(r3.calls.length, 0, 'nothing numbered: no AI call (a toast asks to number the reports)');

      // ── the printed interaction log keeps anonymous callers ──
      const body = await app.page.evaluate(pid => {
        S.projectFilter = pid; const got = []; window._rptCollector = got;
        try { generateReport('interaction-log'); } finally { window._rptCollector = null; }
        return got[0] ? got[0].body : '';
      }, P);
      t.ok(/ANONMARK/.test(body), 'the package\'s interaction log includes an anonymous caller');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
