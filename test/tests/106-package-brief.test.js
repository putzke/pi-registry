// Report package: the one-page Project brief, the parcel report, the running
// header strip, and the team voice in every client-facing AI prompt (Oct 2026,
// Jeff — modelled on a hand-built I-84 Weber Bridges PI summary).
module.exports = {
  name: 'report package — project brief, parcel report, running header, team voice',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async () => {
        const P = DB.get('projects').find(p => p.pid === '25-3W-DESIGN');   // has parcels
        const projF = P.id; S.projectFilter = projF;
        const others = (k) => (DB.get(k) || []).filter(x => String(x.projectId) !== String(projF));
        const stake = DB.getActive('stakeholders').find(s => (DB.get('project_stakeholders') || []).some(l => String(l.projectId) === String(projF) && String(l.stakeholderId) === String(s.id) && (l.stakeholderRole || 'External') === 'External'));
        const mk = (date, dir, channel, subject, nature, summary) => ({ id: 'b' + Math.random(), projectId: projF, date, direction: dir, channel, subject, nature, summary, stakeholderId: stake.id });
        _syncCache.interactions = others('interactions').concat([
          mk('2030-03-02', 'Incoming', 'Phone', 'Traffic', 'Complaint', 'Upset about the single westbound lane'),
          mk('2030-03-02', 'Incoming', 'Email', 'Traffic', 'Concern', 'Worried about emergency access'),
          mk('2030-03-03', 'Incoming', 'Phone', 'Traffic', 'Concern', 'Asked about delays'),
          mk('2030-03-03', 'Incoming', 'Phone', 'Noise / Hours', 'Compliment', 'Thanked the crew'),
          mk('2030-03-05', 'Incoming', 'Phone', 'Information', 'Inquiry', ''),
          mk('2030-03-04', 'Outgoing', 'Phone', 'Traffic', 'Notification', 'Called back'),
          { id: 'undated1', projectId: projF, direction: 'Incoming', channel: 'Phone', subject: 'Traffic', nature: 'Inquiry', summary: 'no date' },
        ]);
        _syncCache.outreach_actions = others('outreach_actions').concat([
          { id: 'oa1', projectId: projF, actionDate: '2030-03-02', actionType: 'Newsletter', title: 'Traffic shift newsletter', delivery: 'Emailed', reach: 265 },
          { id: 'oa2', projectId: projF, actionDate: '2030-03-04', actionType: 'Social post', outlet: 'UDOT Facebook', title: 'Weekend closure roundup', description: 'Hand-drawn roundup post' },
        ]);
        _syncCache.outreach_readings = (DB.get('outreach_readings') || []).concat([
          { id: 'or1', actionId: 'oa2', readOn: '2030-03-06', reactions: 217, comments: 27, shares: 16, source: 'typed' },
        ]);
        const m = _briefModel(projF, '2030-03-01', '2030-03-07', false);
        const html = _briefHTML(m, { convo: 'News coverage: Picked up by two outlets.\nInbox themes: Delays and access.' });
        const facts = _briefFactLines(m).join('\n');

        // Package modal + generation
        let popup = null; const realPop = window._openRptPopup;
        window._openRptPopup = function () { popup = Array.from(arguments); };
        S.view = 'reports'; S.rptTab = 'reports'; render();
        openReportSequenceModal();
        const listed = [...document.querySelectorAll('.rpt-seq-sel')].map(x => x.getAttribute('data-rid'));
        const maxNum = document.querySelector('.rpt-seq-sel').options.length - 1;
        const setSel = (id, v) => { document.querySelector('.rpt-seq-sel[data-rid="' + id + '"]').value = String(v); };
        setSel('project-brief', 1); setSel('parcel-status', 2);
        document.getElementById('pkg-pstart').value = '2030-03-01';
        document.getElementById('pkg-pend').value = '2030-03-07';
        document.getElementById('pkg-convo').value = 'Social media: Mostly appreciative.';
        const pkgPhases = !!document.getElementById('pkg-ph-a0');
        const ids = _pkgSelectedIds();
        const pf = _buildPackageFacts(projF, ids, { briefStart: '2030-03-01', briefEnd: '2030-03-07' });
        generateReportSequence();
        window._openRptPopup = realPop;
        // The frame itself, with the running strip
        let frame = '';
        const realShow = window.showInlineReport; window.showInlineReport = (h) => { frame = h; };
        _openRptPopup('<p>x</p>', 'Public Involvement Report Package', 'L', 'March 8, 2030', '', { running: { title: 'Weber River Bridges', sub: 'PI Report Package | March 1–7, 2030', right: 'UDOT · PIN 1', date: 'March 8, 2030' }, source: 'Source: Cirrus Cc logs' });
        window.showInlineReport = realShow;
        return {
          m: { all: m.all.length, inb: m.inbound.length, phone: m.phone, email: m.email, peak: m.peak && [m.peak.start, m.peak.n], out: m.ost.total,
               marked: m.buckets.filter(b => b.out).map(b => b.start), reach: m.reach && m.reach.a.reach, undated: m.undated, noNotes: m.noNotes,
               topics: m.topics.map(x => x[0] + ':' + x[1]), tone: m.toneAll, weekly: m.weekly, buckets: m.buckets.length },
          html, facts, pkgPhases, listed, maxNum, ids, pfNames: pf.blocks.map(b => b.name), pfBrief: (pf.blocks.find(b => b.id === 'project-brief') || {}).lines || [],
          pfParcel: (pf.blocks.find(b => b.id === 'parcel-status') || {}).lines || [],
          popup: popup ? { body: popup[0], opts: popup[5] } : null, frame,
          prompts: { sec: _claudeSectionSystemPrompt(), co: _coCloseoutSystemPrompt(), voice: RPT_TEAM_VOICE,
                     status: String(generateTrendSummary).includes('RPT_TEAM_VOICE') },
          convoReq: _briefConvoRequest(m),
          names: [stake.firstName, stake.lastName],
        };
      });
      const m = r.m;
      t.eq(m.all + '/' + m.inb, '6/5', 'brief counts the period: 6 contacts, 5 inbound (undated left out)');
      t.eq(m.phone + '/' + m.email, '4/1', 'inbound phone / email');
      t.eq(m.peak, ['2030-03-02', 2], 'busiest day found (first of the ties)');
      t.eq(m.out, 2, 'outreach actions in the period');
      t.eq(m.marked.join(','), '2030-03-02,2030-03-04', 'outreach marked on the days it went out');
      t.eq(m.reach, 265, 'newsletter reach tile');
      t.eq(m.undated + '/' + m.noNotes, '1/1', 'data notes: undated and no-notes counted');
      t.eq(m.topics[0], 'Traffic:3', 'topics counted from Subject');
      t.eq([m.tone.Complaint, m.tone.Concern, m.tone['Question or information'], m.tone.Positive].join(','), '1,2,1,1', 'tone counted from Nature, grouped');
      t.eq(m.weekly + '/' + m.buckets, 'false/7', 'a one-week brief charts per day');
      ['contacts logged', 'inbound phone calls / emails', 'proactive outreach actions', 'Inbound public contacts per day', 'What people contacted us about',
       'Proactive outreach timeline', 'Traffic shift newsletter', 'Social media posts', '217 reactions | 27 comments | 16 shares',
       'What the public conversation looks like', 'News coverage', 'Contact tone by topic', 'has no date and is not counted here']
        .forEach(s => t.ok(r.html.includes(s), 'brief shows: ' + s));
      t.ok(!r.html.includes(r.names[1]), 'no contact name on the brief');
      t.ok(!r.html.includes('Volume by period') && !r.pkgPhases, 'no typed volume-by-period table (removed)');
      t.ok(/Inbound contacts by subject: Traffic \(3\)/.test(r.facts) && /recorded nature: complaint 1, concern 2/.test(r.facts), 'brief facts are counted');
      t.eq(r.listed[0] + '|' + r.listed[r.listed.length - 1], 'project-brief|parcel-status', 'package lists the brief first and the parcel report last');
      t.eq(r.maxNum, r.listed.length, 'sequence numbers go up to the number of reports');
      t.eq(r.ids.join(','), 'project-brief,parcel-status', 'chosen order read');
      t.ok(r.pfBrief.some(x => /Contacts logged: 6/.test(x)) && r.pfParcel.some(x => /Right-of-way parcels: \d+/.test(x)), 'package summary gets brief and parcel facts');
      t.ok(r.popup && /Project brief — March 1/.test(r.popup.body) && /Right-of-Way Parcel Report/.test(r.popup.body), 'package contains the brief and the parcel report');
      t.ok(/Mostly appreciative/.test(r.popup.body), 'typed conversation prints on the brief');
      t.ok(r.popup.opts && r.popup.opts.running && /March 1/.test(r.popup.opts.running.sub) && /Source:/.test(r.popup.opts.source), 'running header + source line passed');
      t.ok(r.frame.includes('Weber River Bridges') && r.frame.includes('Report date: March 8, 2030') && r.frame.includes('#c4551f') && r.frame.includes('Source: Cirrus Cc logs'), 'frame draws the running strip and source line');
      t.ok(/<thead>[\s\S]*Weber River Bridges[\s\S]*<\/thead>/.test(r.frame), 'the strip is in the repeating header');
      t.ok(/team-positive/.test(r.prompts.voice) && /Never assign blame/.test(r.prompts.voice) && /honestly and without minimizing/.test(r.prompts.voice), 'team voice: positive, no blame, still honest');
      t.ok(r.prompts.sec.includes(r.prompts.voice) && r.prompts.co.includes(r.prompts.voice) && r.prompts.status, 'team voice in section, close-out and status report prompts');
      t.ok(r.convoReq.system.includes(r.prompts.voice) && /Heading: text/.test(r.convoReq.user) && !r.convoReq.user.includes(r.names[1]), 'conversation draft: team voice, Heading: text format, no names');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
