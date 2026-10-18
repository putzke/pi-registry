// Hotline menu recordings (Jeff, Oct 2026).
//
//  - A menu hotline can play an uploaded recording of its menu, in English and
//    (optionally) in Spanish after 9, instead of the computer voice.
//  - "Para español, oprima 9" stays the computer's Spanish voice, between the
//    greeting and the menu. Everything after a key press stays computer voice.
//  - The recording is stamped with the script it was made for. Once the menu
//    changes it is no longer played (the computer voice reads the new menu),
//    and the app says it is out of date.
//  - The app's script (_hotMenuOptions) is the receiver's (menuParts().options).
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const SB = 'https://dev-project.supabase.co';
const TOKEN = 'test-twilio-auth-token';
const sign = (url, params) => crypto.createHmac('sha1', TOKEN).update(url + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64');

module.exports = {
  name: 'hotline menu recordings — played while current, stale falls back, upload stamps the script',
  async run({ t, shim }) {
    t.seed();
    const L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', 'hotline', 'logic.mjs')).href);
    const [A, B] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 2`)).map(r => String(r.id));
    const [h] = await t.sql(`insert into pi_hotlines (name, phone_number, spanish_enabled) values ('UDOT Region One','+18015550101',true) returning *`);
    await t.sql(`insert into pi_hotline_extensions (hotline_id, digit, project_id, label, label_es) values ($1,'1',$2,'the 400 North project','el proyecto 400 Norte'),($1,'2',$3,'the SR-201 project',null)`, [h.id, A, B]);
    const exts = L.activeExtensions(await t.sql(`select * from pi_hotline_extensions where hotline_id=$1`, [h.id]), h.id);
    const scriptEn = L.menuParts(h, exts, 'en').options, scriptEs = L.menuParts(h, exts, 'es').options;

    // ── the receiver ────────────────────────────────────────────────────
    const signed = [];
    const fetchFn = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith(SB + '/rest/v1/')) return fetch(shim.origin + u.slice(SB.length), { method: opts.method || 'GET', headers: opts.headers, body: opts.body });
      if (u.startsWith(SB + '/storage/v1/object/sign/')) { const p = u.split('/hotline-audio/')[1]; signed.push(p); return new Response(JSON.stringify({ signedURL: '/object/sign/hotline-audio/' + p + '?token=t' }), { status: 200 }); }
      throw new Error('unexpected fetch ' + u);
    };
    const handler = L.createHandler({ env: { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'svc', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: TOKEN }, fetchFn });
    const call = async (sub, params) => {
      const r = await handler(new Request('http://localhost:9000/hotline' + sub, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(SB + '/functions/v1/hotline' + sub, params) },
        body: new URLSearchParams(params).toString() }));
      return r.text();
    };
    const voice = () => call('/voice', { CallSid: 'CA1', From: '+13855550199', To: '+18015550101' });

    let x = await voice();
    t.ok(/For the 400 North project, press 1/.test(x) && !/menus\//.test(x), 'no menu recording: the computer voice reads the menu');

    await t.sql(`update pi_hotlines set menu_audio_path='menus/${h.id}-en.mp3', menu_audio_for=$1, spanish_menu_audio_path='menus/${h.id}-es.mp3', spanish_menu_audio_for=$2 where id=$3`, [scriptEn, scriptEs, h.id]);
    x = await voice();
    const iOffer = x.indexOf('Para español, oprima 9'), iPlay = x.indexOf(`menus/${h.id}-en.mp3`);
    t.ok(iPlay > 0 && !/For the 400 North project/.test(x), 'a current recording is played instead of the computer menu');
    t.ok(iOffer > 0 && iOffer < iPlay && /Polly\.Lupe/.test(x.slice(0, iPlay)), '“Para español, oprima 9” stays the computer’s Spanish voice, before the menu recording');
    t.ok(x.indexOf('<Gather') < iPlay && iPlay < x.indexOf('</Gather>'), 'the recording plays inside the menu, so a key press interrupts it');

    const q = `?h=${h.id}&l=en&r=0`;
    x = await call('/menu' + q, { CallSid: 'CA1', Digits: '9' });
    t.ok(x.includes(`menus/${h.id}-es.mp3`) && !/Para el proyecto 400 Norte/.test(x), 'after 9: the Spanish menu recording');
    x = await call('/menu' + q, { CallSid: 'CA1', Digits: '7' });
    t.ok(x.includes(`menus/${h.id}-en.mp3`) && /not one of the choices/.test(x), 'a wrong key replays the menu recording (no greeting)');
    x = await call('/menu' + q, { CallSid: 'CA1', Digits: '1' });
    t.ok(!/menus\//.test(x), 'after a key press the menu recording is not played again');

    // The menu changes: the old recording stops playing.
    await t.sql(`update pi_hotline_extensions set label='the 400 North reconstruction' where hotline_id=$1 and digit='1'`, [h.id]);
    x = await voice();
    t.ok(!/menus\/\d+-en/.test(x) && /For the 400 North reconstruction, press 1/.test(x), 'a recording made for an older menu is not played — the computer reads the new menu');
    x = await call('/menu' + q, { CallSid: 'CA1', Digits: '9' });
    t.ok(x.includes(`menus/${h.id}-es.mp3`), '…while the Spanish one, whose script did not change, still plays');
    t.eq(L.menuRecordingPath({ ...h, menu_audio_path: 'm.mp3', menu_audio_for: 'x' }, [], 'en'), '', 'a one-project number never plays a menu recording');

    // ── the app ─────────────────────────────────────────────────────────
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    const uploads = [];
    await app.page.route('**/storage/v1/object/hotline-audio/**', async route => {
      uploads.push({ url: route.request().url(), type: route.request().headers()['content-type'] });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    try {
      await app.ready();
      await app.page.evaluate(async () => { await _hotReload(); });
      const ex2 = L.activeExtensions(await t.sql(`select * from pi_hotline_extensions where hotline_id=$1`, [h.id]), h.id);
      const appExts = ex2.map(e => ({ digit: e.digit, label: e.label, labelEs: e.label_es }));
      t.ok(await app.page.evaluate(e => _hotMenuOptions(e, 'en'), appExts) === L.menuParts(h, ex2, 'en').options
        && await app.page.evaluate(e => _hotMenuOptions(e, 'es'), appExts) === L.menuParts(h, ex2, 'es').options,
        'the app’s script is exactly the receiver’s menu (English and Spanish)');

      // Settings: out of date after the label change.
      await app.page.evaluate(() => { setView('settings'); renderHotlineCard(); });
      t.ok(await app.page.evaluate(() => /Menu recording out of date/.test(document.getElementById('hotline-card-body').textContent)), 'Settings flags the out-of-date menu recording');

      await app.page.evaluate(id => openHotlineModal(id), String(h.id));
      const m = await app.page.evaluate(() => ({
        script: document.getElementById('f-hl-mscript').textContent, scriptEs: document.getElementById('f-hl-mscript-es').textContent,
        state: document.getElementById('f-hl-mstate').textContent, stateEs: document.getElementById('f-hl-mstate-es').textContent,
        preview: document.getElementById('f-hl-preview').textContent }));
      t.eq(m.script, L.menuParts(h, ex2, 'en').options, 'the dialog shows the script to read');
      t.ok(/made for a different menu/.test(m.state) && /recording of this menu is uploaded/.test(m.stateEs), 'English is out of date, Spanish is current');
      t.ok(/\[your Spanish menu recording\]/.test(m.preview) && /For the 400 North reconstruction, press 1/.test(m.preview), '“What callers hear” matches what the receiver will play');

      // Upload a new English recording: stamped with today's script.
      await app.page.setInputFiles('#f-hl-mfile', { name: 'menu.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from([1, 2, 3]) });
      await app.page.evaluate(() => saveHotline());
      const [row] = await t.sql(`select * from pi_hotlines where id=$1`, [h.id]);
      t.ok(uploads.some(u => u.url.endsWith(`/hotline-audio/menus/${h.id}-en.mp3`) && u.type === 'audio/mpeg'), 'the file is uploaded to the hotline’s menu path');
      t.ok(row.menu_audio_path === `menus/${h.id}-en.mp3` && row.menu_audio_for === L.menuParts(row, ex2, 'en').options, '…and stamped with the current script');
      t.eq(row.spanish_menu_audio_for, scriptEs, 'the Spanish recording is left as it was');
      x = await voice();
      t.ok(x.includes(`menus/${h.id}-en.mp3`), 'the receiver plays the new recording');

      // Remove the Spanish one.
      await app.page.evaluate(id => openHotlineModal(id), String(h.id));
      await app.page.evaluate(() => { const c = document.getElementById('f-hl-mrm-es'); c.checked = true; c.dispatchEvent(new Event('change')); });
      t.ok(await app.page.evaluate(() => /will be removed/.test(document.getElementById('f-hl-mstate-es').textContent)), 'ticking Remove says what will happen');
      await app.page.evaluate(() => saveHotline());
      const [row2] = await t.sql(`select spanish_menu_audio_path p, spanish_menu_audio_for f, menu_audio_path e from pi_hotlines where id=$1`, [h.id]);
      t.ok(row2.p === null && row2.f === null && row2.e, 'Remove clears the Spanish menu recording only');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
