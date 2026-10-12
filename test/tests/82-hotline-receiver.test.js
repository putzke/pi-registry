// The Twilio hotline receiver (supabase/functions/hotline/logic.mjs), run under
// Node with the REAL handler: REST goes to the harness's Postgres through the
// shim; Supabase Storage, Twilio's API, Resend and Supabase Auth are faked here.
// No Twilio account is needed — requests are signed with a test auth token
// exactly as Twilio signs them.
//
// What it proves:
//  - an unsigned or wrongly signed request is refused, and nothing is accepted
//    until the Twilio secrets exist;
//  - the menu: extensions, 0 / no choice → general mailbox, a wrong key once
//    → the menu again, twice → general; Spanish on 9 only when switched on;
//    a single-project number with Spanish off goes straight to the recording;
//  - a voicemail becomes a PENDING row (never an interaction), assigned to the
//    project's PI Lead, with the audio copied to our storage, Twilio's copy
//    deleted only once ours exists, and an email to the lead;
//  - the recording and transcription callbacks work in either order;
//  - /notify only works for signed-in staff.
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const SB = 'https://dev-project.supabase.co';
const TOKEN = 'test-twilio-auth-token';
const ACCT = 'ACtest';

function sign(url, params) {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  return crypto.createHmac('sha1', TOKEN).update(data).digest('base64');
}

module.exports = {
  name: 'hotline receiver — menu, signature, voicemail rows, audio, email',
  async run({ t, shim }) {
    const L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', 'hotline', 'logic.mjs')).href);

    // ── data ──────────────────────────────────────────────────────────────
    const [pA] = await t.sql(`insert into pi_projects (name, status, lead) values ('400 North Reconstruction','Active','JP') returning id`);
    const [pB] = await t.sql(`insert into pi_projects (name, status, lead) values ('SR-201 Preservation','Active','XX') returning id`);
    const [pC] = await t.sql(`insert into pi_projects (name, status) values ('Main Street Sewer','Active') returning id`);
    await t.sql(`insert into pi_team_members (name, initials, email, active) values ('Lead Person','JP','lead@example.test',true)`);
    const [h1] = await t.sql(`insert into pi_hotlines (name, phone_number, spanish_enabled) values ('UDOT Region One','+18015550101',true) returning id`);
    await t.sql(`insert into pi_hotline_extensions (hotline_id, digit, project_id, label) values ($1,'1',$2,'the 400 North project'),($1,'2',$3,'the SR-201 project')`, [h1.id, String(pA.id), String(pB.id)]);
    const [h2] = await t.sql(`insert into pi_hotlines (name, phone_number, project_id, spanish_enabled) values ('Main Street Sewer','+18015550102',$1,false) returning id`, [String(pC.id)]);
    const [h3] = await t.sql(`insert into pi_hotlines (name, phone_number, project_id, spanish_enabled, greeting_mode, greeting_audio_path) values ('Recorded One','+18015550103',$1,true,'recording','greetings/x-en.mp3') returning id`, [String(pC.id)]);

    // ── fakes ─────────────────────────────────────────────────────────────
    const log = { storage: [], twilioDeletes: [], emails: [], downloads: [], twilioLookups: [], calls: [] };
    // Twilio's REST API, as the fallback check for unsigned requests sees it.
    const TW_API = `https://api.twilio.com/2010-04-01/Accounts/${ACCT}`;
    const twilioApi = {};
    const fetchFn = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith(SB + '/rest/v1/')) {
        return fetch(shim.origin + u.slice(SB.length), { method: opts.method || 'GET', headers: opts.headers, body: opts.body });
      }
      if (u.startsWith(SB + '/storage/v1/object/sign/')) return new Response(JSON.stringify({ signedURL: '/object/sign/hotline-audio/greetings/x-en.mp3?token=abc' }), { status: 200 });
      if (u.startsWith(SB + '/storage/v1/object/')) { log.storage.push({ url: u, type: opts.headers['Content-Type'], bytes: opts.body.length }); return new Response('{}', { status: 200 }); }
      if (u.startsWith(SB + '/auth/v1/user')) {
        const a = opts.headers.Authorization || '';
        if (a === 'Bearer staff-token') return new Response(JSON.stringify({ email: 'staff@sunrise.example' }), { status: 200 });
        if (a === 'Bearer stranger-token') return new Response(JSON.stringify({ email: 'nobody@else.test' }), { status: 200 });
        return new Response('{}', { status: 401 });
      }
      if (u.startsWith('https://api.twilio.com/') && opts.method === 'DELETE') { log.twilioDeletes.push(u); return new Response('', { status: 204 }); }
      if (u.startsWith(TW_API + '/Recordings/') && u.endsWith('.mp3')) {
        log.downloads.push({ url: u, auth: opts.headers.Authorization });
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      }
      if (u === TW_API + '/Calls.json' && opts.method === 'POST') {
        log.calls.push(Object.fromEntries(new URLSearchParams(opts.body)));
        return new Response(JSON.stringify({ sid: 'CA' + 'e'.repeat(32) }), { status: 201 });
      }
      if (u.startsWith(TW_API + '/')) {
        log.twilioLookups.push(u);
        const k = u.slice(TW_API.length + 1);
        return twilioApi[k] ? new Response(JSON.stringify(twilioApi[k]), { status: 200 }) : new Response('{}', { status: 404 });
      }
      if (u === 'https://api.resend.com/emails') { log.emails.push(JSON.parse(opts.body)); return new Response('{"id":"e1"}', { status: 200 }); }
      throw new Error('unexpected fetch ' + u);
    };
    const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'svc', TWILIO_ACCOUNT_SID: ACCT, TWILIO_AUTH_TOKEN: TOKEN,
                  RESEND_API_KEY: 're_test', APP_BASE_URL: 'https://dev.cirruscc.com' };
    const handler = L.createHandler({ env, fetchFn });
    const base = SB + '/functions/v1/hotline';
    const call = async (sub, params, { signed = true, h = handler, badSig = false, extraHeaders = {} } = {}) => {
      const url = base + sub;
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (signed) headers['X-Twilio-Signature'] = badSig ? sign(url, { ...params, extra: '1' }) : sign(url, params);
      Object.assign(headers, extraHeaders);
      // Supabase hands the function an internal address; the signature is over the public one.
      const internal = 'http://localhost:9000/hotline' + sub;
      const r = await h(new Request(internal, { method: 'POST', headers, body: new URLSearchParams(params).toString() }));
      return { status: r.status, body: await r.text() };
    };

    // ── signatures ────────────────────────────────────────────────────────
    const inbound = { CallSid: 'CA1', From: '+13855550199', To: '+18015550101' };
    t.eq((await call('/voice', inbound, { signed: false })).status, 403, 'an unsigned request is refused');
    t.eq((await call('/voice', inbound, { badSig: true })).status, 403, 'a request signed over different parameters is refused');
    const noSecrets = L.createHandler({ env: { ...env, TWILIO_AUTH_TOKEN: '' }, fetchFn });
    t.eq((await call('/voice', inbound, { h: noSecrets })).status, 503, 'with no Twilio secrets set, nothing is accepted');
    t.ok(await L.validSignature(TOKEN, 'https://x/y', { a: '1' }, sign('https://x/y', { a: '1' })), 'the signature check accepts Twilio’s own scheme');

    // ── unsigned requests: accepted only when Twilio's API confirms them ──
    // (a new trial number's "Receive a call" set-up posts without a signature)
    const CS = 'CA' + 'a'.repeat(32), RS = 'RE' + 'b'.repeat(32);
    const live = { CallSid: CS, AccountSid: ACCT, From: '+13855550177', To: '+18015550102' };
    const nowIso = new Date().toUTCString();
    const lookupsBefore = log.twilioLookups.length;
    t.eq((await call('/voice', { ...live, AccountSid: 'ACother' }, { signed: false })).status, 403, 'unsigned: another account’s SID is refused before any lookup');
    t.eq(log.twilioLookups.length, lookupsBefore, '…without asking Twilio');
    t.eq((await call('/voice', live, { signed: false })).status, 403, 'unsigned: a call Twilio does not know is refused');
    twilioApi[`Calls/${CS}.json`] = { sid: CS, account_sid: ACCT, direction: 'inbound', to: '+18015550102', status: 'in-progress', date_created: nowIso };
    const r0 = await call('/voice', live, { signed: false });
    t.ok(r0.status === 200 && /<Record /.test(r0.body), 'unsigned: a live inbound call Twilio confirms is answered');
    t.eq((await call('/voice', { ...live, To: '+18015550101' }, { signed: false })).status, 403, 'unsigned: a To that differs from Twilio’s record is refused');
    t.eq((await call('/voice', live, { signed: false, extraHeaders: { 'X-Twilio-Signature': 'bogus' } })).status, 403, 'a WRONG signature is refused outright (no fallback)');
    twilioApi[`Calls/${CS}.json`].status = 'completed';
    t.eq((await call('/voice', live, { signed: false })).status, 403, 'unsigned: a call that has ended cannot be replayed into the menu');
    // The recording callback for that call.
    const recLive = { ...live, RecordingSid: RS, RecordingDuration: '12', RecordingStatus: 'completed', RecordingUrl: 'https://evil.example/steal' };
    const qLive = `h=${h2.id}&l=en&d=&p=${pC.id}`;
    t.eq((await call('/recording?' + qLive, recLive, { signed: false })).status, 403, 'unsigned recording: refused until Twilio confirms the recording belongs to the call');
    twilioApi[`Recordings/${RS}.json`] = { sid: RS, call_sid: 'CA' + 'c'.repeat(32) };
    t.eq((await call('/recording?' + qLive, recLive, { signed: false })).status, 403, 'unsigned recording: a recording from another call is refused');
    twilioApi[`Recordings/${RS}.json`].call_sid = CS;
    t.eq((await call('/recording?' + qLive, recLive, { signed: false })).status, 200, 'unsigned recording: confirmed → saved');
    t.ok(log.downloads.some(d => d.url === TW_API + `/Recordings/${RS}.mp3`), '…the audio is fetched from api.twilio.com by SID — never from the RecordingUrl the request named');
    const [mLive] = await t.sql(`select * from pi_hotline_messages where call_sid=$1`, [CS]);
    t.ok(mLive && mLive.status === 'pending', '…as a pending voicemail');
    twilioApi[`Calls/${CS}.json`].date_created = new Date(Date.now() - 2 * 86400000).toUTCString();
    t.eq((await call('/recording?' + qLive, { ...recLive, RecordingSid: 'RE' + 'd'.repeat(32) }, { signed: false })).status, 403, 'unsigned recording: a call older than a day is refused');
    await t.sql(`delete from pi_hotline_messages where call_sid=$1`, [CS]);
    log.downloads.length = 0; log.storage.length = 0; log.emails.length = 0; log.twilioDeletes.length = 0;

    // ── greeting + menu ───────────────────────────────────────────────────
    let r = await call('/voice', inbound);
    t.eq(r.status, 200, 'a signed call is answered');
    t.ok(/<Gather numDigits="1"/.test(r.body) && /For the 400 North project, press 1\./.test(r.body)
      && /For the SR-201 project, press 2\./.test(r.body) && /general message, press 0/.test(r.body), 'the menu lists each extension and the general mailbox');
    t.ok(/Para español, oprima 9\./.test(r.body), 'the Spanish option is offered when it is on');
    t.ok(/Thank you for calling the UDOT Region One hotline/.test(r.body) && /Polly\.Joanna-Neural/.test(r.body), 'default greeting in the computer voice');
    t.ok(/<Redirect method="POST">[^<]*none=1/.test(r.body), 'no key pressed → falls through to the menu handler');

    r = await call('/voice', { ...inbound, To: '+18015559999' });
    t.ok(/not in service/.test(r.body), 'an unknown number says it is not in service');

    const menu = (q, digits) => call('/menu?' + q, { ...inbound, ...(digits != null ? { Digits: digits } : {}) });
    const q = `h=${h1.id}&l=en&r=0`;
    r = await menu(q, '2');
    t.ok(/<Record /.test(r.body) && new RegExp(`p=${pB.id}`).test(r.body) && /d=2/.test(r.body), 'pressing 2 records for the SR-201 project');
    t.ok(/maxLength="120"/.test(r.body) && /transcribe="true"/.test(r.body), 'English: two minutes, transcribed');
    r = await menu(q, '0');
    t.ok(/<Record /.test(r.body) && /p="/.test(r.body), '0 → the general mailbox (no project)');
    r = await call(`/menu?${q}&none=1`, inbound);
    t.ok(/<Record /.test(r.body) && /p="/.test(r.body), 'no choice → the general mailbox');
    r = await menu(q, '7');
    t.ok(/not one of the choices/.test(r.body) && /<Gather/.test(r.body) && /r=1/.test(r.body), 'a wrong key plays the menu once more');
    r = await menu(`h=${h1.id}&l=en&r=1`, '7');
    t.ok(/<Record /.test(r.body) && /p="/.test(r.body), 'a second wrong key → the general mailbox');
    r = await menu(q, '9');
    t.ok(/Polly\.Lupe-Neural/.test(r.body) && /Gracias por llamar/.test(r.body) && /oprima 1/.test(r.body) && /l=es/.test(r.body), '9 → the menu in Spanish');
    r = await menu(`h=${h1.id}&l=es&r=0`, '1');
    t.ok(/<Record /.test(r.body) && !/transcribe=/.test(r.body) && /deje su nombre/.test(r.body), 'Spanish: recorded in Spanish, no transcription requested');

    r = await call('/voice', { ...inbound, To: '+18015550102' });
    t.ok(!/<Gather/.test(r.body) && /<Record /.test(r.body) && new RegExp(`p=${pC.id}`).test(r.body), 'single project with Spanish off: straight to the recording');
    r = await call('/voice', { ...inbound, To: '+18015550103' });
    t.ok(/<Play>https:\/\/dev-project\.supabase\.co\/storage\/v1\/object\/sign\/hotline-audio\/greetings\/x-en\.mp3\?token=abc<\/Play>/.test(r.body), 'a recorded greeting is played from a signed link');
    t.ok(/<Gather numDigits="1" timeout="3"/.test(r.body) && /oprima 9/.test(r.body) && !/press 0/.test(r.body), 'single project with Spanish on: a short wait for 9 only');
    r = await menu(`h=${h3.id}&l=en&r=0`, null);
    t.ok(/<Record /.test(r.body) && new RegExp(`p=${pC.id}`).test(r.body), '…and no key goes to that project');
    r = await call(`/recorded?h=${h1.id}&l=es`, inbound);
    t.ok(/Gracias\. Hemos recibido/.test(r.body) && /<Hangup\/>/.test(r.body), 'after recording: thanks in the caller’s language, hang up');

    // ── the voicemail ─────────────────────────────────────────────────────
    const intsBefore = (await t.sql(`select count(*)::int n from pi_interactions`))[0].n;
    const recQ = `h=${h1.id}&l=en&d=1&p=${pA.id}`;
    const recParams = { CallSid: 'CA100', From: '+13855550199', To: '+18015550101', RecordingSid: 'RE100',
                        RecordingUrl: 'https://recordings.example/RE100', RecordingDuration: '41', RecordingStatus: 'completed' };
    r = await call('/recording?' + recQ, recParams);
    t.eq(r.status, 200, 'recording callback accepted');
    let [m] = await t.sql(`select * from pi_hotline_messages where call_sid='CA100'`);
    t.ok(m && m.status === 'pending' && m.project_id === String(pA.id) && m.extension_digit === '1' && m.recording_seconds === 41
      && m.caller_number === '+13855550199' && m.language === 'en', 'a PENDING voicemail row with project, extension, caller and length');
    t.eq(m.assigned_to, 'JP', 'assigned to the project’s PI Lead');
    t.eq(m.recording_path, `messages/${m.id}.mp3`, 'the audio was copied into our storage');
    t.ok(log.storage.some(s => s.url.endsWith(`/hotline-audio/messages/${m.id}.mp3`) && s.type === 'audio/mpeg'), '…in the private hotline-audio bucket');
    t.ok(log.downloads[0] && log.downloads[0].url === TW_API + '/Recordings/RE100.mp3' && /^Basic /.test(log.downloads[0].auth), 'downloaded from Twilio with the account’s credentials');
    t.eq(log.twilioDeletes.length, 0, 'Twilio’s copy is kept until the transcript is in');
    t.eq((await t.sql(`select count(*)::int n from pi_interactions`))[0].n, intsBefore, 'no interaction is created — a person logs it');
    t.ok(log.emails.length === 1 && log.emails[0].to[0] === 'lead@example.test' && /400 North/.test(log.emails[0].subject)
      && !/3855550199/.test(JSON.stringify(log.emails[0])), 'the lead is emailed, without the caller’s number');

    r = await call('/transcription?' + recQ, { CallSid: 'CA100', RecordingSid: 'RE100', TranscriptionStatus: 'completed',
                                               TranscriptionText: 'Hi, this is about the detour on 400 North.', From: '+13855550199' });
    [m] = await t.sql(`select * from pi_hotline_messages where call_sid='CA100'`);
    t.ok(m.transcript_status === 'done' && /detour/.test(m.transcript) && m.recording_path && m.assigned_to === 'JP', 'transcript saved; recording fields untouched');
    t.ok(log.twilioDeletes.length === 1 && /Recordings\/RE100\.json$/.test(log.twilioDeletes[0]), 'then Twilio’s copy is deleted');

    // Transcription first, recording second.
    const q2 = `h=${h1.id}&l=en&d=2&p=${pB.id}`;
    await call('/transcription?' + q2, { CallSid: 'CA200', RecordingSid: 'RE200', TranscriptionStatus: 'failed', From: '+13855550111' });
    await call('/recording?' + q2, { ...recParams, CallSid: 'CA200', RecordingSid: 'RE200', RecordingUrl: 'https://recordings.example/RE200', From: '+13855550111' });
    [m] = await t.sql(`select * from pi_hotline_messages where call_sid='CA200'`);
    t.ok(m && m.transcript_status === 'failed' && m.recording_path, 'callbacks in the other order: still one complete row');
    t.eq(m.assigned_to, null, 'a lead not on the active team list → unassigned');
    t.ok(log.twilioDeletes.some(u => /RE200/.test(u)), 'Twilio’s copy deleted once both are in');
    t.eq((await t.sql(`select count(*)::int n from pi_hotline_messages where call_sid='CA200'`))[0].n, 1, 'one row per call');

    // Spanish, general mailbox.
    await call(`/recording?h=${h1.id}&l=es&d=0&p=`, { ...recParams, CallSid: 'CA300', RecordingSid: 'RE300', RecordingUrl: 'https://recordings.example/RE300' });
    [m] = await t.sql(`select * from pi_hotline_messages where call_sid='CA300'`);
    t.ok(m && m.language === 'es' && m.transcript_status === 'none' && m.project_id === null && m.assigned_to === null, 'Spanish general-mailbox message: no transcript expected, no project yet');
    t.ok(log.twilioDeletes.some(u => /RE300/.test(u)), 'Spanish: Twilio’s copy deleted as soon as ours exists');

    // ── /notify ───────────────────────────────────────────────────────────
    const notify = async (auth, body) => {
      const res = await handler(new Request('http://localhost:9000/hotline/notify', { method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      return { status: res.status, body: await res.json() };
    };
    const [m2] = await t.sql(`update pi_hotline_messages set assigned_to='JP' where call_sid='CA200' returning id`);
    const before = log.emails.length;
    t.eq((await notify('', { messageId: m2.id })).status, 401, '/notify refuses a caller who is not signed in');
    t.eq((await notify('Bearer stranger-token', { messageId: m2.id })).status, 403, '/notify refuses a signed-in non-staff user');
    const n = await notify('Bearer staff-token', { messageId: m2.id });
    t.ok(n.status === 200 && n.body.sent === true && log.emails.length === before + 1 && /SR-201/.test(log.emails.at(-1).subject), 'staff: the new assignee is emailed');

    // ── greeting wording ──────────────────────────────────────────────────
    t.eq(L.hotName('Test Hotline'), 'Test', 'a name ending in "Hotline" is not doubled');
    t.ok(/calling the Test hotline\./.test(L.greetingParts({ name: 'Test Hotline' }, 'en')) && !/Hotline hotline/i.test(L.greetingParts({ name: 'Test Hotline' }, 'en')), 'greeting reads “the Test hotline”, not “Test Hotline hotline”');
    t.ok(/proyecto Test\./.test(L.greetingParts({ name: 'Test Hotline' }, 'es')), 'Spanish greeting drops it too');

    // ── fallback assignee (no PI Lead, or the general mailbox) ────────────
    await t.sql(`update pi_hotlines set default_assignee='JP' where id=$1`, [h1.id]);
    await call(`/recording?h=${h1.id}&l=en&d=0&p=`, { ...recParams, CallSid: 'CA400', RecordingSid: 'RE400' });
    await call(`/recording?h=${h1.id}&l=en&d=2&p=${pB.id}`, { ...recParams, CallSid: 'CA401', RecordingSid: 'RE401' });
    const fb = Object.fromEntries((await t.sql(`select call_sid, assigned_to from pi_hotline_messages where call_sid in ('CA400','CA401')`)).map(r => [r.call_sid, r.assigned_to]));
    t.ok(fb.CA400 === 'JP' && fb.CA401 === 'JP', 'general mailbox, and a project whose lead is not on the team list, go to the hotline’s fallback person');
    await call(`/recording?h=${h1.id}&l=en&d=1&p=${pA.id}`, { ...recParams, CallSid: 'CA402', RecordingSid: 'RE402' });
    t.eq((await t.sql(`select assigned_to from pi_hotline_messages where call_sid='CA402'`))[0].assigned_to, 'JP', 'the project’s own lead still comes first');

    // ── call-back via the hotline (not recorded) ──────────────────────────
    const cb = async (auth, body) => {
      const res = await handler(new Request('http://localhost:9000/hotline/callback', { method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      return { status: res.status, body: await res.json() };
    };
    const [cm] = await t.sql(`select id from pi_hotline_messages where call_sid='CA100'`);
    t.eq((await cb('', { messageId: cm.id, ringMe: '8015550177' })).status, 401, 'call-back: refused without a sign-in');
    t.eq((await cb('Bearer stranger-token', { messageId: cm.id, ringMe: '8015550177' })).status, 403, 'call-back: refused for a non-staff sign-in');
    t.eq((await cb('Bearer staff-token', { messageId: cm.id, ringMe: '+449876543210' })).status, 400, 'call-back: a non-US “ring me” number is refused');
    t.eq((await cb('Bearer staff-token', { messageId: cm.id, ringMe: '9005550100' })).status, 400, 'call-back: a premium 900 number is refused');
    t.eq((await cb('Bearer staff-token', { messageId: cm.id, ringMe: '3855550199' })).status, 400, 'call-back: ringing the caller’s own number is refused');
    t.eq(log.calls.length, 0, '…and none of those reached Twilio');
    const ok = await cb('Bearer staff-token', { messageId: cm.id, ringMe: '(801) 555-0177' });
    const placed = log.calls[0] || {};
    t.ok(ok.status === 200 && placed.To === '+18015550177' && placed.From === '+18015550101'
      && placed.Url === base + '/bridge?m=' + cm.id && !/3855550199/.test(JSON.stringify(placed)),
      'call-back: Twilio rings the staff phone FROM the hotline number; the caller’s number is not in the request');
    // The staff leg: press 1, then the caller is dialled from the hotline number.
    const leg = { CallSid: 'CA' + 'f'.repeat(32), AccountSid: ACCT, From: '+18015550101', To: '+18015550177' };
    r = await call('/bridge?m=' + cm.id, leg);
    t.ok(/<Gather numDigits="1"/.test(r.body) && /Press 1 to call 3 8 5, 5 5 5, 0 1 9 9/.test(r.body) && !/<Dial/.test(r.body), 'bridge: asks the staff member to press 1 — nobody is dialled yet');
    r = await call('/connect?m=' + cm.id, { ...leg, Digits: '1' });
    t.ok(/<Dial callerId="\+18015550101"[^>]*><Number>\+13855550199<\/Number><\/Dial>/.test(r.body) && !/<Record/.test(r.body) && !/record="/.test(r.body), 'press 1: the caller is dialled from the hotline number, not recorded');
    r = await call('/connect?m=' + cm.id, { ...leg, Digits: '' });
    t.ok(!/<Dial/.test(r.body) && /No call was placed/.test(r.body), 'no key (voicemail picked up): nobody is dialled');
    // Unsigned bridge legs are confirmed as OUR outbound call from a hotline.
    const legSid = 'CA' + '1'.repeat(32);
    twilioApi[`Calls/${legSid}.json`] = { sid: legSid, account_sid: ACCT, direction: 'outbound-api', from: '+18015550101', to: '+18015550177', status: 'in-progress' };
    t.eq((await call('/bridge?m=' + cm.id, { ...leg, CallSid: legSid }, { signed: false })).status, 200, 'unsigned bridge leg: accepted once Twilio confirms our outbound call');
    twilioApi[`Calls/${legSid}.json`].direction = 'inbound';
    t.eq((await call('/bridge?m=' + cm.id, { ...leg, CallSid: legSid }, { signed: false })).status, 403, 'unsigned bridge leg: an inbound call cannot pose as one');

    // ── the dialpad: a fresh call from a hotline number (not recorded) ─────
    const dial = async (auth, body) => {
      const res = await handler(new Request('http://localhost:9000/hotline/dial', { method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      return { status: res.status, body: await res.json() };
    };
    const callsBefore = log.calls.length;
    const d0 = { hotlineId: h1.id, to: '(435) 555-0142', ringMe: '801-555-0177', projectId: String(pA.id), placedBy: 'jp' };
    t.eq((await dial('', d0)).status, 401, 'dial: refused without a sign-in');
    t.eq((await dial('Bearer stranger-token', d0)).status, 403, 'dial: refused for a non-staff sign-in');
    t.eq((await dial('Bearer staff-token', { ...d0, to: '9765550100' })).status, 400, 'dial: a 976 number is refused');
    t.eq((await dial('Bearer staff-token', { ...d0, to: '+442071234567' })).status, 400, 'dial: a non-US number is refused');
    t.eq((await dial('Bearer staff-token', { ...d0, to: '8015550177' })).status, 400, 'dial: the number to call cannot be your own phone');
    t.eq((await dial('Bearer staff-token', { ...d0, to: '8015550101' })).status, 400, 'dial: the number to call cannot be the hotline itself');
    t.eq(log.calls.length, callsBefore, '…none of those reached Twilio');
    t.eq((await t.sql(`select count(*)::int n from pi_hotline_calls`))[0].n, 0, '…and none was written as a call');
    let d = await dial('Bearer staff-token', d0);
    const [row] = await t.sql(`select * from pi_hotline_calls where id=$1`, [d.body.callId]);
    const dPlaced = log.calls[log.calls.length - 1] || {};
    t.ok(d.status === 200 && row && row.to_number === '+14355550142' && row.placed_by_email === 'staff@sunrise.example'
      && row.placed_by === 'JP' && row.project_id === String(pA.id) && row.status === 'ringing' && row.call_sid,
      'dial: the call is written first — who placed it, to which number, for which project');
    t.ok(dPlaced.To === '+18015550177' && dPlaced.From === '+18015550101' && dPlaced.Url === base + '/bridge?c=' + row.id
      && !/4355550142/.test(JSON.stringify(dPlaced)), 'dial: Twilio rings the staff phone from the hotline; the number to call is not in the request');
    d = await dial('Bearer staff-token', { ...d0, projectId: String(pC.id) });
    t.eq((await t.sql(`select project_id from pi_hotline_calls where id=$1`, [d.body.callId]))[0].project_id, null, 'dial: a project that is not on this hotline’s menu is not recorded against it');
    d = await dial('Bearer staff-token', { ...d0, hotlineId: h2.id, projectId: String(pA.id) });
    t.eq((await t.sql(`select project_id from pi_hotline_calls where id=$1`, [d.body.callId]))[0].project_id, String(pC.id), 'dial: a one-project hotline always records its own project');
    // The staff leg.
    const dleg = { CallSid: 'CA' + '2'.repeat(32), AccountSid: ACCT, From: '+18015550101', To: '+18015550177' };
    r = await call('/bridge?c=' + row.id, dleg);
    t.ok(/This is your call from the UDOT Region One hotline\. Press 1 to call 4 3 5, 5 5 5, 0 1 4 2/.test(r.body) && !/<Dial/.test(r.body), 'dial bridge: asks the staff member to press 1 — nobody is dialled yet');
    t.eq((await t.sql(`select status from pi_hotline_calls where id=$1`, [row.id]))[0].status, 'answered', 'dial bridge: marked answered');
    r = await call('/connect?c=' + row.id, { ...dleg, Digits: '1' });
    t.ok(/<Dial callerId="\+18015550101"[^>]*><Number>\+14355550142<\/Number><\/Dial>/.test(r.body) && !/<Record/.test(r.body), 'dial press 1: the number is dialled from the hotline, not recorded');
    t.eq((await t.sql(`select status from pi_hotline_calls where id=$1`, [row.id]))[0].status, 'connected', 'dial: marked connected');
    await t.sql(`update pi_hotline_calls set created_at = now() - interval '20 minutes' where id=$1`, [row.id]);
    r = await call('/connect?c=' + row.id, { ...dleg, Digits: '1' });
    t.ok(!/<Dial/.test(r.body) && /no longer available/.test(r.body), 'dial: an old call cannot be re-dialled through its bridge');
    // The daily cap.
    await t.sql(`insert into pi_hotline_calls (hotline_id, to_number, placed_by_email, status) select $1, '+14355550142', 'staff@sunrise.example', 'connected' from generate_series(1, ${L.DIAL_DAILY_LIMIT})`, [h1.id]);
    const capBefore = log.calls.length;
    d = await dial('Bearer staff-token', d0);
    t.ok(d.status === 429 && log.calls.length === capBefore, 'dial: over the daily limit, refused before Twilio is asked');
    // Staff read calls but cannot invent one.
    t.ok(/revoke insert, delete on public\.pi_hotline_calls from authenticated/.test(require('fs').readFileSync(path.join(__dirname, '..', '..', 'sql', '2026-10-12_hotlines.sql'), 'utf8')),
      'staff cannot insert or delete call rows — only the receiver writes them');
    const [g] = await t.sql(`select has_table_privilege('authenticated','pi_hotline_calls','INSERT') ins, has_table_privilege('authenticated','pi_hotline_calls','UPDATE') upd, has_table_privilege('anon','pi_hotline_calls','SELECT') anon`);
    t.ok(!g.ins && g.upd && !g.anon, 'grants: staff update only; anon nothing');

    // ── Ring-through: the PI Lead's phone rings before voicemail ──────────
    // Settings layering and business hours (pure).
    const D = L.ringSettings(null, {}, null);
    t.ok(D.enabled && D.seconds === 12 && D.start === '07:00' && D.end === '18:00' && D.days === '1,2,3,4,5' && D.tz === 'America/Denver',
      'defaults: ring on, 12 seconds, Mon–Fri 7:00–18:00 Mountain');
    const lay = L.ringSettings({ ring_enabled: true, ring_seconds: 15, hours_start: '06:00', hours_end: '17:00', hours_days: '1,2,3,4,5', timezone: 'America/Denver' },
      { ring_seconds: 20 }, { ring_mode: 'off', hours_start: '09:00' });
    t.ok(!lay.enabled && lay.seconds === 20 && lay.start === '09:00' && lay.end === '17:00', 'each field comes from the nearest layer that sets it (option → hotline → defaults)');
    t.eq(L.ringSettings(null, { ring_seconds: 999 }, null).seconds, 60, 'ring time is held to 5–60 seconds');
    const MON_10 = new Date('2026-10-12T16:00:00Z'), MON_6PM = new Date('2026-10-13T00:00:00Z'), SUN_10 = new Date('2026-10-11T16:00:00Z'), MON_659 = new Date('2026-10-12T12:59:00Z');
    t.ok(L.inHours(D, MON_10) && !L.inHours(D, MON_6PM) && !L.inHours(D, SUN_10) && !L.inHours(D, MON_659),
      'business hours: Monday 10 am in; 6:00 pm, 6:59 am and Sunday out (Mountain Time)');

    await t.sql(`update pi_team_members set phone='801-555-0177' where initials='JP'`);
    const at = when => L.createHandler({ env, fetchFn, now: () => when });
    const inMon = at(MON_10);
    const menu1 = { CallSid: 'CA' + '3'.repeat(32), From: '+13855550111', To: '+18015550101', Digits: '1' };
    r = await call(`/menu?h=${h1.id}&l=en&r=0`, menu1, { h: inMon });
    t.ok(/Please hold while we connect you/.test(r.body) && /<Dial timeout="12"/.test(r.body)
      && /<Number url="[^"]*\/whisper\?[^"]*a=JP[^"]*" method="POST">\+18015550177<\/Number>/.test(r.body) && /action="[^"]*\/afterdial\?/.test(r.body) && !/<Record/.test(r.body),
      'in hours: pressing the project’s key rings its PI Lead for 12 seconds');
    r = await call(`/menu?h=${h1.id}&l=en&r=0`, menu1, { h: at(SUN_10) });
    t.ok(/<Record /.test(r.body) && !/<Dial/.test(r.body), 'Sunday: straight to voicemail');
    r = await call(`/menu?h=${h1.id}&l=en&r=0`, menu1, { h: at(MON_6PM) });
    t.ok(/<Record /.test(r.body) && !/<Dial/.test(r.body), 'after 6 pm: straight to voicemail');
    r = await call(`/menu?h=${h1.id}&l=en&r=0`, { ...menu1, Digits: '2' }, { h: inMon });
    t.ok(/<Record /.test(r.body) && !/<Dial/.test(r.body), 'a project whose lead is not on the team list: voicemail');
    r = await call(`/menu?h=${h1.id}&l=en&r=0`, { ...menu1, Digits: '0' }, { h: inMon });
    t.ok(/<Record /.test(r.body) && !/<Dial/.test(r.body), 'the general mailbox has no lead: voicemail');
    // The harness empties tables between tests; the migration's seeded row is gone.
    await t.sql(`insert into pi_hotline_settings (id) values (1) on conflict (id) do nothing`);
    await t.sql(`update pi_hotline_settings set ring_enabled=false where id=1`);
    r = await call(`/menu?h=${h1.id}&l=en&r=0`, menu1, { h: inMon });
    t.ok(/<Record /.test(r.body) && !/<Dial/.test(r.body), 'ringing switched off in the defaults: voicemail');
    await t.sql(`update pi_hotlines set ring_mode='on', ring_seconds=20 where id=$1`, [h1.id]);
    r = await call(`/menu?h=${h1.id}&l=en&r=0`, menu1, { h: inMon });
    t.ok(/<Dial timeout="20"/.test(r.body), 'a hotline can switch ringing back on for itself, with its own ring time');
    await t.sql(`update pi_hotline_extensions set hours_start='08:00', hours_end='09:00' where hotline_id=$1 and digit='1'`, [h1.id]);
    r = await call(`/menu?h=${h1.id}&l=en&r=0`, menu1, { h: inMon });
    t.ok(/<Record /.test(r.body) && !/<Dial/.test(r.body), 'a project on a menu can keep its own hours (8–9 am here, so 10 am goes to voicemail)');
    await t.sql(`update pi_hotline_extensions set hours_start=null, hours_end=null where hotline_id=$1`, [h1.id]);
    await t.sql(`update pi_hotlines set ring_mode=null, ring_seconds=null where id=$1`, [h1.id]);
    await t.sql(`update pi_hotline_settings set ring_enabled=true where id=1`);
    // A one-project number with no menu rings straight after the greeting.
    await t.sql(`update pi_projects set lead='JP' where id=$1`, [pC.id]);
    r = await call('/voice', { CallSid: 'CA' + '4'.repeat(32), From: '+13855550112', To: '+18015550102' }, { h: inMon });
    t.ok(/Thank you for calling the Main Street Sewer hotline/.test(r.body) && /<Dial timeout="12"/.test(r.body), 'a one-project number: greeting, then the lead’s phone rings');
    await t.sql(`update pi_projects set lead=null where id=$1`, [pC.id]);

    // The lead's leg: press 1 to take it.
    const rq = `h=${h1.id}&l=en&d=1&p=${pA.id}&a=JP`;
    const PARENT = 'CA' + '5'.repeat(32), CHILD = 'CA' + '6'.repeat(32);
    const lead = { CallSid: CHILD, ParentCallSid: PARENT, AccountSid: ACCT, From: '+13855550111', To: '+18015550177' };
    r = await call('/whisper?' + rq, lead, { h: inMon });
    t.ok(/<Gather numDigits="1"/.test(r.body) && /Call for the UDOT Region One hotline\. Press 1 to accept/.test(r.body) && /<Hangup\/>\s*<\/Response>/.test(r.body),
      'the lead hears who it is for and must press 1 — their own voicemail never takes the call');
    r = await call('/accept?' + rq, { ...lead, Digits: '' }, { h: inMon });
    t.ok(/<Hangup\/>/.test(r.body) && (await t.sql(`select count(*)::int n from pi_hotline_calls where call_sid=$1`, [PARENT]))[0].n === 0, 'no key: not connected, nothing recorded');
    r = await call('/accept?' + rq, { ...lead, Digits: '1' }, { h: inMon });
    const [ans] = await t.sql(`select * from pi_hotline_calls where call_sid=$1`, [PARENT]);
    t.ok(/<Response><\/Response>/.test(r.body) && ans && ans.direction === 'inbound' && ans.to_number === '+13855550111' && ans.ring_number === '+18015550177'
      && ans.placed_by === 'JP' && ans.placed_by_email === 'lead@example.test' && ans.project_id === String(pA.id) && !ans.outcome,
      'press 1: connected, and an answered-call row waits for review — number, project, who answered');
    r = await call('/afterdial?' + rq, { CallSid: PARENT, AccountSid: ACCT, From: '+13855550111', To: '+18015550101', DialCallStatus: 'completed', DialCallDuration: '95' }, { h: inMon });
    const [ans2] = await t.sql(`select status, duration_seconds from pi_hotline_calls where call_sid=$1`, [PARENT]);
    t.ok(/<Hangup\/>/.test(r.body) && !/<Record/.test(r.body) && ans2.status === 'completed' && ans2.duration_seconds === 95, 'after an answered call: hang up, length recorded');
    r = await call('/afterdial?' + rq, { CallSid: 'CA' + '7'.repeat(32), AccountSid: ACCT, From: '+13855550111', To: '+18015550101', DialCallStatus: 'no-answer' }, { h: inMon });
    t.ok(/nobody can take your call/.test(r.body) && /<Record /.test(r.body) && new RegExp('p=' + pA.id).test(r.body), 'nobody took it: the caller leaves a voicemail for that project');
    // Unsigned lead legs are confirmed as a leg of a live inbound hotline call.
    twilioApi[`Calls/${CHILD}.json`] = { sid: CHILD, account_sid: ACCT, direction: 'outbound-dial', parent_call_sid: PARENT, status: 'in-progress' };
    twilioApi[`Calls/${PARENT}.json`] = { sid: PARENT, account_sid: ACCT, direction: 'inbound', to: '+18015550101', status: 'in-progress' };
    t.eq((await call('/whisper?' + rq, lead, { h: inMon, signed: false })).status, 200, 'unsigned lead leg: accepted once Twilio confirms it belongs to a live hotline call');
    twilioApi[`Calls/${PARENT}.json`].to = '+18005550000';
    t.eq((await call('/whisper?' + rq, lead, { h: inMon, signed: false })).status, 403, 'unsigned lead leg: refused when its parent call was not to a hotline');
    // Answered calls never count against the dialpad's daily limit.
    t.ok(/direction=eq\.outbound/.test(require('fs').readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'hotline', 'logic.mjs'), 'utf8')), 'the daily limit counts calls placed, not calls answered');
  },
};
