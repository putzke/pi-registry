// A background refresh that was already fetching when the user saved must not
// write its older copy over the cache. Found through test 88 failing ~1 run in
// 3 under load: a refresh started by setView landed after "Save & log next
// contact", and the call-back vanished from the issue on screen (it was in the
// database all along) until the next refresh.
module.exports = {
  name: 'background refresh never overwrites a save made while it was fetching',
  async run({ t }) {
    t.seed();
    const [P] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 1`)).map(r => String(r.id));
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async P => {
        const stale = JSON.parse(JSON.stringify(DB.get('interactions')));
        const realGet = window.sbGet;
        let release; const gate = new Promise(res => { release = res; });
        window.sbGet = async (tbl, o) => { await gate; return stale; };     // a slow refresh
        const pending = _refreshData(['interactions']);
        window.sbGet = realGet;
        // The user saves while that refresh is still out.
        const all = DB.get('interactions');
        all.push({ id: DB.uid(), projectId: P, date: localToday(), channel: 'Phone', direction: 'Outgoing',
                   summary: 'SAVED DURING REFRESH', loggedBy: 'PUT' });
        await DB.set('interactions', all);
        release();
        const changed = await pending;
        return { kept: DB.get('interactions').some(i => i.summary === 'SAVED DURING REFRESH'), changed };
      }, P);
      t.ok(r.kept, 'the row saved during the refresh is still in the cache afterwards');
      t.eq(r.changed, false, 'and the overlapping refresh reports no change (so it does not redraw stale data)');
      // An ordinary refresh with no save in between still applies.
      const fresh = await app.page.evaluate(async () => {
        await new Promise(res => setTimeout(res, 20));
        return _refreshData(['interactions']);
      });
      t.ok(typeof fresh === 'boolean', 'a refresh with no overlapping save still runs');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
