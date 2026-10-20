// pi_issue_interactions was the last table open to the public anon key
// (`anon_all` FOR ALL USING (true) + a full grant, found live 2026-10-20).
// sql/2026-10-20_issue_interactions_lockdown.sql closes it. Role-switched on a
// raw connection inside a rolled-back transaction, like tests 47 and 66: the
// REST shim runs as postgres and would see everything regardless.
module.exports = {
  name: 'issue↔interaction links — anon refused, portal client sees none, staff unchanged',
  async run({ t, db }) {
    const c = await db.pool.connect();
    try {
      await c.query('begin');
      // Recreate the production state the migration fixes, then run it.
      await c.query(`create policy anon_all on pi_issue_interactions for all to anon using (true) with check (true)`).catch(() => {});
      await c.query(`grant all on pi_issue_interactions to anon`);
      await c.query(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'sql', '2026-10-20_issue_interactions_lockdown.sql'), 'utf8'));
      await c.query(`insert into pi_issue_interactions (issue_id, interaction_id) values (1,'10'),(2,'20')`);
      await c.query(`insert into pi_client_access (email, project_id) values ('client@x.example', 1)`);

      const as = async (role, email, sql) => {
        await c.query('savepoint sp');
        try {
          await c.query(`set local role ${role}`);
          if (email) await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ email, role })]);
          const r = await c.query(sql);
          await c.query('reset role'); await c.query('release savepoint sp');
          return r.rowCount;
        } catch (e) { await c.query('rollback to savepoint sp'); return 'denied: ' + e.message; }
      };
      t.ok(/denied/.test(await as('anon', null, 'select * from pi_issue_interactions')), 'anon cannot read the links');
      t.ok(/denied/.test(await as('anon', null, `insert into pi_issue_interactions (issue_id, interaction_id) values (3,'30')`)), 'anon cannot add a link');
      t.ok(/denied/.test(await as('anon', null, 'delete from pi_issue_interactions')), 'anon cannot delete links');
      t.eq(await as('authenticated', 'staff@sunrise.example', 'select * from pi_issue_interactions'), 2, 'staff still see every link');
      t.eq(await as('authenticated', 'client@x.example', 'select * from pi_issue_interactions'), 0, 'a portal client sees none');
      t.eq(await as('authenticated', 'anyone@stranger.example', 'select * from pi_issue_interactions'), 0, 'a signed-in stranger sees none');
      t.eq(await as('authenticated', 'client@x.example', 'delete from pi_issue_interactions'), 0, 'a portal client deletes nothing');
      t.eq((await c.query(`select count(*)::int n from pi_issue_interactions`)).rows[0].n, 2, '(the rows are still there)');
      const pol = (await c.query(`select policyname from pg_policies where tablename='pi_issue_interactions' order by 1`)).rows.map((r) => r.policyname);
      t.eq(pol, ['pi_issue_interactions_staff_all', 'pi_staff_or_client'], 'exactly the staff policy and the staff-or-client rule remain');
    } finally { await c.query('rollback').catch(() => {}); c.release(); }
  },
};
