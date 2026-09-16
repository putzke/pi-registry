// The PI report's overall summary (_buildOverallDraft, feeding _overallDraftCall)
// used to do two things wrong, both found by reading the code rather than
// guessing at it, before any fix shipped:
//
// 1. It pulled from the WHOLE PROJECT's data — every deliverable, issue,
//    commitment, and the full stakeholder sentiment mix — regardless of which
//    sections were actually checked into THIS report. A report with only
//    "Recent public concerns" selected could still have its overall summary
//    cite deliverable progress or an overdue commitment that appears nowhere
//    else in the document — an unsupported claim in a compliance record.
// 2. It folded outbound and inbound interactions into one undifferentiated
//    count, and keyword-scanned ALL of them (outbound included) for "topics
//    raised". A project whose early activity is mostly the team notifying
//    stakeholders (mass flyer emails, referral calls) would have its OWN
//    outreach language ("sent detour exhibit for review") reported back as
//    what the public raised — exactly backwards.
//
// Both fixed the same way: facts are scoped to sections actually in the
// report, and interactions are split by direction (Outgoing = outbound) before
// anything is counted or scanned.
module.exports = {
  name: 'overall summary — scoped to included sections, outbound kept separate from inbound',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      t.ok(proj, 'demo project found');
      const projId = proj.id;

      const out = await app.page.evaluate((pid) => {
        // _buildOverallDraft only reads via DB.get(...)/_syncCache, so the whole
        // dataset can be fabricated in-memory — no DB write needed, and no
        // interference from the seed's own SR-154 interaction history.
        S.projectFilter = pid;
        _syncCache.projects = [{ id: pid, name: 'Test Project', pid: '25-154-001', client: 'UDOT', phase: 'Design' }];
        _syncCache.meetings = [];
        _syncCache.deliverables = [{ id: 'd1', projectId: pid, status: 'Complete', dueDate: null }];
        _syncCache.commitments = [{ id: 'c1', projectId: pid, status: 'Overdue', commitment: 'Finalize haul route agreement' }];
        _syncCache.issues = [{ id: 'i1', projectId: pid, priority: 'High', status: 'Open', title: 'Culvert capacity concern' }];
        _syncCache.stakeholders = [{ id: 'sk1', firstName: 'Jane', lastName: 'Doe', sentiment: 'Champion', influence: 'High' }];
        _syncCache.project_stakeholders = [{ id: 'ps1', projectId: pid, stakeholderId: 'sk1', stakeholderRole: 'External' }];

        function reportWithSections(types) {
          localStorage.setItem('pir4_pi_reports_' + pid, JSON.stringify({
            reportNum: '1', periodStart: '2026-01-01', periodEnd: '2026-12-31',
            sections: types.map((ty, i) => ({ id: 's' + i, title: ty, type: ty })),
            distGroups: [],
          }));
          _syncCache.reports = [];
        }

        const res = {};

        // ── Case 1: all-outbound period ──────────────────────────────────────
        _syncCache.interactions = [
          { id: 'a1', projectId: pid, stakeholderId: null, anonLabel: 'Anonymous', date: '2026-06-01',
            channel: 'Email', direction: 'Outgoing', subject: 'General', nature: 'Notification',
            summary: 'Sent detour exhibit for review to targeted stakeholder list.',
            followUp: false, followUpDone: false },
          { id: 'a2', projectId: pid, stakeholderId: null, anonLabel: 'Anonymous 2', date: '2026-06-02',
            channel: 'Phone', direction: 'Outgoing', subject: 'General', nature: 'Notification',
            summary: 'Called to refer contact to the project website.',
            followUp: false, followUpDone: false },
        ];
        reportWithSections(['auto-concerns']);
        res.outboundOnly = _buildOverallDraft();

        // ── Case 2: mixed outbound + inbound ─────────────────────────────────
        _syncCache.interactions = [
          { id: 'a1', projectId: pid, stakeholderId: null, anonLabel: 'Anonymous', date: '2026-06-01',
            channel: 'Email', direction: 'Outgoing', subject: 'General', nature: 'Notification',
            summary: 'Sent detour exhibit for review to targeted stakeholder list.',
            followUp: false, followUpDone: false },
          { id: 'b1', projectId: pid, stakeholderId: null, anonLabel: 'Anonymous 2', date: '2026-06-03',
            channel: 'Phone', direction: 'Incoming', subject: 'General', nature: 'Complaint',
            summary: 'Resident called concerned about construction noise near the site.',
            followUp: false, followUpDone: false },
        ];
        res.mixed = _buildOverallDraft();

        // ── Case 3: deliverables/issues/commitments/sentiment excluded when
        // their sections are not in the report (interactions stay from case 2) ─
        reportWithSections(['auto-concerns']);
        res.sectionsExcluded = _buildOverallDraft();

        // ── Case 4: same data, but every relevant section IS included ────────
        reportWithSections(['auto-concerns', 'auto-del', 'auto-issues', 'auto-commitments', 'auto-sentiment']);
        res.sectionsIncluded = _buildOverallDraft();

        return res;
      }, projId);

      // ── Case 1: all-outbound ────────────────────────────────────────────────
      t.ok(out.outboundOnly, 'outbound-only period still produces a summary');
      t.ok(/sent 2 outbound project notifications/i.test(out.outboundOnly),
           `outbound activity is reported explicitly (got: ${out.outboundOnly})`);
      t.ok(/no inbound public inquiries have been received/i.test(out.outboundOnly),
           'zero inbound is stated honestly, not silently omitted');
      t.eq(/most engaged stakeholder/i.test(out.outboundOnly), false,
           'no "most engaged" claim when nobody engaged back');
      t.eq(/most frequently raised topics/i.test(out.outboundOnly), false,
           'no "topics raised" claim scanned from the team\'s own outbound language');

      // ── Case 2: mixed ───────────────────────────────────────────────────────
      t.ok(/sent 1 outbound project notification\b/i.test(out.mixed),
           `outbound clause still present alongside inbound (got: ${out.mixed})`);
      t.ok(/logged 1 inbound or in-person stakeholder interaction/i.test(out.mixed),
           'inbound clause reported separately from outbound');
      t.eq(/no inbound public inquiries/i.test(out.mixed), false,
           'the "no inbound" line does not appear once inbound contact exists');
      t.ok(/most frequently raised topics among inbound stakeholder contacts/i.test(out.mixed),
           'topics sentence is explicitly scoped to inbound contacts');

      // ── Case 3: sections excluded from the report ──────────────────────────
      t.eq(/deliverable progress/i.test(out.sectionsExcluded), false,
           'deliverable progress not cited when auto-del is not in the report');
      t.eq(/Culvert capacity concern/i.test(out.sectionsExcluded), false,
           'a high-priority issue not cited when auto-issues is not in the report');
      t.eq(/haul route agreement/i.test(out.sectionsExcluded), false,
           'an overdue commitment not cited when auto-commitments is not in the report');
      t.eq(/stakeholder sentiment/i.test(out.sectionsExcluded), false,
           'sentiment mix not cited when auto-sentiment is not in the report');

      // ── Case 4: sections included — the SAME facts now appear ──────────────
      t.ok(/deliverable progress/i.test(out.sectionsIncluded),
           'deliverable progress IS cited once auto-del is in the report');
      t.ok(/Culvert capacity concern/i.test(out.sectionsIncluded),
           'the high-priority issue IS cited once auto-issues is in the report');
      t.ok(/haul route agreement/i.test(out.sectionsIncluded),
           'the overdue commitment IS cited once auto-commitments is in the report');
      t.ok(/stakeholder sentiment/i.test(out.sectionsIncluded),
           'sentiment mix IS cited once auto-sentiment is in the report');
    } finally {
      await app.close();
    }
  },
};
