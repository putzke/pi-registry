// Reported on DEV (Oct 2026): in the PI Report Editor, section 1 read "Planned
// PI activities" but behaved as the auto-populated concerns section, and
// section 3 read "Recent public concerns and inquiries" as a manual section.
// The titles had been saved onto the wrong sections.
//
// loadReportSections() always moves "Recent public concerns" to the top — but
// only after it has written its copy to localStorage. A draft where concerns
// had been moved down (▼) was therefore DRAWN with concerns first while the
// copy captureFormState() saved from still had it lower, and the inputs were
// matched to sections by position: every title, narrative and table setting
// landed on the wrong section on the next save.
module.exports = {
  name: 'PI report editor — titles and text stay on their own sections',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async (pid) => {
        S.projectFilter = DB.get('projects').find(p => String(p.id) === pid).id;
        const projF = S.projectFilter;
        // A saved draft where concerns was moved to the bottom (as ▼ did).
        const sections = [
          { id: 'planned', title: 'Planned PI activities', type: 'manual', content: 'PLANNED TEXT' },
          { id: 'actions', title: 'Recent PI action items', type: 'manual', content: 'ACTION TEXT' },
          { id: 'concerns', title: 'Recent public concerns and inquiries', type: 'auto-concerns', summary: 'CONCERNS NARRATIVE', showTable: true },
        ];
        _syncCache.reports = [{ id: 999, projectId: projF, reportNum: '1', reportTitle: 'PI Update', sections: JSON.parse(JSON.stringify(sections)) }];
        localStorage.removeItem('pir4_pi_reports_' + projF);
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
        const shown = [...document.querySelectorAll('.rpt-sec-title')].map(i => i.value);
        const saved = captureFormState();
        const byId = {}; saved.sections.forEach(s => byId[s.id] = s);
        // ▼ on concerns (now first) must not be offered, and a forced move is refused
        const downOnFirst = !!document.querySelector('[onclick="movePISection(0,1)"]');
        movePISection(0, 1);
        const after = captureFormState().sections.map(s => s.id);
        return { shown, byId, downOnFirst, after };
      }, String(proj.id));
      t.eq(r.shown[0], 'Recent public concerns and inquiries', 'concerns is drawn first');
      t.eq(r.byId.concerns.title, 'Recent public concerns and inquiries', 'the concerns section keeps its own title');
      t.eq(r.byId.concerns.type, 'auto-concerns', '…and its type');
      t.eq(r.byId.concerns.summary, 'CONCERNS NARRATIVE', '…and its narrative');
      t.ok(r.byId.concerns.showTable === true, '…and its table setting');
      t.eq(r.byId.planned.title, 'Planned PI activities', 'Planned keeps its title');
      t.eq(r.byId.planned.content, 'PLANNED TEXT', 'Planned keeps its text');
      t.eq(r.byId.actions.title, 'Recent PI action items', 'Action items keeps its title');
      t.ok(!r.downOnFirst, 'no ▼ on the concerns section (it always comes first)');
      t.eq(r.after[0], 'concerns', 'a forced move of concerns is refused');
    } finally { await app.close(); }
  }
};
