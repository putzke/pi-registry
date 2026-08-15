// Every column SB_TO_INT maps must exist in the database.
//
// This is the check that would have caught the pi_comment_periods outage in
// seconds: index.html mapped venue / hearing_date / first_ad_date /
// second_ad_date / federal_register_date and savePeriod() wrote all five, but
// none of them existed, so saving a comment period failed with 42703 and the
// portal's Comment Periods tab 400'd. It went unnoticed because no test ever
// compared the mapping against the schema.
//
// Runs against test/schema.sql, which is a verbatim copy of the live
// information_schema — so a drift here means real drift.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const APPS = ['index.html', 'mobile.html', 'importer.html'];

// Per-app allowances for mappings that intentionally point at a column the
// database doesn't have. Empty, and it should stay that way — mobile's
// raisedBy -> raised_by lived here until it was repointed at created_by, the
// column that actually holds who logged the issue.
const KNOWN = {};

function extractMap(html) {
  const i = html.indexOf('const SB_TO_INT');
  if (i < 0) return null;
  let depth = 0, start = html.indexOf('{', i), k = start;
  for (; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) { k++; break; } }
  }
  return eval('(' + html.slice(start, k) + ')');
}

module.exports = {
  name: 'schema drift — SB_TO_INT vs the database',
  async run({ t }) {
    const real = {};
    for (const row of (await t.sql(
      `select table_name, array_agg(column_name::text) cols
         from information_schema.columns
        where table_schema='public' and table_name like 'pi\\_%'
        group by table_name`))) {
      real[row.table_name] = new Set(row.cols);
    }
    t.gt(Object.keys(real).length, 15, 'schema has the expected tables');

    for (const app of APPS) {
      const map = extractMap(fs.readFileSync(path.join(REPO, app), 'utf8'));
      if (!t.ok(map, `${app}: SB_TO_INT found`)) continue;
      for (const [table, fields] of Object.entries(map)) {
        if (!t.ok(real[table], `${app}: table ${table} exists`)) continue;
        const allowed = (KNOWN[app] && KNOWN[app][table]) || [];
        const missing = Object.entries(fields)
          .map(([k, col]) => col)
          .filter(col => !real[table].has(col) && !allowed.includes(col));
        t.eq(missing, [], `${app}: every ${table} column exists`);
      }
    }

    // ── every column must declare its TYPE, not just its name ─────────────
    // schema-columns.txt used to carry names only, and build-schema.js guessed
    // types from them. The guess was wrong for pi_meetings.attendee_ids — text
    // in production, jsonb by name — so the app's JSON array was accepted here
    // and rejected with a 400 in the field, losing every attendee list a user
    // ticked. A guess that is right most of the time is worse than no guess,
    // because it makes the harness confidently wrong.
    const src = fs.readFileSync(path.join(REPO, 'test', 'schema-columns.txt'), 'utf8');
    const untyped = [];
    let tables = 0;
    for (const line of src.trim().split('\n')) {
      if (!line.trim()) continue;
      tables++;
      const [table, cols] = line.split('|');
      cols.split(',').map(c => c.trim()).filter(Boolean).forEach(spec => {
        if (!/^[a-z0-9_]+:[a-z0-9 ]+$/.test(spec)) untyped.push(`${table}.${spec}`);
      });
    }
    t.gt(tables, 15, 'schema-columns.txt lists the tables');
    t.eq(untyped, [], 'every column in schema-columns.txt declares a type');

    // And what it declares must be what the generated schema actually built —
    // otherwise the file could drift from the database the tests run against.
    const declared = {};
    for (const line of src.trim().split('\n')) {
      if (!line.trim()) continue;
      const [table, cols] = line.split('|');
      declared[table] = Object.fromEntries(cols.split(',').map(c => c.trim()).filter(Boolean)
        .map(s => s.split(':').map(x => x.trim())));
    }
    const live = {};
    for (const row of (await t.sql(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema='public' and table_name like 'pi\\_%'`))) {
      (live[row.table_name] = live[row.table_name] || {})[row.column_name] =
        row.data_type === 'timestamp with time zone' ? 'timestamptz'
        : row.data_type === 'character varying' ? 'text' : row.data_type;
    }
    const wrong = [];
    for (const [table, cols] of Object.entries(declared)) {
      for (const [col, ty] of Object.entries(cols)) {
        const got = (live[table] || {})[col];
        if (!got) { wrong.push(`${table}.${col} missing from the built schema`); continue; }
        // The id/token columns become serial or identity, which report as
        // bigint/uuid anyway; everything else must match exactly.
        if (got !== ty) wrong.push(`${table}.${col}: declared ${ty}, built ${got}`);
      }
    }
    t.eq(wrong, [], 'the built schema matches every declared type');

    // The types that were guessed wrong before the dump. Named individually so
    // a regression says which one, not just "something changed".
    const spot = [
      ['pi_meetings', 'attendee_ids', 'jsonb'],
      ['pi_interactions', 'stakeholder_id', 'text'],
      ['pi_interactions', 'meeting_id', 'text'],
      ['pi_issue_interactions', 'interaction_id', 'text'],
      ['pi_commitments', 'project_id', 'bigint'],
      ['pi_interactions', 'project_id', 'text'],
      ['pi_portal_links', 'project_id', 'bigint'],
      ['pi_deliverables', 'milestone_start', 'text'],
      ['pi_report_archive', 'report_num', 'text'],
    ];
    spot.forEach(([tb, col, ty]) =>
      t.eq((live[tb] || {})[col], ty, `${tb}.${col} is ${ty}`));
  },
};
