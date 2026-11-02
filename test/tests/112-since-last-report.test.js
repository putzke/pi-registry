// "Since the last report" (Nov 2026, Jeff): the issues, commitments, follow-up
// and deliverable section drafts state what changed since the last ARCHIVED
// report that included the same section — skipping reports that left it out —
// with the changes worked out in code, items named only when the section's
// data table is on, and no comparison at all on the first report.
module.exports = {
  name: 'since the last report — per-section comparison point, computed changes, names only with the table',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async (pid) => {
        const projF = DB.get('projects').find(p => String(p.id) === pid).id;
        S.projectFilter = projF;
        const others = k => (_syncCache[k] || []).filter(x => String(x.projectId) !== String(projF));
        _syncCache.issues = others('issues').concat([
          { id: 9001, projectId: projF, title: 'Driveway access ZQA', status: 'Resolved', dateRaised: '2030-01-05' },
          { id: 9002, projectId: projF, title: 'Night noise ZQB', status: 'In progress', dateRaised: '2030-01-06' },
          { id: 9003, projectId: projF, title: 'Dust ZQC', status: 'Open', dateRaised: '2030-01-07' },
          { id: 9004, projectId: projF, title: 'Detour signs ZQD', status: 'Open', dateRaised: '2030-02-20' },
        ]);
        _syncCache.commitments = others('commitments').concat([
          { id: 9101, projectId: projF, commitment: 'Keep access ZCA', status: 'Fulfilled' },
          { id: 9102, projectId: projF, commitment: 'Mail notice ZCB', status: 'Open', dueDate: '2001-01-01' },
        ]);
        _syncCache.deliverables = others('deliverables').concat([
          { id: 9201, projectId: projF, title: 'Newsletters ZDA', status: 'In progress', contractedQty: 6, deliveredCount: 4 },
        ]);
        const sections = (types, table) => types.map((ty, n) => ({ id: 's' + n, title: ty, type: ty, showTable: !!table }));
        const setDraft = (types, table) => { localStorage.removeItem('pir4_pi_reports_' + projF);
          _syncCache.reports = [{ id: 1, projectId: projF, reportNum: '8', reportTitle: 'PI', periodStart: '2030-03-01', periodEnd: '2030-03-31', sections: sections(types, table) }]; };
        const ALL = ['auto-issues', 'auto-commitments', 'auto-followups', 'auto-del'];
        // First report: nothing archived.
        _syncCache.report_archive = (_syncCache.report_archive || []).filter(x => String(x.projectId) !== String(projF));
        setDraft(ALL, true);
        const first = _buildSectionDraft('auto-issues');
        // The archive freezes ids + counts.
        const snap = _buildReportSnapshot(projF, loadReportSections(projF));
        const tf = snap.trendFacts;
        const frozen = { issueId: (tf.issues.find(x => /ZQB/.test(x.title)) || {}).id, delId: (tf.deliverables.find(x => /ZDA/.test(x.title)) || {}).id,
          delivered: (tf.deliverables.find(x => /ZDA/.test(x.title)) || {}).delivered, fuList: Array.isArray(tf.followUpOpenIds) };
        // Report 5 (Feb 1) included Issues; report 6 (Feb 15) did not but saw a later state.
        const oldTF = { issues: [
            { id: '9001', title: 'Driveway access ZQA', status: 'Open' },
            { id: '9002', title: 'Night noise ZQB', status: 'Open' },
            { id: '9003', title: 'Dust ZQC', status: 'Open' } ],
          commitments: [ { id: '9101', text: 'Keep access ZCA', status: 'Open' }, { id: '9102', text: 'Mail notice ZCB', status: 'Open' } ],
          deliverables: [ { id: '9201', title: 'Newsletters ZDA', status: 'In progress', pct: 33, delivered: 2, contracted: 6 } ],
          followUpOpenIds: [] };
        const laterTF = JSON.parse(JSON.stringify(oldTF)); laterTF.issues[0].status = 'Resolved'; laterTF.issues[1].status = 'In progress';
        _syncCache.report_archive.push(
          { id: 'a5', projectId: projF, reportNum: '5', archivedAt: '2030-02-01T10:00:00Z', snapshot: { sections: sections(ALL), trendFacts: oldTF } },
          { id: 'a6', projectId: projF, reportNum: '6', archivedAt: '2030-02-15T10:00:00Z', snapshot: { sections: sections(['auto-commitments']), trendFacts: laterTF } });
        setDraft(ALL, true);
        const issNamed = _buildSectionDraft('auto-issues');
        const comm = _buildSectionDraft('auto-commitments');
        const del = _buildSectionDraft('auto-del');
        const fu = _buildSectionDraft('auto-followups');
        const req = _sectionAIRequest('auto-issues', issNamed).userContent;
        setDraft(ALL, false);
        const issCounted = _buildSectionDraft('auto-issues');
        // An old archive with no ids matches by title.
        const noIds = JSON.parse(JSON.stringify(oldTF)); noIds.issues.forEach(x => delete x.id);
        _syncCache.report_archive = _syncCache.report_archive.filter(x => String(x.projectId) !== String(projF));
        _syncCache.report_archive.push({ id: 'a5', projectId: projF, reportNum: '5', archivedAt: '2030-02-01T10:00:00Z', snapshot: { sections: sections(ALL), trendFacts: noIds } });
        setDraft(ALL, true);
        const byTitle = _buildSectionDraft('auto-issues');
        return { first, frozen, issNamed, issCounted, comm, del, fu, req, byTitle };
      }, String(proj.id));
      t.ok(/no earlier archived report included this section/.test(r.first), 'first report: says there is nothing to compare with');
      t.ok(!/SINCE THE LAST REPORT THAT INCLUDED/.test(r.first), 'first report: no comparison block');
      t.eq(r.frozen.issueId, '9002', 'archive keeps each issue id');
      t.eq(r.frozen.delId + ':' + r.frozen.delivered, '9201:4', 'archive keeps deliverable id and delivered count');
      t.ok(r.frozen.fuList, 'archive keeps the open follow-up list');
      t.ok(/Report #5, issued Feb 1, 2030/.test(r.issNamed), 'issues compare against report 5 (report 6 left Issues out)');
      t.ok(/Report #6/.test(r.comm), 'commitments compare against report 6, which included them');
      t.ok(/Resolved or closed since then: 1: Driveway access ZQA/.test(r.issNamed), 'resolved since then, named with the table on');
      t.ok(/New since then: 1: Detour signs ZQD/.test(r.issNamed), 'new since then');
      t.ok(/status changed: 1: Night noise ZQB \(Open → In progress\)/.test(r.issNamed), 'status change worked out');
      t.ok(/unchanged: 1: Dust ZQC/.test(r.issNamed), 'still open, unchanged');
      t.ok(/Resolved or closed since then: 1\./.test(r.issCounted) && !/ZQA|ZQB|ZQC|ZQD/.test(r.issCounted.split('SINCE THE LAST')[1] || 'ZQA'), 'table off: counted, not named');
      t.ok(/Fulfilled since then: 1/.test(r.comm) && /now past due: 1/.test(r.comm), 'commitments: fulfilled and past due');
      t.ok(/Advanced since then: 1: Newsletters ZDA \(2 → 4 of 6 delivered\)/.test(r.del), 'deliverables: delivered count moved');
      t.ok(/Closed since then: \d+\./.test(r.fu) && !/ZQ/.test(r.fu), 'follow-ups: counts only');
      t.ok(/Lead with what changed since the last report/.test(r.req) && /never work out a change/.test(r.req), 'the request tells the AI to narrate the given changes');
      t.ok(/Resolved or closed since then: 1: Driveway access ZQA/.test(r.byTitle), 'an archive without ids matches by title');
    } finally { await app.close(); }
  },
};
