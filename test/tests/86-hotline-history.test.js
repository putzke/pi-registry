// Hotline history: recent rows by default, grouped by date, and the junk rule
// (Jeff's "B", Oct 2026).
//
//  - "Logged & dismissed" and "Calls" show the last 30 days by default; older
//    rows are HIDDEN (the toolbar says how many), never deleted. A call still
//    waiting for Log / Don't log always shows.
//  - Group: none / by date / by caller.
//  - pi_hotline_cleanup() deletes ONLY voicemails dismissed as "Spam /
//    robocall" or "Hang-up / no message" (a typed note after the reason is
//    fine) more than 90 days ago whose recording is already gone — and only
//    for a staff login. Logged rows, wrong numbers and everything recent stay.
//  - The app calls it when the inbox opens and drops what it deleted.
//  - The app's HOT_JUNK_REASONS / HOT_JUNK_KEEP_DAYS match the SQL.
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'hotline history — 30-day view, group by date, junk clean-up',
  async run({ t, db }) {
    t.seed();
    const [A] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 1`)).map(r => String(r.id));
    const [h] = await t.sql(`insert into pi_hotlines (name, phone_number, project_id) values ('Region One','+18015550101',$1) returning id`, [A]);
    const ins = (o) => t.sql(`insert into pi_hotline_messages (hotline_id, project_id, caller_number, call_sid, recording_path, audio_deleted_at,
        status, dismiss_reason, closed_at, received_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 || ' days')::interval, now() - ($9 || ' days')::interval) returning id`,
      [h.id, A, o.from || '+18015550142', o.sid, o.rec || null, o.gone ? new Date().toISOString() : null, o.status || 'dismissed', o.reason || null, String(o.age)]).then(r => String(r[0].id));
    const id = {
      spamOld:   await ins({ sid: 'CA1', reason: 'Spam / robocall', age: 120 }),
      hangOld:   await ins({ sid: 'CA2', reason: 'Hang-up / no message — twice', age: 100, rec: 'messages/2.mp3', gone: true }),
      hangAudio: await ins({ sid: 'CA3', reason: 'Hang-up / no message', age: 100, rec: 'messages/3.mp3' }),
      spamNew:   await ins({ sid: 'CA4', reason: 'Spam / robocall', age: 10 }),
      wrongOld:  await ins({ sid: 'CA5', reason: 'Wrong number', age: 200 }),
      loggedOld: await ins({ sid: 'CA6', status: 'logged', age: 200 }),
      mid:       await ins({ sid: 'CA7', reason: 'Other', age: 60 }),
    };

    // ── the rule, in the database ────────────────────────────────────────
    const c = await db.pool.connect();
    try {
      await c.query('begin');
      const as = async (claims, q) => {
        await c.query('savepoint s'); await c.query('set local role authenticated');
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        let out; try { out = (await c.query(q)).rows; } catch (e) { out = 'denied: ' + e.message; }
        await c.query('rollback to savepoint s');
        return out;
      };
      const stranger = await as({ email: 'anyone@stranger.example' }, `select * from pi_hotline_cleanup()`);
      t.eq(stranger, [], 'a non-staff login deletes nothing');
      const deleted = (await as({ email: 'staff@sunrise.example' }, `select * from pi_hotline_cleanup()`)).map(r => String(r.id)).sort();
      t.eq(deleted, [id.spamOld, id.hangOld].sort(), 'staff: only spam and hang-ups dismissed 90+ days ago with no recording left are deleted (a typed note is fine)');
      await c.query('savepoint a'); await c.query('set local role anon');
      let anon; try { await c.query(`select * from pi_hotline_cleanup()`); anon = 'ran'; } catch (e) { anon = 'denied'; }
      await c.query('rollback to savepoint a');
      t.eq(anon, 'denied', 'the anon key cannot call it');
    } finally { await c.query('rollback').catch(() => {}); c.release(); }
    t.eq((await t.sql(`select count(*)::int n from pi_hotline_messages`))[0].n, 7, '(the checks above were rolled back)');

    // ── the app and the SQL agree ────────────────────────────────────────
    const sqlText = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', '2026-10-18_hotline_junk_cleanup.sql'), 'utf8');

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    const rpcCalls = [];
    await app.page.route('**/rest/v1/rpc/pi_hotline_cleanup', async route => {
      rpcCalls.push(route.request().method());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: Number(id.spamOld) }]) });
    });
    try {
      await app.ready();
      const k = await app.page.evaluate(() => ({ reasons: HOT_JUNK_REASONS, days: HOT_JUNK_KEEP_DAYS, all: HOT_DISMISS_REASONS }));
      t.ok(k.reasons.every(r => k.all.includes(r) && sqlText.includes(`'${r}'`)) && sqlText.includes(`interval '${k.days} days'`)
        && (sqlText.match(/in \(([^)]*)\)/) || [])[1].split(',').length === k.reasons.length,
        'HOT_JUNK_REASONS / HOT_JUNK_KEEP_DAYS match the SQL rule, and both reasons are on the Dismiss list');

      // ── 30 days by default ────────────────────────────────────────────
      await app.page.evaluate(async () => { _hotPurgedAt = Date.now(); await _hotReload(); S.projectFilter = null; S.hotTab = 'closed'; S.hotRange = null; S.hotGroup = ''; setView('hotline'); });
      const ids = () => app.page.evaluate(() => [...document.querySelectorAll('#hot-list tr.hot-vm')].map(r => r.dataset.id));
      t.eq(await ids(), [id.spamNew], 'Logged & dismissed shows the last 30 days by default');
      t.ok(await app.page.evaluate(() => /6 older rows hidden/.test(document.getElementById('hot-list').previousElementSibling.textContent)), '…and says how many older rows are hidden');
      await app.page.evaluate(() => setHotFilter('hotRange', '90'));
      t.eq((await ids()).sort(), [id.spamNew, id.mid].sort(), 'Last 90 days adds the 60-day-old row');
      await app.page.evaluate(() => setHotFilter('hotRange', 'all'));
      t.eq((await ids()).length, 7, 'All shows every row — nothing was deleted by hiding');
      t.ok(await app.page.evaluate(() => /deleted after 90 days/.test(document.querySelector('.content').textContent)), 'the tab says what is removed and when');

      // ── group by date ─────────────────────────────────────────────────
      await app.page.evaluate(() => setHotFilter('hotGroup', 'date'));
      const days = await app.page.evaluate(() => [...document.querySelectorAll('#hot-list tr.hot-day')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
      t.ok(days.length === 5 && days.filter(d => /2 calls/.test(d)).length === 2 && /\w{3}, \w{3} \d+, \d{4}/.test(days[0]),
        'By date: one header per day (with the day and how many), newest first');
      await app.page.evaluate(() => setHotFilter('hotGroup', 'caller'));
      t.eq(await app.page.evaluate(() => document.querySelectorAll('#hot-list tr.hot-group:not(.hot-day)').length), 1, 'By caller still works (one number here)');
      await app.page.evaluate(() => { S.hotGroup = true; render(); });
      t.eq(await app.page.evaluate(() => document.getElementById('hot-group').value), 'caller', 'an older saved "true" reads as By caller');

      // ── a call waiting for a decision is never hidden ────────────────
      const [old] = await t.sql(`insert into pi_hotline_calls (hotline_id, project_id, to_number, ring_number, placed_by, placed_by_email, status, created_at)
        values ($1,$2,'+18015550177','+18015550142','PUT','putzke@demo.test','completed', now() - interval '45 days') returning id`, [h.id, A]);
      await t.sql(`insert into pi_hotline_calls (hotline_id, project_id, to_number, ring_number, placed_by, placed_by_email, status, outcome, created_at)
        values ($1,$2,'+18015550178','+18015550142','PUT','putzke@demo.test','completed','not_logged', now() - interval '45 days')`, [h.id, A]);
      await app.page.evaluate(async () => { await _hotReload(); S.hotRange = null; S.hotGroup = ''; setHotFilter('hotTab', 'calls'); });
      const calls = await app.page.evaluate(() => [...document.querySelectorAll('#hot-list tr.hot-call')].map(r => r.dataset.id));
      t.eq(calls, [String(old.id)], 'Calls: an old call still to decide shows; an old decided one is hidden');

      // ── the inbox runs the clean-up and drops what it deleted ─────────
      await app.page.evaluate(async () => { _hotPurgedAt = 0; await _hotPurgeExpired(); });
      t.eq(rpcCalls, ['POST'], 'opening the inbox asks the database to clean up (POST /rpc/pi_hotline_cleanup)');
      t.ok(await app.page.evaluate(sid => !DB.get('hotline_messages').some(m => String(m.id) === sid), id.spamOld), '…and the deleted row leaves the list at once');
      t.ok(await app.page.evaluate(() => /are deleted after 90 days/.test((hotDismiss(String(DB.get('hotline_messages')[0].id)), document.getElementById('modal-ov').textContent))),
        'the Dismiss dialog says which reasons are deleted after 90 days');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
