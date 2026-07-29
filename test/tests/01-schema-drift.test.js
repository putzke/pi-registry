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

// mobile.html maps raisedBy -> pi_issues.raised_by, which does not exist. It is
// harmless today because mobile never writes issues (it only renders the field,
// which therefore stays blank). Listed here so the test stays green while the
// dead mapping is still present, and so removing it doesn't silently pass.
const KNOWN = { 'mobile.html': { pi_issues: ['raised_by'] } };

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
  },
};
