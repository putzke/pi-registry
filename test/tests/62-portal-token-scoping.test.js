// Portal token links are scoped to the link the visitor ACTUALLY HOLDS
// (sql/2026-10-05_portal_token_scoping.sql).
//
// Before it, every anon policy asked "does this project have SOME portal
// link?", so the public anon key alone could read any linked project by
// guessing its (small, sequential) id. Now pi_portal_project_ids() returns
// only the project of the token the request carries in x-portal-token, read
// from PostgREST's / Storage's `request.headers` setting.
//
// Two halves, because each alone proves nothing:
//   - the DATABASE, role-switched to anon on a raw connection (the REST shim
//     runs as postgres and bypasses RLS, same reason as test 47): the right
//     token sees its project and nothing else; none, someone else's, a
//     malformed or a revoked token see nothing; staff are untouched;
//   - the PAGE: client-portal.html sends its token on every REST and Storage
//     request in token mode — without that the fix would just blank the portal.
//
// What this cannot prove: that hosted Supabase forwards the header into
// request.headers, and that CORS lets the browser send it. That is what
// sql/probes/2026-10-05_portal_header_probe.sql checks, live.
module.exports = {
  name: 'portal token scoping — a token link reads only its own project',
  async run({ t, db }) {
    const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query(`insert into pi_projects (id, name) overriding system value values (901,'Project A'), (902,'Project B'), (903,'Project C, no link')`);
      await client.query(`insert into pi_portal_links (token, project_id) values ($1, 901), ($2, 902)`, [A, B]);
      await client.query(`insert into pi_deliverables (project_id, title) values ('901','A del'), ('902','B del'), ('903','C del')`);
      await client.query(`insert into pi_interactions (project_id, summary) values ('901','A int'), ('902','B int')`);
      await client.query(`insert into pi_parcels (project_id, parcel_number) values ('901','A-1'), ('902','B-1')`);
      await client.query(`insert into pi_report_archive (project_id, client_visible, report_title, docx_path)
                          values (901, true, 'A shared', '901/a.docx'), (902, true, 'B shared', '902/b.docx')`);
      const ra = await client.query(`select id, project_id from pi_report_archive where project_id in (901,902) order by project_id`);
      for (const row of ra.rows) {
        await client.query(`insert into storage.objects (bucket_id, name) values ('report-files', $1)`, [row.project_id + '/' + row.id + '.docx']);
      }

      const as = async (headers) => {
        await client.query('set role anon');
        await client.query(`select set_config('request.headers', $1, true)`, [headers]);
        const q = async sql => (await client.query(sql)).rows;
        const out = {
          ids: (await q(`select project_id from pi_portal_project_ids() order by 1`)).map(r => r.project_id),
          projects: (await q(`select id from pi_projects where id between 901 and 903 order by id`)).map(r => Number(r.id)),
          deliverables: (await q(`select title from pi_deliverables where project_id in ('901','902','903') order by title`)).map(r => r.title),
          interactions: (await q(`select summary from pi_interactions where project_id in ('901','902') order by summary`)).map(r => r.summary),
          parcels: (await q(`select parcel_number from pi_parcels where project_id in ('901','902') order by 1`)).map(r => r.parcel_number),
          reports: (await q(`select report_title from pi_report_archive where project_id in (901,902) order by 1`)).map(r => r.report_title),
          files: (await q(`select split_part(name,'/',1) p from storage.objects where bucket_id='report-files' and name like '90%' order by 1`)).map(r => r.p),
        };
        await client.query('reset role');
        return out;
      };
      const none = { ids: [], projects: [], deliverables: [], interactions: [], parcels: [], reports: [], files: [] };

      // ── the right token ─────────────────────────────────────────────────
      const a = await as(JSON.stringify({ 'x-portal-token': A }));
      t.eq(a, { ids: ['901'], projects: [901], deliverables: ['A del'], interactions: ['A int'], parcels: ['A-1'], reports: ['A shared'], files: ['901'] },
        'token A sees project A in every portal table and its report file — and nothing of B');
      const b = await as(JSON.stringify({ 'x-portal-token': B }));
      t.eq([b.projects, b.deliverables, b.files], [[902], ['B del'], ['902']], 'token B sees project B only');

      // ── the gap this closes: no token, or not one of ours ───────────────
      t.eq(await as('{}'), none, 'NO token: nothing at all (before the fix: every linked project)');
      t.eq(await as(''), none, 'request.headers unset (the SQL Editor, a script): nothing, and no error');
      t.eq(await as(JSON.stringify({ 'x-portal-token': 'cccccccc-3333-4333-8333-cccccccccccc' })), none, 'an unknown token: nothing');
      t.eq(await as(JSON.stringify({ 'x-portal-token': "not-a-uuid'; select 1; --" })), none, 'a malformed token: nothing, never a cast error');
      t.eq(await as(JSON.stringify({ 'x-portal-token': '901' })), none, 'a project id in place of a token: nothing');
      t.eq((await as(JSON.stringify({ 'x-portal-token': ' ' + A.toUpperCase() + ' ' }))).projects, [901], 'case and stray spaces in a real token are tolerated');
      t.eq((await as(JSON.stringify({ 'X-Portal-Token': A }))).projects, [], 'header names arrive lower-cased from PostgREST; only that spelling is read');

      // ── a revoked link stops working on the very next request ───────────
      await client.query(`delete from pi_portal_links where token = $1`, [A]);
      t.eq(await as(JSON.stringify({ 'x-portal-token': A })), none, 'a revoked token: nothing');

      // ── staff are untouched ─────────────────────────────────────────────
      await client.query('set role authenticated');
      await client.query(`select set_config('request.jwt.claims', '{"email":"staff@sunrise.example"}', true)`);
      await client.query(`select set_config('request.headers', '{}', true)`);
      const staff = (await client.query(`select id from pi_projects where id between 901 and 903 order by id`)).rows.map(r => Number(r.id));
      t.eq(staff, [901, 902, 903], 'staff (signed in, no token) still see every project');
      await client.query('reset role');
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
    }

    // ── the page sends its token on every request ───────────────────────
    t.seed();
    const [sr] = await t.sql(`select id from pi_projects where pid='25-154-001'`);
    const [tok] = await t.sql(`select token from pi_portal_links where project_id::text=$1`, [String(sr.id)]);
    const app = await t.open('client-portal.html', { portalToken: tok.token });
    try {
      await app.page.waitForSelector('.nepa-banner', { timeout: 15000 });
      const seen = [];
      app.page.on('request', r => {
        const u = r.url();
        if (/\/(rest|storage)\/v1\//.test(u)) seen.push({ u: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 60), tok: r.headers()['x-portal-token'] || null });
      });
      await app.page.evaluate(async t0 => {
        window.alert = () => {};
        await bootFromToken(t0);
        _sharedReports.push({ id: 'zz', docx_path: '1/zz.docx', report_title: 'x' });
        await downloadSharedReportDocx('zz');
      }, tok.token);
      await app.page.waitForTimeout(300);
      t.ok(seen.length >= 5, 'the boot and a report download made REST and Storage requests: ' + seen.length);
      t.ok(seen.some(s => /storage\/v1\/object\/sign/.test(s.u)), 'including the report-download signing request');
      t.eq(seen.filter(s => s.tok !== tok.token).map(s => s.u), [], 'every one of them carries this link’s token');
      t.eq(app.errors, [], 'no page errors');
    } finally {
      await app.close();
    }

    // ── signed-in clients don't send one (their access comes from the login) ──
    const app2 = await t.open('client-portal.html', { email: 'demo@horizoncompass.com' });
    try {
      t.eq(await app2.page.evaluate(() => [_tokenMode, _portalToken, 'x-portal-token' in anonHdrs()]), [false, null, false],
        'login mode: no token is held or sent');
    } finally {
      await app2.close();
    }
  },
};
