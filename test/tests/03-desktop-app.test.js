// Drives the real index.html against the real seed and asserts on Postgres.
//
// This is the capability the harness exists for: a UI action, then a query
// proving it landed in the database. Everything before this could only be
// checked by hand against the live Supabase project.
module.exports = {
  name: 'desktop app — boots, renders, and writes through to the database',
  async run({ t, shim }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // ── boot ────────────────────────────────────────────────────────────
      const boot = await app.page.evaluate(() => ({
        projects: _syncCache.projects.length,
        interactions: _syncCache.interactions.length,
        stakeholders: _syncCache.stakeholders.length,
        me: getLoggedBy(),
      }));
      t.eq(boot.projects, 3, 'all three demo projects loaded');
      t.eq(boot.stakeholders, 63, 'all stakeholders loaded');
      t.gt(boot.interactions, 500, 'interactions loaded');
      t.eq(boot.me, 'PUT', 'getLoggedBy() derives initials from the login email');

      // ── every nav view renders without throwing ─────────────────────────
      const views = ['dashboard', 'projects', 'master', 'stakeholders', 'interactions',
                     'followups', 'commitments', 'comments', 'deliverables', 'meetings',
                     'issues', 'reports', 'settings'];
      for (const v of views) {
        const r = await app.page.evaluate(view => {
          try { setView(view); return { ok: true, html: document.getElementById('main').innerHTML.length }; }
          catch (e) { return { ok: false, err: e.message }; }
        }, v);
        t.ok(r.ok && r.html > 200, `view "${v}" renders` + (r.ok ? '' : ' — ' + r.err));
      }

      // ── Settings must be scrollable (it shipped without a container) ────
      await app.page.evaluate(() => setView('settings'));
      await app.page.waitForTimeout(100);
      const scroll = await app.page.evaluate(() => {
        const c = document.querySelector('#main .content');
        if (!c) return null;
        return { overflow: getComputedStyle(c).overflowY,
                 scrollable: c.scrollHeight > c.clientHeight,
                 gutter: c.offsetWidth - c.clientWidth };
      });
      t.ok(scroll, 'settings has a scroll container');
      t.eq(scroll && scroll.overflow, 'auto', 'settings scrolls');
      t.gt(scroll ? scroll.gutter : 0, 10, 'scrollbar reserves visible width');

      // ── write-through: reassign a follow-up, then check Postgres ────────
      const target = (await t.sql(
        `select id, logged_by from pi_interactions
          where follow_up and not coalesce(follow_up_done,false)
            and follow_up_assigned_to is null order by id limit 1`))[0];
      t.ok(target, 'found an unassigned open follow-up to reassign');
      if (target) {
        await app.page.evaluate(id => assignFollowUp(id, 'SHA'), String(target.id));
        await app.page.waitForFunction(
          id => (_syncCache.interactions.find(i => String(i.id) === id) || {}).followUpAssignedTo === 'SHA',
          String(target.id), { timeout: 5000 });
        const fu = q => t.sql(
          'select follow_up_assigned_to a, follow_up_done d, follow_up_resolved rd '
          + 'from pi_interactions where id::text=$1', [String(target.id)]).then(r => r[0]);
        t.ok(await t.until(async () => (await fu()).a === 'SHA'),
             'reassignment persisted to the database');
        const patched = shim.calls.some(c => c.method === 'PATCH' && /pi_interactions/.test(c.url) && c.status < 400);
        t.ok(patched, 'it went through a real PATCH, not just the local cache');

        // ── resolve / reopen, including the stale-date fix ────────────────
        await app.page.evaluate(id => resolveFollowUp(id), String(target.id));
        let r = await t.until(async () => { const x = await fu(); return x.d === true ? x : null; });
        t.ok(r, 'resolve persisted');
        t.ok(r && r.rd, 'resolve stamped a resolution date');

        await app.page.evaluate(id => reopenFollowUp(id), String(target.id));
        r = await t.until(async () => { const x = await fu(); return x.d === false ? x : null; });
        t.ok(r, 'reopen persisted');
        t.eq(r && r.rd, null, 'reopen cleared the stale resolution date');
      }

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
