// Link reader for the planned Outreach log (Part B, step 2a: the LINK TEST).
// Given one public URL, reads what a link preview can: title, outlet, date,
// image, and any reaction / comment / share counts the page states publicly
// (meta description, JSON-LD interactionStatistic). Nothing is stored; the
// result goes straight back to the signed-in staff member who asked.
//
// Deliberately NOT done: logging in anywhere, scraping comments, following
// links inside the page, pretending to be another company's crawler. The
// request identifies itself honestly (LINK_UA). Where a platform refuses an
// unknown reader, the result says so — that refusal is what the test is for.
//
// Public, keyless oEmbed endpoints are used where a platform offers one
// (X/Twitter, YouTube). Facebook and Instagram oEmbed need a Meta app token,
// so they are not called.

export const LINK_UA = 'CirrusCcLinkReader/1.0 (+https://www.cirruscc.com; link preview for staff)';
export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 10000;
export const MAX_REDIRECTS = 5;

const CORS = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

// Only ordinary public web addresses: http(s), default ports, a real host name.
// IP literals, localhost and internal names are refused at every redirect hop.
export function urlProblem(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return 'not a web address'; }
  if (!/^https?:$/.test(u.protocol)) return 'only http and https links can be read';
  if (u.username || u.password) return 'links with a user name or password are not read';
  if (u.port && !['80', '443'].includes(u.port)) return 'unusual port';
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.')) return 'not a public host name';
  if (/^\[|^\d+\.\d+\.\d+\.\d+$|^0x|^\d+$/.test(h)) return 'IP addresses are not read';
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(h)) return 'not a public host name';
  if (/(^|\.)supabase\.(co|in)$/.test(h)) return 'not read';
  return null;
}

export function platformOf(url) {
  const h = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\.|^mobile\./, '');
  if (/(^|\.)facebook\.com$|^fb\.watch$/.test(h)) return 'Facebook';
  if (/(^|\.)instagram\.com$/.test(h)) return 'Instagram';
  if (/(^|\.)(x|twitter)\.com$/.test(h)) return 'X';
  if (/(^|\.)linkedin\.com$/.test(h)) return 'LinkedIn';
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(h)) return 'YouTube';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'TikTok';
  if (/(^|\.)nextdoor\.com$/.test(h)) return 'Nextdoor';
  return 'Web';
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  }).replace(/\s+/g, ' ').trim();
}

// <meta property|name="key" content="..."> in either attribute order.
export function metaTags(html) {
  const out = {};
  const re = /<meta\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const k = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const v = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (k && v != null && !(k.toLowerCase() in out)) out[k.toLowerCase()] = decodeEntities(v);
  }
  return out;
}

function jsonLdBlocks(html) {
  const out = []; const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) { try { out.push(JSON.parse(m[1].trim())); } catch { /* a broken block is skipped */ } }
  return out;
}
function walk(o, fn) {
  if (Array.isArray(o)) o.forEach((x) => walk(x, fn));
  else if (o && typeof o === 'object') { fn(o); Object.values(o).forEach((x) => walk(x, fn)); }
}

// "1.2K" → 1200. Returns null for anything that is not a count.
export function parseCount(s) {
  const m = String(s || '').replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([KkMm])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1);
  return Math.round(n);
}

const KINDS = [
  ['reactions', /^(likes?|reactions?|hearts?)$/i],
  ['comments', /^(comments?|replies)$/i],
  ['shares', /^(shares?|retweets?|reposts?)$/i],
  ['views', /^(views?|plays?)$/i],
];
function kindOf(word) { for (const [k, re] of KINDS) if (re.test(word)) return k; return null; }

// Counts stated in text, e.g. Instagram's "1,234 likes, 56 comments - …" or
// Facebook's "12 reactions · 3 comments". Only numbers followed by a count word.
export function countsInText(text) {
  const out = {}; const re = /(\d[\d,.]*\s*[KkMm]?)\s+(likes?|reactions?|hearts?|comments?|replies|shares?|retweets?|reposts?|views?|plays?)\b/gi; let m;
  while ((m = re.exec(String(text || '')))) {
    const k = kindOf(m[2]); const n = parseCount(m[1].trim());
    if (k && n != null && out[k] == null) out[k] = n;
  }
  return out;
}

// schema.org InteractionCounter: {interactionType: "LikeAction", userInteractionCount: 12}
export function countsInJsonLd(blocks) {
  const out = {};
  walk(blocks, (o) => {
    const stats = o.interactionStatistic ? [].concat(o.interactionStatistic) : [];
    stats.forEach((st) => {
      const t = String((st && (st.interactionType && (st.interactionType['@type'] || st.interactionType))) || '');
      const n = st && parseCount(st.userInteractionCount);
      if (n == null) return;
      // Share and Comment first: "ShareAction" contains "reAction".
      const k = /Comment/i.test(t) ? 'comments' : /Share/i.test(t) ? 'shares' : /Watch|View/i.test(t) ? 'views' : /Like|Agree|React/i.test(t) ? 'reactions' : null;
      if (k && out[k] == null) out[k] = n;
    });
    if (o.commentCount != null && out.comments == null) { const n = parseCount(o.commentCount); if (n != null) out.comments = n; }
  });
  return out;
}

function firstLd(blocks, keys) {
  let v = null;
  walk(blocks, (o) => { for (const k of keys) if (v == null && o[k] != null && typeof o[k] !== 'object') v = String(o[k]); });
  return v;
}
function ldAuthor(blocks) {
  let v = null;
  walk(blocks, (o) => { if (v == null && o.author) { const a = [].concat(o.author)[0]; v = typeof a === 'string' ? a : a && a.name ? String(a.name) : null; } });
  return v;
}

// Everything a link preview can say about one page.
export function readPage(html, url) {
  const meta = metaTags(html);
  const ld = jsonLdBlocks(html);
  const titleTag = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const fields = {
    title: meta['og:title'] || meta['twitter:title'] || firstLd(ld, ['headline', 'name']) || titleTag || null,
    description: meta['og:description'] || meta['description'] || meta['twitter:description'] || null,
    site: meta['og:site_name'] || firstLd(ld, ['publisher']) || null,
    published: meta['article:published_time'] || meta['og:published_time'] || meta['datepublished'] || meta['date'] || firstLd(ld, ['datePublished', 'uploadDate', 'dateCreated']) || null,
    author: meta['author'] || meta['article:author'] || ldAuthor(ld) || null,
    image: meta['og:image'] || meta['twitter:image'] || null,
    type: meta['og:type'] || null,
  };
  if (fields.site && /^\[object/.test(fields.site)) fields.site = null;
  const fromLd = countsInJsonLd(ld);
  const fromText = countsInText([fields.description, meta['twitter:description'], titleTag].filter(Boolean).join(' · '));
  const engagement = { ...fromText, ...fromLd };
  const source = Object.keys(fromLd).length ? 'structured data' : Object.keys(fromText).length ? 'page description' : null;
  const notes = [];
  const loginWall = /log ?in|sign ?in|log into/i.test(titleTag) && !meta['og:title'];
  if (loginWall) { notes.push('The site answered with a sign-in page, not the post.'); fields.title = null; }
  if (!fields.title) notes.push('No title found.');
  return { fields, engagement, engagementSource: source, notes, loginWall, ldBlocks: ld.length, metaCount: Object.keys(meta).length, url };
}

async function readBody(res) {
  if (!res.body || !res.body.getReader) { const t = await res.text(); return t.slice(0, MAX_BYTES); }
  const reader = res.body.getReader(); const chunks = []; let n = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length;
    if (n >= MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } break; }
  }
  const all = new Uint8Array(Math.min(n, MAX_BYTES)); let off = 0;
  for (const c of chunks) { const take = Math.min(c.length, all.length - off); all.set(c.subarray(0, take), off); off += take; if (off >= all.length) break; }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

export function createHandler({ env, fetchFn }) {
  const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  async function one(path) {
    const r = await fetchFn(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows && rows[0] || null;
  }
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

  // GET one URL, following redirects by hand so every hop is re-checked.
  async function fetchPage(start) {
    let url = start; const hops = [];
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const bad = urlProblem(url);
      if (bad) return { error: (i ? 'redirected to an address that is not read: ' : '') + bad, hops };
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetchFn(url, { redirect: 'manual', signal: ac.signal, headers: {
          'User-Agent': LINK_UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-US,en;q=0.8' } });
      } catch (e) {
        clearTimeout(timer);
        return { error: e && e.name === 'AbortError' ? 'the site took too long to answer' : 'the site could not be reached', hops };
      }
      clearTimeout(timer);
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        hops.push(res.status);
        url = new URL(res.headers.get('location'), url).toString();
        continue;
      }
      const type = res.headers.get('content-type') || '';
      if (!/html|xml/i.test(type) && type) return { status: res.status, finalUrl: url, hops, error: 'not a web page (' + type.split(';')[0] + ')' };
      const html = await readBody(res);
      return { status: res.status, finalUrl: url, hops, html };
    }
    return { error: 'too many redirects', hops };
  }

  // Public oEmbed where the platform offers one without a key.
  async function oembed(platform, url) {
    const ep = platform === 'X' ? 'https://publish.twitter.com/oembed?omit_script=1&url='
      : platform === 'YouTube' ? 'https://www.youtube.com/oembed?format=json&url=' : null;
    if (!ep) return null;
    try {
      const r = await fetchFn(ep + encodeURIComponent(url), { headers: { 'User-Agent': LINK_UA, Accept: 'application/json' } });
      if (!r.ok) return { error: 'oEmbed answered ' + r.status };
      const o = await r.json();
      const text = o.html ? decodeEntities(String(o.html).replace(/<[^>]+>/g, ' ')) : null;
      // X's embed ends with "— Name (@handle) Month D, YYYY"; that date is the post date.
      const d = text && (text.match(/([A-Z][a-z]+ \d{1,2}, \d{4})\s*$/) || [])[1];
      return { title: o.title || null, author: o.author_name || null, site: o.provider_name || null, text, published: d || null };
    } catch { return { error: 'oEmbed could not be reached' }; }
  }

  async function read(url) {
    const bad = urlProblem(url);
    if (bad) return { ok: false, url, error: bad };
    const platform = platformOf(url);
    const page = await fetchPage(url);
    const out = { ok: false, url, platform, status: page.status || null, finalUrl: page.finalUrl || null, redirects: (page.hops || []).length };
    if (page.html) {
      const p = readPage(page.html, page.finalUrl);
      Object.assign(out, { fields: p.fields, engagement: p.engagement, engagementSource: p.engagementSource, notes: p.notes, ok: !!p.fields.title });
      if (page.status >= 400) out.notes.push('The site answered ' + page.status + '.');
    } else {
      out.error = page.error; out.notes = []; out.fields = {}; out.engagement = {};
    }
    const oe = await oembed(platform, url);
    if (oe) {
      out.oembed = oe;
      if (!oe.error) {
        out.fields = out.fields || {};
        for (const k of ['title', 'author', 'site', 'published']) if (!out.fields[k] && oe[k]) out.fields[k] = oe[k];
        if (!out.fields.description && oe.text) out.fields.description = oe.text;
        out.ok = out.ok || !!(oe.title || oe.text);
      }
    }
    if (!out.engagement || !Object.keys(out.engagement).length) {
      out.notes = out.notes || [];
      out.notes.push(platform === 'Web' ? 'No public counts on this page.' : platform + ' shows no counts to an outside reader; read them from a screenshot or type them.');
    }
    return out;
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const who = await staffEmail(req);
    if (who.res) return who.res;
    let body; try { body = await req.json(); } catch { return json({ error: 'send {"url": "..."}' }, 400); }
    const url = String(body && body.url || '').trim();
    if (!url) return json({ error: 'no url' }, 400);
    return json(await read(url));
  };
}
