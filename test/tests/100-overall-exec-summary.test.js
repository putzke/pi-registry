// The PI report's overall summary became an executive summary (Oct 2026, Jeff):
//  - its facts cover EVERY section in the report (outreach, events, comments,
//    follow-ups, issues, commitments, parcels), not just interactions,
//    deliverables, issues/commitment alerts and sentiment;
//  - events are counted inside the report period, in their own sentence, and
//    only when the events section is in the report (they used to be every
//    completed event ever, worded as part of the interactions);
//  - deliverables "In progress" are counted (the code looked for "In Progress");
//  - what inbound contacts were about goes to the model (by role/organization,
//    never a person's name), instead of only keyword-scanned topics;
//  - the length follows the report: _overallWordBudget weighs each section.
module.exports = {
  name: 'overall summary — executive summary: every section, events in period, length by sections',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const pid = String((await t.sql(`select id from pi_projects where pid='25-154-001'`))[0].id);

      const r = await app.page.evaluate((pid) => {
        S.projectFilter = pid;
        _syncCache.projects = [{ id: pid, name: 'Test Project', pid: '25-154-001', client: 'UDOT', phase: 'Construction' }];
        _syncCache.stakeholders = [{ id: 'sk1', firstName: 'Margaret', lastName: 'Okafor', type: 'Business', org: 'Kennecott Smelter' },
                                   { id: 'sk2', firstName: 'Harold', lastName: 'Pemberton', type: 'Resident' }];
        _syncCache.project_stakeholders = [{ id: 'l1', projectId: pid, stakeholderId: 'sk1', stakeholderRole: 'External' },
                                           { id: 'l2', projectId: pid, stakeholderId: 'sk2', stakeholderRole: 'External' }];
        _syncCache.interactions = [
          { id: 'i1', projectId: pid, stakeholderId: 'sk1', date: '2026-09-15', channel: 'Phone', direction: 'Incoming', subject: 'Access',
            summary: 'Asked whether the west gate stays open for employees during eastbound closure.' },
          { id: 'i2', projectId: pid, stakeholderId: 'sk2', date: '2026-09-20', channel: 'Email', direction: 'Incoming', subject: 'Noise',
            summary: 'Reported night noise from sound wall installation.', followUp: true, followUpDone: false, followUpDue: '2026-01-01' },
          { id: 'i3', projectId: pid, stakeholderId: null, date: '2026-09-21', channel: 'Email', direction: 'Outgoing', summary: 'Sent closure notice.' }];
        _syncCache.meetings = [
          { id: 'm1', projectId: pid, title: 'Old open house', date: '2025-03-01', status: 'Completed', type: 'Open house', attendanceCount: 40 },
          { id: 'm2', projectId: pid, title: 'Business briefing', date: '2026-09-25', status: 'Completed', type: 'Briefing', attendanceCount: 12 }];
        _syncCache.deliverables = [{ id: 'd1', projectId: pid, status: 'Complete' }, { id: 'd2', projectId: pid, status: 'In progress' }];
        _syncCache.outreach_actions = [{ id: 'o1', projectId: pid, actionDate: '2026-09-18', actionType: 'Flyer / door hanger', party: 'PI team',
          title: 'Ramp closure flyer', delivery: 'Hand-delivered', reach: 450 }];
        _syncCache.outreach_readings = []; _syncCache.outreach_campaigns = [];
        _syncCache.public_comments = [{ id: 'c1', projectId: pid, commentDate: '2026-09-22', commenter: 'Beatrice Lindqvist',
          affiliation: 'Magna Community Council', category: 'Noise', summary: 'Wants quieter night work.', responseStatus: 'Responded' }];
        _syncCache.issues = []; _syncCache.commitments = []; _syncCache.parcels = [];
        const report = (types) => { localStorage.setItem('pir4_pi_reports_' + pid, JSON.stringify({ reportNum: '4', periodStart: '2026-09-10', periodEnd: '2026-10-24',
          sections: types.map((ty, i) => ({ id: 's' + i, title: ty, type: ty })), distGroups: [] })); _syncCache.reports = []; };
        const out = {};
        report(['auto-concerns', 'auto-del']);
        out.noEvents = _buildOverallDraft();
        report(['auto-concerns', 'auto-del', 'auto-events', 'auto-outreach', 'auto-comment-matrix', 'auto-followups']);
        out.withEvents = _buildOverallDraft();
        out.facts = _overallAIFacts(out.withEvents);
        report(['auto-concerns', 'auto-del']);
        out.factsNoOutreach = _overallAIFacts(_buildOverallDraft());
        out.budget = {
          concernsOnly: _overallWordBudget(['auto-concerns'], 3),
          heavy: _overallWordBudget(['auto-concerns'], 26),
          four: _overallWordBudget(['auto-concerns', 'auto-del', 'auto-outreach', 'auto-events'], 3),
          none: _overallWordBudget([], 0),
          all: _overallWordBudget(Object.keys(OVERALL_SECTION_WORDS), 100) };
        return out;
      }, pid);

      t.ok(!/public event|outreach event/i.test(r.noEvents), 'no events section → no event count in the summary');
      t.ok(/held 1 public event during the period/.test(r.withEvents), 'events section → only the event dated inside the period is counted, in its own sentence');
      t.ok(!/including \d+ public outreach event/.test(r.withEvents), 'events are no longer worded as part of the interactions');
      t.ok(/1 in progress/.test(r.withEvents), '"In progress" deliverables are counted');

      const f = r.facts.text;
      t.ok(/OUTREACH IN THIS PERIOD/.test(f) && /Ramp closure flyer/.test(f) && /450/.test(f), 'outreach facts reach the summary when the section is in the report');
      t.ok(!/OUTREACH/.test(r.factsNoOutreach.text), '…and not when it is not');
      t.ok(/west gate stays open/.test(f) && /Business: Kennecott Smelter/.test(f), 'what inbound contacts were about is included, by organization');
      t.ok(!/Okafor|Pemberton|Margaret|Harold/.test(f.split('PROJECT FACTS')[1].split('\n\n').slice(1).join('\n')), 'no private person\'s name in the added blocks');
      t.ok(/Magna Community Council/.test(f) && !/Lindqvist/.test(f), 'comments use the affiliation, never the commenter');
      t.ok(/Business briefing/.test(f) && !/Old open house/.test(f), 'events block lists only the period\'s events');
      t.ok(/Open follow-ups now: 1 \(1 overdue\)/.test(f), 'follow-up facts');
      t.eq(r.facts.present.sort(), ['auto-comment-matrix', 'auto-concerns', 'auto-del', 'auto-events', 'auto-followups', 'auto-outreach'], 'every included section with something to say counts toward the length');

      t.eq(r.budget, { concernsOnly: 130, heavy: 160, four: 225, none: 120, all: 300 }, 'length: base 60 + section weights, interactions heaviest, 120–300');

      // The request actually sent.
      const call = await app.page.evaluate(async () => {
        S.view = 'reports'; S.rptTab = 'pi-editor';
        localStorage.setItem('pir4_pi_reports_' + S.projectFilter, JSON.stringify({ reportNum: '4', periodStart: '2026-09-10', periodEnd: '2026-10-24',
          sections: ['auto-concerns', 'auto-del', 'auto-events', 'auto-outreach'].map((ty, i) => ({ id: 's' + i, title: ty, type: ty })), distGroups: [] }));
        _syncCache.reports = [];
        await openPIReport();
        _setClaudeKey('sk-ant-test-key-not-real');
        let c = null; const real = _claudeNarrative;
        window._claudeNarrative = async (sys, user, max) => { c = { sys, user, max }; return 'STUB'; };
        document.getElementById('rpt-overall-summary').value = '';
        await generateOverallDraft();
        window._claudeNarrative = real;
        return c;
      });
      t.ok(call && /about 225 words/.test(call.user) && /2-3 paragraphs/.test(call.user), 'the request carries the length rule (225 words, 2-3 paragraphs)');
      t.eq(call && call.max, Math.round(225 * 1.6) + 200, 'reply budget follows the word count');
      t.ok(call && /Outreach — releases, posts and coverage/.test(call.user) && /OUTREACH IN THIS PERIOD/.test(call.user), 'the request names the sections and carries outreach facts');
      t.ok(call && /executive summary/i.test(call.sys) && /Never name a private individual/.test(call.sys) && !/3-4 sentences/.test(call.sys), 'system prompt: executive summary, no private names, no 3–4 sentence cap');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
