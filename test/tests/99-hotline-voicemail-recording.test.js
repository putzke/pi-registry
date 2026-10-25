// The voicemail prompt as a recording (Jeff, Oct 2026): one recording for every
// hotline, in pi_hotline_settings, played wherever the computer voice said
// "Please leave your name…" — and after an unanswered ring it replaces "Sorry,
// nobody can take your call right now" too. Spanish optional; none = computer.
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const SB = 'https://dev-project.supabase.co';
const TOKEN = 'test-twilio-auth-token';
const sign = (url, params) => crypto.createHmac('sha1', TOKEN).update(url + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64');

module.exports = {
  name: 'hotline voicemail prompt — one recording replaces the computer voice on every hotline',
  async run({ t, shim }) {
    t.seed();
    const L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', 'hotline', 'logic.mjs')).href);
    const [A, B] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 2`)).map(r => String(r.id));
    const [one] = await t.sql(`insert into pi_hotlines (name, phone_number, project_id, spanish_enabled) values ('One','+18015550111',$1,true) returning *`, [A]);
    await t.sql(`insert into pi_hotlines (name, phone_number, project_id, spanish_enabled) values ('Plain','+18015550113',$1,false)`, [A]);
    const [menu] = await t.sql(`insert into pi_hotlines (name, phone_number, spanish_enabled) values ('Menu','+18015550112',true) returning *`);
    await t.sql(`insert into pi_hotline_extensions (hotline_id, digit, project_id, label) values ($1,'1',$2,'the A project')`, [menu.id, B]);
    // Ringing off, so every path goes to voicemail.
    await t.sql(`insert into pi_hotline_settings (id, ring_enabled) values (1,false) on conflict (id) do update set ring_enabled=false, voicemail_audio_path=null, spanish_voicemail_audio_path=null`);

    const fetchFn = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith(SB + '/rest/v1/')) return fetch(shim.origin + u.slice(SB.length), { method: opts.method || 'GET', headers: opts.headers, body: opts.body });
      if (u.startsWith(SB + '/storage/v1/object/sign/')) { const p = u.split('/hotline-audio/')[1]; return new Response(JSON.stringify({ signedURL: '/object/sign/hotline-audio/' + p + '?token=t' }), { status: 200 }); }
      throw new Error('unexpected fetch ' + u);
    };
    const handler = L.createHandler({ env: { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'svc', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: TOKEN }, fetchFn });
    const call = async (sub, params) => {
      const r = await handler(new Request('http://localhost:9000/hotline' + sub, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(SB + '/functions/v1/hotline' + sub, params) },
        body: new URLSearchParams(params).toString() }));
      return r.text();
    };
    const paths = async () => ({
      voice: await call('/voice', { CallSid: 'CA1', From: '+13855550199', To: '+18015550113' }),
      none: await call(`/menu?h=${one.id}&l=en&r=0&none=1`, { CallSid: 'CA7' }),
      menu1: await call(`/menu?h=${menu.id}&l=en&r=0`, { CallSid: 'CA2', Digits: '1' }),
      es: await call(`/menu?h=${one.id}&l=en&r=0`, { CallSid: 'CA3', Digits: '9' }),
      after: await call(`/afterdial?h=${one.id}&l=en&d=&p=${A}`, { CallSid: 'CA4', DialCallStatus: 'no-answer' }),
      afterEs: await call(`/afterdial?h=${one.id}&l=es&d=&p=${A}`, { CallSid: 'CA5', DialCallStatus: 'no-answer' }),
    });

    let x = await paths();
    t.ok(/Please leave your name/.test(x.voice) && /Please leave your name/.test(x.menu1), 'no recording: the computer voice asks for the message');
    t.ok(/nobody can take your call/.test(x.after) && /Please leave your name/.test(x.after), 'no recording: after an unanswered ring, both computer sentences');
    t.ok(/nadie puede atender/.test(x.afterEs) && /deje su nombre/.test(x.es), 'no recording: Spanish computer voice');

    await t.sql(`update pi_hotline_settings set voicemail_audio_path='prompts/voicemail-en.mp3' where id=1`);
    x = await paths();
    for (const k of ['voice', 'none', 'menu1', 'after']) {
      t.ok(x[k].includes('prompts/voicemail-en.mp3') && !/Please leave your name|nobody can take your call/.test(x[k]), `English recording replaces the computer voice (${k})`);
      t.ok(x[k].indexOf('prompts/voicemail-en.mp3') < x[k].indexOf('<Record'), `…and plays before the tone (${k})`);
    }
    t.ok(/deje su nombre/.test(x.es) && /nadie puede atender/.test(x.afterEs) && !/voicemail-en/.test(x.es + x.afterEs), 'no Spanish recording: Spanish callers still hear the Spanish computer voice, never the English recording');

    await t.sql(`update pi_hotline_settings set spanish_voicemail_audio_path='prompts/voicemail-es.mp3' where id=1`);
    x = await paths();
    t.ok(x.es.includes('prompts/voicemail-es.mp3') && x.afterEs.includes('prompts/voicemail-es.mp3') && !/deje su nombre|nadie puede/.test(x.es + x.afterEs), 'Spanish recording plays for Spanish callers');
    t.ok(!/<Play>[^<]*voicemail/.test(await call('/voice', { CallSid: 'CA6', From: '+13855550199', To: '+18015550112' })), 'a menu is not interrupted by the voicemail prompt');

    // ── the app ─────────────────────────────────────────────────────────
    await t.sql(`update pi_hotline_settings set voicemail_audio_path=null, spanish_voicemail_audio_path='prompts/voicemail-es.mp3' where id=1`);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    const uploads = [];
    await app.page.route('**/storage/v1/object/hotline-audio/**', async route => {
      uploads.push({ url: route.request().url(), type: route.request().headers()['content-type'] });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    try {
      await app.ready();
      await app.page.evaluate(async () => { await _hotReload(); setView('settings'); renderHotlineCard(); });
      const box = await app.page.evaluate(() => document.getElementById('hot-vm').textContent);
      t.ok(/one recording for every hotline/.test(box) && /English: computer voice/.test(box) && /recording in use/.test(box), 'Settings shows the voicemail prompt box and what plays now');
      await app.page.setInputFiles('#hot-vm-file', { name: 'vm.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from([1, 2, 3]) });
      await app.page.evaluate(() => saveHotlineVoicemail());
      let [g] = await t.sql(`select * from pi_hotline_settings where id=1`);
      t.ok(uploads.some(u => u.url.endsWith('/hotline-audio/prompts/voicemail-en.mp3') && u.type === 'audio/mpeg'), 'the file is uploaded to prompts/voicemail-en.mp3');
      t.ok(g.voicemail_audio_path === 'prompts/voicemail-en.mp3' && g.spanish_voicemail_audio_path === 'prompts/voicemail-es.mp3' && g.ring_enabled === false, 'saved; Spanish and the ring defaults untouched');
      await app.page.evaluate(() => { document.getElementById('hot-vm-rm-es').checked = true; return saveHotlineVoicemail(); });
      [g] = await t.sql(`select * from pi_hotline_settings where id=1`);
      t.ok(g.spanish_voicemail_audio_path === null && g.voicemail_audio_path, 'Remove clears the Spanish recording only');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
