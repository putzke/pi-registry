// Section drafts that have nothing to say (Nov 2026, Jeff). Seen live: with no
// API key the Commitments AI Draft pasted the model's own instructions ("SINCE
// THE LAST REPORT … worked out already; use exactly as given …") into the
// summary, and Follow-up status said only "Not enough data yet". Now:
//  - the fallback box text is the plain sentences, never the AI instructions;
//  - Follow-ups with nothing in the window and Commitments with nothing new
//    since the last report grey the AI button and say why, by name;
//  - "Draft all" skips them; the empty tables read "… to report.".
module.exports = {
  name: 'section draft fallbacks — no AI instructions in the box; nothing-to-say sections explain and are skipped',
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
        const toasts = []; const _t = window.showToast; window.showToast = (m) => toasts.push(m);
        const setDraft = types => { localStorage.removeItem('pir4_pi_reports_' + projF);
          _syncCache.reports = [{ id: 1, projectId: projF, reportNum: '8', reportTitle: 'PI', periodStart: '2030-03-01', periodEnd: '2030-03-31',
            sections: types.map((ty, n) => ({ id: 's' + n, title: ty, type: ty, showTable: true })) }]; };
        const out = {};
        // Follow-ups: none on the project at all, then some but none in the window.
        _syncCache.interactions = others('interactions');
        _syncCache.commitments = others('commitments').concat([{ id: 9101, projectId: projF, commitment: 'Keep access ZCA', status: 'Fulfilled' }]);
        _syncCache.report_archive = (_syncCache.report_archive || []).filter(x => String(x.projectId) !== String(projF));
        setDraft(['auto-commitments', 'auto-followups']);
        out.fuNone = _sectionDraftBlock('auto-followups');
        _syncCache.interactions = others('interactions').concat([{ id: 7001, projectId: projF, date: '2029-01-01', followUp: true, followUpDone: true, followUpResolved: '2029-01-05' }]);
        out.fuOutside = _sectionDraftBlock('auto-followups');
        // Commitments: first report (nothing archived) with all fulfilled is still worth a summary.
        out.commFirst = _sectionDraftBlock('auto-commitments');
        // Archived report #4 already had it fulfilled: nothing new.
        const tf = { issues: [], deliverables: [], followUpOpenIds: [], commitments: [{ id: '9101', text: 'Keep access ZCA', status: 'Fulfilled' }] };
        _syncCache.report_archive.push({ id: 'a4', projectId: projF, reportNum: '4', archivedAt: '2030-02-25T10:00:00Z',
          snapshot: { sections: [{ type: 'auto-commitments' }, { type: 'auto-followups' }], trendFacts: tf } });
        out.commSame = _sectionDraftBlock('auto-commitments');
        // Fulfilled SINCE the last report: worth a summary.
        tf.commitments[0].status = 'Open';
        out.commChanged = _sectionDraftBlock('auto-commitments');
        tf.commitments[0].status = 'Fulfilled';
        // An open one: worth a summary.
        _syncCache.commitments.push({ id: 9102, projectId: projF, commitment: 'Mail notice ZCB', status: 'Open' });
        out.commOpen = _sectionDraftBlock('auto-commitments');
        _syncCache.commitments.pop();
        // The editor: greyed buttons with the reason; clicks say why and write nothing.
        openPIReport();
        await new Promise(r => setTimeout(r, 300));
        const btns = [...document.querySelectorAll('[id^="sec-draft-btn-"]')].map(b => ({ blocked: b.dataset.blocked === '1', title: b.title }));
        out.btns = btns;
        const tas = [...document.querySelectorAll('.rpt-sec-summary')];
        await generateSectionDraft('auto-commitments', tas[0].dataset.idx);
        await generateSectionDraft('auto-followups', tas[1].dataset.idx);
        out.boxes = tas.map(t => t.value);
        out.toasts = toasts.slice();
        // No API key + something to say: the box gets plain sentences only.
        tf.commitments[0].status = 'Open';
        localStorage.removeItem('compass_claude_api_key_v2');
        await generateSectionDraft('auto-commitments', tas[0].dataset.idx);
        out.plain = tas[0].value;
        // Empty follow-up table wording.
        out.fuTable = _buildSectionPreviewTable('auto-followups', projF, '2030-03-01', '2030-03-31') || '';
        window.showToast = _t;
        return out;
      }, String(proj.id));
      t.ok(/has no follow-ups yet/.test(r.fuNone) && /type your own summary/.test(r.fuNone), 'no follow-ups at all: says so, and that a summary can still be typed');
      t.ok(/none were resolved in this report period/.test(r.fuOutside), 'follow-ups exist but none in the window: says so');
      t.eq(r.commFirst, '', 'first report with fulfilled commitments: AI summary still offered');
      t.ok(/already fulfilled by the last report \(#4/.test(r.commSame) && /nothing has changed since/.test(r.commSame), 'all fulfilled before report #4, nothing new: no AI summary, and why');
      t.eq(r.commChanged, '', 'fulfilled since the last report: AI summary offered');
      t.eq(r.commOpen, '', 'an open commitment: AI summary offered');
      t.ok(r.btns.length >= 2 && r.btns.every(b => b.blocked && b.title), 'both AI Draft buttons are greyed with the reason as a tooltip');
      t.ok(r.boxes.every(v => v === ''), 'clicking them writes nothing in the summary boxes');
      t.ok(r.toasts.some(m => /already fulfilled/.test(m)) && r.toasts.some(m => /none were resolved/.test(m)), 'each click explains why');
      t.ok(r.plain && /commitment/.test(r.plain) && !/SINCE THE LAST REPORT|worked out already|use exactly/i.test(r.plain), 'no-key fallback: plain sentences, never the AI instructions');
      t.ok(/No follow-up items to report\./.test(r.fuTable), 'empty follow-up table reads "No follow-up items to report."');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
