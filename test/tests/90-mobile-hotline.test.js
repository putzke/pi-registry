// The hotline on mobile (Oct 2026; plan agreed with Jeff 2026-10-12).
//
//  - One bottom nav, drawn by renderBottomNavs(). Once a hotline exists,
//    Hotline takes Dashboard's place (badge = voicemails waiting on me +
//    unassigned + my calls to decide) and the phone opens on it.
//  - The Hotline screen: Calls to decide (Log / Don't log), voicemails
//    (play, transcript, Log, Call back, Dismiss), New call.
//  - Log = mobile's own Log sheet, prefilled; a phone match is offered as
//    "Use …" and linked to the project only on save; "Save — no call-back
//    needed" when nothing follows; "Save & log call-back" opens a next
//    contact linked by related_to.
//  - related_to is never sent before the column is known, and never as ''.
module.exports = {
  name: 'mobile hotline — nav, voicemails, log + call-back thread, dismiss, call back, new call',
  async run({ t }) {
    t.seed();
    const [A, B] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 2`)).map(r => String(r.id));
    await t.sql(`insert into pi_team_members (name, initials, email, phone, active) values ('Jeff P','PUT','putzke@demo.test','801-555-0177',true),('Sam H','SHA','sha@demo.test',null,true)`);
    // A contact on project B only, whose phone matches a caller to project A.
    const [st] = await t.sql(`select s.id from pi_stakeholders s join pi_project_stakeholders l on l.stakeholder_id = s.id::text
                               where l.project_id=$1 and coalesce(s.is_archived,false)=false
                                 and not exists (select 1 from pi_project_stakeholders x where x.stakeholder_id = s.id::text and x.project_id=$2)
                               order by s.id limit 1`, [B, A]);
    const ST = String(st.id);
    await t.sql(`update pi_stakeholders set phone='(801) 555-0987', lep=false where id=$1`, [ST]);

    const mobOpts = { email: 'putzke@demo.test', viewport: { width: 414, height: 896 } };
    const loaded = page => page.waitForFunction(() => typeof _syncCache !== 'undefined' && Array.isArray(_syncCache.hotlines) && document.querySelector('nav.bottom-nav .nav-item'), null, { timeout: 15000 });

    // ── no hotline: the nav is unchanged ────────────────────────────────
    let mob = await t.open('mobile.html', mobOpts);
    try {
      await loaded(mob.page);
      const nav = await mob.page.evaluate(() => [...document.querySelectorAll('nav.bottom-nav[data-active="contacts"] .nav-label')].map(e => e.textContent));
      t.eq(nav, ['Dashboard', 'Contacts', 'Log', 'Follow-ups', 'Issues'], 'no hotline: Dashboard is first, as before');
      t.ok(await mob.page.evaluate(() => document.getElementById('screen-home').classList.contains('active')), 'no hotline: the phone opens on the Dashboard');
      t.eq(await mob.page.evaluate(() => document.querySelectorAll('nav.bottom-nav').length), 6, 'every screen with a nav gets the shared bar');
      // related_to: left out before the column is known, and never sent empty.
      const sb = await mob.page.evaluate(() => {
        const was = window._relCol;
        window._relCol = false; const a = toSB('interactions', { summary: 'x', relatedTo: '5' });
        window._relCol = true;  const b = toSB('interactions', { summary: 'x', relatedTo: '' }), c = toSB('interactions', { summary: 'x', relatedTo: '5' });
        window._relCol = was;
        return { a: 'related_to' in a, b: 'related_to' in b, c: c.related_to };
      });
      t.eq(sb, { a: false, b: false, c: 5 }, 'related_to: not sent before the column is known, never sent as \'\', sent as a number otherwise');
      t.eq(mob.errors, [], 'no page errors (no hotline)');
    } finally { await mob.close(); }

    // ── with a hotline ──────────────────────────────────────────────────
    const [h] = await t.sql(`insert into pi_hotlines (name, phone_number, spanish_enabled) values ('Region One','+18015550101',true) returning id`);
    await t.sql(`insert into pi_hotline_extensions (hotline_id, digit, project_id, label) values ($1,'1',$2,'the first project'),($1,'2',$3,'the second project')`, [h.id, A, B]);
    const ins = (o) => t.sql(`insert into pi_hotline_messages (hotline_id, extension_digit, project_id, language, caller_number, call_sid,
        recording_path, recording_seconds, transcript, transcript_status, status, assigned_to, received_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12) returning id`,
      [h.id, o.d, o.p, o.lang || 'en', o.from, o.sid, o.rec || null, 30, o.tr || null, o.ts || 'done', o.to || null, o.at]).then(r => String(r[0].id));
    const m1 = await ins({ d: '1', p: A, from: '+18015550987', sid: 'CA1', rec: 'messages/1.mp3', tr: 'The detour sign on 400 North is down.', to: 'PUT', at: '2026-10-10T15:00:00Z' });
    const m2 = await ins({ d: '1', p: A, lang: 'es', from: '+13855550111', sid: 'CA2', tr: 'Hola, tengo una pregunta.', at: '2026-10-09T15:00:00Z' });
    const m3 = await ins({ d: '2', p: B, from: '+13855550122', sid: 'CA3', to: 'SHA', at: '2026-10-08T15:00:00Z' });
    const m4 = await ins({ d: '2', p: B, from: '+13855550133', sid: 'CA4', at: '2026-10-07T15:00:00Z' });

    mob = await t.open('mobile.html', mobOpts);
    const callbacks = [], dials = [];
    await mob.page.route('**/functions/v1/hotline/callback', async route => {
      callbacks.push({ auth: route.request().headers()['authorization'], body: JSON.parse(route.request().postData() || '{}') });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"sid":"CAx"}' });
    });
    await mob.page.route('**/functions/v1/hotline/dial', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      dials.push(body);
      const [c] = await t.sql(`insert into pi_hotline_calls (hotline_id, project_id, stakeholder_id, to_number, ring_number, placed_by, placed_by_email, status)
                               values ($1,$2,$3,$4,$5,$6,'putzke@demo.test','ringing') returning id`,
        [body.hotlineId, body.projectId, body.stakeholderId, body.to, body.ringMe, body.placedBy]);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, callId: c.id }) });
    });
    await mob.page.route('**/storage/v1/object/sign/hotline-audio/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"signedURL":"/object/sign/hotline-audio/messages/1.mp3?token=t"}' }));
    try {
      await loaded(mob.page);
      await mob.page.waitForFunction(() => document.getElementById('screen-hotline').classList.contains('active'), null, { timeout: 5000 });
      t.ok(true, 'with a hotline, the phone opens on the Hotline screen');
      const nav = await mob.page.evaluate(() => [...document.querySelectorAll('nav.bottom-nav[data-active="issues"] .nav-label')].map(e => e.textContent));
      t.eq(nav, ['Hotline', 'Contacts', 'Log', 'Follow-ups', 'Issues'], 'Hotline takes Dashboard’s place in every nav');
      t.eq(await mob.page.evaluate(() => document.querySelector('.nav-badge[data-badge="hot"]').textContent), '3', 'the badge counts mine + unassigned (m1, m2, m4), not Sam’s');
      const shown = () => mob.page.evaluate(() => [...document.querySelectorAll('#hot-body .hot-card')].map(c => c.dataset.id));
      t.eq(await shown(), [m4, m2, m1], 'Mine & unassigned, oldest first');
      await mob.page.evaluate(() => { document.getElementById('hot-who').value = 'all'; renderHotline(); });
      t.eq(await shown(), [m4, m3, m2, m1], 'All waiting adds Sam’s');
      t.ok(await mob.page.evaluate(() => /Use full desktop site/.test(document.getElementById('hot-body').textContent) && /Dashboard/.test(document.getElementById('hot-body').textContent)),
        'the Dashboard and the desktop site are one tap away');
      t.ok(await mob.page.evaluate(() => /media-src[^;]*oxbonrnilvadszgfctfl\.supabase\.co/.test(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content)),
        'the page may play recordings from the database (CSP media-src)');

      // Play
      await mob.page.evaluate(id => mobHotPlay(id), m1);
      t.ok(await mob.page.waitForFunction(id => { const a = document.querySelector('#hot-audio-' + id + ' audio'); return a && /hotline-audio\/messages\/1\.mp3/.test(a.src); }, m1).then(() => true),
        'Play signs the recording and shows a player');

      // ── Log m1: prefilled; the phone match is offered, not attached ──
      await mob.page.evaluate(id => mobHotLog(id), m1);
      const f = await mob.page.evaluate(() => ({
        open: document.getElementById('sheet-log').classList.contains('open'),
        proj: document.getElementById('log-proj').value, date: document.getElementById('log-date').value,
        ch: document.getElementById('log-channel').value, dir: document.getElementById('log-direction').value,
        sum: document.getElementById('log-summary').value, stake: document.getElementById('log-stake').value,
        fu: document.getElementById('log-fu').checked, fuNote: document.getElementById('log-fu-note').value, fuDue: document.getElementById('log-fu-date').value,
        use: [...document.querySelectorAll('#log-hot button')].map(b => b.textContent.trim()),
        save: document.getElementById('log-save').textContent, next: getComputedStyle(document.getElementById('log-save-next')).display }));
      t.ok(f.open && f.proj === A && f.date === '2026-10-10' && f.ch === 'Phone' && f.dir === 'Incoming', 'the Log sheet opens prefilled: project, the day it was left, Phone, Incoming');
      t.ok(/Hotline voicemail \(Region One, pressed 1\)/.test(f.sum) && /detour sign/.test(f.sum), '…with the transcript in the summary');
      t.ok(!f.fu && /Call back at \(801\) 555-0987/.test(f.fuNote) && f.fuDue === '2026-10-13', 'the call-back follow-up is prefilled but NOT ticked (two working days out — Mon, Tue)');
      t.ok(f.stake === '' && f.use.some(x => /^Use /.test(x)), 'the matching contact is offered as “Use …”, not attached');
      t.ok(f.use.some(x => /Call me now/.test(x)), 'the sheet carries “Call me now”');
      t.eq(f.save, 'Save — no call-back needed', 'with nothing to follow, the button says so');
      t.ok(f.next !== 'none', '“Save & log call-back” is offered');
      await mob.page.evaluate(() => { document.getElementById('log-fu').checked = true; toggleLogFU(); });
      t.ok(await mob.page.evaluate(() => document.getElementById('log-save').textContent === 'Save interaction' && document.getElementById('log-fu-date').value === '2026-10-13'),
        'ticking the follow-up restores “Save interaction” and keeps the prefilled due date');
      await mob.page.evaluate(() => { document.getElementById('log-fu').checked = false; toggleLogFU(); });

      // Call me now from inside the sheet
      await mob.page.evaluate(() => [...document.querySelectorAll('#log-hot button')].find(b => /Call me now/.test(b.textContent)).click());
      await mob.page.evaluate(() => { document.getElementById('hot-ring-me').value = '(801) 555-0177'; return mobHotCallGo(); });
      t.ok(callbacks.length === 1 && callbacks[0].body.messageId === Number(m1) && callbacks[0].body.ringMe === '+18015550177' && /^Bearer /.test(callbacks[0].auth || ''),
        'Call me now asks the receiver to ring my phone, with my session');
      t.ok(await mob.page.evaluate(() => document.getElementById('sheet-log').classList.contains('open') && /Ringing you/.test(document.getElementById('log-hot-cb').textContent)),
        'the Log sheet stays open for the call-back');

      await mob.page.evaluate(() => [...document.querySelectorAll('#log-hot button')].find(b => /^Use /.test(b.textContent.trim())).click());
      t.eq(await mob.page.evaluate(() => document.getElementById('log-stake').value), ST, '“Use …” selects the contact');
      await mob.page.evaluate(() => saveInteractionAndNext());
      const orig = await t.until(async () => (await t.sql(`select id, stakeholder_id, project_id, follow_up from pi_interactions where summary like 'Hotline voicemail (Region One, pressed 1)%'`))[0]);
      t.ok(orig && String(orig.stakeholder_id) === ST && String(orig.project_id) === A && !orig.follow_up, 'the interaction is saved for the chosen contact, with no follow-up');
      const msg = await t.until(async () => (await t.sql(`select status, logged_interaction_id, closed_by, audio_purge_after from pi_hotline_messages where id=$1 and status='logged'`, [m1]))[0]);
      t.ok(msg && String(msg.logged_interaction_id) === String(orig.id) && msg.closed_by === 'PUT' && msg.audio_purge_after, 'the voicemail is closed out against it (logged, by me, audio purge date set)');
      t.ok(await t.until(async () => (await t.sql(`select 1 from pi_project_stakeholders where project_id=$1 and stakeholder_id=$2`, [A, ST]))[0]),
        'a contact from another project is linked to this one on save');

      // The next contact: Outgoing, same contact, linked to the original.
      await mob.page.waitForFunction(() => document.getElementById('sheet-log').classList.contains('open') && /Next contact on/.test(document.getElementById('log-hot').textContent), null, { timeout: 5000 });
      const nx = await mob.page.evaluate(() => ({ dir: document.getElementById('log-direction').value, stake: document.getElementById('log-stake').value,
        proj: document.getElementById('log-proj').value, fuShown: getComputedStyle(document.getElementById('log-fu').closest('.card')).display }));
      t.ok(nx.dir === 'Outgoing' && nx.stake === ST && nx.proj === A, 'Save & log call-back opens a next contact: Outgoing, same project and contact');
      t.eq(nx.fuShown, 'none', 'a next contact has no follow-up box of its own');
      await mob.page.evaluate(() => { document.getElementById('log-summary').value = 'CALLED THEM BACK ABOUT THE SIGN'; return saveInteraction(); });
      const child = await t.until(async () => (await t.sql(`select related_to, direction from pi_interactions where summary='CALLED THEM BACK ABOUT THE SIGN'`))[0]);
      t.ok(child && String(child.related_to) === String(orig.id) && child.direction === 'Outgoing', 'the call-back is saved linked to the original (related_to)');

      // ── Spanish m2: LEP ──
      await mob.page.evaluate(id => mobHotLog(id), m2);
      t.ok(await mob.page.evaluate(() => !!document.getElementById('log-hot-lep') && document.getElementById('log-hot-lep').checked), 'a Spanish voicemail offers “Mark the contact LEP”, ticked');
      await mob.page.evaluate(st => { selectStake(st, 'X'); return saveInteraction(); }, ST);
      t.ok(await t.until(async () => (await t.sql(`select lep from pi_stakeholders where id=$1 and lep`, [ST]))[0]), '…and saving marks the contact LEP');

      // ── Dismiss m4 ──
      await mob.page.evaluate(id => mobHotDismiss(id), m4);
      await mob.page.evaluate(() => { document.getElementById('hot-dis-reason').value = 'Wrong number'; document.getElementById('hot-dis-note').value = 'asked for the DMV'; return mobHotDismissGo(); });
      const dm = (await t.sql(`select status, dismiss_reason from pi_hotline_messages where id=$1`, [m4]))[0];
      t.ok(dm.status === 'dismissed' && dm.dismiss_reason === 'Wrong number — asked for the DMV', 'Dismiss records the reason and note');
      t.eq((await t.sql(`select count(*)::int n from pi_interactions where summary like '%555-0133%'`))[0].n, 0, '…and creates no interaction');

      // ── New call → Calls to decide ──
      await mob.page.evaluate(() => mobHotNewCall());
      const projOpts = await mob.page.evaluate(() => [...document.getElementById('hot-nc-proj').options].map(o => o.value));
      t.eq(projOpts, ['', A, B], 'New call: the line’s menu projects are offered');
      await mob.page.evaluate(A => { const s = document.getElementById('hot-nc-proj'); s.value = A; _hotNcProj(); document.getElementById('hot-nc-to').value = '(385) 555-0199'; return mobHotCallGo(); }, A);
      t.ok(dials.length === 1 && dials[0].to === '+13855550199' && dials[0].ringMe === '+18015550177' && String(dials[0].projectId) === A && dials[0].placedBy === 'PUT',
        'New call sends line, number, my phone (remembered), project and me to the receiver');
      await mob.page.waitForFunction(() => document.querySelectorAll('#hot-body .hot-call').length === 1, null, { timeout: 5000 });
      t.ok(true, 'the call waits under “Calls to decide”');
      await mob.page.evaluate(() => { mobHotNewCall(); document.getElementById('hot-nc-to').value = '(809) 555-0100'; return mobHotCallGo(); });
      t.eq(dials.length, 1, 'a Caribbean area code is refused on the phone, before the receiver');
      await mob.page.evaluate(() => closeSheet('sheet-hot-call'));

      const [c1] = await t.sql(`select id from pi_hotline_calls order by id limit 1`);
      await mob.page.evaluate(id => mobHotCallLog(id), String(c1.id));
      t.ok(await mob.page.evaluate(() => document.getElementById('log-direction').value === 'Outgoing' && /Called \(385\) 555-0199 from the Region One hotline/.test(document.getElementById('log-summary').value)),
        'Log this call opens the sheet as Outgoing, prefilled');
      await mob.page.evaluate(() => saveInteraction());
      const lc = await t.until(async () => (await t.sql(`select outcome, logged_interaction_id from pi_hotline_calls where id=$1 and outcome='logged'`, [c1.id]))[0]);
      t.ok(lc && lc.logged_interaction_id, 'saving marks the call logged against the interaction');

      // A second call: Don't log.
      const [c2] = await t.sql(`insert into pi_hotline_calls (hotline_id, to_number, ring_number, placed_by, placed_by_email, status) values ($1,'+13855550198','+18015550177','PUT','putzke@demo.test','completed') returning id`, [h.id]);
      await mob.page.evaluate(async () => { await _hotReload(); renderHotline(); });
      await mob.page.evaluate(id => mobHotCallSkip(id), String(c2.id));
      t.eq((await t.sql(`select outcome from pi_hotline_calls where id=$1`, [c2.id]))[0].outcome, 'not_logged', 'Don’t log records the choice');
      t.eq(await mob.page.evaluate(() => document.querySelectorAll('#hot-body .hot-call').length), 0, 'nothing left to decide');

      // An ordinary log (not from the hotline) is unchanged.
      await mob.page.evaluate(A => { openSheet('sheet-log'); document.getElementById('log-proj').value = A; document.getElementById('log-summary').value = 'PLAIN MOBILE LOG'; }, A);
      t.ok(await mob.page.evaluate(() => getComputedStyle(document.getElementById('log-save-next')).display === 'none' && document.getElementById('log-save').textContent === 'Save interaction' && document.getElementById('log-hot').style.display === 'none'),
        'an ordinary Log sheet shows none of the hotline parts');
      await mob.page.evaluate(() => saveInteraction());
      t.ok(await t.until(async () => (await t.sql(`select related_to from pi_interactions where summary='PLAIN MOBILE LOG' and related_to is null`))[0]), 'and saves with no related_to');
      t.eq(mob.errors, [], 'no page errors');
    } finally { await mob.close(); }
  },
};
