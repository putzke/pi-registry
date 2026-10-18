// Follow-ups vs. next contacts, and the hotline call-back (Jeff, Oct 2026).
//
//  - The box reads "Requires a scheduled follow-up". Logging a voicemail
//    opens it prefilled but UNTICKED; ticking it is a deliberate choice.
//  - An inbound hotline call saved with neither a follow-up nor a next
//    contact is a deliberate "no call-back needed" — the Save button says so,
//    and goes back to "Save interaction" once the follow-up is ticked.
//  - "Save & log next contact" is on every new interaction: the one just
//    saved becomes the original, and the next contact links to it.
//  - The log shows tags: "No call-back needed", "Called back · date",
//    "Conversation · N contacts", "↳ Next contact", "⏳ Follow-up due/overdue";
//    the contact's history shows the conversation tags too; the Follow-up
//    filter has "Hotline: called back" / "Hotline: no call-back needed".
//  - "📞 Call back" sits inside the Log hotline voicemail dialog, and the
//    dialog stays open afterwards.
module.exports = {
  name: 'follow-ups vs next contacts — hotline call-back, tags and filters',
  async run({ t }) {
    t.seed();
    const [A] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 1`)).map(r => String(r.id));
    await t.sql(`insert into pi_team_members (name, initials, email, phone, active) values ('Jeff P','PUT','putzke@demo.test','801-555-0177',true)`);
    const [st] = await t.sql(`select s.id from pi_stakeholders s join pi_project_stakeholders l on l.stakeholder_id = s.id::text
                               where l.project_id=$1 and coalesce(s.is_archived,false)=false order by s.id limit 1`, [A]);
    const [h] = await t.sql(`insert into pi_hotlines (name, phone_number, project_id) values ('Region One','+18015550101',$1) returning id`, [A]);
    const ins = (sid, from) => t.sql(`insert into pi_hotline_messages (hotline_id, project_id, caller_number, call_sid, recording_seconds, transcript, transcript_status, status, assigned_to, received_at)
        values ($1,$2,$3,$4,20,'Question about the detour.','done','pending','PUT','2026-10-10T15:00:00Z') returning id`, [h.id, A, from, sid]).then(r => String(r[0].id));
    const m1 = await ins('CA1', '+18015550142');
    const m2 = await ins('CA2', '+18015550143');

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    const callbacks = [];
    await app.page.route('**/functions/v1/hotline/callback', async route => {
      callbacks.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"sid":"CAx"}' });
    });
    try {
      await app.ready();
      await app.page.evaluate(async () => { await _hotReload(); });
      const save = () => app.page.evaluate(() => document.getElementById('f-isave').textContent);

      // ── the Log dialog ──────────────────────────────────────────────────
      await app.page.evaluate(id => hotLog(id), m1);
      const f = await app.page.evaluate(() => ({
        label: document.querySelector('label[for="f-ifu"]').textContent, fu: document.getElementById('f-ifu').checked,
        note: document.getElementById('f-ifun').value, next: !!document.querySelector('#modal-ov button[onclick^="saveIntAndNext"]'),
        cb: !!document.getElementById('hcb-go'),
      }));
      t.eq(f.label, 'Requires a scheduled follow-up', 'the box is called “Requires a scheduled follow-up”');
      t.ok(!f.fu && /^Call back at/.test(f.note), 'logging a voicemail: the follow-up is prefilled but unticked');
      t.eq(await save(), 'Save — no call-back needed', 'unticked, the Save button says “no call-back needed”');
      await app.page.evaluate(() => { const cb = document.getElementById('f-ifu'); cb.checked = true; cb.dispatchEvent(new Event('change')); });
      t.eq(await save(), 'Save interaction', 'ticked, it is the ordinary Save');
      await app.page.evaluate(() => { const cb = document.getElementById('f-ifu'); cb.checked = false; cb.dispatchEvent(new Event('change')); });
      t.ok(f.next, 'the dialog has “Save & log next contact”');

      // ── Call back from inside the dialog ────────────────────────────────
      t.ok(f.cb, 'the Log dialog has “Call me now”');
      await app.page.evaluate(() => { document.getElementById('f-hcb-phone').value = '(801) 555-0177'; });
      await app.page.evaluate(id => hotCallBackGo(id), m1);
      t.ok(callbacks.length === 1 && String(callbacks[0].messageId) === m1 && callbacks[0].ringMe === '+18015550177', 'it asks the receiver to ring me, for this voicemail');
      t.ok(await app.page.evaluate(() => /Log hotline voicemail/.test(document.getElementById('modal-ov').textContent) && document.getElementById('hcb-go').textContent === 'Ringing you — press 1'),
        'the dialog stays open, and the button says to press 1');

      // Save & log next contact → the call-back is the next contact.
      await app.page.evaluate(() => saveIntAndNext(''));
      await app.page.waitForFunction(() => /Next contact on/.test(document.getElementById('modal-ov').textContent));
      const msg1 = await t.until(async () => (await t.sql(`select logged_interaction_id::text i from pi_hotline_messages where id=$1 and status='logged'`, [m1]))[0]);
      const orig1 = msg1 && msg1.i;
      t.ok(await app.page.evaluate(id => S.intOpts.relatedTo === id, orig1), 'the next contact is linked to the voicemail just logged');
      t.eq(await save(), 'Save interaction', 'a next contact saves normally');
      await app.page.evaluate(() => { document.getElementById('f-id').value = '2026-10-11'; document.getElementById('f-isu').value = 'Called back, explained the detour.'; return saveInt(); });
      await t.until(async () => (await t.sql(`select id from pi_interactions where related_to=$1`, [orig1]))[0]);

      // m2: logged with no follow-up, no next contact.
      await app.page.evaluate(id => hotLog(id), m2);
      await app.page.evaluate(() => saveInt());
      const msg2 = await t.until(async () => (await t.sql(`select logged_interaction_id::text i from pi_hotline_messages where id=$1 and status='logged'`, [m2]))[0]);
      const orig2 = msg2 && msg2.i;

      // A plain interaction: "Save & log next contact" too, with an overdue follow-up.
      await app.page.evaluate(sid => openIntModal(sid), String(st.id));
      t.ok(await app.page.evaluate(() => !!document.querySelector('#modal-ov button[onclick^="saveIntAndNext"]') && document.getElementById('f-isave').textContent === 'Save interaction'),
        'a plain new interaction also has “Save & log next contact”, and an ordinary Save');
      await app.page.evaluate(A => {
        document.getElementById('f-ip').value = A; updateIntStakeholders();
        document.getElementById('f-isu').value = 'PLAIN ORIGINAL';
        const cb = document.getElementById('f-ifu'); cb.checked = true; cb.dispatchEvent(new Event('change'));
        document.getElementById('f-ifun').value = 'Send the exhibit'; document.getElementById('f-ifud').value = '2026-01-05';
      }, A);
      await app.page.evaluate(sid => _intSetStake(sid), String(st.id));
      await app.page.evaluate(() => saveIntAndNext(''));
      await app.page.waitForFunction(() => /Next contact on/.test(document.getElementById('modal-ov').textContent));
      const [plain] = await t.sql(`select id::text from pi_interactions where summary='PLAIN ORIGINAL'`);
      t.ok(plain && await app.page.evaluate(id => S.intOpts.relatedTo === id && !/^tmp_/.test(id), plain.id), 'it opens a next contact linked to the real id of the one just saved');
      await app.page.evaluate(() => { document.getElementById('f-isu').value = 'PLAIN REPLY'; const r = document.getElementById('f-irelres'); if (r) r.checked = false; return saveInt(); });
      await t.until(async () => (await t.sql(`select id from pi_interactions where summary='PLAIN REPLY'`))[0]);

      // ── tags in the log ─────────────────────────────────────────────────
      await app.page.evaluate(async A => { S.projectFilter = A; S.intFu = ''; setView('interactions'); }, A);
      const rowTags = (needle) => app.page.evaluate(n => {
        const tr = [...document.querySelectorAll('tr')].find(r => r.textContent.includes(n));
        return tr ? [...tr.querySelectorAll('.int-tag')].map(x => x.textContent) : null;
      }, needle);
      const t1 = await rowTags('Question about the detour'), tc = await rowTags('Called back, explained');
      const tags = await app.page.evaluate(() => [...document.querySelectorAll('.int-tag')].map(x => x.textContent));
      t.ok(tags.some(x => /^Called back · Oct 11, 2026$/.test(x)), 'the voicemail answered by a call-back reads “Called back · date”');
      t.ok(tags.includes('No call-back needed'), 'the voicemail logged with neither reads “No call-back needed”');
      t.ok(tags.includes('Conversation · 2 contacts') && tags.includes('↳ Next contact'), 'the conversation and the next contact are tagged');
      t.ok(tags.some(x => /^⏳ Follow-up overdue · Jan 5, 2026$/.test(x)), 'an open follow-up past due reads “⏳ Follow-up overdue · date”');
      t.ok(t1 && tc, '(rows found)');

      // ── filters ─────────────────────────────────────────────────────────
      const visible = () => app.page.evaluate(() => [...document.querySelectorAll('.int-tag')].map(x => x.textContent).filter(x => /Called back|No call-back/.test(x)));
      await app.page.evaluate(() => { S.intFu = 'calledback'; render(); });
      t.ok((await visible()).every(x => /^Called back/.test(x)) && (await visible()).length === 1, 'filter “Hotline: called back” shows the called-back voicemail only');
      await app.page.evaluate(() => { S.intFu = 'nocallback'; render(); });
      t.ok((await visible()).length === 1 && (await visible())[0] === 'No call-back needed', 'filter “Hotline: no call-back needed” shows that one only');
      t.ok(await app.page.evaluate(() => [...document.getElementById('int-fu').options].map(o => o.textContent).join('|') === 'All|Open / overdue|Resolved|Hotline: called back|Hotline: no call-back needed'),
        'the Follow-up filter offers both hotline options');
      await app.page.evaluate(() => { S.intFu = ''; render(); });

      // ── the contact's history ───────────────────────────────────────────
      const hist = await app.page.evaluate(sid => {
        S.stakeTab = 'log';
        const s = DB.get('stakeholders').find(x => String(x.id) === sid);
        const el = document.createElement('div'); el.innerHTML = renderStakeDetail(s, null);
        return [...el.querySelectorAll('.int-tag')].map(x => x.textContent).join('|');
      }, String(st.id));
      t.ok(/↳ Next contact/.test(hist) && /Conversation · 2 contacts/.test(hist), 'the contact’s interaction history shows the conversation tags (' + hist + ')');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
