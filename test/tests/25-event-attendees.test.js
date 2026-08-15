// Event attendees must survive a round trip, and a write the database refuses
// must not look like it succeeded.
//
// Reported symptom: tick attendees on an event, save, see the names on the
// Events list — leave the view, come back, and they are gone. Writes are
// local-first, so a rejected PATCH leaves the change in _syncCache looking
// saved until the next background refetch replaces it with the server's copy.
//
// DB._sync discarded the return value of every sbAdd / sbUpdate / sbDelete, so
// the only trace was a console line nobody was watching. That is what turned a
// schema problem into a mystery, and it applies to every table, not just events.
module.exports = {
  name: 'events — attendees round-trip, and a refused write is reported',
  async run({ t, shim }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const target = (await t.sql(
        `select id, project_id from pi_meetings order by id limit 1`))[0];
      t.ok(target, 'seed has an event');

      // ── the round trip ──────────────────────────────────────────────────
      const picked = await app.page.evaluate(([mid]) => {
        const ids = (_syncCache.stakeholders || []).slice(0, 3).map(s => String(s.id));
        const all = DB.get('meetings');
        const i = all.findIndex(x => String(x.id) === String(mid));
        all[i] = { ...all[i], attendeeIds: ids };
        DB.set('meetings', all);
        return ids;
      }, [String(target.id)]);
      t.eq(picked.length, 3, 'three attendees ticked');

      const stored = await t.until(async () => {
        const r = (await t.sql('select attendee_ids from pi_meetings where id::text=$1',
          [String(target.id)]))[0];
        return r && r.attendee_ids ? r.attendee_ids : null;
      });
      t.ok(stored, 'the attendee list reached the database');
      t.eq(stored, picked, 'exactly as ticked');

      // The refetch is what used to wipe them — it replaces the array wholesale.
      const back = await app.page.evaluate(async mid => {
        _syncCache.meetings = await sbGet('meetings');
        const m = _syncCache.meetings.find(x => String(x.id) === String(mid));
        return { ids: m.attendeeIds, isArray: Array.isArray(m.attendeeIds) };
      }, String(target.id));
      t.ok(back.isArray, 'they come back as an array, not a string or null');
      t.eq(back.ids, picked, 'and with the same ids');

      // Which means the Events list still shows them after leaving and returning.
      const shown = await app.page.evaluate(mid => {
        setView('meetings');
        const m = (_syncCache.meetings || []).find(x => String(x.id) === String(mid));
        const names = (m.attendeeIds || []).map(id => {
          const s = (_syncCache.stakeholders || []).find(x => String(x.id) === String(id));
          return s ? (s.lastName || s.org || '') : '';
        }).filter(Boolean);
        const html = document.getElementById('main').innerHTML;
        return { names, listed: names.filter(n => html.includes(n)).length };
      }, String(target.id));
      t.gt(shown.names.length, 0, 'the attendees resolve to real contacts');
      t.eq(shown.listed, shown.names.length,
           'and every one is rendered on the events list after re-entering the view');

      // ── a refused write must surface ────────────────────────────────────
      // Point the app at a column the database will reject, which is what a
      // schema mismatch looks like from the browser's side.
      const warned = await app.page.evaluate(async () => {
        const seen = [];
        const realToast = window.showToast;
        window.showToast = (msg, kind) => { seen.push({ msg: String(msg), kind }); };
        // Make the next PATCH fail the way a bad column type does.
        const realWrite = window._sbWrite;
        window._sbWrite = async (url, method, body, h) => {
          if (method === 'PATCH') {
            return { ok: false, status: 400,
                     text: async () => 'invalid input syntax for type json' };
          }
          return realWrite(url, method, body, h);
        };
        const all = DB.get('meetings');
        all[0] = { ...all[0], location: 'this save will be refused' };
        const ok = await DB.set('meetings', all);
        window.showToast = realToast; window._sbWrite = realWrite;
        return { ok, seen };
      });
      t.eq(warned.ok, false, 'DB.set reports that the sync failed');
      t.eq(warned.seen.length, 1, 'the user is told, once');
      t.eq(warned.seen[0] && warned.seen[0].kind, 'err', 'as an error');
      t.ok(/could not save/i.test(warned.seen[0].msg), 'saying the change was not saved');
      t.ok(/meetings/i.test(warned.seen[0].msg), 'and naming what it was');
      t.ok(/lost when the view refreshes/i.test(warned.seen[0].msg),
           'and warning that the on-screen copy is about to disappear');

      // A successful save must stay quiet.
      const quiet = await app.page.evaluate(async () => {
        const seen = [];
        const realToast = window.showToast;
        window.showToast = m => seen.push(String(m));
        const all = DB.get('meetings');
        all[0] = { ...all[0], location: 'City Hall — annex' };
        const ok = await DB.set('meetings', all);
        window.showToast = realToast;
        return { ok, seen };
      });
      t.eq(quiet.ok, true, 'a good save reports success');
      t.eq(quiet.seen, [], 'and says nothing');

      // The only console errors should be the two this test deliberately caused
      // — and both must be present, since a silent console would mean the
      // failure left no diagnosable trace either.
      t.ok(app.errors.some(e => /SB UPDATE error: 400/.test(e)),
           'the rejection is logged with its status');
      t.ok(app.errors.some(e => /SYNC: 1 write\(s\) to meetings were rejected/.test(e)),
           'and the sync layer names the table and the count');
      t.eq(app.errors.filter(e => !/SB UPDATE error: 400|SYNC: 1 write/.test(e)), [],
           'nothing else went wrong during the run');
    } finally {
      await app.close();
    }
  },
};
