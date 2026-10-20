// The Outreach log in reports (Part B, step 2c, Oct 2026) and the campaign
// manager.
//  - Manage campaigns: add, rename (a duplicate name is refused), delete — the
//    campaign's actions stay in the log, without a campaign.
//  - _outreachStats is the ONE set of numbers: actions dated in the window,
//    each with its newest reading ON OR BEFORE the window's end.
//  - Quick report "Outreach log": headline numbers, a by-campaign table, the
//    actions with counts and their dates; the internal note never prints.
//  - PI report section "auto-outreach": period-bounded label + counts, the
//    same table in the preview and the archived snapshot, and a .docx that
//    lists titles only when "Include data table" is ticked.
module.exports = {
  name: 'outreach in reports — campaigns managed, period-bounded section, quick report, .docx table toggle',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    const [c1] = await t.sql(`insert into pi_outreach_campaigns (project_id, name) values ($1,'Fall closures') returning id`, [P]);
    const [c2] = await t.sql(`insert into pi_outreach_campaigns (project_id, name) values ($1,'Open house') returning id`, [P]);
    const [inA] = await t.sql(`insert into pi_outreach_actions (project_id, campaign_id, action_date, action_type, party, url, title, outlet, note)
      values ($1,$2,'2026-08-05','Press release','UDOT','https://connect.udot.utah.gov/a','OUTMARK-IN closures announced','connect.udot.utah.gov','NOTEMARK internal only') returning id`, [P, c1.id]);
    const [inB] = await t.sql(`insert into pi_outreach_actions (project_id, campaign_id, action_date, action_type, party, title, outlet)
      values ($1,$2,'2026-08-20','Social post','PI team','OUTMARK-POST weekend closures','Instagram') returning id`, [P, c1.id]);
    await t.sql(`insert into pi_outreach_actions (project_id, campaign_id, action_date, action_type, party, title)
      values ($1,$2,'2026-09-15','Newsletter','PI team','OUTMARK-LATER September newsletter')`, [P, c2.id]);
    // Readings: one inside the period, one after it — the report must use the first.
    await t.sql(`insert into pi_outreach_readings (action_id, read_on, reactions, comments, source) values
      ($1,'2026-08-22',100,5,'automatic'),($1,'2026-10-01',900,40,'typed')`, [inB.id]);

    const app = await t.open('index.html', { email: 'staff@sunrise.example' });
    try {
      await app.ready();
      const P_ = app.page;
      await P_.evaluate(() => { window.confirm = () => true; window._toasts = []; const o = window.showToast; window.showToast = (m, k, d) => { window._toasts.push(m); return o && o(m, k, d); }; });

      // ── one set of numbers ──
      const st = await P_.evaluate((p) => { const s = _outreachStats(p, '2026-08-01', '2026-08-31');
        return { total: s.total, titles: s.rows.map((x) => x.a.title), r: s.rows.find((x) => /POST/.test(x.a.title)).r, totals: s.totals, camps: s.campaigns.map((c) => [c.name, c.n, c.reactions]) }; }, P);
      t.eq(st.total, 2, 'the period holds the two August actions');
      t.ok(!st.titles.some((x) => /LATER/.test(x)), 'an action after the period is left out');
      t.eq([st.r.reactions, st.r.comments], [100, 5], 'the reading used is the one taken on or before the period end, not the later one');
      t.eq(st.camps, [['Fall closures', 2, 100]], 'campaign roll-up for the period');
      const all = await P_.evaluate((p) => { const s = _outreachStats(p); return [s.total, s.totals.reactions]; }, P);
      t.eq(all, [3, 900], 'no window → every action, newest reading');

      // ── quick report ──
      const qr = await P_.evaluate((p) => {
        S.view = 'reports'; S.rptTab = 'reports'; S.projectFilter = p; render();
        const card = [...document.querySelectorAll('#main [onclick]')].some((e) => /generateReport\('outreach-log'\)/.test(e.getAttribute('onclick')));
        generateReport('outreach-log');
        const f = document.getElementById('inline-rpt-frame');
        return { card, html: f ? f.srcdoc : '', ai: !!document.getElementById('qr-ai-btn') };
      }, P);
      t.ok(qr.card, 'the Outreach log card is on Quick Reports');
      t.ok(/Outreach actions/.test(qr.html) && /By campaign/.test(qr.html) && /Fall closures/.test(qr.html), 'headline numbers and the by-campaign table');
      t.ok(/OUTMARK-IN/.test(qr.html) && /OUTMARK-LATER/.test(qr.html) && /900 reactions/.test(qr.html), 'every action, with its latest counts');
      t.ok(!/NOTEMARK/.test(qr.html), 'the internal note never prints');
      t.ok(qr.ai, 'the ✦ AI summary button is offered');
      await P_.evaluate(() => { const o = document.getElementById('inline-rpt-overlay'); if (o) o.remove(); });   // Close, as the button does
      const facts = await P_.evaluate((p) => _buildPackageFacts(p, ['outreach-log']), P);
      t.ok(facts.blocks[0].lines.some((l) => /Outreach actions: 3/.test(l)) && facts.blocks[0].lines.some((l) => /Campaign "Fall closures"/.test(l)), 'package/AI facts carry the computed counts and campaigns');
      t.ok(!facts.blocks[0].lines.join(' ').includes('NOTEMARK'), 'and never the internal note');

      // ── PI report section: label, table, snapshot ──
      const sec = await P_.evaluate((p) => {
        const label = _periodLabel('auto-outreach', '2026-08-01', '2026-08-31');
        const tbl = _buildSectionPreviewTable('auto-outreach', p, '2026-08-01', '2026-08-31', false);
        S.projectFilter = p;
        const snap = _buildReportSnapshot(p, { periodStart: '2026-08-01', periodEnd: '2026-08-31', reportNum: '1', reportTitle: 'R', distGroups: [],
          sections: [{ id: 'o', title: 'Outreach', type: 'auto-outreach', showTable: true }] });
        const s0 = (snap.sections || []).find((x) => x.type === 'auto-outreach' || x.id === 'o') || {};
        return { label, tbl, snapLabel: s0.countsLabel || '', snapTbl: s0.tableHtml || '', avail: getAvailableSections().some((x) => x.type === 'auto-outreach') };
      }, P);
      t.ok(sec.avail, 'Outreach is offered in Add section');
      t.eq(sec.label, '31-day report period · ', 'the section is bounded by the period and says so');
      t.ok(/OUTMARK-IN/.test(sec.tbl) && !/OUTMARK-LATER/.test(sec.tbl) && /100 reactions/.test(sec.tbl), 'the preview table holds the period only, with the in-period reading');
      t.ok(/^31-day report period · 2 outreach actions · 1 with engagement counts$/.test(sec.snapLabel), 'the archived header says the same: ' + sec.snapLabel);
      t.eq(sec.snapTbl, sec.tbl, 'the archive freezes the same table the preview shows');

      // ── .docx: aggregate always, titles only with the table ──
      const runExport = (showTable) => P_.evaluate(async ([p, showTable]) => {
        _syncCache.reports = [];
        localStorage.setItem('pir4_pi_reports_' + p, JSON.stringify({ reportNum: '1', reportTitle: 'PI Progress Report',
          periodStart: '2026-08-01', periodEnd: '2026-08-31', distGroups: [],
          sections: [{ id: 'o', title: 'Outreach', type: 'auto-outreach', showTable }] }));
        S.projectFilter = p; S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
        const real = URL.createObjectURL.bind(URL); let blob = null;
        URL.createObjectURL = (x) => { blob = x; return real(x); };
        try { await exportPIDocx(); } catch (e) {}
        for (let i = 0; i < 80 && !blob; i++) await new Promise((r) => setTimeout(r, 100));
        URL.createObjectURL = real;
        if (!blob) return null;
        return (await JSZip.loadAsync(blob)).file('word/document.xml').async('string');
      }, [P, showTable]);
      const off = await runExport(false);
      t.ok(off && /2 outreach actions in the period/.test(off) && /Campaign &quot;Fall closures&quot;|Campaign "Fall closures"/.test(off), 'table off: the aggregate lines print');
      t.ok(off && !/OUTMARK/.test(off), 'table off: no action titles in the .docx');
      await t.sql(`delete from pi_reports where project_id=$1`, [P]);
      const on = await runExport(true);
      t.ok(on && /OUTMARK-IN/.test(on) && /OUTMARK-POST/.test(on) && !/OUTMARK-LATER/.test(on), 'table on: the period’s actions are listed');
      t.ok(on && !/NOTEMARK/.test(on), 'the internal note never reaches the .docx');
      await t.sql(`delete from pi_reports where project_id=$1`, [P]);

      // ── manage campaigns ──
      await P_.evaluate((p) => { S.projectFilter = p; setView('outreach'); openCampaignsModal(); }, P);
      t.ok((await P_.inputValue('#out-camp-name-' + c1.id)) === 'Fall closures' && /2 actions/.test(await P_.textContent('#out-camp-list')), 'the manager lists campaigns with their action counts');
      await P_.fill('#out-camp-new', 'Detour signs');
      await P_.click('#out-camp-add');
      await t.until(async () => (await t.sql(`select count(*)::int n from pi_outreach_campaigns where name='Detour signs'`))[0].n === 1, 'campaign added');
      await P_.fill('#out-camp-name-' + c2.id, 'fall CLOSURES');
      await P_.evaluate((id) => outRenameCampaign(String(id)), c2.id);
      t.ok((await P_.evaluate(() => window._toasts)).some((m) => /already has a campaign/.test(m)), 'a duplicate name (any capitals) is refused');
      await P_.fill('#out-camp-name-' + c2.id, 'Spring open house');
      await P_.evaluate((id) => outRenameCampaign(String(id)), c2.id);
      await t.until(async () => (await t.sql(`select name from pi_outreach_campaigns where id=$1`, [c2.id]))[0].name === 'Spring open house', 'renamed');
      await P_.evaluate((id) => outDelCampaign(String(id)), c1.id);
      await t.until(async () => (await t.sql(`select count(*)::int n from pi_outreach_campaigns where id=$1`, [c1.id]))[0].n === 0, 'deleted');
      const left = await t.sql(`select count(*)::int n, count(campaign_id)::int c from pi_outreach_actions where id in ($1,$2)`, [inA.id, inB.id]);
      t.eq(left[0], { n: 2, c: 0 }, 'its actions stay in the log, without a campaign');
      t.ok(await P_.evaluate((id) => !DB.get('outreach_actions').some((a) => String(a.campaignId) === String(id)), c1.id), 'and the app no longer points them at it');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
