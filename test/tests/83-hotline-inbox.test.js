// The Hotline inbox and Settings → Project hotlines (index.html).
//
//  - The nav item appears once a hotline exists; its badge counts voicemails
//    waiting on me plus unassigned ones.
//  - Mine / Unassigned / All; oldest first; a general-mailbox message shows
//    whatever project is in scope.
//  - "Log as interaction" opens the ordinary dialog PREFILLED (project, date,
//    Phone, Incoming, transcript, "Call back" follow-up to the assignee) and
//    only SUGGESTS the contact whose phone matches; saving closes the
//    voicemail out against the new interaction.
//  - A Spanish voicemail can mark the contact LEP.
//  - Dismiss records a reason and creates no interaction.
//  - Reassign saves and asks the receiver to email the new assignee.
//  - Threads: "+ Related contact" links a new interaction to the earlier one,
//    can resolve its follow-up, and the thread shows in the dialog.
//  - Settings: a menu hotline with extensions is saved; a removed extension is
//    switched off, not deleted; "what callers hear" matches the receiver.
const path = require('path');
const { pathToFileURL } = require('url');

module.exports = {
  name: 'hotline inbox — log, dismiss, reassign, threads, settings',
  async run({ t }) {
    t.seed();
    const L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', 'hotline', 'logic.mjs')).href);
    const [A, B] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 2`)).map(r => String(r.id));
    await t.sql(`update pi_projects set lead='PUT' where id=$1`, [A]);
    await t.sql(`insert into pi_team_members (name, initials, email, active) values ('Jeff P','PUT','putzke@demo.test',true),('Sam H','SHA','sha@demo.test',true)`);
    // A contact on project A whose phone matches the first caller.
    const [st] = await t.sql(`select s.id from pi_stakeholders s join pi_project_stakeholders l on l.stakeholder_id = s.id::text
                               where l.project_id=$1 and coalesce(s.is_archived,false)=false order by s.id limit 1`, [A]);
    await t.sql(`update pi_stakeholders set phone='801-555-0142', lep=false where id=$1`, [st.id]);
    const [h] = await t.sql(`insert into pi_hotlines (name, phone_number, spanish_enabled) values ('Region One','+18015550101',true) returning id`);
    await t.sql(`insert into pi_hotline_extensions (hotline_id, digit, project_id, label) values ($1,'1',$2,'the first project'),($1,'2',$3,'the second project')`, [h.id, A, B]);
    const ins = (o) => t.sql(`insert into pi_hotline_messages (hotline_id, extension_digit, project_id, language, caller_number, call_sid,
        recording_path, recording_seconds, transcript, transcript_status, status, assigned_to, received_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12) returning id`,
      [h.id, o.d, o.p, o.lang || 'en', o.from, o.sid, o.rec || null, o.sec || 30, o.tr || null, o.ts || 'pending', o.to || null, o.at]).then(r => String(r[0].id));
    const m1 = await ins({ d: '1', p: A, from: '+18015550142', sid: 'CA1', rec: 'messages/1.mp3', tr: 'Hi, the detour sign on 400 North is down.', ts: 'done', to: 'PUT', at: '2026-10-10T15:00:00Z' });
    const m2 = await ins({ d: '0', p: null, lang: 'es', from: '+13855550111', sid: 'CA2', ts: 'none', at: '2026-10-09T15:00:00Z' });
    const m3 = await ins({ d: '2', p: B, from: '+13855550122', sid: 'CA3', to: 'SHA', at: '2026-10-08T15:00:00Z' });
    const m4 = await ins({ d: '2', p: B, from: '+13855550133', sid: 'CA4', to: 'SHA', at: '2026-10-07T15:00:00Z' });

    const app = await t.open('index.html', { email: 'putzke@demo.test' });   // initials PUT
    const notified = [];
    await app.page.route('**/functions/v1/hotline/notify', async route => {
      notified.push({ auth: route.request().headers()['authorization'], body: JSON.parse(route.request().postData() || '{}') });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"sent":true}' });
    });
    try {
      await app.ready();
      await app.page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
      // ready() resolves once the data is in; the first render follows a moment later.
      await app.page.waitForFunction(() => typeof _hotWaitingForMe === 'function' && document.querySelector('.topbar'));
      await app.page.evaluate(() => refreshBadges());
      t.ok(await app.page.evaluate(() => document.getElementById('nav-hotline').style.display !== 'none'), 'the Hotline nav item shows once a hotline exists');
      t.eq(await app.page.evaluate(() => document.getElementById('nb-hot').textContent), '2', 'badge = mine (1) + unassigned (1)');

      await app.page.evaluate(() => setView('hotline'));
      const ids = () => app.page.evaluate(() => [...document.querySelectorAll('.hot-card')].map(c => c.dataset.id));
      t.eq(await ids(), [m1], 'opens on Mine');
      await app.page.evaluate(() => setHotFilter('hotWho', 'all'));
      t.eq(await ids(), [m4, m3, m2, m1], 'All, oldest first');
      await app.page.evaluate(B => { S.projectFilter = B; render(); }, B);
      t.eq(await ids(), [m4, m3, m2], 'scoped to a project: its messages plus the general mailbox');
      await app.page.evaluate(() => { S.projectFilter = null; render(); });
      const card1 = await app.page.evaluate(id => document.querySelector(`.hot-card[data-id="${id}"]`).textContent, m1);
      t.ok(/detour sign/.test(card1) && /Number matches/.test(card1) && /Play recording/.test(card1), 'a card shows the transcript, the phone match and the recording');
      const card2 = await app.page.evaluate(id => document.querySelector(`.hot-card[data-id="${id}"]`).textContent, m2);
      t.ok(/Español · LEP/.test(card2) && /General mailbox/.test(card2) && /listen to the recording/.test(card2), 'a Spanish general-mailbox message says so');

      // ── log m1 ────────────────────────────────────────────────────────
      const intsBefore = (await t.sql(`select count(*)::int n from pi_interactions`))[0].n;
      await app.page.evaluate(id => hotLog(id), m1);
      const form = await app.page.evaluate(() => ({
        title: document.querySelector('#modal-ov .modal-title, #modal-ov h2, #modal-ov .mhead')?.textContent || document.getElementById('modal-ov').textContent.slice(0, 80),
        proj: document.getElementById('f-ip').value, ch: document.getElementById('f-ic').value, dir: document.getElementById('f-idr').value,
        date: document.getElementById('f-id').value, sum: document.getElementById('f-isu').value,
        fu: document.getElementById('f-ifu').checked, fun: document.getElementById('f-ifun').value, fud: document.getElementById('f-ifud').value,
        stake: document.getElementById('f-is').value, useBtn: !!document.querySelector('#modal-ov button[onclick^="_intSetStake"]'),
      }));
      t.ok(/Log hotline voicemail/.test(form.title), 'the Log dialog opens for the voicemail');
      t.ok(form.proj === A && form.ch === 'Phone' && form.dir === 'Incoming' && form.date === '2026-10-10', 'prefilled: project, Phone, Incoming, the day it was left');
      t.ok(/^Hotline voicemail \(Region One, pressed 1\)/.test(form.sum) && /detour sign/.test(form.sum), 'the summary starts from the transcript');
      t.ok(form.fu && /^Call back at \(801\) 555-0142/.test(form.fun) && form.fud === '2026-10-13', 'a “Call back” follow-up, due two working days later');
      t.ok(form.stake === '' && form.useBtn, 'the matching contact is suggested, not attached');
      await app.page.evaluate(() => document.querySelector('#modal-ov button[onclick^="_intSetStake"]').click());
      await app.page.evaluate(() => saveInt());
      const logged = await t.until(async () => (await t.sql(`select * from pi_hotline_messages where id=$1 and status='logged'`, [m1]))[0]);
      t.ok(logged && logged.logged_interaction_id && logged.closed_by === 'PUT' && logged.audio_purge_after, 'the voicemail is closed out against the interaction, with a recording clean-up date');
      const [int1] = await t.sql(`select * from pi_interactions where id=$1`, [logged && logged.logged_interaction_id]);
      t.ok(int1 && String(int1.stakeholder_id) === String(st.id) && int1.channel === 'Phone' && int1.direction === 'Incoming' && int1.follow_up === true, 'the interaction carries the chosen contact and the follow-up');
      t.eq((await t.sql(`select count(*)::int n from pi_interactions`))[0].n, intsBefore + 1, 'exactly one interaction');
      const days = (new Date(logged.audio_purge_after) - new Date(logged.closed_at)) / 864e5;
      t.ok(Math.round(days) === 90, 'recording kept 90 days after logging');

      // ── Spanish m2: choose a project, mark LEP ─────────────────────────
      await app.page.evaluate(id => hotLog(id), m2);
      t.ok(await app.page.evaluate(() => document.getElementById('f-ihot-lep')?.checked === true), 'Spanish: “mark as LEP” offered and ticked');
      t.eq(await app.page.evaluate(() => document.getElementById('f-ip').value), '', 'general mailbox: the project is left for staff to choose');
      await app.page.evaluate(({ A, sid }) => { const ps = document.getElementById('f-ip'); ps.value = A; updateIntStakeholders(); _intSetStake(sid); }, { A, sid: String(st.id) });
      await app.page.evaluate(() => saveInt());
      t.ok(await t.until(async () => (await t.sql(`select lep from pi_stakeholders where id=$1`, [st.id]))[0].lep === true), 'the contact is now marked LEP');
      t.ok(await t.until(async () => (await t.sql(`select status from pi_hotline_messages where id=$1`, [m2]))[0].status === 'logged'), 'Spanish voicemail logged');

      // ── dismiss m3 ─────────────────────────────────────────────────────
      const n0 = (await t.sql(`select count(*)::int n from pi_interactions`))[0].n;
      await app.page.evaluate(id => hotDismiss(id), m3);
      await app.page.evaluate(() => { document.getElementById('f-hd-reason').value = 'Wrong number'; document.getElementById('f-hd-note').value = 'asked for the DMV'; });
      await app.page.evaluate(() => saveHotDismiss());
      const [d3] = await t.sql(`select * from pi_hotline_messages where id=$1`, [m3]);
      t.ok(d3.status === 'dismissed' && d3.dismiss_reason === 'Wrong number — asked for the DMV' && d3.closed_by === 'PUT', 'dismissed with the reason');
      t.eq((await t.sql(`select count(*)::int n from pi_interactions`))[0].n, n0, 'dismissing creates no interaction');

      // ── reassign m4 ────────────────────────────────────────────────────
      await app.page.evaluate(id => hotReassign(id, 'PUT'), m4);
      const [r4] = await t.sql(`select assigned_to, assigned_by from pi_hotline_messages where id=$1`, [m4]);
      t.ok(r4.assigned_to === 'PUT' && r4.assigned_by === 'PUT', 'reassigned');
      t.ok(notified.length === 1 && String(notified[0].body.messageId) === m4 && /^Bearer /.test(notified[0].auth), 'the receiver was asked to email the new assignee, with my session');

      // ── closed list ────────────────────────────────────────────────────
      await app.page.evaluate(() => setHotFilter('hotTab', 'closed'));
      const closed = await app.page.evaluate(() => document.getElementById('hot-list').textContent);
      t.ok(/Logged by PUT/.test(closed) && /Dismissed — Wrong number/.test(closed) && /Open interaction/.test(closed), 'Logged & dismissed lists both, with a link to the interaction');

      // ── threads ────────────────────────────────────────────────────────
      const parentId = String(logged.logged_interaction_id);
      await app.page.evaluate(id => openEditIntModal(id), parentId);
      t.ok(await app.page.evaluate(() => !!document.querySelector('#modal-ov button[onclick^="logRelatedInt"]')), 'the edit dialog has “+ Related contact”');
      await app.page.evaluate(id => logRelatedInt(id), parentId);
      await app.page.waitForFunction(() => document.getElementById('f-irelres'));
      t.ok(await app.page.evaluate(() => document.getElementById('f-irelres').checked), 'offers to resolve the earlier follow-up');
      await app.page.evaluate(() => { document.getElementById('f-isu').value = 'Called back; crew reset the sign.'; document.getElementById('f-idr').value = 'Outgoing'; });
      await app.page.evaluate(() => saveInt());
      const child = await t.until(async () => (await t.sql(`select * from pi_interactions where related_to=$1`, [parentId]))[0]);
      t.ok(child && /crew reset/.test(child.summary), 'the callback is its own interaction, linked to the voicemail');
      const [par] = await t.sql(`select follow_up_done, follow_up_resolution from pi_interactions where id=$1`, [parentId]);
      t.ok(par.follow_up_done === true && /See the related phone/.test(par.follow_up_resolution || ''), 'and resolves the voicemail’s follow-up');
      t.eq(await app.page.evaluate(id => _intThread(id).length, String(child.id)), 2, 'the thread holds both, from either end');
      await app.page.evaluate(id => openEditIntModal(id), parentId);
      t.ok(await app.page.evaluate(() => /Thread · 2 contacts/.test(document.getElementById('modal-ov').textContent)), 'the dialog shows the thread');
      await app.page.evaluate(() => closeM());

      // ── Settings ───────────────────────────────────────────────────────
      await app.page.evaluate(() => setView('settings'));
      t.ok(await app.page.evaluate(() => /Region One/.test(document.getElementById('hotline-card-body').textContent)), 'Settings lists the hotline');
      await app.page.evaluate(({ A, B }) => {
        openHotlineModal();
        document.getElementById('f-hl-name').value = 'Weber County';
        document.getElementById('f-hl-num').value = '(801) 555-0199';
        document.querySelector('input[name="f-hl-mode"][value="menu"]').checked = true; _hotModeChanged();
        _hotAddExt();
        const rows = document.querySelectorAll('#f-hl-exts .hot-ext-row');
        rows[0].querySelector('.hx-proj').value = A; rows[0].querySelector('.hx-label').value = 'the first project';
        rows[1].querySelector('.hx-proj').value = B; rows[1].querySelector('.hx-label').value = 'the second project';
        document.getElementById('f-hl-es').checked = false; _hotPreview();
      }, { A, B });
      const preview = await app.page.evaluate(() => document.getElementById('f-hl-preview').textContent);
      const want = L.menuText({ spanish_enabled: false }, [{ digit: '1', label: 'the first project' }, { digit: '2', label: 'the second project' }], 'en');
      t.ok(preview.includes(want), '“What callers hear” matches the receiver’s own menu');
      await app.page.evaluate(() => saveHotline());
      const [wh] = await t.sql(`select * from pi_hotlines where name='Weber County'`);
      t.ok(wh && wh.phone_number === '+18015550199' && wh.spanish_enabled === false && !wh.project_id, 'the hotline is saved, number in E.164');
      t.eq((await t.sql(`select digit from pi_hotline_extensions where hotline_id=$1 and active order by digit`, [wh.id])).map(r => r.digit), ['1', '2'], 'two extensions');
      await app.page.evaluate(id => { openHotlineModal(id); document.querySelectorAll('#f-hl-exts .hot-ext-row')[1].remove(); }, String(wh.id));
      await app.page.evaluate(() => saveHotline());
      const ex = await t.sql(`select digit, active from pi_hotline_extensions where hotline_id=$1 order by digit`, [wh.id]);
      t.eq(ex, [{ digit: '1', active: true }, { digit: '2', active: false }], 'a removed extension is switched off, not deleted');
      t.ok(L.menuText({ spanish_enabled: true }, [{ digit: '1', label: 'x' }], 'en') === await app.page.evaluate(() => _hotMenuText({ spanishEnabled: true }, [{ digit: '1', label: 'x' }], 'en'))
        && L.menuText({ spanish_enabled: true }, [{ digit: '1', label: 'x', label_es: 'y' }], 'es') === await app.page.evaluate(() => _hotMenuText({ spanishEnabled: true }, [{ digit: '1', label: 'x', labelEs: 'y' }], 'es')),
        'the app’s menu text and the receiver’s agree, English and Spanish');
      // The page's CSP falls back to default-src 'self' for audio; without a
      // media-src naming both Supabase projects the player loads nothing.
      const csp = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8').match(/Content-Security-Policy" content="([^"]*)"/)[1];
      const media = (csp.match(/media-src([^;]*)/) || [, ''])[1];
      t.ok(/ncfbblhlsiglxkoiounv\.supabase\.co/.test(media) && /oxbonrnilvadszgfctfl\.supabase\.co/.test(media), 'the CSP lets the recording player load audio from both Supabase projects');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
