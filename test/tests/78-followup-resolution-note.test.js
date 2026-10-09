// Optional "how it was resolved" note on a follow-up (Oct 2026).
//
// The Edit interaction dialog gets a "How it was resolved" box, shown only
// while "Follow-up resolved" is ticked. The one-click Resolve button still
// resolves with no note. Reopening clears the note with the date.
module.exports = {
  name: 'follow-up resolution note',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const open = await t.sql(`select id from pi_interactions where follow_up and not coalesce(follow_up_done,false) order by id limit 2`);
      t.ok(open.length === 2, 'the seed has open follow-ups to work with');
      const [a, b] = open.map(r => String(r.id));

      t.ok(await app.page.evaluate(() => !!window._fuResCol), 'the migrated column is detected');

      await app.page.evaluate(async id => { await openEditIntModal(id); }, a);
      t.eq(await app.page.evaluate(() => getComputedStyle(document.getElementById('fu-rnote')).display), 'none', 'the note box is hidden while the follow-up is open');
      await app.page.evaluate(() => { const c = document.getElementById('f-ifudo'); c.checked = true; c.dispatchEvent(new Event('change')); });
      t.ok(await app.page.evaluate(() => getComputedStyle(document.getElementById('fu-rnote')).display !== 'none'), 'ticking "Follow-up resolved" shows it');
      await app.page.evaluate(async () => { document.getElementById('f-ifures').value = '  Emailed the exhibit; resident satisfied.  '; await saveInt(); });
      await app.page.waitForFunction(() => _writesInFlight === 0); await new Promise(r => setTimeout(r, 300));
      let [r] = await t.sql(`select follow_up_done d, follow_up_resolution n from pi_interactions where id=${a}`);
      t.eq([r.d, r.n], [true, 'Emailed the exhibit; resident satisfied.'], 'the note is saved, trimmed, with the resolution');

      await app.page.evaluate(async id => { await openEditIntModal(id); }, a);
      t.eq(await app.page.evaluate(() => document.getElementById('f-ifures').value), 'Emailed the exhibit; resident satisfied.', 'reopening the dialog shows the saved note');
      await app.page.evaluate(() => closeM());

      await app.page.evaluate(() => { setView('followups'); S.fuStatus = 'all'; S.fuUser = 'all'; renderFollowups(document.getElementById('main')); });
      t.ok(await app.page.evaluate(() => document.getElementById('main').textContent.includes('Emailed the exhibit; resident satisfied.')), 'the Follow-ups view shows the note');

      await app.page.evaluate(id => resolveFollowUp(id), b);
      await app.page.waitForFunction(() => _writesInFlight === 0); await new Promise(r => setTimeout(r, 300));
      [r] = await t.sql(`select follow_up_done d, follow_up_resolution n from pi_interactions where id=${b}`);
      t.eq([r.d, r.n], [true, null], 'one-click Resolve still resolves with no note');

      await app.page.evaluate(id => reopenFollowUp(id), a);
      await app.page.waitForFunction(() => _writesInFlight === 0); await new Promise(r => setTimeout(r, 300));
      [r] = await t.sql(`select follow_up_done d, follow_up_resolved::text dt, follow_up_resolution n from pi_interactions where id=${a}`);
      t.eq([r.d, r.dt, r.n || ''], [false, null, ''], 'reopening clears the date and the note');

      const gated = await app.page.evaluate(() => { const k = window._fuResCol; window._fuResCol = false; const o = toSB('interactions', { followUpResolution: 'x' }); window._fuResCol = k; return 'follow_up_resolution' in o; });
      t.eq(gated, false, 'before the migration the column is left out of writes');
    } finally { await app.close(); }
  }
};
