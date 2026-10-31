// A conversation reads in order (Jeff, Oct 2026). No time field: inside one
// day, contacts are ordered as they were LOGGED (the database's increasing
// ids, compared as numbers). The dialog shows a numbered timeline, oldest
// first; the log tags each contact "n of N" and keeps same-day rows in
// logged order.
module.exports = {
  name: 'conversation order — numbered timeline, n of N tags, same-day rows in logged order',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(() => {
        const projF = DB.get('projects')[0].id;
        const mk = (id, date, dir, summary, rel) => ({ id, projectId: projF, date, channel: 'Phone', direction: dir, subject: 'General', nature: 'Inquiry', summary, relatedTo: rel || '' });
        // ids 9998 → 9999 → 10000 → 10001: as text, "10000" and "10001" would sort before "9998".
        _syncCache.interactions = (DB.get('interactions') || []).concat([
          mk(9998, '2030-03-03', 'Incoming', 'FIRSTCALL voicemail'),
          mk(9999, '2030-03-03', 'Outgoing', 'SECONDCALL returned', '9998'),
          mk(10000, '2030-03-03', 'Incoming', 'THIRDCALL called again', '9998'),
          mk(10001, '2030-03-03', 'Outgoing', 'FOURTHCALL closed it out', '9998'),
        ]);
        const conv = _intConversation({ id: 9998 }).map(x => x.id);
        const div = document.createElement('div');
        div.innerHTML = _intPairHTML(DB.get('interactions').find(x => x.id === 10000));
        const seq = [...div.querySelectorAll('.int-seq')].map(x => x.textContent);
        const T = _intThreadIndex();
        const tag = id => { const d = document.createElement('div'); d.innerHTML = _intThreadTagsHTML(DB.get('interactions').find(x => x.id === id), T, false); return d.textContent; };
        S.intSortCol = 'date'; S.intSortDir = 'desc';
        const sorted = sortInts(DB.get('interactions').filter(x => x.date === '2030-03-03')).map(x => x.id);
        return { conv, seq, header: div.querySelector('.fsec').textContent, t9998: tag(9998), t10000: tag(10000), sorted };
      });
      t.eq(r.conv, [9999, 10000, 10001], 'next contacts in logged order (numbers, not text)');
      t.ok(/FIRSTCALL/.test(r.seq[0]) && /SECONDCALL/.test(r.seq[1]) && /THIRDCALL/.test(r.seq[2]) && /FOURTHCALL/.test(r.seq[3]), 'the dialog timeline runs oldest first');
      t.ok(/^1/.test(r.seq[0]) && /^4/.test(r.seq[3]), 'each step is numbered');
      t.ok(/this one/.test(r.seq[2]) && !/this one/.test(r.seq[1]), 'the open contact is marked');
      t.ok(/⬇/.test(r.seq[0]) && /⬆/.test(r.seq[1]), 'arrows show in and out');
      t.ok(/Conversation · 4 contacts/.test(r.header) && /oldest first/.test(r.header), 'header says how it is ordered');
      t.ok(/Conversation · 1 of 4/.test(r.t9998), 'the original reads 1 of 4');
      t.ok(/Next contact · 3 of 4/.test(r.t10000), 'a next contact reads its place');
      t.eq(r.sorted, [10001, 10000, 9999, 9998], 'same-day rows keep logged order (newest first in the log)');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
