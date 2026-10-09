// The dashboard follows My projects | All (Oct 2026).
//
// Every figure is computed from the projects in scope — "All" = Active and
// On hold, "My projects" = those I lead — and the project cards sit right
// under the figures, with the toggle in the topbar.
module.exports = {
  name: 'dashboard figures follow My projects | All',
  async run({ t }) {
    t.seed();
    const projs = await t.sql(`select id::text id, status from pi_projects where status in ('Active','On hold') order by id`);
    t.ok(projs.length >= 2, 'seed has several active / on-hold projects');
    const A = projs[0].id;
    await t.sql(`insert into pi_team_members (name, initials, email, active) values ('Test Lead', 'PUT', 'putzke@demo.test', true)`);
    await t.sql(`update pi_projects set lead = case when id::text = $1 then 'PUT' else null end`, [A]);
    const ids = projs.map(p => p.id);
    const count = async (q, list) => Number((await t.sql(q, [list]))[0].n);
    const expect = async list => ({
      proj: projs.filter(p => list.includes(p.id) && p.status === 'Active').length,
      ints: await count(`select count(*) n from pi_interactions where project_id::text = any($1)`, list),
      comm: await count(`select count(*) n from pi_commitments where project_id::text = any($1) and status in ('Open','Overdue')`, list),
      stakes: await count(`select count(distinct ps.stakeholder_id) n from pi_project_stakeholders ps join pi_stakeholders s on s.id::text = ps.stakeholder_id where ps.project_id::text = any($1) and not coalesce(s.is_archived,false)`, list),
    });

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const read = async scope => {
        await app.page.evaluate(sc => { localStorage.setItem('cc_proj_scope', sc); S.view = 'dashboard'; render(); }, scope);
        await app.page.waitForTimeout(1300);   // the count-up animation
        return app.page.evaluate(() => {
          const n = id => Number((document.getElementById(id) || {}).textContent);
          const cards = [...document.querySelectorAll('#dash-proj-cards > div[onclick]')].map(d => d.getAttribute('onclick').match(/filterByProject\('([^']+)'\)/)[1]);
          return { proj: n('sv-proj'), ints: n('sv-ints'), comm: n('sv-comm'), stakes: n('sv-stakes'), cards };
        });
      };

      const mine = await read('mine'), mineExp = await expect([A]);
      t.eq(mine.cards, [A], 'My projects: only the project I lead');
      t.eq([mine.proj, mine.ints, mine.comm, mine.stakes], [mineExp.proj, mineExp.ints, mineExp.comm, mineExp.stakes], 'My projects: projects, interactions, open commitments and stakeholders count that project only');

      const all = await read('all'), allExp = await expect(ids);
      t.eq(all.cards.sort(), ids.slice().sort(), 'All: every active and on-hold project has a card');
      t.eq([all.proj, all.ints, all.comm, all.stakes], [allExp.proj, allExp.ints, allExp.comm, allExp.stakes], 'All: the figures cover every active and on-hold project');
      t.ok(all.ints > mine.ints, 'the two scopes really differ');

      const layout = await app.page.evaluate(() => ({
        next: (document.querySelector('.stat-row').nextElementSibling || {}).innerHTML || '',
        topbar: !!document.querySelector('.topbar .proj-scope'),
      }));
      t.ok(layout.next.includes('dash-proj-cards'), 'the project cards sit directly under the figures');
      t.ok(layout.topbar, 'the My projects | All toggle is in the dashboard topbar');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  }
};
