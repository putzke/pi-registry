// The SR-154 report-test data script applies, is idempotent, and produces
// three periods whose state actually MOVES between them.
//
// That last part is the whole point. Only auto-concerns is bounded by the
// report period; deliverables, issues and commitments show current state
// whatever the header says, and snapshot.trendFacts freezes exactly those. So
// three reports over static data give three identical trendFacts and the
// Project Status Report correctly reports that nothing happened. This script
// exists to make something happen between archives.
const fs = require('fs'), path = require('path');

// The scenario is five files meant to be pasted one at a time, with an archive
// step in between. Read them in order so the test runs them exactly as a human
// would — including the cleanup, which has to be safe to run first.
const DIR = path.join(__dirname, '..', '..', 'sql', 'sr154-report-test');
const FILES = {
  'BLOCK 0': '00-cleanup.sql',
  'BLOCK 1': '01-period-1.sql',
  'BLOCK 2': '02-period-2.sql',
  'BLOCK 3': '03-period-3.sql',
  'Verify':  '04-verify.sql',
};
function blocks() {
  const out = {};
  for (const [k, f] of Object.entries(FILES)) {
    const p = path.join(DIR, f);
    if (fs.existsSync(p)) out[k] = fs.readFileSync(p, 'utf8');
  }
  return out;
}

module.exports = {
  name: 'SR-154 report test data — three periods, and the state moves between them',
  async run({ t }) {
    t.seed();
    const B = blocks();
    Object.entries(FILES).forEach(([k, f]) => t.ok(B[k], `${f} exists`));
    t.ok(fs.existsSync(path.join(DIR, 'README.md')),
         'the folder documents the run order');
    // These are DATA, not schema. test/run.js applies every *.sql in sql/ as a
    // migration; a subfolder is skipped by that filter, which is the whole
    // reason they live here rather than flat beside the migrations.
    t.eq(fs.readdirSync(path.join(__dirname, '..', '..', 'sql'))
           .filter(f => f.endsWith('.sql') && /sr154/.test(f)).length, 0,
         'and none of them sits flat in sql/, where it would run as a migration');

    const proj = (await t.sql(
      `select id, pid from pi_projects where pid='25-154-001'`))[0];
    t.ok(proj, 'SR-154 is in the seed');
    const P = String(proj.id);

    const before = (await t.sql(
      `select count(*)::int n from pi_interactions where project_id::text=$1`, [P]))[0].n;
    t.gt(before, 100, `it already has real activity (${before} interactions)`);

    // ── each block applies, in the order a human would paste them ────────
    const snap = async () => (await t.sql(`
      select (select count(*)::int from pi_interactions
               where project_id::text=$1 and updated_by='sr154-rpt-test') ints,
             (select count(*)::int from pi_issues
               where project_id::text=$1 and updated_by='sr154-rpt-test' and status='Open') iss_open,
             (select count(*)::int from pi_issues
               where project_id::text=$1 and updated_by='sr154-rpt-test' and status='Resolved') iss_done,
             (select count(*)::int from pi_commitments
               where project_id=$1::bigint and status='Fulfilled') comm_done,
             (select count(*)::int from pi_commitments
               where project_id=$1::bigint and status='Open') comm_open,
             (select progress from pi_deliverables
               where project_id::text=$1 and title='Comment Period Summary (DEIS)') dev_pct`,
      [P]))[0];

    await t.sql(B['BLOCK 0']);
    await t.sql(B['BLOCK 1']);
    const s1 = await snap();
    t.eq(s1.ints, 14, 'block 1 logs 14 interactions');
    t.eq(s1.iss_open, 2, 'and opens 2 issues');
    t.eq(s1.iss_done, 0, 'with none resolved yet');

    await t.sql(B['BLOCK 2']);
    const s2 = await snap();
    t.eq(s2.ints, 23, 'block 2 brings the total to 23');
    t.eq(s2.iss_done, 1, 'and resolves one issue');
    t.eq(s2.iss_open, 2, 'while opening another, so 2 stay open');
    t.gt(s2.comm_done, s1.comm_done, 'a commitment is fulfilled');
    t.gt(Number(s2.dev_pct), Number(s1.dev_pct),
         `the comment matrix advances (${s1.dev_pct}% → ${s2.dev_pct}%)`);

    await t.sql(B['BLOCK 3']);
    const s3 = await snap();
    t.eq(s3.ints, 40, 'block 3 brings the total to 40');
    t.eq(s3.iss_done, 2, 'a second issue resolves');
    t.eq(s3.iss_open, 1, 'and exactly one is left open');
    t.gt(s3.comm_done, s2.comm_done, 'a second commitment is fulfilled');
    t.eq(Number(s3.dev_pct), 100, 'the comment matrix completes');

    // ── the persisting item — the reason the trend has anything to say ───
    const persisting = (await t.sql(
      `select title, status, priority, date_raised from pi_issues
        where project_id::text=$1 and updated_by='sr154-rpt-test' and status='Open'`, [P]));
    t.eq(persisting.length, 1, 'exactly one issue persists across all three periods');
    t.ok(/noise wall/i.test(persisting[0].title),
         `and it is the high-priority one (${persisting[0].title})`);
    t.eq(persisting[0].priority, 'High',
         'so it also lands in the portal\'s Heads Up panel');

    // ── the three periods are genuinely different sizes ──────────────────
    const per = await t.sql(`
      select case
               when i.interaction_date between current_date-90 and current_date-61 then 1
               when i.interaction_date between current_date-60 and current_date-31 then 2
               when i.interaction_date between current_date-30 and current_date    then 3
             end pd,
             count(*)::int n,
             count(*) filter (where i.stakeholder_id is null)::int anon
        from pi_interactions i
       where i.project_id::text=$1 and i.updated_by='sr154-rpt-test'
       group by 1 order by 1`, [P]);
    t.eq(per.length, 3, 'every row lands inside one of the three windows');
    t.eq(per.map(r => r.n), [14, 9, 17],
         'and the volumes differ, so the engagement delta has something to report');
    t.ok(per.every(r => r.anon > 0),
         'each period includes anonymous callers — they must count as EXTERNAL');

    // Every named interaction resolves to a real contact, or the report table
    // renders "Anonymous" for rows that are not anonymous at all.
    const orphan = (await t.sql(`
      select count(*)::int n from pi_interactions i
       where i.project_id::text=$1 and i.updated_by='sr154-rpt-test'
         and i.stakeholder_id is not null
         and not exists (select 1 from pi_stakeholders s
                          where s.id::text = i.stakeholder_id::text)`, [P]))[0].n;
    t.eq(orphan, 0, 'no interaction points at a stakeholder that does not exist');

    const unlinked = (await t.sql(`
      select count(*)::int n from pi_interactions i
       where i.project_id::text=$1 and i.updated_by='sr154-rpt-test'
         and i.stakeholder_id is not null
         and not exists (select 1 from pi_project_stakeholders ps
                          where ps.stakeholder_id::text = i.stakeholder_id::text
                            and ps.project_id::text = i.project_id::text
                            and coalesce(ps.stakeholder_role,'External')='External')`, [P]))[0].n;
    t.eq(unlinked, 0,
         'and every one is an EXTERNAL contact on this project, so the '
         + 'External-only report sections actually show them');

    // ── idempotent, and it removes only its own rows ─────────────────────
    const realBefore = (await t.sql(
      `select count(*)::int n from pi_interactions
        where project_id::text=$1 and (updated_by is null or updated_by<>'sr154-rpt-test')`,
      [P]))[0].n;
    await t.sql(B['BLOCK 0']);
    await t.sql(B['BLOCK 1']);
    await t.sql(B['BLOCK 2']);
    await t.sql(B['BLOCK 3']);
    const s3b = await snap();
    t.eq(s3b.ints, 40, 're-running the whole script does not double up');
    t.eq(s3b.iss_open, 1, 'nor duplicate the issues');
    const realAfter = (await t.sql(
      `select count(*)::int n from pi_interactions
        where project_id::text=$1 and (updated_by is null or updated_by<>'sr154-rpt-test')`,
      [P]))[0].n;
    t.eq(realAfter, realBefore,
         `and the project's real ${realBefore} interactions are untouched`);

    // ── the verify query at the bottom of the file runs ──────────────────
    const v = await t.sql(B['Verify'].replace(/^--.*$/gm, ''));
    t.eq(v.length, 3, 'the script\'s own verify query returns the three periods');

    // ── and the report editor really does see three different periods ────
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const counts = await app.page.evaluate(([pid, wins]) => {
        S.projectFilter = pid;
        const ext = DB.get('project_stakeholders')
          .filter(l => String(l.projectId) === String(pid)
                    && (l.stakeholderRole || 'External') === 'External')
          .map(l => String(l.stakeholderId));
        const ints = DB.get('interactions').filter(i => String(i.projectId) === String(pid));
        return wins.map(([a, b]) => ints.filter(i =>
          _intIsExternal(i, ext) && i.date >= a && i.date <= b).length);
      }, [P, [
        [iso(-90), iso(-61)], [iso(-60), iso(-31)], [iso(-30), iso(0)],
      ]]);
      t.ok(counts[0] >= 14 && counts[1] >= 9 && counts[2] >= 17,
           `the editor counts each window separately (${counts.join(' / ')})`);
      // NOT asserting the three totals differ. They include the project's own
      // seeded history, so two windows can coincide on a count while listing
      // entirely different rows — and tuning the script's volumes against seed
      // numbers would be fabricating a guarantee that does not hold against
      // the real project anyway. What matters is that the windows are disjoint
      // and each report therefore carries different rows.
      const disjoint = await app.page.evaluate(([pid, wins]) => {
        const ints = DB.get('interactions').filter(i => String(i.projectId) === String(pid));
        const sets = wins.map(([a, b]) =>
          new Set(ints.filter(i => i.date >= a && i.date <= b).map(i => String(i.id))));
        const overlap = (x, y) => [...x].some(v => y.has(v));
        return { sizes: sets.map(s => s.size),
                 any: overlap(sets[0], sets[1]) || overlap(sets[1], sets[2])
                   || overlap(sets[0], sets[2]) };
      }, [P, [[iso(-90), iso(-61)], [iso(-60), iso(-31)], [iso(-30), iso(0)]]]);
      t.eq(disjoint.any, false,
           `no interaction appears in two reports (${disjoint.sizes.join(' / ')} rows)`);
      t.eq(app.errors, [], 'no page errors during the run');
    } finally { await app.close(); }

    function iso(d) { return new Date(Date.now() + d * 86400000).toISOString().slice(0, 10); }
  },
};
