// "Project website updates" (Oct 2026, Jeff): the website address and what its
// analytics counts live on the project; a report types the count to date and
// the changes made; "this period" is worked out from the last archived
// report's count, which archiving keeps on the project. A default section only
// for a project with a website; removable and addable. Website updates are no
// longer an Outreach type.
module.exports = {
  name: 'PI report — Project website updates section on every surface',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const other = (await t.sql(`select id from pi_projects where pid<>'25-154-001' order by id limit 1`))[0];
    await t.sql(`delete from pi_reports where project_id=$1`, [proj.id]);
    await t.sql(`insert into pi_reports (project_id, report_num, report_title, period_start, period_end, sections)
      values ($1,'1','PI','2030-02-01','2030-02-14',$2::jsonb)`, [proj.id, JSON.stringify([
        { id: 'concerns', title: 'Recent public concerns and inquiries', type: 'auto-concerns' },
        { id: 'actions', title: 'Recent PI action items', type: 'manual', content: '' }])]);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async ([pid, oid]) => {
        const P = () => DB.get('projects').find(p => String(p.id) === pid);
        const projF = P().id;
        const noWebDefault = getDefaultSections(oid).some(s => s.type === 'auto-website');
        const offered = getAvailableSections().some(s => s.type === 'auto-website');
        const outreachType = OUTREACH_TYPES.indexOf('Website update') >= 0;

        // Edit project: address + label; the existing draft gains the section.
        openProjModal(projF);
        document.getElementById('f-pid').value = '15401';
        document.getElementById('f-pweb').value = 'udotinput.utah.gov/sr154';
        document.getElementById('f-pwebl').value = 'Page views';
        await saveProj();
        await new Promise(res => setTimeout(res, 300));
        const draftHas = (DB.get('reports') || []).find(x => String(x.projectId) === String(projF)).sections.some(s => s.type === 'auto-website');
        const withDefault = getDefaultSections(projF).some(s => s.type === 'auto-website');

        // Two earlier counts, as two archived reports would have left them.
        const rds = [{ date: '2030-01-15', visits: 700 }, { date: '2030-01-31', visits: 1000 }];
        await sbUpdate('projects', projF, { websiteReadings: rds }); _syncCache.projects.find(p => String(p.id) === pid).websiteReadings = rds;

        S.projectFilter = projF; S.view = 'reports'; S.rptTab = 'pi-editor';
        localStorage.removeItem('pir4_pi_reports_' + projF);
        await openPIReport();
        const urlBox = document.querySelector('.rpt-sec-weburl').value;
        document.getElementById('rpt-pend').value = '2030-02-14';
        document.querySelector('.rpt-sec-webvisits').value = '1,450';
        const webIdx = document.querySelector('.rpt-sec-webvisits').getAttribute('data-idx');
        document.querySelector('.rpt-sec-content[data-idx="' + webIdx + '"]').value = 'Posted DETOURMAP for 400 North\nAdded the FAQ page';
        renderLivePreview();
        const delta = document.getElementById('rpt-web-delta-' + webIdx).textContent;
        const pane = document.getElementById('rpt-live-preview').innerHTML;
        const facts = _buildSectionDraft('auto-website') || '';

        const saved = captureFormState();
        localStorage.setItem('pir4_pi_reports_' + projF, JSON.stringify(saved));
        const snap = _buildReportSnapshot(projF, saved);
        const snapSec = snap.sections.find(s => s.type === 'auto-website') || {};
        const real = URL.createObjectURL.bind(URL); let blob = null;
        URL.createObjectURL = x => { blob = x; return real(x); };
        await exportPIDocx();
        for (let i = 0; i < 100 && !blob; i++) await new Promise(res => setTimeout(res, 100));
        URL.createObjectURL = real;
        const doc = blob ? await (await JSZip.loadAsync(blob)).file('word/document.xml').async('string') : '';
        const archived = await _archiveReport(projF);
        const co = _coWithProjWeb({ projectId: projF, label: 'Final', intake: {} }, {});
        return { noWebDefault, offered, outreachType, draftHas, withDefault, urlBox, delta, pane, facts,
          snapHtml: snapSec.tableHtml || '', glance: snap.atGlanceHtml || '', doc, archived,
          coUrl: co.websiteUrl, coVisits: (co.visits || []).map(v => v.visits).join(',') };
      }, [String(proj.id), String(other.id)]);

      const row = (await t.sql(`select website_url, website_label, website_readings from pi_projects where id=$1`, [proj.id]))[0];
      t.ok(!r.noWebDefault, 'no website on the project → not a default section');
      t.ok(r.offered, 'offered under Add sections');
      t.ok(!r.outreachType, '"Website update" is no longer an Outreach type');
      t.eq(row.website_url, 'https://udotinput.utah.gov/sr154', 'Edit project saves the address (https added)');
      t.eq(row.website_label, 'Page views', 'and what the analytics counts');
      t.ok(r.draftHas, 'entering a website adds the section to the existing draft');
      t.ok(r.withDefault, 'a new draft gets it by default once the project has a website');
      t.eq(r.urlBox, 'https://udotinput.utah.gov/sr154', 'the section fills the address from the project');
      t.ok(/1,000 as of 01\/31\/2030 → 450 this period \(last period: 300\)/.test(r.delta), 'editor works out this period and last period: ' + r.delta);
      t.ok(/udotinput\.utah\.gov\/sr154/.test(r.pane) && /Page views this period/.test(r.pane) && />450</.test(r.pane) && />1,450</.test(r.pane) && /DETOURMAP/.test(r.pane), 'preview prints address, visits and the changes');
      t.ok(!/%/.test(r.pane.match(/Page views[\s\S]*?<\/table>/)[0]), 'no percentage');
      t.ok(/Page views during .*: 450/.test(r.facts) && /DETOURMAP/.test(r.facts) && !/udotinput/.test(r.facts), 'AI facts: counts and changes, never the address');
      t.ok(/DETOURMAP/.test(r.snapHtml) && /1,450/.test(r.snapHtml), 'frozen snapshot carries the block (archive + portal)');
      t.ok(/Page views/.test(r.glance) && />450</.test(r.glance), 'Report at a glance shows the visits');
      t.ok(/Project website: /.test(r.doc) && /udotinput\.utah\.gov\/sr154/.test(r.doc) && /Page views this period: 450/.test(r.doc) && /DETOURMAP/.test(r.doc), '.docx prints the section');
      t.ok(r.archived, 'archived');
      t.ok((row.website_readings || []).some(x => x.date === '2030-02-14' && Number(x.visits) === 1450), 'archiving keeps the count on the project');
      t.eq(r.coUrl, 'https://udotinput.utah.gov/sr154', 'close-out uses the project website when the intake has none');
      t.eq(r.coVisits, '700,1000,1450', 'and the counts from archived reports');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
