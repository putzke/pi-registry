// The demo seed must apply cleanly, be idempotent, and produce the numbers the
// conference demo is built on.
//
// Both seed failures this project hit reached the live SQL editor because
// nothing ran the file first: a phantom `venue` column, then `text = bigint`
// from project_id being text on some tables and bigint on others.
const path = require('path');
const SQL = path.join(__dirname, '..', '..', 'sql');

module.exports = {
  name: 'demo seed — applies, idempotent, correct counts',
  async run({ t }) {
    const out1 = t.seed();
    t.ok(!/ERROR/.test(out1), 'first run has no errors');
    t.ok(/follow-up assignment: \d+ of \d+/.test(out1), 'follow-up assignment step ran (column present)');

    const counts = async () => (await t.sql(`
      select (select count(*) from pi_projects)              projects,
             (select count(*) from pi_stakeholders)          stakeholders,
             (select count(*) from pi_interactions)          interactions,
             (select count(*) from pi_portal_links)          links,
             (select count(*) from pi_client_access)         grants,
             (select count(*) from pi_report_archive)        archives,
             (select count(*) from pi_client_summaries)      trends`))[0];

    const a = await counts();
    t.eq(Number(a.projects), 2, 'two demo projects');
    t.eq(Number(a.stakeholders), 52, '52 stakeholders');
    t.eq(Number(a.links), 2, 'two portal links');
    t.eq(Number(a.grants), 4, 'four access grants');
    t.eq(Number(a.archives), 6, 'six archived reports');
    t.eq(Number(a.trends), 3, 'three published trends');

    // Idempotency — the purge must leave no duplicates behind.
    const out2 = t.seed();
    t.ok(/Purged 2 previous demo project\(s\)/.test(out2), 'second run purges the first');
    t.ok(!/ERROR/.test(out2), 'second run has no errors');
    const b = await counts();
    t.eq(b, a, 're-running changes nothing');

    // The numbers the demo actually shows.
    const sr = (await t.sql(
      `select count(*) filter (where follow_up and not coalesce(follow_up_done,false)) open_fu,
              count(*) filter (where coalesce(nullif(follow_up_assigned_to,''), logged_by)='PUT'
                               and follow_up and not coalesce(follow_up_done,false)) mine
         from pi_interactions`))[0];
    t.gt(Number(sr.mine), 0, 'the signed-in user owns some follow-ups (logged_by is initials, not full names)');
    t.eq(await t.sql(`select 1 from pi_interactions where follow_up_assigned_to = logged_by limit 1`), [],
         'nothing is assigned to its own logger');

    t.eq(Number((await t.sql(`select count(*) c from pi_report_archive where client_visible`))[0].c), 5,
         'five reports shared, one held back');
    t.eq(Number((await t.sql(`select count(*) c from pi_report_archive where snapshot is null`))[0].c), 0,
         'every archive has a frozen snapshot');
    t.eq(await t.sql(`select 1 from pi_interactions where interaction_date > current_date limit 1`), [],
         'no future-dated interactions');

    // The engagement chart needs all eight ISO weeks populated.
    const weeks = await t.sql(`
      select count(distinct date_trunc('week', interaction_date)) w
        from pi_interactions
       where interaction_date >= date_trunc('week', current_date) - interval '7 weeks'`);
    t.eq(Number(weeks[0].w), 8, 'all 8 trailing ISO weeks have interactions');
  },
};
