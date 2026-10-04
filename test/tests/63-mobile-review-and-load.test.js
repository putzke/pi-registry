// Mobile catch-up (Oct 2026): four things the desktop had moved past.
//
//   1. Draw-area placeholder contacts ("Property 3", needs_review) are made to
//      be canvassed — on the phone — but mobile never read the flag, and NO
//      surface could clear it: desktop saveStake rebuilt the record without the
//      field, so toSB dropped it and the column stayed true forever. Both apps
//      now show a "Needs review" toggle on a flagged contact; unticking clears it.
//   2. A failed read on mobile returned [] — an expired sign-in looked like
//      "No contacts found". Now it is named in a toast, and a reload keeps the
//      last good copy. A 404 is still an empty table.
//   3. saveInteraction redrew before its insert returned, so the row just
//      logged carried a tmp_ id and tapping it did nothing.
//   4. The confirmation toast read "Interactionsged ✓".
module.exports = {
  name: 'mobile catch-up — needs-review flag, named load failures, logged-row id, toast',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    const [ph] = await t.sql(
      `insert into pi_stakeholders (first_name, last_name, address, stakeholder_type, is_master, needs_review)
       values ('Property','91','91 Testcase Lane, Logan, 84321','Property Owner', false, true) returning id`);
    const PH = String(ph.id);
    await t.sql(`insert into pi_project_stakeholders (project_id, stakeholder_id, stakeholder_role) values ($1,$2,'External')`, [P, PH]);
    const flag = async () => (await t.sql(`select needs_review from pi_stakeholders where id=$1`, [PH]))[0].needs_review;

    // ── desktop: the flag can finally be cleared ────────────────────────────
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      const shown = await app.page.evaluate(async id => {
        await openStakeModal(id);
        const box = document.getElementById('f-sneeds');
        return { exists: !!box, checked: box && box.checked };
      }, PH);
      t.eq(shown, { exists: true, checked: true }, 'desktop: a flagged contact opens with "Needs review" ticked');

      await app.page.evaluate(async () => { document.getElementById('f-ph').value = '435-555-0191'; await saveStake(); });
      await app.page.waitForTimeout(900);
      t.eq(await flag(), true, 'an unrelated edit leaves the flag alone');

      await app.page.evaluate(async id => {
        await openStakeModal(id);
        document.getElementById('f-fn').value = 'Dana';
        document.getElementById('f-ln').value = 'Testcase';
        document.getElementById('f-sneeds').checked = false;
        await saveStake();
      }, PH);
      await app.page.waitForTimeout(900);
      t.eq(await flag(), false, 'unticking it and saving clears needs_review in the database');
      const after = await app.page.evaluate(async id => { await openStakeModal(id); return !!document.getElementById('f-sneeds'); }, PH);
      t.eq(after, false, 'and a reviewed contact no longer shows the toggle');
      t.eq(app.errors, [], 'desktop: no page errors');
    } finally { await app.close(); }

    // ── mobile ─────────────────────────────────────────────────────────────
    await t.sql(`update pi_stakeholders set needs_review = true where id=$1`, [PH]);
    const mob = await t.open('mobile.html', { email: 'putzke@demo.test', viewport: { width: 414, height: 896 } });
    try {
      await mob.page.waitForFunction(() => typeof _syncCache !== 'undefined' && Array.isArray(_syncCache.stakeholders) && _syncCache.stakeholders.length > 0, null, { timeout: 15000 });

      const seen = await mob.page.evaluate(([id, pid]) => {
        const s = _syncCache.stakeholders.find(x => x.id === id);
        document.getElementById('contacts-proj').value = pid;
        renderContacts();
        const row = [...document.querySelectorAll('#contacts-list .list-item')].find(r => r.getAttribute('onclick').includes("'" + id + "'"));
        showContactDetail(id);
        const body = document.getElementById('detail-body').innerHTML;
        return { mapped: s && s.needsReview, rowBadge: !!row && /Needs review/.test(row.textContent),
                 rowAddress: !!row && /91 Testcase Lane/.test(row.textContent),
                 pill: /b-review/.test(body), note: /review-note/.test(body) };
      }, [PH, P]);
      t.eq(seen.mapped, true, 'mobile maps needs_review as a boolean');
      t.ok(seen.rowBadge && seen.rowAddress, 'the contact list row shows "Needs review" and the address to knock on');
      t.ok(seen.pill && seen.note, 'the contact screen shows the badge and the "not a confirmed mailing address" note');

      const sheet = await mob.page.evaluate(id => {
        openEditStakeholder(id);
        return { shown: getComputedStyle(document.getElementById('add-needs-wrap')).display !== 'none',
                 checked: document.getElementById('add-needs').checked };
      }, PH);
      t.eq(sheet, { shown: true, checked: true }, 'the edit sheet shows the toggle, ticked');
      await mob.page.evaluate(async () => { document.getElementById('add-needs').checked = false; await updateStakeholder(); });
      await mob.page.waitForTimeout(900);
      t.eq(await flag(), false, 'unticking it on the phone clears needs_review in the database');
      const fresh = await mob.page.evaluate(() => { prepAddStakeholderSheet(); return getComputedStyle(document.getElementById('add-needs-wrap')).display; });
      t.eq(fresh, 'none', 'a new contact never shows the toggle');

      // ── a logged row carries its real id, and the toast reads right ───────
      const logged = await mob.page.evaluate(async pid => {
        const toasts = []; const real = window.showToast;
        window.showToast = (m, k) => { toasts.push(String(m)); };
        document.getElementById('home-proj').value = pid;
        prepLogSheet && prepLogSheet();
        document.getElementById('log-proj').value = pid;
        updateLogStakeholders && updateLogStakeholders();
        document.getElementById('log-summary').value = 'Mobile catch-up test row';
        await saveInteraction();
        window.showToast = real;
        const ids = [...document.querySelectorAll('[onclick^="editInteraction"]')].map(e => e.getAttribute('onclick'));
        const mine = _syncCache.interactions.find(i => i.summary === 'Mobile catch-up test row');
        return { toasts, tmpIds: ids.filter(x => /tmp_/.test(x)).length, id: mine && mine.id,
                 drawn: !!mine && ids.some(x => x.includes("'" + mine.id + "'")) };
      }, P);
      t.ok(/^\d+$/.test(logged.id || ''), 'the logged interaction has its real numeric id by the time the list redraws');
      t.ok(logged.drawn, 'and the home list was drawn with that id');
      t.eq(logged.tmpIds, 0, 'no row on screen points at a temporary id');
      t.ok(logged.toasts.includes('Interaction logged ✓'), 'the toast reads "Interaction logged ✓" (got ' + JSON.stringify(logged.toasts) + ')');

      // ── a failed read is named, never shown as empty ──────────────────────
      const fail = await mob.page.evaluate(async () => {
        const before = _syncCache.stakeholders.length;
        const toasts = []; const realToast = window.showToast; const realFetch = window.fetch;
        window.showToast = (m, k) => toasts.push({ m: String(m), k });
        Object.keys(_syncCache).forEach(k => cacheClear(k));
        window.fetch = (url, o) => /pi_stakeholders\?/.test(String(url))
          ? Promise.resolve({ ok: false, status: 401, text: async () => 'JWT expired', json: async () => ({}) })
          : realFetch(url, o);
        const failed = await loadAllData();
        const kept = _syncCache.stakeholders.length;
        Object.keys(_syncCache).forEach(k => cacheClear(k));
        window.fetch = (url, o) => /pi_parcels\?/.test(String(url))
          ? Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) })
          : realFetch(url, o);
        const toastsBefore404 = toasts.length;
        const failed404 = await loadAllData();
        window.fetch = realFetch; window.showToast = realToast;
        return { before, kept, failed, toasts, failed404, toastsFrom404: toasts.length - toastsBefore404 };
      });
      t.eq(fail.failed, ['stakeholders'], 'a 401 on contacts is reported as a failed load');
      t.eq(fail.kept, fail.before, 'and the contacts already loaded are kept, not emptied');
      t.eq(fail.toasts[0] && fail.toasts[0].k, 'error', 'the user is told');
      t.ok(fail.toasts[0] && /contacts/.test(fail.toasts[0].m) && !/interactions/.test(fail.toasts[0].m),
           'naming contacts, and only contacts: ' + (fail.toasts[0] || {}).m);
      t.eq([fail.failed404, fail.toastsFrom404], [[], 0], 'a 404 (table not created yet) is still just empty, with no warning');

      t.eq(mob.errors.filter(e => !/SB GET error|Load failed/.test(e)), [], 'mobile: no unexpected page errors');
    } finally { await mob.close(); }
  },
};
