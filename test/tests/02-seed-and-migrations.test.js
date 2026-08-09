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
    t.eq(Number(a.projects), 3, 'three demo projects');
    t.eq(Number(a.stakeholders), 63, '63 stakeholders');
    t.eq(Number(a.links), 2, 'two portal links');
    t.eq(Number(a.grants), 5, 'five access grants');
    t.eq(Number(a.archives), 6, 'six archived reports');
    t.eq(Number(a.trends), 3, 'three published trends');

    // Idempotency — the purge must leave no duplicates behind.
    const out2 = t.seed();
    t.ok(/Purged 3 previous demo project\(s\)/.test(out2), 'second run purges the first');

    // A TEXT-PK row that has lost its project link must not block a re-run.
    // pi_comment_periods ids are fixed literals, so an orphan survives the
    // project-scoped delete and then collides on re-insert — which is exactly
    // what "duplicate key value violates unique constraint" looked like in
    // production.
    await t.sql(`update pi_comment_periods set project_id='999999'
                  where id='cp-sr154-deis-2025'`);
    let orphanOut = '';
    try { orphanOut = t.seed(); } catch (e) { orphanOut = 'FAILED: ' + e.message; }
    t.eq(/FAILED/.test(String(orphanOut)), false,
         're-running over an orphaned comment period succeeds');
    t.eq(Number((await t.sql(
      `select count(*) c from pi_comment_periods where id='cp-sr154-deis-2025'`))[0].c), 1,
         'and leaves exactly one copy of it');

    // The harder version, and the one seen in production: the comment period is
    // orphaned AND no demo project remains. The purge's nothing-to-purge guard
    // returns early, so any cleanup placed after it is skipped in exactly the
    // state that needs it — which is why the text-PK deletes run before it.
    await t.sql(`update pi_comment_periods set project_id='999999'
                  where id='cp-sr154-deis-2025'`);
    // pi_stakeholders goes too: the purge identifies demo contacts BY their link
    // rows, so wiping links while leaving contacts would strand them and the
    // next run would add a second copy — an artefact of this teardown, not of
    // the seed.
    for (const tbl of ['pi_project_stakeholders','pi_interactions','pi_public_comments',
                       'pi_parcel_owners','pi_parcels','pi_deliverables','pi_meetings',
                       'pi_issues','pi_commitments','pi_portal_links','pi_client_access',
                       'pi_reports','pi_report_archive','pi_client_summaries',
                       'pi_stakeholders','pi_projects']) {
      await t.sql(`delete from ${tbl}`);
    }
    // Everything the seed writes with a FIXED key gets stranded, not just the
    // comment period: portal-link tokens and client-access emails are literals
    // too. Orphan ids must stay distinct — pi_portal_links(project_id) and
    // pi_client_access(email, project_id) are both unique.
    await t.sql(`with n as (select token, row_number() over (order by token) rn
                              from pi_portal_links)
                 update pi_portal_links pl set project_id='9991'||n.rn::text
                   from n where n.token = pl.token`);
    await t.sql(`with n as (select id, row_number() over (order by id) rn
                              from pi_client_access)
                 update pi_client_access c set project_id='9992'||n.rn::text
                   from n where n.id = c.id`);

    let strandedOut = '';
    try { strandedOut = t.seed(); } catch (e) { strandedOut = 'FAILED: ' + e.message; }
    t.eq(/FAILED/.test(String(strandedOut)), false,
         're-running with orphaned literal keys and no demo projects succeeds');
    const after = (await t.sql(`select
        (select count(*) from pi_comment_periods) periods,
        (select count(*) from pi_portal_links)    links,
        (select count(*) from pi_client_access)   grants`))[0];
    t.eq(Number(after.periods), 1, 'exactly one comment period');
    t.eq(Number(after.links), 2, 'exactly two portal links — tokens stay stable');
    t.eq(Number(after.grants), 5, 'exactly five access grants');

    // ── the 3600 West design project: right-of-way test data ────────────────
    // A roadway project in DESIGN, which is when acquisition actually happens.
    // Its parcels are shaped to exercise every case the module has to handle,
    // so a re-run has to reproduce them exactly.
    const rw = (await t.sql(`
      select count(distinct pc.id)::int parcels,
             count(po.id)::int links,
             count(distinct po.stakeholder_id)::int owners,
             count(distinct pc.id) filter (where po.id is null)::int unowned,
             count(distinct pc.id) filter (where pc.notice_date is not null)::int noticed,
             count(distinct pc.id) filter (where coalesce(pc.situs_address,'')=''
                                             and coalesce(pc.latitude,'')<>'')::int coords_only
        from pi_projects p
        join pi_parcels pc on pc.project_id::text = p.id::text
        left join pi_parcel_owners po on po.parcel_id::text = pc.id::text
       where p.pid = '25-3W-DESIGN'`))[0];
    t.eq(rw.parcels, 7, 'seven parcels on the design project');
    t.eq(rw.links, 10, 'ten ownership links — the many-to-many is exercised');
    t.eq(rw.owners, 9, 'nine distinct owner contacts');
    t.eq(rw.unowned, 1, 'one parcel deliberately has no owner identified');
    t.eq(rw.noticed, 6, 'six of seven parcels noticed, so coverage is partial');
    t.eq(rw.coords_only, 1, 'one unsubdivided parcel is located by coordinates only');

    // Several owners on one parcel, and one owner across two.
    const shapes = (await t.sql(`
      select max(c)::int most_owners_on_a_parcel from (
        select po.parcel_id, count(*) c from pi_parcel_owners po
          join pi_parcels pc on pc.id::text = po.parcel_id::text
          join pi_projects p on p.id::text = pc.project_id::text
         where p.pid='25-3W-DESIGN' group by po.parcel_id) x`))[0];
    t.eq(shapes.most_owners_on_a_parcel, 3, 'one parcel carries three heirs');
    const multi = (await t.sql(`
      select count(*)::int n from (
        select po.stakeholder_id from pi_parcel_owners po
          join pi_parcels pc on pc.id::text = po.parcel_id::text
          join pi_projects p on p.id::text = pc.project_id::text
         where p.pid='25-3W-DESIGN'
         group by po.stakeholder_id having count(*) > 1) x`))[0];
    t.eq(multi.n, 1, 'one owner holds more than one parcel');

    // Property owners stay OUT of the master registry — they are specific to
    // this acquisition, not contacts reused across projects.
    const master = (await t.sql(
      `select count(*)::int n from pi_stakeholders
        where stakeholder_type='Property Owner' and is_master`))[0];
    t.eq(master.n, 0, 'no property owner is in the master registry');
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
