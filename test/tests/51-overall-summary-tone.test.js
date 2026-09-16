// The overall summary's PROMPT, not just its facts, needed fixing (Sep 2026,
// live feedback from real generated reports):
//
// 1. It opened with the project's NAME every time. The deterministic facts
//    (_buildOverallDraft) led with "ProjectName (Client) is currently in the
//    X phase," the model closely mirrors that opening line, and the userContent
//    additionally told it "for project \"X\" (PID)" — two reinforcing cues to
//    name the project again, when the report header already does.
// 2. The system prompt asked the model to "identify the single most
//    consequential development" — which, combined with an early project's
//    lopsided outbound-vs-inbound volume, invited it to editorialize about
//    the gap as if it were a finding. It isn't: heavy early outreach with
//    little inbound reply yet is the normal, expected shape of PI work at
//    the start of a project.
// 3. The prose read at roughly a college level. A public involvement report
//    is read by agency staff and the public, not policy analysts.
// 4. "Deliverable / scope status" was a DEFAULT section on every new report,
//    whether or not the project tracks deliverables that way.
//
// This guards the prompt-level fixes for 1-3 and the section-default fix for
// 4. See test/tests/48-overall-summary-scope.test.js for the fact-scoping
// and outbound/inbound-splitting fixes from the same area, made earlier.
module.exports = {
  name: 'overall summary — no project name in the opener, no outbound/inbound judgment, plainer prose',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // ── 1. Deliverable/scope status is no longer a default section ────────
      const defaults = await app.page.evaluate(() => getDefaultSections().map(s => s.type));
      t.eq(defaults.indexOf('auto-del') >= 0, false,
           `a brand-new report does not start with Deliverable/scope status (got: ${defaults.join(', ')})`);
      t.ok(defaults.indexOf('auto-concerns') >= 0, 'the concerns section is still a default');
      // Still a real, addable section — this is a default change, not a removal.
      const available = await app.page.evaluate(() => getAvailableSections().map(s => s.type));
      t.ok(available.indexOf('auto-del') >= 0, 'Deliverable/scope status is still offered in Add Section');

      // ── 2. The system prompt's own wording ─────────────────────────────────
      const prompt = await app.page.evaluate(() => _claudeExecSystemPrompt());
      t.ok(/this project|the project/i.test(prompt) && /never by its name/i.test(prompt),
           'the prompt explicitly tells the model to call it "this project," not by name');
      t.eq(/single most consequential/i.test(prompt), false,
           'the old "find the single most consequential development" framing is gone — it invited editorializing');
      t.ok(/normal.*early.project|early.project.*normal/is.test(prompt),
           `an outbound/inbound gap is framed as normal, not a finding (prompt: ${prompt})`);
      t.ok(/9th|10th|grade/i.test(prompt), 'a concrete reading-level target is specified');

      // ── 3. The deterministic opener — real input to both the no-AI-key ─────
      // fallback and the "PROJECT FACTS" text handed to the model — says "This
      // project," never the project's actual name.
      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      t.ok(proj, 'demo project found');
      const pid = proj.id;
      const draft = await app.page.evaluate((pid) => {
        S.projectFilter = pid;
        _syncCache.projects = [{ id: pid, name: 'Sensitive Corridor Widening', pid: '25-154-001', client: 'UDOT', phase: 'Design' }];
        _syncCache.meetings = [];
        _syncCache.deliverables = [];
        _syncCache.commitments = [];
        _syncCache.issues = [];
        _syncCache.stakeholders = [];
        _syncCache.project_stakeholders = [];
        _syncCache.interactions = [
          { id: 'a1', projectId: pid, stakeholderId: null, anonLabel: 'Anonymous', date: '2026-06-01',
            channel: 'Email', direction: 'Outgoing', subject: 'General', nature: 'Notification',
            summary: 'Sent project update.', followUp: false, followUpDone: false },
        ];
        localStorage.setItem('pir4_pi_reports_' + pid, JSON.stringify({
          reportNum: '1', periodStart: '2026-01-01', periodEnd: '2026-12-31',
          sections: [{ id: 's0', title: 'auto-concerns', type: 'auto-concerns' }],
          distGroups: [],
        }));
        _syncCache.reports = [];
        return _buildOverallDraft();
      }, pid);
      t.ok(draft, 'the deterministic draft still produces something');
      t.ok(/^This project/.test(draft), `the opener says "This project" (got: "${draft.slice(0, 60)}...")`);
      t.eq(draft.indexOf('Sensitive Corridor Widening') >= 0, false,
           'the project\'s actual name never appears in the built facts');

      // ── 4. The AI call itself: same facts, and the userContent doesn't ─────
      // re-introduce the name the facts already avoid.
      await app.page.evaluate(async (pid) => {
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
        _setClaudeKey('sk-ant-test-key-not-real');
        window.__overallCall = null;
        window.__realNarrative = _claudeNarrative;
        window._claudeNarrative = async (sys, user, max) => {
          window.__overallCall = { sys, user, max };
          return 'STUBBED SUMMARY';
        };
        document.getElementById('rpt-overall-summary').value = '';
        await generateOverallDraft();
        window._claudeNarrative = window.__realNarrative;
      }, pid);
      const call = await app.page.evaluate(() => window.__overallCall);
      t.ok(call, 'generateOverallDraft() reached the AI call');
      if (call) {
        t.eq(call.user.indexOf('Sensitive Corridor Widening') >= 0, false,
             'the userContent sent to the model never names the project either');
        t.eq(/single most consequential/i.test(call.user), false,
             'the userContent does not ask for a "most consequential development" either');
        t.ok(/normal|not itself worth/i.test(call.user),
             'the userContent also tells the model not to judge the outbound/inbound ratio');
      }

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
