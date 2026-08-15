// sql/2026-08-09_remove_stale_demo_copies.sql — a one-time cleanup.
//
// The situation it fixes: the demo seed's purge matches on `pid`, so when two
// demo projects were renumbered by hand to the 5-digit UDOT standard, every
// later seed run rebuilt a fresh pair and left the renamed pair behind. Those
// orphans still held the seed's FIXED literal keys (comment period, portal
// tokens, grant emails), which is what produced the duplicate-key failures.
//
// A delete script gets exactly one chance to be right, so this reproduces the
// exact state from production and checks both directions: the stale copies go,
// and nothing else does.
const path = require('path');
const CLEANUP = path.join(__dirname, '..', '..', 'sql',
                          '2026-08-09_remove_stale_demo_copies.sql');

module.exports = {
  name: 'stale demo cleanup — removes the renumbered copies and nothing else',
  async run({ t, db }) {
    t.seed();

    // ── reproduce the production state ──────────────────────────────────────
    // Renumber by hand, exactly as the project owner did, then re-seed. The
    // renamed pair is now invisible to the purge.
    await t.sql(`update pi_projects set pid='22825' where pid='25-154-001'`);
    await t.sql(`update pi_projects set pid='705'   where pid='25-LC-400N'`);
    const stale = (await t.sql(
      `select array_agg(id::text) ids from pi_projects where pid in ('22825','705')`))[0].ids;
    t.eq(stale.length, 2, 'two projects renumbered by hand');

    const reseed = t.seed();
    t.ok(!/ERROR/.test(reseed), 're-seeding over the renamed copies succeeds');

    // Sorted in JS on both sides — Postgres orders text by the cluster's
    // collation, which the harness does not pin.
    const pids = async () => (await t.sql('select pid from pi_projects'))
      .map(r => r.pid).sort();
    t.eq(await pids(), ['25-154-001','25-3W-DESIGN','25-LC-400N','705','22825'].sort(),
         'five projects — the demo trio plus the two stale copies');

    // The stale copies still own real child rows; that is what makes deleting
    // them worth testing rather than eyeballing.
    const staleKids = async () => (await t.sql(`
      select (select count(*) from pi_interactions        where project_id::text = any($1)) ints,
             (select count(*) from pi_project_stakeholders where project_id::text = any($1)) links,
             (select count(*) from pi_deliverables        where project_id::text = any($1)) devs,
             (select count(*) from pi_meetings            where project_id::text = any($1)) mtgs,
             (select count(*) from pi_issues              where project_id::text = any($1)) iss,
             (select count(*) from pi_commitments         where project_id::text = any($1)) cmts,
             (select count(*) from pi_report_archive      where project_id::text = any($1)) arch`,
      [stale]))[0];
    const before = await staleKids();
    t.gt(Number(before.ints), 0, 'the stale copies still carry interactions');
    t.gt(Number(before.links), 0, 'and contact links');

    // Baseline for everything that must survive — scoped to the demo trio, so
    // rows still hanging off a stale copy can't mask a wrongful delete.
    const survivors = async () => (await t.sql(`
      with keep as (select id::text from pi_projects where pid like '25-%')
      select (select count(*) from keep)                                              projects,
             (select count(*) from pi_interactions   where project_id::text in (select id from keep)) ints,
             (select count(*) from pi_deliverables   where project_id::text in (select id from keep)) devs,
             (select count(*) from pi_meetings       where project_id::text in (select id from keep)) mtgs,
             (select count(*) from pi_issues         where project_id::text in (select id from keep)) iss,
             (select count(*) from pi_commitments    where project_id::text in (select id from keep)) cmts,
             (select count(*) from pi_parcels        where project_id::text in (select id from keep)) parcels,
             (select count(*) from pi_parcel_owners) owners,
             (select count(*) from pi_report_archive where project_id::text in (select id from keep)) arch,
             (select count(*) from pi_portal_links   where project_id::text in (select id from keep)) links,
             (select count(*) from pi_client_access  where project_id::text in (select id from keep)) grants,
             (select count(*) from pi_comment_periods where project_id::text in (select id from keep)) periods,
             (select count(*) from pi_public_comments where project_id::text in (select id from keep)) pcmts`))[0];
    const keepBefore = await survivors();
    t.gt(Number(keepBefore.parcels), 0, 'the surviving trio owns the parcel data');
    t.gt(Number(keepBefore.periods), 0, 'and the comment period');

    // ── run it ──────────────────────────────────────────────────────────────
    const out = db.runSqlFile(CLEANUP);
    t.ok(!/ERROR/.test(out), 'the cleanup applies without error');
    t.ok(/Removing 2 stale demo project\(s\)/.test(out), 'it names what it is removing');

    t.eq(await pids(), ['25-154-001','25-3W-DESIGN','25-LC-400N'],
         'only the current demo trio remains');

    const after = await staleKids();
    t.eq(Object.values(after).map(Number), [0,0,0,0,0,0,0],
         'every child row of the stale copies went with them');

    t.eq(await survivors(), keepBefore, 'nothing belonging to a live project changed');

    // No stakeholder is left stranded — the purge identifies demo contacts by
    // their link rows, so a contact whose only links were to a deleted project
    // becomes unreachable rather than merely unused.
    const stranded = (await t.sql(`
      select count(*) c from pi_stakeholders s
       where not exists (select 1 from pi_project_stakeholders ps
                          where ps.stakeholder_id::text = s.id::text)`))[0];
    t.eq(Number(stranded.c), 0, 'no orphaned contacts left behind');
    t.eq(Number((await t.sql('select count(*) c from pi_stakeholders'))[0].c), 63,
         'the contact count is back to what one clean seed produces');

    // Nothing points at a project that no longer exists.
    const dangling = (await t.sql(`
      -- project_id is bigint on some of these tables and text on others, so
      -- every arm is cast before the union — the mixed typing is real, and
      -- production, not a harness quirk.
      select count(*) c from (
        select project_id::text from pi_interactions
        union all select project_id::text from pi_project_stakeholders
        union all select project_id::text from pi_deliverables
        union all select project_id::text from pi_meetings
        union all select project_id::text from pi_issues
        union all select project_id::text from pi_commitments
        union all select project_id::text from pi_parcels
        union all select project_id::text from pi_report_archive
        union all select project_id::text from pi_portal_links) x
       where project_id is not null
         and project_id::text not in (select id::text from pi_projects)`))[0];
    t.eq(Number(dangling.c), 0, 'no row references a deleted project');

    // ── safe to run twice ───────────────────────────────────────────────────
    const out2 = db.runSqlFile(CLEANUP);
    t.ok(/No stale demo copies found/.test(out2), 'a second run finds nothing and says so');
    t.eq(await pids(), ['25-154-001','25-3W-DESIGN','25-LC-400N'],
         'and changes nothing');

    // ── the name check is a real safety catch ───────────────────────────────
    // Both halves must match. A pid that was reused for something real, or a
    // demo-named project sitting on a live number, must be left alone.
    await t.sql(`insert into pi_projects (pid, name, status)
                 values ('22825','US-89 Farmington Interchange','Active'),
                        ('15905','SR-154 Corridor Safety Improvements','Active')`);
    const out3 = db.runSqlFile(CLEANUP);
    t.ok(/No stale demo copies found/.test(out3),
         'a matching pid alone, or a matching name alone, is not enough to delete');
    t.eq(await pids(),
         ['15905','22825','25-154-001','25-3W-DESIGN','25-LC-400N'].sort(),
         'both decoys survive');

    // And the real thing still goes when both halves line up.
    await t.sql(`update pi_projects set pid='705'
                  where name='SR-154 Corridor Safety Improvements' and pid='15905'`);
    const out4 = db.runSqlFile(CLEANUP);
    t.ok(/Removing 1 stale demo project/.test(out4),
         'a project matching a stale pid AND a demo name is removed');
    t.eq(await pids(), ['22825','25-154-001','25-3W-DESIGN','25-LC-400N'].sort(),
         'the reused pid, on a real project name, is still untouched');
  },
};
