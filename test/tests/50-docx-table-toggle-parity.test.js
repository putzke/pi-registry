// The .docx export used to defeat "Include data table in report" instead of
// obeying it: every TABLE_ELIGIBLE_TYPES section (auto-concerns, auto-intlog,
// auto-followups, auto-del, auto-comments, auto-comment-matrix, auto-events,
// auto-commitments, auto-issues) fell back to a full BULLETED itemization of
// every underlying record — names, org, channel, one-line summaries, issue
// descriptions and resolution text, even linked interactions — whenever the
// checkbox was left unchecked. The live preview (renderLivePreview) and the
// archived snapshot (_buildReportSnapshot) both correctly show NOTHING beyond
// the narrative and the aggregate counts line when the checkbox is off — only
// the raw .docx export leaked the itemized data in a different format nobody
// previewed before exporting.
//
// Reported live: a consultant unchecked "Include data table in report" on
// auto-concerns, the Live Preview showed no interaction list (correct), and
// the exported .docx still printed every named stakeholder contact as a
// bulleted line. That is a compliance/privacy problem, not a cosmetic one —
// the checkbox promised to keep individually identifying records out of a
// document that gets distributed, and silently kept them in.
//
// This asserts the fix in both directions for every affected section type:
// showTable=false hides the itemized markers (while the aggregate summary
// line the live preview's countsLabel corresponds to still prints), and
// showTable=true still shows them in the actual table — the feature was
// suppressed only where it was supposed to be, not removed outright.
module.exports = {
  name: 'docx export — "Include data table" hides itemized records when off, same as the live preview',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      t.ok(proj, 'found a demo project');
      const pid = String(proj.id);

      const MARKERS = {
        concern: 'MARKER_CONCERN_SUMMARY_TXT',
        prior: 'MARKER_PRIOR_SUMMARY_TXT',
        followup: 'MARKER_FOLLOWUP_NOTE_TXT',
        delType: 'MARKER_DEL_TYPE_TXT',
        comment: 'MARKER_COMMENT_SUMMARY_TXT',
        matrix: 'MARKER_MATRIX_SUMMARY_TXT',
        eventTitle: 'MARKER_EVENT_TITLE_TXT',
        eventNotes: 'MARKER_EVENT_NOTES_TXT',
        commitment: 'MARKER_COMMITMENT_TEXT_TXT',
        madeBy: 'MARKER_MADE_BY_TXT',
        issueTitle: 'MARKER_ISSUE_TITLE_TXT',
        issueDesc: 'MARKER_ISSUE_DESC_TXT',
        issueResolution: 'MARKER_ISSUE_RESOLUTION_TXT',
        linkedInt: 'MARKER_LINKED_INT_SUMMARY_TXT',
        stakeName: 'Wanda Secretstone',
      };

      const runExport = (showTable) => app.page.evaluate(async ([pid, m, showTable]) => {
        S.projectFilter = pid;
        _syncCache.projects = [{ id: pid, name: 'Marker Test Project', pid: '25-154-001', client: 'UDOT', phase: 'Design' }];
        _syncCache.stakeholders = [{ id: 'sk1', firstName: 'Wanda', lastName: 'Secretstone', org: 'Redacted LLC' }];
        _syncCache.project_stakeholders = [{ id: 'ps1', projectId: pid, stakeholderId: 'sk1', stakeholderRole: 'External' }];
        _syncCache.interactions = [
          { id: 'i1', projectId: pid, stakeholderId: 'sk1', date: '2026-08-10', channel: 'Phone', summary: m.concern, followUp: false },
          { id: 'i2', projectId: pid, stakeholderId: 'sk1', date: '2026-07-01', channel: 'Email', summary: m.prior, followUp: false },
          { id: 'i3', projectId: pid, stakeholderId: 'sk1', date: '2026-08-05', channel: 'Phone', summary: 'x', followUp: true, followUpDone: false, followUpNote: m.followup, followUpDue: '2026-09-01' },
          { id: 'i4', projectId: pid, stakeholderId: 'sk1', date: '2026-08-06', channel: 'Comment card', summary: m.comment, followUp: false },
          { id: 'i5', projectId: pid, stakeholderId: 'sk1', date: '2026-08-07', channel: 'Email', summary: m.linkedInt, followUp: false },
        ];
        _syncCache.issues = [{ id: 'iss1', projectId: pid, title: m.issueTitle, description: m.issueDesc, resolutionSummary: m.issueResolution, status: 'Open', priority: 'Medium', category: 'General', dateRaised: '2026-08-01' }];
        _syncCache.issue_interactions = [{ id: 'link1', issueId: 'iss1', interactionId: 'i5' }];
        _syncCache.commitments = [{ id: 'c1', projectId: pid, commitment: m.commitment, category: 'General', status: 'Open', madeBy: m.madeBy, madeTo: 'Someone', dueDate: '2026-09-01' }];
        _syncCache.meetings = [{ id: 'mt1', projectId: pid, date: '2026-08-08', title: m.eventTitle, type: 'Public meeting', status: 'Complete', notes: m.eventNotes, attendanceCount: 12 }];
        _syncCache.public_comments = [{ id: 'pc1', projectId: pid, category: 'Traffic', summary: m.matrix, responseStatus: 'Pending' }];
        _syncCache.deliverables = [{ id: 'd1', projectId: pid, type: m.delType, status: 'In progress', contractedQty: 4, deliveredCount: 2, progress: 50 }];

        const types = ['auto-concerns', 'auto-intlog', 'auto-followups', 'auto-del',
                        'auto-comments', 'auto-comment-matrix', 'auto-events',
                        'auto-commitments', 'auto-issues'];
        // loadReportSections() prefers a Supabase/_syncCache draft over
        // localStorage — the first export's flush-save populates that cache,
        // which would otherwise silently win over the second export's fresh
        // localStorage stash (see CLAUDE.md's client-reporting-redesign note).
        _syncCache.reports = [];
        localStorage.setItem('pir4_pi_reports_' + pid, JSON.stringify({
          reportNum: '1', reportTitle: 'PI Progress Report',
          periodStart: '2026-08-01', periodEnd: '2026-08-31',
          sections: types.map((ty, i) => ({ id: 's' + i, title: ty, type: ty, showTable: showTable })),
          distGroups: [],
        }));
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();

        const real = URL.createObjectURL.bind(URL);
        let blob = null;
        URL.createObjectURL = x => { blob = x; return real(x); };
        try { await exportPIDocx(); } catch (e) { /* reported below */ }
        for (let i = 0; i < 80 && !blob; i++) await new Promise(r => setTimeout(r, 100));
        URL.createObjectURL = real;
        if (!blob) return { ok: false };
        const zip = await JSZip.loadAsync(blob);
        const doc = await zip.file('word/document.xml').async('string');
        return { ok: true, doc };
      }, [pid, MARKERS, showTable]);

      const off = await runExport(false);
      t.ok(off.ok, 'export with every "Include data table" checkbox OFF produced a file');
      if (off.ok) {
        // ── nothing itemized leaks ──────────────────────────────────────────
        [MARKERS.concern, MARKERS.prior, MARKERS.followup, MARKERS.delType,
         MARKERS.comment, MARKERS.matrix, MARKERS.eventTitle, MARKERS.eventNotes,
         MARKERS.commitment, MARKERS.madeBy, MARKERS.issueTitle, MARKERS.issueDesc,
         MARKERS.issueResolution, MARKERS.linkedInt, MARKERS.stakeName
        ].forEach(marker => {
          t.eq(off.doc.indexOf(marker) >= 0, false,
               `showTable=false: "${marker}" does not appear anywhere in the .docx`);
        });
        // ── the aggregate line each section already prints stays ───────────
        t.ok(off.doc.indexOf('Report period: August 1') >= 0, 'auto-concerns: period label still prints');
        t.ok(off.doc.indexOf('Interactions prior to 2026-08-01') >= 0, 'auto-intlog: prior-interactions caption still prints');
        t.ok(off.doc.indexOf('Open: 1') >= 0 && off.doc.indexOf('Total: 1') >= 0, 'auto-followups: aggregate line still prints');
        t.ok(off.doc.indexOf('Summary: 0 of 1 complete, 1 in progress') >= 0, 'auto-del: aggregate line still prints');
        t.ok(off.doc.indexOf('1 public comment(s) received') >= 0, 'auto-comments: aggregate line still prints');
        t.ok(off.doc.indexOf('formal public comment') >= 0, 'auto-comment-matrix: aggregate line still prints');
        t.ok(off.doc.indexOf('1 event logged') >= 0, 'auto-events: aggregate line still prints');
        t.ok(off.doc.indexOf('Open commitments: 1') >= 0, 'auto-commitments: aggregate line still prints');
        t.ok(off.doc.indexOf('1 issue') >= 0 && off.doc.indexOf('open') >= 0, 'auto-issues: aggregate line still prints');
      }

      // The first export's flush-save persisted a real pi_reports row for
      // this project (a real seeded project id, not a synthetic one) — and
      // openPIReport()'s "fresh open" path (_rptFetchRow) does a LIVE fetch
      // of that row into _syncCache.reports, which would silently win over
      // the second export's fresh localStorage stash even after clearing
      // the in-memory cache from inside the page. Delete it for real so the
      // second pass starts clean, same as the first did.
      await t.sql(`delete from pi_reports where project_id::text=$1`, [pid]);

      const on = await runExport(true);
      t.ok(on.ok, 'export with every "Include data table" checkbox ON produced a file');
      if (on.ok) {
        // ── the checkbox genuinely still shows data when checked — this   ──
        // proves the fix suppressed the leak, not the feature.
        [MARKERS.concern, MARKERS.prior, MARKERS.followup, MARKERS.delType,
         MARKERS.comment, MARKERS.matrix, MARKERS.eventTitle,
         MARKERS.commitment, MARKERS.issueTitle
        ].forEach(marker => {
          t.ok(on.doc.indexOf(marker) >= 0,
               `showTable=true: "${marker}" appears in the .docx table`);
        });
        t.ok(on.doc.indexOf(MARKERS.stakeName) >= 0, 'showTable=true: the stakeholder name appears in a table');
      }

      t.eq(app.errors, [], 'no page errors during export');
    } finally {
      await app.close();
    }
  },
};
