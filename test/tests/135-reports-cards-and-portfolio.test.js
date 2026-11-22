// Reports view redesign (DEV, Nov 2026, Jeff — from the canvas mockups).
// Quick Reports: no stat row; 12 cards in three groups of four, each with a
// small picture of its data; Insight ▾ on four cards; ＋ Package numbers the
// package dialog in click order; a period switch remembered per person.
// Portfolio (no project): one grouped list by client, collapsed unless a
// project in the group has an overdue follow-up or no report in 30+ days.
const SHOT = process.env.SHOT_DIR;
module.exports = {
  name: 'reports — report cards with pictures, insight panels, package picks; grouped portfolio',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const q = await app.page.evaluate(() => {
        try { localStorage.removeItem('cc_rpt_period'); } catch (e) {}
        const p = DB.get('projects').find(x => /3600 West/.test(x.name)) || DB.get('projects')[0];
        S.projectFilter = p.id; S.rptTab = 'reports'; S.rptInsight = ''; S.rptPkg = null; S.view = 'reports'; render();
        const main = document.getElementById('main');
        const cards = [...main.querySelectorAll('.rpt-card')].map(c => c.getAttribute('data-rid'));
        const out = { pid: p.id, cards, groups: main.querySelectorAll('.rpt-group').length,
          oldStats: /Stakeholders<\/div>/.test(main.innerHTML) && /incoming</.test(main.innerHTML),
          ins: [...main.querySelectorAll('.rpt-ins')].map(b => b.closest('.rpt-card').getAttribute('data-rid')),
          pkgOnPi: !!main.querySelector('.rpt-card[data-rid="pi-summary"] .rpt-pkg'),
          incInt: !!document.getElementById('rpt-include-internal'), brand: !!document.getElementById('rpt-brand-sel'),
          defPeriod: _rptPeriod() };
        // The interaction-log card counts external & public contacts in the window.
        const ps = DB.get('project_stakeholders').filter(x => String(x.projectId) === String(p.id));
        const ext = ps.filter(x => (x.stakeholderRole || 'External') === 'External').map(x => String(x.stakeholderId));
        const count = days => { const s = _isoAddDays(localToday(), -(days - 1)), td = localToday();
          return DB.get('interactions').filter(i => String(i.projectId) === String(p.id) && _intIsExternal(i, ext) && i.date && i.date >= s && i.date <= td).length; };
        const big = () => main.querySelector('.rpt-card[data-rid="interaction-log"] .rpt-card-big').textContent;
        out.big90 = big(); out.want90 = String(count(90));
        setRptPeriod('30');
        out.stored = localStorage.getItem('cc_rpt_period');
        out.big30 = document.querySelector('.rpt-card[data-rid="interaction-log"] .rpt-card-big').textContent; out.want30 = String(count(30));
        out.pressed30 = [...document.querySelectorAll('[aria-label="Period shown on the cards"] button')].find(b => b.getAttribute('aria-pressed') === 'true').textContent;
        // Package picks in click order → dialog numbers.
        rptPkgToggle('deliverable-status'); rptPkgToggle('interaction-log'); rptPkgToggle('comment-matrix'); rptPkgToggle('comment-matrix');
        out.pkgBtn = [...document.querySelectorAll('.rpt-sendto button')].pop().textContent;
        openReportSequenceModal();
        const val = id => (document.querySelector('.rpt-seq-sel[data-rid="' + id + '"]') || {}).value;
        out.seq = { del: val('deliverable-status'), int: val('interaction-log'), cmt: val('comment-matrix') };
        closeM();
        // Insight panel.
        rptInsight('followup-status');
        const panel = document.querySelector('.rpt-insight');
        out.panel = panel && panel.getAttribute('data-rid');
        out.panelInGroup = panel && panel.closest('.rpt-group').querySelector('.rpt-card[data-rid="followup-status"]') !== null;
        const today = localToday();
        out.overdueWant = DB.get('interactions').filter(i => String(i.projectId) === String(p.id) && i.followUp && !i.followUpDone && i.followUpDue && i.followUpDue < today).length;
        out.overdueTile = panel ? panel.querySelector('div[style*="border-top:3px"] div').textContent : null;
        // Internal toggle survives a re-render.
        rptSetIncInt(true); out.incKept = document.getElementById('rpt-include-internal').checked; rptSetIncInt(false);
        return out;
      });
      t.eq(q.cards.length, 12, 'twelve report cards');
      t.eq(q.groups, 3, 'in three groups');
      t.ok(!q.cards.includes('stakeholder-map'), 'the map card is gone (Map link on the contact list card)');
      t.ok(!q.oldStats, 'the old stakeholders / interactions stat row is gone');
      t.eq(q.ins, ['interaction-log', 'followup-status', 'comment-matrix', 'deliverable-status'], 'Insight on the four first cards');
      t.ok(!q.pkgOnPi, 'no ＋ Package on a report the package cannot hold');
      t.ok(q.incInt && q.brand, 'internal toggle and letterhead are on the Send to strip');
      t.eq(q.defPeriod, '90', 'period defaults to the last 90 days');
      t.eq(q.big90, q.want90, 'interaction-log card counts external contacts in 90 days');
      t.eq(q.stored, '30', 'period choice remembered per person');
      t.eq(q.big30, q.want30, 'card follows the period');
      t.eq(q.pressed30, 'Last 30 days', 'the switch shows the chosen period');
      t.ok(/· 2 /.test(q.pkgBtn), 'package button counts picks: ' + q.pkgBtn);
      t.eq(q.seq, { del: '1', int: '2', cmt: '' }, 'dialog numbered in click order; an unpicked report stays blank');
      t.eq(q.panel, 'followup-status', 'Insight opens the follow-up panel');
      t.ok(q.panelInGroup, 'panel sits under its own row');
      t.eq(q.overdueTile, String(q.overdueWant), 'overdue tile = the follow-up rule');
      t.ok(q.incKept, 'internal toggle stays ticked after a redraw');
      if (SHOT) {
        await app.page.evaluate(() => { rptInsight('interaction-log'); });
        await app.page.screenshot({ path: SHOT + '/quick.png', fullPage: true });
      }

      // A bottom-row Insight keeps your place and shows its panel (Jeff: it
      // jumped back to the top, panel out of sight).
      await app.page.setViewportSize({ width: 1440, height: 700 });
      const sc = await app.page.evaluate(() => {
        S.rptInsight = ''; render();
        const c = document.querySelector('#main .content'); c.scrollTop = c.scrollHeight;
        const before = c.scrollTop;
        document.querySelector('.rpt-card[data-rid="deliverable-status"] .rpt-ins').click();
        const c2 = document.querySelector('#main .content'), p = document.querySelector('.rpt-insight');
        const pr = p.getBoundingClientRect(), cr = c2.getBoundingClientRect();
        const out = { before, after: c2.scrollTop, inView: pr.top < cr.bottom && pr.bottom > cr.top && pr.top >= cr.top - 1 };
        c2.scrollTop = 400; const keep = c2.scrollTop; rptPkgToggle('events-log');
        out.pkgKeep = document.querySelector('#main .content').scrollTop === keep; rptPkgToggle('events-log');
        return out;
      });
      t.ok(sc.before > 0 && sc.after > 0, 'opening a bottom-row Insight does not jump to the top');
      t.ok(sc.inView, 'the opened panel is on screen');
      t.ok(sc.pkgKeep, '＋ Package keeps the scroll position');
      await app.page.setViewportSize({ width: 1440, height: 900 });

      const pf = await app.page.evaluate(() => {
        const today = localToday();
        _syncCache.projects = [
          { id: '901', pid: 'A1', name: 'Alpha Road', status: 'Active', client: 'Client A', county: 'Weber', lead: 'ZQA', phase: 'Design' },
          { id: '902', pid: 'A2', name: 'Alpha Bridge', status: 'Active', client: 'Client A', county: 'Davis', lead: 'ZQB', phase: 'Construction' },
          { id: '903', pid: 'B1', name: 'Beta Main', status: 'Active', client: 'Client B', county: 'Weber', lead: 'ZQA', phase: 'Design' },
          { id: '904', pid: 'C1', name: 'Gamma Old', status: 'Complete', client: 'Client C', county: 'Cache', lead: 'ZQB' },
          { id: '905', pid: 'B2', name: 'Beta Paused', status: 'On hold', client: 'Client B', county: 'Weber', lead: 'ZQB' }];
        _syncCache.project_stakeholders = []; _syncCache.issues = []; _syncCache.commitments = []; _syncCache.client_summaries = [];
        _syncCache.interactions = [{ id: '1', projectId: '901', followUp: true, followUpDone: false, followUpDue: _isoAddDays(today, -3), date: today }];
        _syncCache.report_archive = ['901', '902', '903'].map((pid, i) => ({ id: 'r' + i, projectId: pid, clientVisible: true, archivedAt: _isoAddDays(today, -5) }));
        S.projectFilter = ''; const ps0 = document.getElementById('rpt-proj'); if (ps0) ps0.value = ''; S.pfOpen = {}; S.pfQ = ''; S.pfQuick = ''; S.pfBy = 'client'; S.pfShow = 'current'; render();
        const groups = () => [...document.querySelectorAll('.pf-group')].map(g => ({ k: g.getAttribute('data-key'), rows: g.querySelectorAll('.pf-row').length, flag: (g.querySelector('.pf-flag') || {}).textContent || '' }));
        const out = { start: groups(), oldCards: /Portfolio Overview/.test(document.getElementById('main').innerHTML) };
        pfToggle('Client B'); out.afterOpen = groups();
        S.pfQ = 'bridge'; _pfRender(); out.search = groups(); S.pfQ = '';
        pfSet('pfBy', 'lead'); out.byLead = groups().map(g => g.k); pfSet('pfBy', 'client');
        pfSet('pfShow', 'all'); out.all = groups().map(g => g.k); pfSet('pfShow', 'current');
        pfSet('pfQuick', 'overdue'); out.quick = groups(); pfSet('pfQuick', '');
        out.dbg = groups(); const row = [...document.querySelectorAll('.pf-row')][0]; if (row) { row.click(); out.opened = S.projectFilter; }
        return out;
      });
      t.ok(!pf.oldCards, 'old Portfolio Overview cards replaced');
      t.eq(pf.start, [{ k: 'Client A', rows: 2, flag: '1 overdue' }, { k: 'Client B', rows: 0, flag: '' }],
        'grouped by client; flagged group open, quiet group collapsed; Complete hidden');
      t.eq(pf.afterOpen[1].rows, 2, 'a collapsed group opens on click (On hold included)');
      t.eq(pf.search, [{ k: 'Client A', rows: 1, flag: '' }], 'search narrows and opens what it finds');
      t.eq(pf.byLead, ['ZQA', 'ZQB'], 'group by PI Lead');
      t.ok(pf.all.includes('Client C'), 'Show All brings Complete projects back');
      t.eq(pf.quick.map(g => g.k), ['Client A'], 'Overdue follow-ups tile filters to those projects');
      t.ok(['901', '902'].includes(String(pf.opened)), 'clicking a project row opens its reports');
      if (SHOT) {
        await app.page.evaluate(() => { S.projectFilter = ''; render(); });
        await app.page.screenshot({ path: SHOT + '/portfolio.png', fullPage: true });
      }
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
