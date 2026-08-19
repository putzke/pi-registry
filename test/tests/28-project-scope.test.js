// The project you pick has to follow you between views.
//
// S.projectFilter is the shared scope, written by the project select on
// interactions, follow-ups, deliverables, reports, meetings, commitments and
// parcels. Issues and Comments kept their OWN — S.issViewProj and S.cmtProj —
// and setView() cleared both on every navigation. So scoping Interactions to
// 3600 West and clicking Issues landed you on "All projects", with no way to
// tell the app you had already answered that question.
//
// Comments was subtler: it read `S.cmtProj || S.projectFilter`, so it filtered
// correctly while its select still displayed "All projects" — the list and the
// control disagreed on the same screen.
module.exports = {
  name: 'project scope — the selected project follows you between views',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(
        `select id, pid from pi_projects where pid='25-154-001'`))[0];
      t.ok(proj, 'found a demo project to scope to');
      const counts = (await t.sql(`
        select (select count(*) from pi_issues where project_id::text=$1)::int iss,
               (select count(*) from pi_issues)::int iss_all,
               (select count(*) from pi_public_comments where project_id::text=$1)::int cmt,
               (select count(*) from pi_public_comments)::int cmt_all`,
        [String(proj.id)]))[0];
      t.gt(counts.iss, 0, 'the project has issues');
      t.gt(counts.iss_all, counts.iss, 'and other projects have issues too');

      // Every list view with a project select must honour the shared scope.
      const SCOPED = ['interactions', 'followups', 'commitments', 'deliverables',
                      'meetings', 'issues', 'comments', 'parcels', 'reports'];

      const scope = await app.page.evaluate(([pid, views]) => {
        S.projectFilter = pid;
        setView('interactions');                 // pick the project here…
        const out = {};
        for (const v of views) {
          setView(v);                            // …then walk the app
          out[v] = S.projectFilter;
        }
        return out;
      }, [String(proj.id), SCOPED]);

      SCOPED.forEach(v => t.eq(scope[v], String(proj.id),
        `${v} still has the project selected after navigating to it`));

      // The select has to SHOW it, not just filter by it. Comments filtered
      // correctly while displaying "All projects", which is arguably worse than
      // not filtering — it tells you you are looking at everything.
      for (const v of ['issues', 'comments']) {
        const sel = await app.page.evaluate(([view, pid]) => {
          S.projectFilter = pid; setView(view);
          const s = [...document.querySelectorAll('#main select')]
            .find(x => /All projects/.test(x.innerHTML));
          return s ? { value: s.value, label: s.options[s.selectedIndex].text } : null;
        }, [v, String(proj.id)]);
        t.ok(sel, `${v} renders a project select`);
        t.eq(sel && sel.value, String(proj.id),
             `${v}'s select shows the scoped project, not "All projects"`);
        t.ok(sel && sel.label.includes(proj.pid),
             `${v}'s select names it (${proj.pid})`);
      }

      // And the list is genuinely narrowed, not merely labelled.
      const shown = await app.page.evaluate(pid => {
        S.projectFilter = pid; setView('issues');
        const rows = document.querySelectorAll('#main .lrow, #main .iss-row').length;
        S.projectFilter = ''; setView('issues');
        const all = document.querySelectorAll('#main .lrow, #main .iss-row').length;
        return { rows, all };
      }, String(proj.id));
      t.gt(shown.all, shown.rows, 'scoping issues really does show fewer than all projects');

      // Choosing a project INSIDE Issues must scope everything else too —
      // otherwise the carry-over only works in one direction.
      const outward = await app.page.evaluate(([pid, views]) => {
        S.projectFilter = ''; setView('issues');
        const sel = [...document.querySelectorAll('#main select')]
          .find(x => /All projects/.test(x.innerHTML));
        sel.value = pid; sel.dispatchEvent(new Event('change'));
        const out = { afterPick: S.projectFilter };
        for (const v of views) { setView(v); out[v] = S.projectFilter; }
        return out;
      }, [String(proj.id), ['interactions', 'commitments', 'parcels']]);
      t.eq(outward.afterPick, String(proj.id), 'picking a project in Issues sets the shared scope');
      ['interactions', 'commitments', 'parcels'].forEach(v =>
        t.eq(outward[v], String(proj.id), `and ${v} inherits it`));

      // "All projects" must still be reachable — a shared scope is no good if
      // one view can never widen it again.
      const cleared = await app.page.evaluate(() => {
        setView('issues');
        const sel = [...document.querySelectorAll('#main select')]
          .find(x => /All projects/.test(x.innerHTML));
        sel.value = ''; sel.dispatchEvent(new Event('change'));
        const here = S.projectFilter;
        setView('interactions');
        return { here, there: S.projectFilter };
      });
      t.eq(cleared.here, '', 'selecting All projects in Issues clears the scope');
      t.eq(cleared.there, '', 'and it stays cleared elsewhere');

      // The two private filters are gone, not merely bypassed — a leftover
      // reference would silently reintroduce the split.
      const src = await app.page.evaluate(() => ({
        iss: typeof S.issViewProj, cmt: typeof S.cmtProj,
      }));
      t.eq(src.iss, 'undefined', 'S.issViewProj no longer exists');
      t.eq(src.cmt, 'undefined', 'S.cmtProj no longer exists');

      // Master is the cross-project list by definition and must NOT be scoped.
      const master = await app.page.evaluate(pid => {
        S.projectFilter = pid; setView('master');
        return document.querySelectorAll('#main .lrow').length;
      }, String(proj.id));
      t.gt(master, counts.iss, 'the master list still shows every contact');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
