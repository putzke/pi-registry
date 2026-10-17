// Project hotline receiver — the logic, kept free of Deno so the test harness
// (Node) runs exactly this file. index.ts only wires it to Deno.serve.
//
// Twilio calls this function at each step of a call:
//   POST /hotline/voice        a call comes in       → greeting + menu (TwiML)
//   POST /hotline/menu         the caller pressed a key (or nothing)
//   POST /hotline/recorded     the recording ended   → "thank you", hang up
//   POST /hotline/recording    the recording is ready → save the voicemail
//   POST /hotline/transcription  live transcription (Deepgram Nova-3): each finished
//                              piece of the message, then a stopped event
// Every Twilio request must carry a valid X-Twilio-Signature, or — when it
// carries none at all — be confirmed call-by-call against Twilio's own API
// (confirmWithTwilio). Anything else is refused.
//   POST /hotline/whisper      ring-through: the PI Lead answered → "press 1 to accept"
//   POST /hotline/accept       they pressed 1 → connected, an "answered call" row is written
//   POST /hotline/afterdial    the ringing ended → hang up if answered, else voicemail
//   POST /hotline/bridge       call-back: the staff member's phone answered → "press 1"
//   POST /hotline/connect      they pressed 1 → dial the caller from the hotline number
// The app calls two routes, with the signed-in user's token:
//   POST /hotline/notify       {messageId} → email the person it is assigned to
//   POST /hotline/callback     {messageId, ringMe} → ring the staff phone (not recorded)
//   POST /hotline/dial         {hotlineId, to, ringMe, projectId?, stakeholderId?, placedBy?}
//                              → a fresh call from a hotline number (not recorded),
//                                written to pi_hotline_calls first, capped per person per day
//
// Nothing here creates an interaction. A voicemail lands as a PENDING row in
// pi_hotline_messages and only becomes an interaction when a person logs it
// in the Hotline inbox (the locked rule: interactions are entered deliberately).

export const VOICE = {
  en: { voice: 'Polly.Joanna-Neural', language: 'en-US' },
  es: { voice: 'Polly.Lupe-Neural',   language: 'es-US' },
};
// The callers are told they have two minutes.
export const MAX_RECORD_SECONDS = 120;
// Voicemail transcripts: Twilio's LIVE transcription with Deepgram Nova-3
// (Oct 2026; replaced <Record transcribe>, which was English only, capped at
// two minutes and rough on names). It starts as the caller begins the
// message, so the greeting and menu are not transcribed or billed. Only the
// caller's side is transcribed. Twilio's US price: $0.027/min (was $0.05).
export const TRANSCRIBE_ENGINE = 'deepgram';
export const TRANSCRIBE_MODEL = 'nova-3';
export const TRANSCRIBE_LANG = { en: 'en-US', es: 'es-US' };
export const SPANISH_DIGIT = '9';
export const GENERAL_DIGIT = '0';
export const AUDIO_BUCKET = 'hotline-audio';
// Fresh calls (the dialpad) per staff member in any 24 hours — a mistake or a
// stolen sign-in can't run up the bill. Call-backs to a voicemail don't count.
export const DIAL_DAILY_LIMIT = 30;
// A placed call's bridge works only this long after it was placed.
export const DIAL_BRIDGE_MINUTES = 10;
// How long the staff leg waits for "press 1" — each of the two prompts.
export const BRIDGE_KEY_WAIT_SEC = 15;

const T = {
  en: {
    greeting: name => `Thank you for calling the ${hotName(name)} hotline.`,
    option: (label, d) => `For ${label}, press ${d}.`,
    general: 'To leave a general message, press 0.',
    spanish: 'Para español, oprima 9.',
    notOption: 'Sorry, that is not one of the choices.',
    record: 'Please leave your name, your phone number and your message after the tone. You have two minutes. Press the pound key when you are finished.',
    thanks: 'Thank you. Your message has been received. Goodbye.',
    closed: 'This number is not in service. Goodbye.',
    noMessage: 'We did not receive a message. Goodbye.',
    trouble: 'Sorry, we are having trouble taking messages right now. Please call back later.',
    hold: 'Please hold while we connect you.',
    noAnswer: 'Sorry, nobody can take your call right now.',
    whisper: (name, es) => `Call for the ${name} hotline${es ? ', from a Spanish-speaking caller' : ''}. Press 1 to accept.`,
    callbackPrompt: (num, name) => `This is your call back from the ${name} hotline. Press 1 to call ${num}. Or hang up to cancel.`,
    dialPrompt: (num, name) => `This is your call from the ${name} hotline. Press 1 to call ${num}. Or hang up to cancel.`,
    callbackConnecting: 'Connecting. This call is not recorded.',
    callbackCancelled: 'No call was placed. Goodbye.',
    callbackNoKey: 'We didn\u2019t hear a 1, so no call was placed. Goodbye.',
    callbackRepeat: 'Sorry, I didn\u2019t hear that.',
    callbackEnded: 'The call has ended. Goodbye.',
    callbackGone: 'This call back is no longer available. Goodbye.',
  },
  es: {
    greeting: name => `Gracias por llamar a la línea de información del proyecto ${hotName(name)}.`,
    option: (label, d) => `Para ${label}, oprima ${d}.`,
    general: 'Para dejar un mensaje general, oprima 0.',
    spanish: '',
    notOption: 'Lo sentimos, esa no es una de las opciones.',
    record: 'Por favor, deje su nombre, su número de teléfono y su mensaje después del tono. Tiene dos minutos. Oprima la tecla de numeral cuando termine.',
    thanks: 'Gracias. Hemos recibido su mensaje. Adiós.',
    closed: 'Este número no está en servicio. Adiós.',
    noMessage: 'No recibimos un mensaje. Adiós.',
    trouble: 'Lo sentimos, tenemos problemas para recibir mensajes. Por favor, llame más tarde.',
    hold: 'Por favor, espere mientras lo comunicamos.',
    noAnswer: 'Lo sentimos, nadie puede atender su llamada en este momento.',
  },
};
export const PHRASES = T;

// "Test Hotline" must not be read as "the Test Hotline hotline".
export function hotName(name) {
  const n = String(name || '').trim();
  return n.replace(/\s+hotline$/i, '').trim() || n;
}

// A US/Canada number the call-back may ring or dial. Premium (900/976) and
// anything outside +1 is refused — the call-back must never become a way to
// run up charges.
// +1 area codes that are NOT the United States or Canada: the Caribbean
// nations and Bermuda share the US country code but bill like international
// calls (about $0.40–0.60 a minute) and are a classic toll-fraud target.
// Refused here as well as in Twilio's geo permissions, so a wrongly ticked
// box on a Twilio account can't open them. Mirrored in index.html
// (HOT_NOT_US_AREA, asserted equal by test 83).
export const NOT_US_AREA_CODES = '242 246 264 268 284 345 441 473 649 658 664 721 758 767 784 809 829 849 868 869 876'.split(' ');
export function callableNumber(p) {
  const n = normPhone(p);
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(n) && !/^\+1(900|976)/.test(n)
    && !NOT_US_AREA_CODES.includes(n.slice(2, 5)) ? n : '';
}
// Digits read one by one: "8 0 1, 6 5 2, 4 0 0 8".
export function spokenNumber(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? [d.slice(0, 3), d.slice(3, 6), d.slice(6)].map(x => x.split('').join(' ')).join(', ') : d.split('').join(' ');
}

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

// The menu in two parts. The Spanish offer comes FIRST, right after the
// greeting, and is spoken by the Spanish voice, so a Spanish speaker doesn't
// sit through the English project list to find it (Jeff, 2026-10-17).
export function menuParts(hotline, exts, lang) {
  const t = T[lang];
  const spanish = lang === 'en' && hotline.spanish_enabled ? T.en.spanish : '';
  const lines = [];
  if (exts.length) {
    exts.forEach(e => lines.push(t.option((lang === 'es' && e.label_es) || e.label || ('project ' + e.digit), e.digit)));
    lines.push(t.general);
  }
  return { spanish, options: lines.join(' ') };
}
export function menuText(hotline, exts, lang) {
  const m = menuParts(hotline, exts, lang);
  return [m.spanish, m.options].filter(Boolean).join(' ');
}

// The greeting + menu. A single-project number with Spanish off has no menu at
// all and goes straight to the recording.
export function voiceTwiml({ hotline, exts, lang, base, greetingUrl, retry = 0 }) {
  const q = `h=${hotline.id}&l=${lang}`;
  const parts = menuParts(hotline, exts, lang);
  const menu = say(parts.spanish, 'es') + say(parts.options, lang);
  const greet = retry ? '' : greetingParts(hotline, lang, greetingUrl);
  if (!menu) return twiml(greet + recordParts({ hotline, lang, base, projectId: hotline.project_id, digit: '' }));
  const timeout = exts.length ? 6 : 3;
  return twiml(
    `<Gather numDigits="1" timeout="${timeout}" action="${xmlEsc(base + '/menu?' + q + '&r=' + retry)}" method="POST">`
    + greet + menu + '</Gather>'
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
  // Live transcription starts here, after the prompt, so only the message
  // itself is transcribed (and billed). English and Spanish alike.
  return say(T[lang].record, lang)
    + `<Start><Transcription name="voicemail" track="inbound_track"`
    + ` transcriptionEngine="${TRANSCRIBE_ENGINE}" speechModel="${TRANSCRIBE_MODEL}" languageCode="${TRANSCRIBE_LANG[lang] || TRANSCRIBE_LANG.en}"`
    + ` partialResults="false" statusCallbackUrl="${xmlEsc(base + '/transcription?' + q)}" statusCallbackMethod="POST"/></Start>`
    + `<Record maxLength="${MAX_RECORD_SECONDS}" timeout="6" finishOnKey="#" playBeep="true"`
    + ` action="${xmlEsc(base + '/recorded?' + q)}" method="POST"`
    + ` recordingStatusCallback="${xmlEsc(base + '/recording?' + q)}" recordingStatusCallbackMethod="POST"`
    + ` recordingStatusCallbackEvent="completed"/>`
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

// ── Ring-through: ring the PI Lead before voicemail ─────────────────────────
// Settings come in three layers, each field taken from the first that sets it:
// the menu option (a project on a menu hotline), the hotline, then the
// all-hotlines defaults (pi_hotline_settings), then these built-in values.
export const RING_DEFAULTS = { enabled: true, seconds: 12, start: '07:00', end: '18:00', days: '1,2,3,4,5', tz: 'America/Denver' };
export const RING_SECONDS_MIN = 5, RING_SECONDS_MAX = 60;
const set = v => v !== null && v !== undefined && v !== '';
export function ringSettings(global, hotline, ext) {
  const layers = [ext || {}, hotline || {}, global || {}];
  const pick = (k, fb) => { for (const l of layers) if (set(l[k])) return l[k]; return fb; };
  const mode = pick('ring_mode', null);
  const enabled = mode === 'on' ? true : mode === 'off' ? false
    : (global && typeof global.ring_enabled === 'boolean' ? global.ring_enabled : RING_DEFAULTS.enabled);
  const secs = Math.round(Number(pick('ring_seconds', RING_DEFAULTS.seconds)));
  return {
    enabled,
    seconds: Math.min(RING_SECONDS_MAX, Math.max(RING_SECONDS_MIN, isFinite(secs) ? secs : RING_DEFAULTS.seconds)),
    start: pick('hours_start', RING_DEFAULTS.start), end: pick('hours_end', RING_DEFAULTS.end),
    days: pick('hours_days', RING_DEFAULTS.days),
    tz: (global && global.timezone) || RING_DEFAULTS.tz,
  };
}
// Is `date` inside business hours, in the settings' time zone? Days are
// 0 = Sunday … 6 = Saturday; times "HH:MM", end not included.
export function inHours(st, date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: st.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(p => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  if (!String(st.days || '').split(',').map(s => s.trim()).includes(String(day))) return false;
  const now = `${String(parts.hour).padStart(2, '0')}:${parts.minute}`;
  return now >= String(st.start) && now < String(st.end);
}
export function ringTwiml({ hotline, lang, base, projectId, digit, seconds, phone, lead, greet = '' }) {
  const q = `h=${hotline.id}&l=${lang}&d=${encodeURIComponent(digit || '')}&p=${encodeURIComponent(projectId || '')}&a=${encodeURIComponent(lead || '')}`;
  return twiml(greet + say(T[lang].hold, lang)
    + `<Dial timeout="${Number(seconds)}" action="${xmlEsc(base + '/afterdial?' + q)}" method="POST">`
    + `<Number url="${xmlEsc(base + '/whisper?' + q)}" method="POST">${xmlEsc(phone)}</Number></Dial>`);
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

  // Who to ring for this call right now, or null (straight to voicemail).
  // Only the project's own PI Lead, active on the team list, with a US phone,
  // inside business hours, and only if ringing is on for this hotline/option.
  async function ringTarget(loaded, projectId, digit) {
    try {
      if (!loaded || !projectId) return null;
      let g = null;
      try { g = await one('pi_hotline_settings?id=eq.1&select=*'); } catch (_) { /* table not there yet: defaults */ }
      const ext = digit ? loaded.exts.find(e => e.digit === digit) : null;
      const st = ringSettings(g, loaded.h, ext);
      if (!st.enabled || !inHours(st, now())) return null;
      const proj = await one(`pi_projects?id=eq.${encodeURIComponent(projectId)}&select=id,lead`);
      const lead = String((proj && proj.lead) || '').trim().toUpperCase();
      if (!lead) return null;
      const team = await rest('pi_team_members?select=initials,phone,email,active') || [];
      const m = team.find(x => String(x.initials || '').trim().toUpperCase() === lead && x.active !== false);
      const phone = m && callableNumber(m.phone);
      if (!phone || phone === normPhone(loaded.h.phone_number)) return null;
      return { phone, lead, email: String(m.email || '').toLowerCase(), seconds: st.seconds };
    } catch (e) {
      console.error('hotline: ring lookup failed', e.message);
      return null;   // never lose the call: voicemail instead
    }
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
    // A call-back leg is a call WE placed from a hotline number; everything
    // else is a call that came IN to one.
    // A ring-through leg is the PI Lead's phone, dialled from a live inbound
    // call to one of our hotlines.
    if (['/whisper', '/accept'].includes(sub)) {
      if (c.direction !== 'outbound-dial' || !/^CA[0-9a-f]{32}$/i.test(c.parent_call_sid || '')) return 'direction';
      if (!['queued', 'ringing', 'in-progress'].includes(c.status)) return 'call over';
      const pc = await twilioGet(`Calls/${c.parent_call_sid}.json`);
      if (!pc || pc.account_sid !== SID || pc.direction !== 'inbound') return 'parent';
      if (!['queued', 'ringing', 'in-progress'].includes(pc.status)) return 'call over';
      if (!(await one(`pi_hotlines?phone_number=eq.${encodeURIComponent(normPhone(pc.to))}&select=id`))) return 'not a hotline';
      return '';
    }
    const outbound = ['/bridge', '/connect'].includes(sub);
    if (c.direction !== (outbound ? 'outbound-api' : 'inbound')) return 'direction';
    const ours = outbound ? c.from : c.to;
    if (!outbound && params.To && normPhone(params.To) !== normPhone(c.to)) return 'to';
    if (!(await one(`pi_hotlines?phone_number=eq.${encodeURIComponent(normPhone(ours))}&select=id`))) return 'not a hotline';
    if (['/voice', '/menu', '/recorded', '/afterdial', '/bridge', '/connect'].includes(sub)) {
      if (!['queued', 'ringing', 'in-progress'].includes(c.status)) return 'call over';
    } else {
      const age = now().getTime() - new Date(c.date_created || c.start_time).getTime();
      if (!(age >= 0 && age < 86400000)) return 'too old';
      // A live-transcription event names no recording; the call is enough —
      // it can only add text to that call's own voicemail.
      if (sub === '/transcription' && params.TranscriptionEvent) return '';
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

  // Fields both recording callbacks know. The caller's number is sent only
  // when known, so an upsert without it can never blank one already saved.
  const baseRow = (url, params, loaded, lang) => ({
    hotline_id: loaded ? loaded.h.id : (Number(url.searchParams.get('h')) || null),
    extension_digit: url.searchParams.get('d') || null,
    project_id: url.searchParams.get('p') || null,
    language: lang,
    ...(params.From ? { caller_number: params.From } : {}),
    call_sid: params.CallSid,
    updated_at: now().toISOString(),
  });
  // Neither the recording callback nor live transcription carries the
  // caller's number (only the old <Record transcribe> callback did), so it is
  // read from Twilio's own record of the call. A failed lookup leaves the
  // number blank; the voicemail itself is never lost over it.
  async function callerOf(params) {
    if (params.From) return params.From;
    try {
      const c = await twilioGet(`Calls/${encodeURIComponent(params.CallSid || '')}.json`);
      return (c && c.from) || null;
    } catch (e) { console.error('hotline: caller lookup failed', e.message); return null; }
  }
  async function upsertMessage(row) {
    if (!row.call_sid) throw new Error('no CallSid');
    return ((await rest('pi_hotline_messages?on_conflict=call_sid', {
      method: 'POST', body: JSON.stringify(row),
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates' },
    })) || [])[0] || null;
  }

  async function handleTwilio(sub, url, params) {
    const lang = url.searchParams.get('l') === 'es' ? 'es' : 'en';
    // ── Call-back (staff phone first, then the caller) ───────────────────
    // Nothing here is recorded. The message id carries the caller's number;
    // it is looked up again here, never taken from the request.
    // A fresh call (?c=) reads the number from its pi_hotline_calls row, a
    // call-back (?m=) from the voicemail.
    if (sub === '/bridge' || sub === '/connect') {
      const cid = url.searchParams.get('c');
      let src = null, q = '', fresh = false;
      if (cid) {
        const call = await one(`pi_hotline_calls?id=eq.${encodeURIComponent(cid)}&select=id,to_number,hotline_id,created_at`);
        const age = call ? now().getTime() - new Date(call.created_at).getTime() : -1;
        if (call && age >= 0 && age < DIAL_BRIDGE_MINUTES * 60000) { src = { hotline_id: call.hotline_id, number: call.to_number }; q = `c=${call.id}`; fresh = true; }
      } else {
        const msg = await one(`pi_hotline_messages?id=eq.${encodeURIComponent(url.searchParams.get('m'))}&select=id,caller_number,hotline_id`);
        if (msg) { src = { hotline_id: msg.hotline_id, number: msg.caller_number }; q = `m=${msg.id}`; }
      }
      const h = src && src.hotline_id ? await one(`pi_hotlines?id=eq.${src.hotline_id}&select=id,name,phone_number,active`) : null;
      const to = src && callableNumber(src.number);
      if (!h || h.active === false || !to) return xml(twiml(say(T.en.callbackGone, 'en') + '<Hangup/>'));
      const mark = async status => { if (fresh) { try { await rest(`pi_hotline_calls?id=eq.${encodeURIComponent(cid)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status }) }); } catch (_) {} } };
      if (sub === '/bridge') {
        await mark('answered');
        // Forgiving on purpose (Oct 2026): a 1 pressed late, or lost on a
        // Bluetooth/car phone, used to end the call after 8 s. Now the prompt
        // waits BRIDGE_KEY_WAIT_SEC, is said once more, and the goodbye says why.
        const prompt = (fresh ? T.en.dialPrompt : T.en.callbackPrompt)(spokenNumber(to), hotName(h.name));
        const gather = text => `<Gather numDigits="1" timeout="${BRIDGE_KEY_WAIT_SEC}" action="${xmlEsc(base + '/connect?' + q)}" method="POST">`
          + say(text, 'en') + '</Gather>';
        return xml(twiml(gather(prompt) + gather(T.en.callbackRepeat + ' ' + prompt)
          + say(T.en.callbackNoKey, 'en') + '<Hangup/>'));
      }
      if (String(params.Digits || '') !== '1') { await mark('cancelled'); return xml(twiml(say(T.en.callbackCancelled, 'en') + '<Hangup/>')); }
      await mark('connected');
      return xml(twiml(say(T.en.callbackConnecting, 'en')
        + `<Dial callerId="${xmlEsc(h.phone_number)}" timeout="30"><Number>${xmlEsc(to)}</Number></Dial>`
        + say(T.en.callbackEnded, 'en') + '<Hangup/>'));
    }
    if (sub === '/voice') {
      const h = await one(`pi_hotlines?phone_number=eq.${encodeURIComponent(normPhone(params.To))}&active=eq.true&select=*`);
      if (!h) return xml(closedTwiml());
      const loaded = await loadHotline(h.id);
      const gu = await greetingUrl(loaded.h, 'en');
      // A one-project number with no menu goes straight to the lead (or voicemail).
      if (!menuText(loaded.h, loaded.exts, 'en')) {
        const t = await ringTarget(loaded, loaded.h.project_id, '');
        if (t) return xml(ringTwiml({ hotline: loaded.h, lang: 'en', base, projectId: loaded.h.project_id, digit: '', seconds: t.seconds, phone: t.phone, lead: t.lead, greet: greetingParts(loaded.h, 'en', gu) }));
      }
      return xml(voiceTwiml({ hotline: loaded.h, exts: loaded.exts, lang: 'en', base, greetingUrl: gu }));
    }
    const loaded = await loadHotline(url.searchParams.get('h'));
    if (sub === '/menu') {
      if (!loaded) return xml(closedTwiml());
      const digits = url.searchParams.get('none') ? '' : params.Digits;
      const r = route({ hotline: loaded.h, exts: loaded.exts, lang, digits, retry: url.searchParams.get('r') });
      if (r.kind === 'record') {
        const t = await ringTarget(loaded, r.projectId, r.digit);
        if (t) return xml(ringTwiml({ hotline: loaded.h, lang, base, projectId: r.projectId, digit: r.digit, seconds: t.seconds, phone: t.phone, lead: t.lead }));
      }
      const gu = r.kind === 'spanish' ? await greetingUrl(loaded.h, 'es') : '';
      // Spanish on a one-project number: no Spanish menu, so ring (or record) now.
      if (r.kind === 'spanish' && !menuText(loaded.h, loaded.exts, 'es')) {
        const t = await ringTarget(loaded, loaded.h.project_id, '');
        if (t) return xml(ringTwiml({ hotline: loaded.h, lang: 'es', base, projectId: loaded.h.project_id, digit: '', seconds: t.seconds, phone: t.phone, lead: t.lead, greet: greetingParts(loaded.h, 'es', gu) }));
      }
      return xml(menuTwiml({ hotline: loaded.h, exts: loaded.exts, lang, base, digits, retry: url.searchParams.get('r'), greetingUrl: gu }));
    }
    if (sub === '/recorded') return xml(recordedTwiml(lang));

    // ── Ring-through ─────────────────────────────────────────────────────
    // The lead's leg: they must press 1, so a phone's own voicemail can never
    // swallow the caller — it doesn't press 1, the ringing ends, and the
    // caller gets the project's voicemail.
    if (sub === '/whisper') {
      if (!loaded) return xml(twiml('<Hangup/>'));
      const q = url.search.slice(1);
      return xml(twiml(`<Gather numDigits="1" timeout="6" action="${xmlEsc(base + '/accept?' + q)}" method="POST">`
        + say(T.en.whisper(hotName(loaded.h.name), lang === 'es'), 'en') + '</Gather><Hangup/>'));
    }
    if (sub === '/accept') {
      if (!loaded || String(params.Digits || '') !== '1') return xml(twiml('<Hangup/>'));
      const lead = String(url.searchParams.get('a') || '').toUpperCase().slice(0, 6) || null;
      let email = '';
      try {
        const m = lead ? await one(`pi_team_members?initials=ilike.${encodeURIComponent(lead)}&select=email`) : null;
        email = String((m && m.email) || '').toLowerCase();
      } catch (_) {}
      // Only the facts of the call: no recording, so nothing to announce.
      try {
        await rest('pi_hotline_calls', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ direction: 'inbound', hotline_id: loaded.h.id, project_id: url.searchParams.get('p') || null,
            to_number: normPhone(params.From) || 'unknown', ring_number: normPhone(params.To) || null,
            placed_by: lead, placed_by_email: email, call_sid: params.ParentCallSid || null, status: 'connected' }) });
      } catch (e) { console.error('hotline: answered call not recorded', e.message); }
      return xml(twiml(''));   // an empty response connects the two
    }
    if (sub === '/afterdial') {
      const answered = params.CallSid
        ? await one(`pi_hotline_calls?call_sid=eq.${encodeURIComponent(params.CallSid)}&direction=eq.inbound&select=id`) : null;
      if (answered) {
        try {
          await rest(`pi_hotline_calls?id=eq.${answered.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ status: 'completed', duration_seconds: Number(params.DialCallDuration) || null }) });
        } catch (_) {}
        return xml(twiml('<Hangup/>'));
      }
      if (!loaded) return xml(closedTwiml());
      return xml(twiml(say(T[lang].noAnswer, lang)
        + recordParts({ hotline: loaded.h, lang, base, projectId: url.searchParams.get('p') || null, digit: url.searchParams.get('d') || '' })));
    }

    if (sub === '/recording') {
      if (params.RecordingStatus && params.RecordingStatus !== 'completed') return json({ ok: true, skipped: params.RecordingStatus });
      const projectId = url.searchParams.get('p') || null;
      let assignee = null;
      // Who it goes to is a convenience; a failed lookup must never lose the
      // voicemail itself — it lands unassigned instead.
      // The project's PI Lead; failing that (no lead, an inactive one, or the
      // general mailbox) the hotline's own fallback person.
      try {
        const team = await rest('pi_team_members?select=initials,active');
        const proj = projectId ? await one(`pi_projects?id=eq.${encodeURIComponent(projectId)}&select=id,lead`) : null;
        assignee = pickAssignee(proj, team)
          || pickAssignee({ lead: loaded && loaded.h.default_assignee }, team);
      } catch (e) { console.error('hotline: assignee lookup failed', e.message); }
      // Twilio's two callbacks (this one and /transcription) can arrive in
      // either order, so each UPSERTS on call_sid and sends only its own
      // fields — neither can overwrite what the other wrote.
      const caller = await callerOf(params);
      const row = {
        ...baseRow(url, params, loaded, lang),
        ...(caller ? { caller_number: caller } : {}),
        recording_sid: params.RecordingSid || null,
        recording_seconds: params.RecordingDuration != null ? Number(params.RecordingDuration) : null,
        assigned_to: assignee,
        assigned_at: assignee ? now().toISOString() : null,
      };
      const saved = await upsertMessage(row);

      // Copy the audio into our own storage, then drop Twilio's copy (the
      // transcript comes from live transcription, not from the recording).
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
          await deleteTwilioRecording(params.RecordingSid);
        } catch (e) {
          // The row stays; the inbox says the audio could not be copied.
          console.error('hotline: audio copy failed', e.message);
        }
      }
      if (saved) { try { await notifyAssignee(saved); } catch (e) { console.error('hotline: notify failed', e.message); } }
      return json({ ok: true, id: saved && saved.id });
    }

    if (sub === '/transcription' && params.TranscriptionEvent) {
      const ev = params.TranscriptionEvent;
      if (ev === 'transcription-content') {
        if (String(params.Final).toLowerCase() === 'false') return json({ ok: true, skipped: 'partial' });
        let text = '';
        try { text = String(JSON.parse(params.TranscriptionData || '{}').transcript || '').trim(); } catch (_) {}
        if (!text) return json({ ok: true, skipped: 'empty' });
        // One piece at a time, added in the database under the row lock, so
        // pieces arriving together never overwrite each other.
        await rest('rpc/pi_hotline_transcript_part', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_call_sid: params.CallSid, p_seq: Number(params.SequenceId) || 0, p_text: text,
            p_row: baseRow(url, params, loaded, lang) }) });
        return json({ ok: true });
      }
      if (ev === 'transcription-stopped' || ev === 'transcription-error') {
        if (ev === 'transcription-error') console.error('hotline: transcription error', params.TranscriptionError || params.ErrorMessage || '');
        // Never creates a row: a caller who hung up before leaving a message
        // has no voicemail. If the recording callback has not landed yet the
        // row stays "pending" and the inbox stops waiting after a while.
        const cur = await one(`pi_hotline_messages?call_sid=eq.${encodeURIComponent(params.CallSid || '')}&select=id,transcript`);
        if (cur) {
          const status = String(cur.transcript || '').trim() ? 'done' : ev === 'transcription-error' ? 'failed' : 'none';
          await rest(`pi_hotline_messages?id=eq.${cur.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript_status: status, updated_at: now().toISOString() }) });
        }
        return json({ ok: true });
      }
      return json({ ok: true, skipped: ev });
    }
    // The older <Record transcribe> callback (messages recorded before Oct 2026).
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

  // The signed-in staff member's email, or the refusal to send back.
  async function staffEmail(req) {
    const auth = req.headers.get('authorization') || '';
    const u = await fetchFn(SB + '/auth/v1/user', { headers: { apikey: KEY, Authorization: auth } });
    if (!u.ok) return { res: json({ error: 'not signed in' }, 401) };
    const user = await u.json();
    const email = String(user.email || '').toLowerCase();
    const staff = email && await one(`pi_staff?email=eq.${encodeURIComponent(email)}&select=email`);
    if (!staff) return { res: json({ error: 'not staff' }, 403) };
    return { email };
  }
  // Twilio's reason for refusing a call, in words staff can act on. Twilio's
  // own code and message are not secret; they go to the log and the app.
  const TWILIO_CALL_ERRORS = {
    21219: 'This Twilio account is still a trial and can only ring verified numbers. Verify the number in Twilio (Phone Numbers → Verified Caller IDs) or upgrade the account.',
    21215: 'Twilio’s calling permissions block this number. Turn on the United States in Twilio (Voice → Settings → Geo permissions).',
    21210: 'Twilio won’t call from the hotline number — it isn’t a voice number on this account.',
    21212: 'Twilio says the hotline number is not a valid caller ID.',
    21211: 'Twilio says the number to ring is not valid.',
    21217: 'Twilio says the number to ring is not valid.',
    21214: 'Twilio can’t reach the number to ring.',
    20003: 'Twilio rejected the hotline’s credentials (check the function secrets).',
  };
  async function twilioRefusal(r) {
    let code = null, message = '';
    try { const b = await r.json(); code = b.code || null; message = String(b.message || '').slice(0, 300); } catch (_) {}
    const plain = TWILIO_CALL_ERRORS[code] || 'Twilio refused the call.';
    return { code, message, text: plain + ' (Twilio ' + (code || r.status) + (message ? ': ' + message : '') + ')' };
  }

  async function placeCall(ring, from, bridgeQuery) {
    const form = new URLSearchParams({ To: ring, From: from, Url: `${base}/bridge?${bridgeQuery}`, Method: 'POST', Timeout: '25' });
    return fetchFn(`${API}/Calls.json`, { method: 'POST', body: form.toString(),
      headers: { Authorization: twilioAuth(), 'Content-Type': 'application/x-www-form-urlencoded' } });
  }

  // The dialpad: a fresh call from a hotline number to any US number. The
  // number is stored in pi_hotline_calls BEFORE Twilio is asked, and /bridge
  // reads it from there — never from the address Twilio calls back on.
  async function handleDial(req) {
    const who = await staffEmail(req);
    if (who.res) return who.res;
    if (!TOKEN || !SID) return json({ error: 'hotline not configured' }, 503);
    let body = {};
    try { body = await req.json(); } catch (_) {}
    const ring = callableNumber(body.ringMe);
    if (!ring) return json({ error: 'Enter your own 10-digit US phone number to ring.' }, 400);
    const to = callableNumber(body.to);
    if (!to) return json({ error: 'Enter a 10-digit US number to call (not 900 or 976, and not a Caribbean or Bermuda area code).' }, 400);
    const h = await one(`pi_hotlines?id=eq.${encodeURIComponent(body.hotlineId)}&select=id,phone_number,project_id,active`);
    if (!h || h.active === false) return json({ error: 'That hotline is switched off.' }, 400);
    if (ring === to) return json({ error: 'The number to call and your own phone must be different.' }, 400);
    if (to === normPhone(h.phone_number) || ring === normPhone(h.phone_number)) return json({ error: 'Neither number can be the hotline itself.' }, 400);
    // The project must be the hotline's own, or one of its menu's.
    let project = h.project_id ? String(h.project_id) : null;
    if (!project && body.projectId) {
      const exts = activeExtensions(await rest(`pi_hotline_extensions?hotline_id=eq.${h.id}&select=*`), h.id);
      if (exts.some(e => String(e.project_id) === String(body.projectId))) project = String(body.projectId);
    }
    const since = new Date(now().getTime() - 86400000).toISOString();
    const recent = await rest(`pi_hotline_calls?placed_by_email=eq.${encodeURIComponent(who.email)}&direction=eq.outbound&created_at=gte.${encodeURIComponent(since)}&select=id`) || [];
    if (recent.length >= DIAL_DAILY_LIMIT) return json({ error: `You have placed ${DIAL_DAILY_LIMIT} hotline calls in the last 24 hours — the daily limit. It resets as the day goes on.` }, 429);
    const rows = await rest('pi_hotline_calls', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ hotline_id: h.id, project_id: project, stakeholder_id: body.stakeholderId ? String(body.stakeholderId) : null,
        to_number: to, ring_number: ring, placed_by: String(body.placedBy || '').toUpperCase().slice(0, 6) || null,
        placed_by_email: who.email, status: 'placing' }) });
    const call = rows && rows[0];
    if (!call) return json({ error: 'The call could not be recorded, so it was not placed.' }, 500);
    const patch = obj => rest(`pi_hotline_calls?id=eq.${call.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(obj) }).catch(() => {});
    const r = await placeCall(ring, h.phone_number, `c=${call.id}`);
    if (!r.ok) {
      const why = await twilioRefusal(r);
      console.error('hotline: dial failed', r.status, why.code, why.message);
      await patch({ status: 'failed' });
      return json({ error: why.text, twilioCode: why.code }, 502);
    }
    const c = await r.json();
    await patch({ status: 'ringing', call_sid: c.sid || null });
    return json({ ok: true, callId: call.id });
  }

  // Staff press "Call back": Twilio rings THEIR phone from the hotline number,
  // and /bridge asks them to press 1 before anyone else is dialled.
  async function handleCallback(req) {
    const who = await staffEmail(req);
    if (who.res) return who.res;
    if (!TOKEN || !SID) return json({ error: 'hotline not configured' }, 503);
    let body = {};
    try { body = await req.json(); } catch (_) {}
    const ring = callableNumber(body.ringMe);
    if (!ring) return json({ error: 'Enter your own 10-digit US phone number to ring.' }, 400);
    const msg = await one(`pi_hotline_messages?id=eq.${encodeURIComponent(body.messageId)}&select=id,caller_number,hotline_id`);
    if (!msg) return json({ error: 'no such message' }, 404);
    const to = callableNumber(msg.caller_number);
    if (!to) return json({ error: 'This caller’s number can’t be called back from the hotline.' }, 400);
    const h = msg.hotline_id ? await one(`pi_hotlines?id=eq.${msg.hotline_id}&select=id,phone_number,active`) : null;
    if (!h || h.active === false) return json({ error: 'That hotline is switched off.' }, 400);
    if (ring === to || ring === normPhone(h.phone_number)) return json({ error: 'Enter your own phone number, not the caller’s or the hotline’s.' }, 400);
    const r = await placeCall(ring, h.phone_number, `m=${msg.id}`);
    if (!r.ok) {
      const why = await twilioRefusal(r);
      console.error('hotline: call-back failed', r.status, why.code, why.message);
      return json({ error: why.text, twilioCode: why.code }, 502);
    }
    const c = await r.json();
    return json({ ok: true, sid: c.sid || null });
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
      if (sub === '/callback') return await handleCallback(req);
      if (sub === '/dial') return await handleDial(req);
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
      if (['/voice', '/menu', '/afterdial'].includes(sub)) return xml(troubleTwiml());
      return json({ error: 'failed' }, 500);
    }
  };
}
