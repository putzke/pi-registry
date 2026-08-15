// sql/2026-08-14_meetings_attendee_ids_jsonb.sql
//
// Production had pi_meetings.attendee_ids as TEXT while the app writes a JSON
// array, so PostgREST answered 400 and every attendee list was dropped. The
// harness typed it jsonb — inferred from the column name — which is why the
// round trip passed here and failed there.
//
// The migration therefore has to be tested against the shape production
// actually had, not the shape the harness assumes. This forces the column back
// to text, fills it with every value that could plausibly be in there, and runs
// the real file.
const path = require('path');
const MIG = path.join(__dirname, '..', '..', 'sql',
                      '2026-08-14_meetings_attendee_ids_jsonb.sql');

module.exports = {
  name: 'attendee_ids migration — text to jsonb, without losing or guessing',
  async run({ t, db }) {
    t.seed();

    const type = async () => (await t.sql(
      `select data_type d from information_schema.columns
        where table_name='pi_meetings' and column_name='attendee_ids'`))[0].d;

    // Already jsonb here, so the migration must recognise that and stop.
    t.eq(await type(), 'jsonb', 'the harness types it jsonb');
    const noop = db.runSqlFile(MIG);
    t.ok(/already jsonb, nothing to do/.test(noop),
         'run against a converted column it does nothing');
    t.eq(await type(), 'jsonb', 'and leaves the type alone');

    // ── recreate production's shape ──────────────────────────────────────
    await t.sql(`alter table pi_meetings alter column attendee_ids type text
                 using attendee_ids::text`);
    t.eq(await type(), 'text', 'column forced back to text');

    const ids = (await t.sql('select id from pi_meetings order by id limit 5')).map(r => r.id);
    t.eq(ids.length, 5, 'five events to convert');
    // Every shape that could be sitting in a text column.
    await t.sql(`update pi_meetings set attendee_ids='["12","34"]' where id=$1`, [ids[0]]);
    await t.sql(`update pi_meetings set attendee_ids='7, 8 ,9' where id=$1`, [ids[1]]);
    await t.sql(`update pi_meetings set attendee_ids='' where id=$1`, [ids[2]]);
    await t.sql(`update pi_meetings set attendee_ids=null where id=$1`, [ids[3]]);
    await t.sql(`update pi_meetings set attendee_ids='[not valid json' where id=$1`, [ids[4]]);

    const out = db.runSqlFile(MIG);
    t.ok(!/ERROR/.test(out), 'the migration applies without error');
    t.eq(await type(), 'jsonb', 'the column is jsonb afterwards');

    const val = async id => (await t.sql(
      'select attendee_ids a from pi_meetings where id=$1', [id]))[0].a;
    t.eq(await val(ids[0]), ['12', '34'], 'a JSON array converts unchanged');
    t.eq(await val(ids[1]), ['7', '8', '9'],
         'a comma-separated list becomes an array, trimmed');
    t.eq(await val(ids[2]), null, 'an empty string becomes null, not an empty string');
    t.eq(await val(ids[3]), null, 'a null stays null');

    // The one that matters most: a value it cannot parse must not abort the
    // migration or be guessed at.
    t.ok(/could not be parsed/.test(out), 'an unparseable value is reported');
    t.ok(out.includes(String(ids[4])), 'by row id, so it can be found');
    t.eq(await val(ids[4]), null, 'and left empty rather than invented');
    t.ok(/1 unparseable/.test(out), 'and counted in the summary');

    // ── the app can now write what it was trying to write ────────────────
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const wrote = await app.page.evaluate(mid => {
        const picks = (_syncCache.stakeholders || []).slice(0, 2).map(s => String(s.id));
        const all = DB.get('meetings');
        const i = all.findIndex(x => String(x.id) === String(mid));
        all[i] = { ...all[i], attendeeIds: picks };
        DB.set('meetings', all);
        return picks;
      }, String(ids[0]));
      // Poll for the value actually written, not merely for "two of something"
      // — the row already held a two-element array, so a length check would
      // pass before the write landed and prove nothing.
      const landed = await t.until(async () => {
        const a = await val(ids[0]);
        return a && JSON.stringify(a) === JSON.stringify(wrote) ? a : null;
      });
      t.ok(landed, 'a save now reaches the database');
      t.eq(landed, wrote, 'with the ticked attendees intact');
      t.eq(app.errors, [], 'and no errors on the way');
    } finally {
      await app.close();
    }
  },
};
