// Close-out counts external stakeholders and the public only, like the PI
// reports and quick reports; an intake box adds the internal team back
// (Nov 2026, Jeff). Seen live on SR-201: the package said 43 interactions,
// the close-out 56 — the 13 extra were contacts marked Internal.
module.exports = {
  name: 'close-out counts — external & public by default, "Include internal" adds the team',
  async run({ t }) {
    t.seed();
    const P = String((await t.sql(`select id from pi_projects where pid='25-LC-400N'`))[0].id);
    const EXT = ` and (stakeholder_id is null or exists (select 1 from pi_project_stakeholders l where l.project_id=x.project_id and l.stakeholder_id=x.stakeholder_id and coalesce(nullif(l.stakeholder_role,''),'External')='External'))`;
    const n = async (q) => (await t.sql(q, [P]))[0].n;
    const all = await n(`select count(*)::int n from pi_interactions x where project_id=$1`);
    const ext = await n(`select count(*)::int n from pi_interactions x where project_id=$1` + EXT);
    const anon = await n(`select count(*)::int n from pi_interactions x where project_id=$1 and stakeholder_id is null`);
    const extLinks = await n(`select count(*)::int n from pi_project_stakeholders where project_id=$1 and coalesce(nullif(stakeholder_role,''),'External')='External'`);
    const allLinks = await n(`select count(*)::int n from pi_project_stakeholders where project_id=$1`);
    t.ok(all > ext && anon > 0, 'the seed has internal contacts and anonymous callers on the project (' + all + ' / ' + ext + ' / ' + anon + ')');
    const id = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by) values ($1, 'Final', '{}'::jsonb, 'putzke@demo.test') returning id`, [P]))[0].id);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const page = app.page;
      await page.evaluate(([pid, cid]) => { S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports'); openCloseoutIntake(cid); }, [P, id]);
      const facts = () => page.evaluate(() => { const co = _syncCache.closeouts.find(c => c.id === _coWork.id); const f = _coFactsFor(co);
        const fig = _coFigures(co, _coWork.intake); const tot = fig.blocks.find(b => b.t === 'table' && b.cols[0].h === 'Channel');
        return { ints: f.interactions, stakes: f.stakeholders, chTotal: tot ? tot.rows[tot.rows.length - 1][3][0].text.replace(/,/g, '') : null,
          commlog: (_coCommlogFacts(co) || { counts: [] }).counts.join('\n') }; });
      let f = await facts();
      t.eq(f.ints, ext, 'by default the close-out counts external & public interactions (anonymous callers included)');
      t.eq(String(f.chTotal), String(ext), 'the channel table counts the same');
      t.eq(f.stakes, extLinks, 'stakeholders in registry = external contacts');
      t.ok(f.commlog.includes('Total logged contacts: ' + ext + '.'), 'the log summary\'s facts count the same');
      t.ok(await page.evaluate(() => !!document.getElementById('co-f-incInternal') && !document.getElementById('co-f-incInternal').checked), 'the intake has the box, unticked');
      await page.evaluate(() => { const el = document.getElementById('co-f-incInternal'); el.checked = true; coSetIncInternal(el); });
      f = await facts();
      t.eq(f.ints, all, 'ticked, internal contacts are counted too');
      t.eq(f.stakes, allLinks, 'and every linked contact');
      const foot = await page.evaluate(() => JSON.stringify(_coReportDoc(_syncCache.closeouts.find(c => c.id === _coWork.id)).blocks));
      t.ok(/include the internal project team/.test(foot), 'the report says so under the Glance table');
      await page.evaluate(() => _coSave());
      await page.waitForTimeout(300);
      t.eq((await t.sql(`select intake->>'includeInternal' v from pi_closeouts where id=$1`, [id]))[0].v, 'true', 'the choice is saved with the close-out');
    } finally { await app.close(); }
  },
};
