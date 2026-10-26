// "Recent public concerns and inquiries" — a fuller, structured AI summary and
// an "Interactions at a glance" table (DEV, Oct 2026, Jeff). Before: a fixed
// ~175-word cap whatever the volume (319 interactions got the same as 15), the
// team's outbound notifications counted as public concern, no counts by theme,
// no comparison with the previous period, and contact NAMES sent to the AI.
module.exports = {
  name: 'concerns summary — length by volume, inbound/outbound, themes, previous period, glance table',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async (pid) => {
        const P = DB.get('projects').find(p => String(p.id) === pid);
        S.projectFilter = P.id;
        const projF = P.id;
        // A clean 14-day period with known contacts, plus 14 days before it.
        const stake = DB.getActive('stakeholders').find(s => (DB.get('project_stakeholders')||[]).some(l => String(l.projectId)===String(projF) && String(l.stakeholderId)===String(s.id) && (l.stakeholderRole||'External')==='External') && s.firstName && s.lastName);
        const mk = (date, dir, subject, nature, extra) => Object.assign({ id: 'x' + Math.random(), projectId: projF, date, direction: dir, channel: 'Phone', subject, nature, summary: subject + ' NOTE', stakeholderId: stake.id }, extra || {});
        const own = (DB.get('interactions')||[]).filter(i => !(i.date >= '2030-01-01'));
        const fake = [
          mk('2030-02-02', 'Incoming', 'Noise', 'Complaint'), mk('2030-02-03', 'Incoming', 'Noise', 'Concern'),
          mk('2030-02-04', 'Incoming', 'Noise', 'Concern', { followUp: true }), mk('2030-02-05', 'Incoming', 'Access', 'Inquiry'),
          mk('2030-02-06', 'Outgoing', 'Detour', 'Notification'), mk('2030-02-07', 'Outgoing', 'Detour', 'Notification'),
          mk('2030-01-20', 'Incoming', 'Access', 'Inquiry'), mk('2030-01-21', 'Outgoing', 'Detour', 'Notification'),
        ];
        _syncCache.interactions = own.concat(fake);
        const setSections = (secs) => {
          _syncCache.reports = [{ id: 1, projectId: projF, reportNum: '1', reportTitle: 'PI', periodStart: '2030-02-01', periodEnd: '2030-02-14', sections: secs }];
        };
        setSections([{ id: 'concerns', title: 'Recent public concerns and inquiries', type: 'auto-concerns', showTable: false }]);
        const st = _concernsStats(projF, '2030-02-01', '2030-02-14', false);
        const facts = _buildConcernsAIFacts();
        const req = _sectionAIRequest('auto-concerns', '');
        // with a Follow-up status section in the report
        setSections([{ id: 'concerns', title: 'R', type: 'auto-concerns' }, { id: 'f', title: 'F', type: 'auto-followups' }]);
        const req2 = _sectionAIRequest('auto-concerns', '');
        const glanceFU = _concernsGlanceRows(st, false).map(r => r[0]);
        // tiers
        const tiers = [10, 25, 26, 100, 101, 300, 301].map(n => _concernsTier(n).words);
        // preview + snapshot + archive
        setSections([{ id: 'concerns', title: 'Recent public concerns and inquiries', type: 'auto-concerns', showTable: false, summary: 'Para one.\n\nPara two.' }]);
        localStorage.removeItem('pir4_pi_reports_' + projF);
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport(); renderLivePreview();
        const pane = document.getElementById('rpt-live-preview').innerHTML;
        const snap = _buildReportSnapshot(projF, loadReportSections(projF));
        const arch = _buildArchivedPreviewHTML({ reportTitle: 'PI', snapshot: snap }, P);
        // .docx
        const real = URL.createObjectURL.bind(URL); let blob = null;
        URL.createObjectURL = x => { blob = x; return real(x); };
        await exportPIDocx();
        for (let i = 0; i < 100 && !blob; i++) await new Promise(r => setTimeout(r, 100));
        URL.createObjectURL = real;
        const doc = blob ? await (await JSZip.loadAsync(blob)).file('word/document.xml').async('string') : '';
        return {
          inN: st.inbound.length, outN: st.outbound.length, top: st.top, prev: st.prev,
          facts, req, req2, glanceFU, tiers,
          names: [stake.firstName, stake.lastName],
          pane, archGlance: (snap.sections[0].glanceHtml || '').length > 0, arch, doc,
        };
      }, String(proj.id));
      t.eq(r.inN, 4, 'inbound counted on their own');
      t.eq(r.outN, 2, 'outbound counted on their own');
      t.eq(r.top[0].join(':'), 'Noise:3', 'top subject from inbound only, counted');
      t.ok(r.prev && r.prev.start === '2030-01-18' && r.prev.end === '2030-01-31', 'previous period = the same 14 days before');
      t.eq(r.prev.inbound + '/' + r.prev.outbound, '1/1', 'previous period counts');
      t.eq(r.tiers.join(','), '150,150,250,250,350,350,450', 'length steps with inbound volume');
      t.ok(/Inbound and in-person contacts from the public and stakeholders: 4\./.test(r.facts), 'facts: inbound count');
      t.ok(/Outbound notifications and calls by the project team: 2\./.test(r.facts), 'facts: outbound count, separate');
      t.ok(/Inbound contacts by subject: Noise \(3\), Access \(1\)/.test(r.facts), 'facts: counts by subject (inbound only)');
      t.ok(/Previous period \(.*\): 1 inbound, 1 outbound/.test(r.facts), 'facts: previous period');
      t.ok(/Noise 3 vs 0 \(new\)/.test(r.facts), 'facts: subject change vs previous');
      t.ok(!r.facts.includes(r.names[0] + ' ' + r.names[1]) && !r.facts.includes(r.names[1]), 'no contact name reaches the AI');
      t.ok(/still awaiting follow-up: 1/.test(r.facts), 'follow-ups given when the report has no follow-up section');
      t.ok(/about 150 words/.test(r.req.userContent) && r.req.maxTokens === 440, 'request: words and reply budget from the tier');
      t.ok(/Outbound notifications are the team's work, not public concern/.test(r.req.userContent), 'request keeps outreach out of public concern');
      t.ok(/compared with the previous period/.test(r.req.userContent), 'request asks what changed');
      t.ok(/Do not discuss follow-ups/.test(r.req2.userContent), 'with a Follow-up section: no follow-ups in the narrative');
      t.ok(!r.glanceFU.some(x => /follow-up/i.test(x)), 'glance rows drop follow-ups when the section exists');
      t.ok(/Interactions at a glance/.test(r.pane), 'preview shows the glance table (data table off)');
      t.ok(/Raised most: Noise/.test(r.pane), 'preview glance lists the top subject');
      t.ok(r.archGlance && /Interactions at a glance/.test(r.arch), 'archived copy carries the frozen glance table');
      t.ok(/Interactions at a glance/.test(r.doc) && /Raised most: Noise/.test(r.doc), '.docx has the glance table');
      t.ok(/Para one\.<\/w:t>/.test(r.doc) && /Para two\.<\/w:t>/.test(r.doc), '.docx prints each narrative paragraph as its own paragraph');
    } finally { await app.close(); }
    const fs = require('fs'), path = require('path');
    const portal = fs.readFileSync(path.join(__dirname, '../../client-portal.html'), 'utf8');
    t.ok(/sec\.glanceHtml/.test(portal), 'portal renders the frozen glance table');
  }
};
