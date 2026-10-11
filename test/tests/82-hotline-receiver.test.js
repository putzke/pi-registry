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
    const log = { storage: [], twilioDeletes: [], emails: [], downloads: [], twilioLookups: [] };
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
  },
};
