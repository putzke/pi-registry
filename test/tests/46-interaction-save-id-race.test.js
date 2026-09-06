// A new interaction (via Quick Log or the single Log Interaction modal) is
// pushed into the cache with a TEMPORARY local id (DB.uid(), prefixed
// "tmp_") before the real Supabase insert has happened. DB.set() replaces
// that temporary id with the real one once the insert resolves — but
// saveQuickLog() and saveInt() used to call DB.set() WITHOUT awaiting it,
// then immediately call render(). That drew the interaction table's "Edit"
// buttons with the temporary id baked into their onclick handler, while the
// real id was swapped into the cache moments later in the background with
// nothing to redraw the table to match.
//
// Found live: log a batch through Quick Log, then click Edit on one of the
// freshly-logged rows. openEditIntModal(id) looks the id up in the cache,
// finds nothing (the cache has long since moved on to the real id), and
// opens the modal with every field blank rather than the interaction you
// just logged.
//
// The fix makes both save functions await DB.set() before render() runs, so
// the id baked into the DOM is always the final one. This test pins that
// directly — the id in the rendered Edit button must be the real numeric id,
// never the tmp_ placeholder — and separately demonstrates the failure mode
// itself (opening the modal by a nonexistent id really does render blank),
// so the regression this guards against is unambiguous.
module.exports = {
  name: 'a freshly logged interaction never exposes its temporary id to the UI',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      const projId = String(proj.id);
      await app.page.evaluate(id => { S.projectFilter = id; setView('interactions'); }, projId);
      await app.page.waitForTimeout(100);

      // ── Quick Log path ────────────────────────────────────────────────────
      await app.page.evaluate(() => openQuickLog());
      await app.page.waitForSelector('#ql-body tr', { timeout: 5000 });
      const summary = 'Race-condition regression check — quick log.';
      await app.page.evaluate((s) => {
        document.getElementById('qld0').value = '2026-03-02';
        document.getElementById('qlc0').value = 'Phone';
        document.getElementById('qldr0').value = 'Incoming';
        document.getElementById('qlsu0').value = s;
      }, summary);
      // Awaiting this all the way through is the point: with the fix,
      // saveQuickLog's own internal await means the table is not redrawn
      // until the real id has replaced the temporary one.
      await app.page.evaluate(() => saveQuickLog());
      await app.page.waitForFunction(() => S.showQuickLog === false, null, { timeout: 5000 });

      const found = await app.page.evaluate((s) => {
        const rows = [...document.querySelectorAll('#main table.dtable tbody tr, #main [onclick^="openEditIntModal"]')];
        const btn = [...document.querySelectorAll('[onclick^="openEditIntModal"]')]
          .find(b => b.closest('tr')?.textContent.includes(s) || b.parentElement?.parentElement?.textContent.includes(s));
        const m = btn && btn.getAttribute('onclick').match(/openEditIntModal\('([^']*)'\)/);
        return { id: m ? m[1] : null };
      }, summary);
      t.ok(found.id, 'the newly logged row has an Edit button');
      t.ok(/^\d+$/.test(found.id || ''), 'its baked-in id is the real numeric id, not the tmp_ placeholder ' +
           '(id=' + found.id + ')');

      const opened = await app.page.evaluate(async (id) => {
        await openEditIntModal(id);
        return {
          summary: document.getElementById('f-isu')?.value,
          channel: document.getElementById('f-ic')?.value,
          direction: document.getElementById('f-idr')?.value,
        };
      }, found.id);
      t.eq(opened.summary, summary, 'the edit modal shows the real summary, not a blank field');
      t.eq(opened.channel, 'Phone', 'and the real channel');
      t.eq(opened.direction, 'Incoming', 'and the real direction');
      await app.page.evaluate(() => closeM());

      // ── demonstrate the failure mode this guards against ────────────────
      // Opening the modal by an id the cache genuinely doesn't have (exactly
      // what the DOM used to expose during the race) really does render
      // every field blank/defaulted — confirming this is the actual bug the
      // fix prevents, not a coincidental pass above.
      const blank = await app.page.evaluate(async () => {
        await openEditIntModal('tmp_doesnotexist');
        return {
          summary: document.getElementById('f-isu')?.value,
          date: document.getElementById('f-id')?.value,
        };
      });
      t.eq(blank.summary, '', 'a nonexistent id (the shape of the stale tmp_ id after the swap) blanks the summary');
      t.eq(blank.date, '', 'and the date — this is exactly what a user hitting the race would have seen');
      await app.page.evaluate(() => closeM());

      // ── the single "Log interaction" modal has the same fix ─────────────
      const single = await app.page.evaluate(async (pid) => {
        openIntModal();
        document.getElementById('f-ip').value = pid;
        document.getElementById('f-id').value = '2026-03-05';
        document.getElementById('f-isu').value = 'Race-condition regression check — single log.';
        await saveInt();
        const btn = [...document.querySelectorAll('[onclick^="openEditIntModal"]')]
          .find(b => (b.closest('tr') || b.parentElement?.parentElement)?.textContent
            .includes('Race-condition regression check — single log.'));
        const m = btn && btn.getAttribute('onclick').match(/openEditIntModal\('([^']*)'\)/);
        return { id: m ? m[1] : null };
      }, projId);
      t.ok(single.id && /^\d+$/.test(single.id),
           'saveInt() also awaits before rendering — its new row is never exposed under a tmp_ id ' +
           '(id=' + single.id + ')');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
