// The client portal, in both access modes, against real seeded data.
//
// Covers the four demo additions (NEPA banner, deliverable meters, 8-week
// engagement chart, commitments tile) and the Project Updates tab, which is the
// differentiator no competitor has.
module.exports = {
  name: 'client portal — token and login modes render the seeded project',
  async run({ t }) {
    t.seed();
    const [sr] = await t.sql(`select id from pi_projects where pid='25-154-001'`);
    const [tok] = await t.sql(`select token from pi_portal_links where project_id::text=$1`, [String(sr.id)]);
    t.ok(tok, 'the seed created a portal token');

    // ── token mode ──────────────────────────────────────────────────────
    let app = await t.open('client-portal.html', { portalToken: tok.token });
    try {
      await app.page.waitForSelector('.nepa-banner', { timeout: 15000 });
      const ov = await app.page.evaluate(() => {
        const tiles = [...document.querySelectorAll('.stat-tile')].map(x => ({
          num: (x.querySelector('.stat-num') || {}).textContent,
          lbl: (x.querySelector('.stat-lbl') || {}).textContent,
        }));
        const banner = document.querySelector('.nepa-banner');
        return {
          tiles,
          bannerClass: banner.className,
          bannerText: banner.textContent.replace(/\s+/g, ' ').trim(),
          meters: document.querySelectorAll('.tile-meter-fill').length,
          chart: !!document.querySelector('#trend-canvas, .svg-chart'),
          chartEmpty: !!document.querySelector('.chart-empty'),
        };
      });
      t.eq(ov.tiles.length, 5, 'five overview tiles (commitments tile present)');
      t.ok(/nepa-ea/.test(ov.bannerClass), 'EA project gets the amber EA banner');
      t.ok(/Environmental Assessment/.test(ov.bannerText), 'banner names the classification');
      t.eq(ov.meters, 1, 'deliverables tile has a progress meter');
      t.ok(ov.chart && !ov.chartEmpty, '8-week engagement chart rendered with data');
      t.ok(ov.tiles.some(x => /Commitments/.test(x.lbl || '')), 'commitments tile is labelled');

      // Deliverables tab health card
      await app.page.click('#nav-deliverables');
      await app.page.waitForTimeout(400);
      const del = await app.page.evaluate(() => ({
        health: !!document.querySelector('.del-health-fill'),
        pct: (document.querySelector('.del-health-num') || {}).textContent,
        banner: !!document.querySelector('.nepa-banner'),
      }));
      t.ok(del.health, 'deliverables tab shows the overall-progress bar');
      t.eq(del.pct, '71%', 'overall progress is 5 of 7');
      t.ok(del.banner, 'NEPA banner appears on this tab too');

      // Project Updates — shared reports + published trend
      await app.page.click('#nav-summary');
      await app.page.waitForTimeout(400);
      const sum = await app.page.evaluate(() => {
        document.querySelectorAll('[id^=rpt-body-]').forEach(b => b.style.display = 'block');
        const txt = document.querySelector('.content-inner, .content').textContent;
        return {
          hasStatus: /Project Status/.test(txt),
          hasHistory: /Previous Trend Updates/.test(txt),
          reportCards: document.querySelectorAll('[id^=rpt-body-]').length,
          tables: document.querySelectorAll('[id^=rpt-body-] table').length,
          distributed: /Distributed to/i.test(txt),
        };
      });
      t.ok(sum.hasStatus, 'current project status narrative renders');
      t.ok(sum.hasHistory, 'earlier trend appears as history');
      t.eq(sum.reportCards, 2, 'two shared reports on SR-154 (the third is held back)');
      t.gt(sum.tables, 0, 'frozen snapshot tables render in the portal');
      t.ok(sum.distributed, 'the frozen distribution list renders');

      t.eq(app.errors, [], 'no page errors in token mode');
    } finally { await app.close(); }

    // ── magic-link mode: the multi-project selector ─────────────────────
    app = await t.open('client-portal.html', { email: 'demo@horizoncompass.com' });
    try {
      await app.page.waitForSelector('.nepa-banner', { timeout: 15000 });
      const multi = await app.page.evaluate(() => {
        const sel = document.getElementById('sb-proj-select');
        return { options: sel ? sel.options.length : 0 };
      });
      t.eq(multi.options, 2, 'grant covering both projects shows a two-project selector');

      // Switch to whichever project is NOT currently selected, then assert the
      // banner matches that project's classification. Written this way so the
      // test doesn't depend on which project the selector defaults to.
      const cur = await app.page.evaluate(() => ({
        value: document.getElementById('sb-proj-select').value,
        cls: document.querySelector('.nepa-banner').className,
      }));
      const other = await app.page.evaluate(v =>
        [...document.getElementById('sb-proj-select').options].map(o => o.value).find(x => x !== v), cur.value);
      t.ok(other, 'there is a second project to switch to');

      await app.page.selectOption('#sb-proj-select', other);
      await app.page.waitForFunction(
        prev => { const b = document.querySelector('.nepa-banner'); return b && b.className !== prev; },
        cur.cls, { timeout: 15000 });
      const after = await app.page.evaluate(() => {
        const b = document.querySelector('.nepa-banner');
        return { cls: b.className, text: b.textContent.replace(/\s+/g, ' ').trim() };
      });

      const [expected] = await t.sql(
        'select nepa_classification c, nepa_stage s from pi_projects where id::text=$1', [String(other)]);
      const wantPost = /post-?nepa|construction/i.test(expected.s || '');
      t.ok(wantPost ? /nepa-post/.test(after.cls) : /nepa-(ea|eis|ce)/.test(after.cls),
           `switched project shows the right banner tone for ${expected.c} / ${expected.s}`);
      t.ok(after.text.length > 5, 'switched banner has label text');

      // ── Right-of-Way section ────────────────────────────────────────────
      // Coverage is what the agency client needs. Owner NAMES are deliberately
      // withheld: a token link is unauthenticated, anyone with the URL can read
      // it, and the owners are private individuals — so the client sees a COUNT.
      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      const pid = String(proj.id);
      const own = (await t.sql(
        `select s.id, s.last_name from pi_stakeholders s join pi_project_stakeholders l
           on l.stakeholder_id::text = s.id::text
          where l.project_id::text=$1 and s.last_name <> '' order by s.id limit 1`, [pid]))[0];
      const par = (await t.sql(
        `insert into pi_parcels (project_id,parcel_number,situs_address,status,notice_date,acquisition_type,notes)
         values ($1,'13-112-0009','9 Situs Way','Notice sent','2026-07-02','Partial take','internal working note')
         returning id`, [pid]))[0];
      await t.sql(
        `insert into pi_parcels (project_id,parcel_number,status) values ($1,'13-112-0010','Not started')`, [pid]);
      await t.sql(
        `insert into pi_parcel_owners (parcel_id,stakeholder_id,ownership_role) values ($1,$2,'Owner')`,
        [String(par.id), String(own.id)]);

      await app.page.evaluate(() => setView('parcels'));
      await app.page.waitForFunction(
        () => !/Loading/.test(document.getElementById('parc-content')?.innerHTML || 'Loading'),
        null, { timeout: 10000 });
      const rw = await app.page.evaluate(() => document.getElementById('parc-content').innerHTML);

      t.ok(/Right-of-Way coverage/.test(rw), 'the Right-of-Way section renders');
      t.ok(/13-112-0009/.test(rw) && /13-112-0010/.test(rw), 'both parcels are listed');
      t.ok(/1 owner/.test(rw), 'an owner count is shown');
      t.ok(/Not yet identified/.test(rw), 'and a parcel with no owner says so');
      t.eq(new RegExp(own.last_name).test(rw), false,
           'no owner NAME is exposed to the client');
      t.eq(/internal working note/.test(rw), false, 'internal parcel notes are withheld');
      t.ok(/Notice sent/.test(rw), 'status shows');

      t.eq(app.errors, [], 'no page errors in login mode');
    } finally { await app.close(); }
  },
};
