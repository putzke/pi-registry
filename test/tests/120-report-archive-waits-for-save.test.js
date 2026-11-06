// "Save to archive" must archive what is on screen, even when a draft save is
// already in flight or hits a self-conflict. Found via test 38 failing ~1 run
// in 10 under load: the second of two reports archived with the FIRST one's
// title. _rptDoSave returned at once while a save was running (so the local
// copy that _archiveReport reads was never updated), and a conflict retry was
// not awaited — and bound itself to whichever editor was open by then. And the
// archive read the localStorage copy, which the preview's re-capture can write
// the cached draft back over; it now freezes what is on screen.
module.exports = {
  name: 'report editor — Save to archive waits for an in-flight save and archives what is on screen',
  async run({ t }) {
    t.seed();
    const [P] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 1`)).map(r => String(r.id));
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async P => {
        S.projectFilter = P; S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
        const realSave = window._rptSaveSupabase, realFetch = window._rptFetchRow;
        const calls = [];
        // 1) A save is already running when the user clicks Save to archive,
        //    and it comes back as a conflict caused by our own write.
        let release; const gate = new Promise(res => { release = res; });
        let first = true;
        window._rptSaveSupabase = async (saved, force) => {
          calls.push(saved.reportTitle);
          if (first) { first = false; await gate; return { conflict: true }; }
          return realSave(saved, force);
        };
        window._rptFetchRow = async () => ({ updatedBy: _rptMyEmail(), updatedAt: new Date().toISOString() });
        document.getElementById('rpt-title').value = 'FIRST TITLE';
        const inflight = _rptDoSave(true);           // the slow save
        document.getElementById('rpt-title').value = 'SECOND TITLE';   // user keeps typing
        const flush = _rptFlushSave();
        let flushed = false; flush.then(() => { flushed = true; });
        await new Promise(res => setTimeout(res, 50));
        const flushedBeforeRelease = flushed;
        release();
        await flush; await inflight;
        const local = JSON.parse(localStorage.getItem('pir4_pi_reports_' + P) || '{}').reportTitle;
        window._rptSaveSupabase = realSave; window._rptFetchRow = realFetch;
        return { flushedBeforeRelease, local, calls };
      }, P);
      t.eq(r.flushedBeforeRelease, false, 'Save to archive waits for the save already in flight');
      t.eq(r.local, 'SECOND TITLE', 'the copy it archives is what is on screen now');
      t.ok(r.calls[r.calls.length - 1] === 'SECOND TITLE', 'and the last save sent is the on-screen text (' + r.calls.join(' → ') + ')');

      // 2) The stored copy is stale (the preview re-captured and wrote the cached
      //    draft back over it): the archive must still freeze what is on screen.
      const title = await app.page.evaluate(async P => {
        document.getElementById('rpt-title').value = 'ON SCREEN TITLE';
        const realFlush = window._rptFlushSave;
        window._rptFlushSave = async () => {
          await realFlush();
          localStorage.setItem('pir4_pi_reports_' + P, JSON.stringify(Object.assign(
            JSON.parse(localStorage.getItem('pir4_pi_reports_' + P) || '{}'), { reportTitle: 'STALE STORED TITLE' })));
        };
        await manualArchiveReport();
        window._rptFlushSave = realFlush;
        const mine = (_syncCache.report_archive || []).filter(r => String(r.projectId) === String(P));
        return mine.length ? mine[mine.length - 1].reportTitle : null;
      }, P);
      t.eq(title, 'ON SCREEN TITLE', 'Save to archive freezes the on-screen report, not a stale stored copy');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
