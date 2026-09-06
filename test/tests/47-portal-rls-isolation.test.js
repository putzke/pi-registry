// Real RLS enforcement for the portal client-isolation migration
// (sql/2026-08-31_portal_client_isolation.sql) — the one thing no other test
// in this suite checks.
//
// Every other test drives the app through the REST shim (lib/postgrest.js),
// which runs every query as the `postgres` superuser and so BYPASSES RLS
// entirely — a superuser sees every row and can write anywhere regardless of
// what policies say. That is fine for testing what the app DOES with the
// data it's given, but it means passing the rest of this suite proves
// nothing about whether the isolation migration's policies actually isolate
// anything. 17-grants.test.js checks the CONTRACT (grants and policies
// exist, name the right roles); this test checks the ENFORCEMENT, by
// actually switching Postgres role and JWT claims on a raw connection and
// querying as anon and as authenticated would be for real.
//
// Everything here runs inside one transaction that is always rolled back
// (never committed), on a client checked out directly from the pool — so a
// SET ROLE or a seeded row can never leak into another test sharing the same
// pool. auth.jwt() itself only exists in this harness because
// test/lib/build-schema.js now stubs it (see that file's comment) —
// discovered while building this migration, because
// sql/2026-07-13_client_access_by_email.sql's own auth.jwt()-referencing
// policy had been silently failing to even apply here since July, caught
// only by run.js's per-file try/catch.
module.exports = {
  name: 'portal RLS isolation — anon and a granted client each see only their own project',
  async run({ t, db }) {
    const client = await db.pool.connect();
    try {
      await client.query('begin');

      // Two projects. Project 1 gets a portal token link; project 2 gets an
      // email grant for client@b.example instead — the two access paths this
      // migration covers.
      await client.query(`insert into pi_projects (id, name) overriding system value values (1,'Project A'), (2,'Project B')`);
      await client.query(`insert into pi_portal_links (token, project_id) values ('11111111-1111-1111-1111-111111111111', 1)`);
      await client.query(`insert into pi_client_access (email, project_id) values ('client@b.example', 2)`);
      await client.query(`insert into pi_deliverables (project_id, title) values ('1','A deliverable'), ('2','B deliverable')`);
      await client.query(`insert into pi_parcels (project_id, parcel_number) values ('1','A-1'), ('2','B-1')`);
      await client.query(`
        insert into pi_report_archive (project_id, client_visible, report_title)
        values (1, true, 'A shared'), (1, false, 'A unshared'), (2, true, 'B shared')`);

      // A statement that errors aborts the rest of the transaction in
      // Postgres until a ROLLBACK — so every "this should be refused" check
      // below runs inside its own SAVEPOINT and rolls back to it, instead of
      // poisoning every assertion after the first one.
      const expectDenied = async (sql) => {
        await client.query('savepoint sp');
        let threw = false;
        try { await client.query(sql); }
        catch (e) { threw = /permission denied/.test(e.message); }
        await client.query('rollback to savepoint sp');
        return threw;
      };

      // ── anon: cannot list the token table itself ──────────────────────────
      await client.query('set role anon');
      t.ok(await expectDenied('select * from pi_portal_links'),
           'anon: SELECT on pi_portal_links itself is refused outright, not just filtered to zero rows');

      // ── anon: resolves a token it holds, and only that token ─────────────
      let r = await client.query(`select pi_resolve_portal_token('11111111-1111-1111-1111-111111111111') r`);
      t.eq(r.rows[0].r, 1, 'anon: pi_resolve_portal_token resolves a real token to its project');
      r = await client.query(`select pi_resolve_portal_token('99999999-9999-9999-9999-999999999999') r`);
      t.eq(r.rows[0].r, null, 'anon: an unknown token resolves to null, not an error and not someone else’s project');

      // ── anon: sees project 1's rows, not project 2's ──────────────────────
      r = await client.query(`select id from pi_projects where id in (1,2) order by id`);
      t.eq(r.rows.map(x => x.id), [1], 'anon: pi_projects — only the linked project, not both');
      r = await client.query(`select project_id from pi_deliverables order by project_id`);
      t.eq(r.rows.map(x => x.project_id), ['1'], 'anon: pi_deliverables scoped to the linked project only');

      // ── anon: client_visible is enforced by RLS itself, not just the app's
      // own query filter — the exact gap this migration closes on
      // pi_report_archive ─────────────────────────────────────────────────
      r = await client.query(`select report_title from pi_report_archive where project_id = 1`);
      t.eq(r.rows.map(x => x.report_title), ['A shared'],
           'anon: an unshared report for the SAME project stays invisible even without a client_visible filter in the query');

      // ── anon: cannot write anywhere ────────────────────────────────────────
      t.ok(await expectDenied(`insert into pi_parcels (project_id, parcel_number) values ('1','sneaky')`),
           'anon: cannot INSERT into a portal-read table at all');

      await client.query(`reset role`);

      // ── authenticated, staff (no matching pi_client_access row): sees and
      // writes everything, unchanged from before this migration ────────────
      await client.query('set role authenticated');
      await client.query(`set request.jwt.claims to '{"email":"staff@sunrise.example"}'`);
      r = await client.query(`select id from pi_projects order by id`);
      t.eq(r.rows.map(x => x.id), [1, 2], 'staff: sees every project, not just one');
      r = await client.query(`select report_title from pi_report_archive order by id`);
      t.eq(r.rows.map(x => x.report_title), ['A shared', 'A unshared', 'B shared'],
           'staff: sees unshared reports too — client_visible only gates the client-facing roles');
      let upd = await client.query(`update pi_parcels set parcel_number = parcel_number || '-edited' where project_id = '1'`);
      t.eq(upd.rowCount, 1, 'staff: can still write');

      // ── authenticated, a granted client (client@b.example, project 2 only)
      // — the path that had ZERO real per-table enforcement before this
      // migration, since the pre-existing policy matched on a user_id column
      // every email-based grant leaves null ───────────────────────────────
      await client.query(`set request.jwt.claims to '{"email":"client@b.example"}'`);
      r = await client.query(`select id from pi_projects order by id`);
      t.eq(r.rows.map(x => x.id), [2], 'client: sees only the granted project, not project 1');
      r = await client.query(`select project_id from pi_deliverables order by project_id`);
      t.eq(r.rows.map(x => x.project_id), ['2'], 'client: deliverables scoped to the granted project only');
      r = await client.query(`select report_title from pi_report_archive order by id`);
      t.eq(r.rows.map(x => x.report_title), ['B shared'],
           'client: only their own project’s SHARED report — not project 1’s at all, and not project 2’s unshared draft (moot here, but the rule is the same one anon is held to)');
      upd = await client.query(`update pi_parcels set parcel_number = 'hacked' where project_id = '2'`);
      t.eq(upd.rowCount, 0, 'client: write is rejected — RLS check fails so zero rows match, not a hard grant-level error, but still zero rows changed');

      await client.query(`reset role`);
      await client.query('reset request.jwt.claims');
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
    }
  },
};
