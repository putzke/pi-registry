// Project hotline receiver — the logic, kept free of Deno so the test harness
// (Node) runs exactly this file. index.ts only wires it to Deno.serve.
//
// Twilio calls this function at each step of a call:
//   POST /hotline/voice        a call comes in       → greeting + menu (TwiML)
//   POST /hotline/menu         the caller pressed a key (or nothing)
//   POST /hotline/recorded     the recording ended   → "thank you", hang up
//   POST /hotline/recording    the recording is ready → save the voicemail
//   POST /hotline/transcription  the transcript is ready
// Every Twilio request must carry a valid X-Twilio-Signature, or — when it
// carries none at all — be confirmed call-by-call against Twilio's own API
// (confirmWithTwilio). Anything else is refused. The app calls one route, with the signed-in user's token:
//   POST /hotline/notify       {messageId} → email the person it is assigned to
//
// Nothing here creates an interaction. A voicemail lands as a PENDING row in
// pi_hotline_messages and only becomes an interaction when a person logs it
// in the Hotline inbox (the locked rule: interactions are entered deliberately).

export const VOICE = {
  en: { voice: 'Polly.Joanna-Neural', language: 'en-US' },
  es: { voice: 'Polly.Lupe-Neural',   language: 'es-US' },
};
// Twilio's <Record> transcription only covers recordings up to two minutes.
export const MAX_RECORD_SECONDS = 120;
export const SPANISH_DIGIT = '9';
export const GENERAL_DIGIT = '0';
export const AUDIO_BUCKET = 'hotline-audio';

const T = {
  en: {
    greeting: name => `Thank you for calling the ${name} hotline.`,
    option: (label, d) => `For ${label}, press ${d}.`,
    general: 'To leave a general message, press 0.',
    spanish: 'Para español, oprima 9.',
    notOption: 'Sorry, that is not one of the choices.',
    record: 'Please leave your name, your phone number and your message after the tone. You have two minutes. Press the pound key when you are finished.',
    thanks: 'Thank you. Your message has been received. Goodbye.',
    closed: 'This number is not in service. Goodbye.',
    noMessage: 'We did not receive a message. Goodbye.',
    trouble: 'Sorry, we are having trouble taking messages right now. Please call back later.',
  },
  es: {
    greeting: name => `Gracias por llamar a la línea de información del proyecto ${name}.`,
    option: (label, d) => `Para ${label}, oprima ${d}.`,
    general: 'Para dejar un mensaje general, oprima 0.',
    spanish: '',
    notOption: 'Lo sentimos, esa no es una de las opciones.',
    record: 'Por favor, deje su nombre, su número de teléfono y su mensaje después del tono. Tiene dos minutos. Oprima la tecla de numeral cuando termine.',
    thanks: 'Gracias. Hemos recibido su mensaje. Adiós.',
    closed: 'Este número no está en servicio. Adiós.',
    noMessage: 'No recibimos un mensaje. Adiós.',
    trouble: 'Lo sentimos, tenemos problemas para recibir mensajes. Por favor, llame más tarde.',
  },
};
export const PHRASES = T;

export function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const say = (text, lang) => text
  ? `<Say voice="${VOICE[lang].voice}" language="${VOICE[lang].language}">${xmlEsc(text)}</Say>` : '';
const twiml = inner => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

// E.164-ish: keep a leading + and digits. Twilio sends +18015550123.
export function normPhone(p) {
  const s = String(p || '').trim();
  const d = s.replace(/\D/g, '');
  if (!d) return '';
  if (s.startsWith('+')) return '+' + d;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '+' + d;
}

// Active menu choices on a hotline, sorted by digit.
export function activeExtensions(exts, hotlineId) {
  return (exts || [])
    .filter(e => e.active !== false && String(e.hotline_id) === String(hotlineId) && /^[1-8]$/.test(e.digit))
    .sort((a, b) => a.digit.localeCompare(b.digit));
}

// What the caller hears first. `greetingUrl` is a signed URL to an uploaded
// recording when the hotline uses one; otherwise the text is spoken.
export function greetingParts(hotline, lang, greetingUrl) {
  if (greetingUrl) return `<Play>${xmlEsc(greetingUrl)}</Play>`;
  const text = lang === 'es'
    ? (hotline.spanish_greeting_text || T.es.greeting(hotline.name))
    : (hotline.greeting_text || T.en.greeting(hotline.name));
  return say(text, lang);
}

export function menuText(hotline, exts, lang) {
  const t = T[lang];
  const lines = [];
  if (exts.length) {
    exts.forEach(e => lines.push(t.option((lang === 'es' && e.label_es) || e.label || ('project ' + e.digit), e.digit)));
    lines.push(t.general);
  }
  if (lang === 'en' && hotline.spanish_enabled) lines.push(T.en.spanish);
  return lines.join(' ');
}

// The greeting + menu. A single-project number with Spanish off has no menu at
// all and goes straight to the recording.
export function voiceTwiml({ hotline, exts, lang, base, greetingUrl, retry = 0 }) {
  const q = `h=${hotline.id}&l=${lang}`;
  const menu = menuText(hotline, exts, lang);
  const greet = retry ? '' : greetingParts(hotline, lang, greetingUrl);
  if (!menu) return twiml(greet + recordParts({ hotline, lang, base, projectId: hotline.project_id, digit: '' }));
  const timeout = exts.length ? 6 : 3;
  return twiml(
    `<Gather numDigits="1" timeout="${timeout}" action="${xmlEsc(base + '/menu?' + q + '&r=' + retry)}" method="POST">`
    + greet + say(menu, lang) + '</Gather>'
    + `<Redirect method="POST">${xmlEsc(base + '/menu?' + q + '&r=' + retry + '&none=1')}</Redirect>`);
}

// Where a key press goes.
//   {kind:'spanish'} | {kind:'record', projectId, digit} | {kind:'retry'}
export function route({ hotline, exts, lang, digits, retry }) {
  const d = String(digits || '').slice(0, 1);
  if (d === SPANISH_DIGIT && lang === 'en' && hotline.spanish_enabled) return { kind: 'spanish' };
  if (!exts.length) return { kind: 'record', projectId: hotline.project_id || null, digit: '' };
  const hit = exts.find(e => e.digit === d);
  if (hit) return { kind: 'record', projectId: hit.project_id, digit: d };
  if (!d || d === GENERAL_DIGIT) return { kind: 'record', projectId: null, digit: GENERAL_DIGIT };
  // A wrong key: say so and play the menu once more, then the general mailbox.
  return Number(retry) >= 1 ? { kind: 'record', projectId: null, digit: GENERAL_DIGIT } : { kind: 'retry' };
}

function recordParts({ hotline, lang, base, projectId, digit }) {
  const q = `h=${hotline.id}&l=${lang}&d=${encodeURIComponent(digit || '')}&p=${encodeURIComponent(projectId || '')}`;
  // Twilio's own transcription is English; a Spanish message is kept as audio
  // and the inbox says to listen to it.
  const tr = lang === 'en'
    ? ` transcribe="true" transcribeCallback="${xmlEsc(base + '/transcription?' + q)}"` : '';
  return say(T[lang].record, lang)
    + `<Record maxLength="${MAX_RECORD_SECONDS}" timeout="6" finishOnKey="#" playBeep="true"`
    + ` action="${xmlEsc(base + '/recorded?' + q)}" method="POST"`
    + ` recordingStatusCallback="${xmlEsc(base + '/recording?' + q)}" recordingStatusCallbackMethod="POST"`
    + ` recordingStatusCallbackEvent="completed"${tr}/>`
    + say(T[lang].noMessage, lang) + '<Hangup/>';
}

export function menuTwiml({ hotline, exts, lang, base, digits, retry, greetingUrl }) {
  const r = route({ hotline, exts, lang, digits, retry });
  if (r.kind === 'spanish') {
    const esExts = exts;
    return voiceTwiml({ hotline, exts: esExts, lang: 'es', base, greetingUrl });
  }
  if (r.kind === 'retry') {
    return twiml(say(T[lang].notOption, lang)
      + voiceTwiml({ hotline, exts, lang, base, retry: 1 }).replace(/^.*?<Response>|<\/Response>$/g, ''));
  }
  return twiml(recordParts({ hotline, lang, base, projectId: r.projectId, digit: r.digit }));
}

export const recordedTwiml = lang => twiml(say(T[lang === 'es' ? 'es' : 'en'].thanks, lang === 'es' ? 'es' : 'en') + '<Hangup/>');
export const closedTwiml = () => twiml(say(T.en.closed, 'en') + '<Hangup/>');
export const troubleTwiml = () => twiml(say(T.en.trouble, 'en') + '<Hangup/>');

// ── Twilio request signature ─────────────────────────────────────────────────
// HMAC-SHA1 over the full URL Twilio called followed by every POST parameter,
// sorted by name, as name+value — base64. https://www.twilio.com/docs/usage/security
export async function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  let bin = ''; sig.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
export async function validSignature(authToken, url, params, header) {
  if (!authToken || !header) return false;
  const want = await twilioSignature(authToken, url, params);
  if (want.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

// The project's PI Lead, if they are an active member of the team list.
export function pickAssignee(project, team) {
  const lead = String((project && project.lead) || '').trim().toUpperCase();
  if (!lead) return null;
  const m = (team || []).find(x => String(x.initials || '').trim().toUpperCase() === lead && x.active !== false);
  return m ? m.initials : null;
}

// ── The handler ──────────────────────────────────────────────────────────────
// env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_ACCOUNT_SID,
//      TWILIO_AUTH_TOKEN, RESEND_API_KEY (optional), HOTLINE_FROM_EMAIL
//      (optional), APP_BASE_URL (optional).
// fetchFn is injected so the harness can stand in for Supabase/Twilio/Resend.
export function createHandler({ env, fetchFn = fetch, now = () => new Date() }) {
  const SB = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  // A pasted secret often carries a stray space or newline.
  const TOKEN = String(env.TWILIO_AUTH_TOKEN || '').trim();
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const base = SB + '/functions/v1/hotline';
  const sbH = (extra = {}) => ({ apikey: KEY, Authorization: 'Bearer ' + KEY, ...extra });

  async function rest(path, opts = {}) {
    const r = await fetchFn(SB + '/rest/v1/' + path, { ...opts, headers: sbH(opts.headers || {}) });
    if (!r.ok) throw new Error('REST ' + r.status + ' ' + path.split('?')[0] + ': ' + (await r.text()).slice(0, 200));
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const one = async path => ((await rest(path)) || [])[0] || null;

  const xml = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/xml' } });
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

  async function loadHotline(id) {
    const h = await one(`pi_hotlines?id=eq.${encodeURIComponent(id)}&select=*`);
    if (!h || h.active === false) return null;
    const exts = activeExtensions(await rest(`pi_hotline_extensions?hotline_id=eq.${h.id}&select=*`), h.id);
    return { h, exts };
  }

  async function greetingUrl(h, lang) {
    const path = lang === 'es' ? h.spanish_greeting_audio_path : h.greeting_audio_path;
    if (h.greeting_mode !== 'recording' || !path) return '';
    try {
      const r = await fetchFn(`${SB}/storage/v1/object/sign/${AUDIO_BUCKET}/${path}`, {
        method: 'POST', headers: sbH({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: 900 }) });
      if (!r.ok) return '';
      const j = await r.json();
      return j.signedURL ? SB + '/storage/v1' + j.signedURL : '';
    } catch (_) { return ''; }        // fall back to the computer voice
  }

  const SID = String(env.TWILIO_ACCOUNT_SID || '').trim();
  const API = `https://api.twilio.com/2010-04-01/Accounts/${SID}`;
  const twilioAuth = () => 'Basic ' + btoa(SID + ':' + TOKEN);
  async function twilioGet(path) {
    const r = await fetchFn(`${API}/${path}`, { headers: { Authorization: twilioAuth() } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('twilio ' + r.status);
    return r.json();
  }

  // Some Twilio numbers (seen on a new trial account's "Receive a call" set-up)
  // post webhooks with NO X-Twilio-Signature at all. Such a request is only
  // accepted if Twilio's own API, asked with our credentials, confirms it: the
  // call exists on our account, came IN to one of our hotline numbers, and is
  // still live (or, for the recording callbacks, began within the last day and
  // the recording belongs to it). Returns '' when confirmed, else the reason.
  async function confirmWithTwilio(sub, params) {
    if (params.AccountSid !== SID) return 'account';
    if (!/^CA[0-9a-f]{32}$/i.test(params.CallSid || '')) return 'call sid';
    const c = await twilioGet(`Calls/${params.CallSid}.json`);
    if (!c) return 'no such call';
    if (c.account_sid !== SID) return 'account';
    if (c.direction !== 'inbound') return 'direction';
    if (params.To && normPhone(params.To) !== normPhone(c.to)) return 'to';
    if (!(await one(`pi_hotlines?phone_number=eq.${encodeURIComponent(normPhone(c.to))}&select=id`))) return 'not a hotline';
    if (['/voice', '/menu', '/recorded'].includes(sub)) {
      if (!['queued', 'ringing', 'in-progress'].includes(c.status)) return 'call over';
    } else {
      const age = now().getTime() - new Date(c.date_created || c.start_time).getTime();
      if (!(age >= 0 && age < 86400000)) return 'too old';
      if (!/^RE[0-9a-f]{32}$/i.test(params.RecordingSid || '')) return 'recording sid';
      const rec = await twilioGet(`Recordings/${params.RecordingSid}.json`);
      if (!rec || rec.call_sid !== params.CallSid) return 'recording';
    }
    return '';
  }

  async function deleteTwilioRecording(sid) {
    if (!sid) return;
    try {
      await fetchFn(`${API}/Recordings/${encodeURIComponent(sid)}.json`,
        { method: 'DELETE', headers: { Authorization: twilioAuth() } });
    } catch (_) { /* best effort — Twilio keeps it until deleted by hand */ }
  }

  async function sendEmail(to, subject, text) {
    if (!env.RESEND_API_KEY || !to) return false;
    const r = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.HOTLINE_FROM_EMAIL || 'Cirrus Cc <no-reply@cirruscc.com>', to: [to], subject, text }),
    });
    return r.ok;
  }

  // Email whoever the message is assigned to. No transcript or caller number in
  // the email — the inbox is where those are read.
  async function notifyAssignee(msg) {
    if (!msg || !msg.assigned_to) return false;
    const m = await one(`pi_team_members?initials=ilike.${encodeURIComponent(msg.assigned_to)}&active=eq.true&select=name,email`);
    if (!m || !m.email) return false;
    const proj = msg.project_id ? await one(`pi_projects?id=eq.${encodeURIComponent(msg.project_id)}&select=name`) : null;
    const where = proj ? proj.name : 'the general mailbox';
    const app = (env.APP_BASE_URL || '').replace(/\/$/, '');
    const lang = msg.language === 'es' ? ' (in Spanish)' : '';
    const text = `A new hotline voicemail${lang} for ${where} is waiting for you in Cirrus Cc.\n\n`
      + `Open the Hotline inbox to listen and log it:\n${app ? app + '/index.html' : 'Cirrus Cc'}\n`;
    return sendEmail(m.email, `New hotline voicemail — ${where}`, text);
  }

  // Fields both recording callbacks know.
  const baseRow = (url, params, loaded, lang) => ({
    hotline_id: loaded ? loaded.h.id : (Number(url.searchParams.get('h')) || null),
    extension_digit: url.searchParams.get('d') || null,
    project_id: url.searchParams.get('p') || null,
    language: lang,
    caller_number: params.From || null,
    call_sid: params.CallSid,
    updated_at: now().toISOString(),
  });
  async function upsertMessage(row) {
    if (!row.call_sid) throw new Error('no CallSid');
    return ((await rest('pi_hotline_messages?on_conflict=call_sid', {
      method: 'POST', body: JSON.stringify(row),
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates' },
    })) || [])[0] || null;
  }

  async function handleTwilio(sub, url, params) {
    const lang = url.searchParams.get('l') === 'es' ? 'es' : 'en';
    if (sub === '/voice') {
      const h = await one(`pi_hotlines?phone_number=eq.${encodeURIComponent(normPhone(params.To))}&active=eq.true&select=*`);
      if (!h) return xml(closedTwiml());
      const loaded = await loadHotline(h.id);
      return xml(voiceTwiml({ hotline: loaded.h, exts: loaded.exts, lang: 'en', base, greetingUrl: await greetingUrl(loaded.h, 'en') }));
    }
    const loaded = await loadHotline(url.searchParams.get('h'));
    if (sub === '/menu') {
      if (!loaded) return xml(closedTwiml());
      const digits = url.searchParams.get('none') ? '' : params.Digits;
      const r = route({ hotline: loaded.h, exts: loaded.exts, lang, digits, retry: url.searchParams.get('r') });
      const gu = r.kind === 'spanish' ? await greetingUrl(loaded.h, 'es') : '';
      return xml(menuTwiml({ hotline: loaded.h, exts: loaded.exts, lang, base, digits, retry: url.searchParams.get('r'), greetingUrl: gu }));
    }
    if (sub === '/recorded') return xml(recordedTwiml(lang));

    if (sub === '/recording') {
      if (params.RecordingStatus && params.RecordingStatus !== 'completed') return json({ ok: true, skipped: params.RecordingStatus });
      const projectId = url.searchParams.get('p') || null;
      let assignee = null;
      // Who it goes to is a convenience; a failed lookup must never lose the
      // voicemail itself — it lands unassigned instead.
      if (projectId) {
        try {
          const proj = await one(`pi_projects?id=eq.${encodeURIComponent(projectId)}&select=id,lead`);
          const team = await rest('pi_team_members?select=initials,active');
          assignee = pickAssignee(proj, team);
        } catch (e) { console.error('hotline: assignee lookup failed', e.message); }
      }
      // Twilio's two callbacks (this one and /transcription) can arrive in
      // either order, so each UPSERTS on call_sid and sends only its own
      // fields — neither can overwrite what the other wrote.
      const row = {
        ...baseRow(url, params, loaded, lang),
        recording_sid: params.RecordingSid || null,
        recording_seconds: params.RecordingDuration != null ? Number(params.RecordingDuration) : null,
        assigned_to: assignee,
        assigned_at: assignee ? now().toISOString() : null,
      };
      if (lang !== 'en') row.transcript_status = 'none';
      const saved = await upsertMessage(row);

      // Copy the audio into our own storage, then drop Twilio's copy (a
      // Spanish message now; an English one once its transcript is in).
      if (saved && params.RecordingSid) {
        try {
          // Built from the SID, never from RecordingUrl: our credentials go to
          // api.twilio.com and nowhere a request could name.
          const a = await fetchFn(`${API}/Recordings/${encodeURIComponent(params.RecordingSid)}.mp3`, { headers: { Authorization: twilioAuth() } });
          if (!a.ok) throw new Error('download ' + a.status);
          const bytes = new Uint8Array(await a.arrayBuffer());
          const path = `messages/${saved.id}.mp3`;
          const up = await fetchFn(`${SB}/storage/v1/object/${AUDIO_BUCKET}/${path}`, {
            method: 'POST', body: bytes, headers: sbH({ 'Content-Type': 'audio/mpeg', 'x-upsert': 'true' }) });
          if (!up.ok) throw new Error('upload ' + up.status);
          await rest(`pi_hotline_messages?id=eq.${saved.id}`, { method: 'PATCH',
            body: JSON.stringify({ recording_path: path }), headers: { 'Content-Type': 'application/json' } });
          saved.recording_path = path;
          if (lang !== 'en' || ['done', 'failed'].includes(saved.transcript_status)) await deleteTwilioRecording(params.RecordingSid);
        } catch (e) {
          // The row stays; the inbox says the audio could not be copied.
          console.error('hotline: audio copy failed', e.message);
        }
      }
      if (saved) { try { await notifyAssignee(saved); } catch (e) { console.error('hotline: notify failed', e.message); } }
      return json({ ok: true, id: saved && saved.id });
    }

    if (sub === '/transcription') {
      const done = params.TranscriptionStatus === 'completed';
      const row = { ...baseRow(url, params, loaded, lang), transcript_status: done ? 'done' : 'failed' };
      if (done) row.transcript = params.TranscriptionText || '';
      const saved = await upsertMessage(row);
      // Only drop Twilio's copy once ours exists.
      if (saved && saved.recording_path) await deleteTwilioRecording(params.RecordingSid || saved.recording_sid);
      return json({ ok: true, id: saved && saved.id });
    }
    return json({ error: 'not found' }, 404);
  }

  // The app asks for an email after reassigning. The caller must be signed-in staff.
  async function handleNotify(req) {
    const auth = req.headers.get('authorization') || '';
    const u = await fetchFn(SB + '/auth/v1/user', { headers: { apikey: KEY, Authorization: auth } });
    if (!u.ok) return json({ error: 'not signed in' }, 401);
    const user = await u.json();
    const staff = await one(`pi_staff?email=eq.${encodeURIComponent(String(user.email || '').toLowerCase())}&select=email`);
    if (!staff) return json({ error: 'not staff' }, 403);
    let body = {};
    try { body = await req.json(); } catch (_) {}
    const msg = await one(`pi_hotline_messages?id=eq.${encodeURIComponent(body.messageId)}&select=*`);
    if (!msg) return json({ error: 'no such message' }, 404);
    const sent = await notifyAssignee(msg);
    return json({ ok: true, sent });
  }

  return async function handler(req) {
    const url = new URL(req.url);
    const sub = (url.pathname.match(/\/hotline(\/[a-z]+)?\/?$/) || [])[1] || '/';
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' } });
    }
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    try {
      if (sub === '/notify') return await handleNotify(req);
      if (!TOKEN || !env.TWILIO_ACCOUNT_SID) return json({ error: 'hotline not configured' }, 503);
      const raw = await req.text();
      const form = new URLSearchParams(raw);
      const params = Object.fromEntries(form.entries());
      // Validate against the PUBLIC address Twilio called, not the internal one.
      const publicUrl = base + sub + url.search;
      const sig = req.headers.get('x-twilio-signature');
      let ok = await validSignature(TOKEN, publicUrl, params, sig);
      if (!ok && !sig) {
        const why = await confirmWithTwilio(sub, params);
        ok = !why;
        if (!ok) console.error('hotline: unsigned request not confirmed by Twilio', JSON.stringify({ sub, why }));
      }
      if (!ok) {
        // Nothing about the caller or the token is logged — only which check failed.
        if (sig) console.error('hotline: bad signature', JSON.stringify({ sub }));
        return json({ error: 'bad signature' }, 403);
      }
      return await handleTwilio(sub, new URL(publicUrl), params);
    } catch (e) {
      console.error('hotline:', e.message);
      // A caller never hears an error code: they are told to call back later.
      if (['/voice', '/menu'].includes(sub)) return xml(troubleTwiml());
      return json({ error: 'failed' }, 500);
    }
  };
}
