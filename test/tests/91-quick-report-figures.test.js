// Quick reports with headline numbers, charts and colour-coded rows (Oct 2026).
// Jeff asked for the five working quick reports — interaction log, follow-ups,
// public comment matrix, issues, events — to print as something a client reads
// at a glance: a row of headline numbers, one or two charts (the close-out's
// SVG helpers), status colours in the table, and an optional "✦ AI summary"
// that uses the report package's facts for that one report.
module.exports = {
  name: 'quick reports — headline numbers, charts, colours and an AI summary',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id, name from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    // A follow-up that is overdue and one due tomorrow, so both colours show.
    await t.sql(`insert into pi_interactions (project_id, interaction_date, channel, direction, subject, nature, summary, logged_by, follow_up, follow_up_due, follow_up_note, follow_up_done)
                 values ($1, current_date - 20, 'Phone', 'Incoming', 'Access', 'Concern', 'QRMARK caller', 'JP', true, current_date - 3, 'ODMARK call back about driveway', false),
                        ($1, current_date - 2, 'Email', 'Outgoing', 'Access', 'Notification', 'QRMARK2 notice', 'JP', true, current_date + 1, 'SOONMARK send exhibit', false)`, [P]);
    await t.sql(`insert into pi_public_comments (id, project_id, comment_date, commenter, channel, summary, category, response_status)
                 values ('qr1', $1, current_date - 5, 'Resident', 'Email', 'Worried about detours', 'Traffic', 'Responded'),
                        ('qr2', $1, current_date - 4, 'Business', 'Comment card', 'Access to the shop', 'Access', 'Pending')`, [P]);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      // Open a report and hand back the frame's HTML and the overlay's buttons.
      const open = (id) => app.page.evaluate(([pid, id]) => {
        S.view = 'reports'; S.rptTab = 'reports'; S.projectFilter = pid; render();
        if (id === 'issues-report') generateIssuesReport(); else generateReport(id);
        const ov = document.getElementById('inline-rpt-overlay');
        const f = document.getElementById('inline-rpt-frame');
        return { html: f ? f.srcdoc : '', ai: !!document.getElementById('qr-ai-btn'), ctx: window._qrAICtx, overlay: !!ov };
      }, [P, id]);

      const reports = ['interaction-log', 'followup-status', 'comment-matrix', 'issues-report', 'events-log'];
      for (const id of reports) {
        const r = await open(id);
        t.ok(r.overlay, `${id}: opens in the report frame`);
        t.ok(/class="qr-kpis"/.test(r.html), `${id}: headline numbers`);
        // Charts were kept only where Jeff found them worth the space (Oct 2026):
        // none on follow-ups or issues; attendance only on events.
        const figs = (r.html.match(/class="qr-fig"/g) || []).length;
        const want = { 'interaction-log': 2, 'comment-matrix': 2, 'events-log': 1, 'followup-status': 0, 'issues-report': 0 }[id];
        t.eq(figs, want, `${id}: ${want} chart(s)`);
        if (want) t.ok(/<svg [^>]*role="img"/.test(r.html), `${id}: the chart is an SVG drawing`);
        t.ok(!/var\(--/.test(r.html.split('</style>')[1] || ''), `${id}: no CSS variables in the body (they mean nothing in the frame)`);
        t.ok(r.ai && r.ctx && r.ctx.id === id && String(r.ctx.projF) === P, `${id}: offers ✦ AI summary for this project`);
      }

      // Colour-coded rows: the overdue and due-soon follow-ups are labelled.
      const fu = await open('followup-status');
      t.ok(/ODMARK[\s\S]*?Overdue|Overdue[\s\S]*?ODMARK/.test(fu.html), 'the overdue follow-up is marked Overdue');
      t.ok(/Due within 7 days/.test(fu.html), 'a follow-up due tomorrow is marked due within 7 days');
      t.ok(/#b32020/.test(fu.html) && /#b36b00/.test(fu.html), 'red and amber are used');
      const ev = await open('events-log');
      t.ok(/Attendance by event/.test(ev.html) && !/Events by type/.test(ev.html), 'events: attendance chart only');

      // Interaction log: outbound and inbound counted and coloured separately.
      const il = await open('interaction-log');
      t.ok(/Outbound<\/div>/.test(il.html) && /Inbound &amp; in-person<\/div>/.test(il.html), 'outbound and inbound tiles');
      t.ok(/Contacts per (month|quarter)/.test(il.html), 'contacts-over-time chart');

      // A report that is not one of the five gets no AI button.
      const cl = await open('contact-list');
      t.ok(!cl.ai, 'the contact list has no AI summary button');

      // ✦ AI summary: one call with this report's facts only, then the report
      // reopens with the summary at the top, editable.
      const ai = await app.page.evaluate(async (pid) => {
        S.projectFilter = pid; generateReport('followup-status');
        const calls = []; const real = window._claudeNarrative; const realKey = window._getClaudeKey;
        window._claudeNarrative = async (sys, user, max) => { calls.push({ sys, user, max }); return 'AIMARK summary text.'; };
        window._getClaudeKey = () => 'sk-test';
        try { await qrAISummary(document.getElementById('qr-ai-btn')); }
        finally { window._claudeNarrative = real; window._getClaudeKey = realKey; }
        const f = document.getElementById('inline-rpt-frame');
        return { calls, html: f.srcdoc, btn: (document.getElementById('qr-ai-btn') || {}).textContent };
      }, P);
      t.eq(ai.calls.length, 1, 'one AI call');
      const u = ai.calls[0].user;
      t.ok(/REPORT: Follow-up status report/.test(u) && /Follow-ups: \d+ total/.test(u), 'the follow-up facts are sent');
      t.ok(/- open, due \d{4}-\d{2}-\d{2} \(overdue\): /.test(u), 'open items with their due state are in the facts');
      for (const absent of ['Interactions in the log', 'Formal public comments', 'Issues:', 'Events:'])
        t.ok(!u.includes(absent), `nothing from another report ("${absent}")`);
      t.ok(!u.includes('report package'), 'worded for one report, not a package');
      t.ok(!u.includes(proj.name), 'the project is not named');
      t.ok(/id="rpt-summary-body" contenteditable="true"[^>]*>AIMARK summary text\./.test(ai.html), 'the summary prints at the top and can be edited');
      t.ok(/Rewrite AI summary/.test(ai.btn || ''), 'the button now offers a rewrite');

      // No key → no call.
      const nokey = await app.page.evaluate(async (pid) => {
        S.projectFilter = pid; generateReport('events-log');
        let n = 0; const real = window._claudeNarrative; const realKey = window._getClaudeKey;
        window._claudeNarrative = async () => { n++; return 'x'; }; window._getClaudeKey = () => '';
        try { await qrAISummary(document.getElementById('qr-ai-btn')); } finally { window._claudeNarrative = real; window._getClaudeKey = realKey; }
        return n;
      }, P);
      t.eq(nokey, 0, 'no API key: no call');

      // The report package still collects the bodies (with the new figures).
      const pkg = await app.page.evaluate(pid => {
        S.projectFilter = pid; const got = []; window._rptCollector = got;
        try { generateReport('comment-matrix'); generateIssuesReport(); } finally { window._rptCollector = null; }
        return { n: got.length, kp: got.every(g => /qr-kpis/.test(g.body)), ctx: window._qrAINext };
      }, P);
      t.eq(pkg.n, 2, 'the package collects both reports');
      t.ok(pkg.kp, 'with their headline numbers');
      t.ok(!pkg.ctx, 'no AI context left behind by the package');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
