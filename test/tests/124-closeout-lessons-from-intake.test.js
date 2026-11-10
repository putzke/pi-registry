// Close-out: lessons typed in the intake print in the report (Nov 2026, Jeff).
// They showed only as "Your pointers" beside an empty Lessons box, and the
// section read "Left out". Now an empty report box prints the intake's lessons;
// a box with text replaces them.
module.exports = {
  name: 'close-out lessons learned — the intake\'s lessons print unless the report box replaces them',
  async run({ t }) {
    t.seed();
    const projId = String((await t.sql(`select id from pi_projects where pid='25-LC-400N'`))[0].id);
    const intake = { scmName: 'A Person, Manager', sigName: 'J P',
      lessons: 'Notify UHP: follow digital notices with phone calls.\nPublish closures early in the week.' };
    const id = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by)
      values (${projId}, 'Final', $1::jsonb, 'putzke@demo.test') returning id`, [JSON.stringify(intake)]))[0].id);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const page = app.page;
      await page.evaluate(([pid, cid]) => { S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports'); openCloseoutReport(cid); }, [projId, id]);
      const doc = () => page.evaluate(cid => { const d = _coReportDoc(_syncCache.closeouts.find(c => c.id === cid));
        return { text: JSON.stringify(d.blocks), sec: d.sections.find(s => s.id === 'lessons') }; }, id);
      let d = await doc();
      t.eq(d.sec.state, 'in', 'with the report box empty, Lessons is in the report');
      t.ok(/Notify UHP/.test(d.text) && /Publish closures early/.test(d.text), 'the intake\'s lessons print');
      t.ok(/Notify UHP/.test(await page.evaluate(() => document.getElementById('co-preview').textContent)), 'and show in the preview');
      t.ok(await page.evaluate(() => /prints your lessons from the intake/.test(document.body.textContent)), 'the editor says where they come from');
      t.ok(await page.evaluate(() => _coLetterContents(_syncCache.closeouts.find(c => c.id === _coWork.id)).includes('lessons learned and recommendations')), 'the cover letter knows the report has lessons');
      await page.evaluate(() => { const ta = document.getElementById('co-dr-lessons'); ta.value = 'Rewritten lesson in the report.'; _coSet(ta); });
      d = await doc();
      t.ok(/Rewritten lesson/.test(d.text) && !/Notify UHP/.test(d.text), 'text in the report box replaces the intake\'s');
      await page.evaluate(() => { _coWork.intake.lessons = ''; const ta = document.getElementById('co-dr-lessons'); ta.value = ''; _coSet(ta); });
      d = await doc();
      t.eq(d.sec.state, 'out', 'with neither, the section is left out');
    } finally { await app.close(); }
  },
};
