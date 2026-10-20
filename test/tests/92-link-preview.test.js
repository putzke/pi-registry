// The Outreach log's link reader, step 2a: the LINK TEST on DEV (Oct 2026).
// supabase/functions/link-preview/logic.mjs reads one public URL the way a
// link preview does (title, outlet, date, public counts) for signed-in staff,
// and refuses anything that is not an ordinary public web address. A
// temporary Settings card on DEV lets staff paste real links and see what
// comes back. Nothing is stored.
const path = require('path');
const { pathToFileURL } = require('url');

const SB = 'https://example.supabase.co';
const IG_HTML = `<html><head><title>Instagram</title>
<meta property="og:title" content="UDOT Region One on Instagram: &quot;I-84 lane closures start Monday&quot;">
<meta property="og:description" content="1,234 likes, 56 comments - udotregion1 on October 3, 2026: &quot;I-84 lane closures…&quot;">
<meta property="og:site_name" content="Instagram"></head><body></body></html>`;
const NEWS_HTML = `<html><head><title>I-84 work begins | KSL.com</title>
<meta content="I-84 work begins near Morgan" property="og:title">
<meta name="description" content="Crews start Monday.">
<meta property="og:site_name" content="KSL.com">
<meta property="article:published_time" content="2026-10-02T08:00:00Z">
<script type="application/ld+json">{"@type":"NewsArticle","headline":"I-84 work begins near Morgan","author":{"@type":"Person","name":"A Reporter"},
"interactionStatistic":[{"@type":"InteractionCounter","interactionType":"https://schema.org/CommentAction","userInteractionCount":"17"},
{"@type":"InteractionCounter","interactionType":{"@type":"ShareAction"},"userInteractionCount":"1.2K"}]}</script>
</head></html>`;
const FB_LOGIN = `<html><head><title>Log into Facebook</title></head><body>Log in</body></html>`;

module.exports = {
  name: 'link reader (DEV link test) — reads public previews, refuses internal addresses, staff only',
  async run({ t }) {
    const L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', 'link-preview', 'logic.mjs')).href);

    // ── address rules ──
    for (const bad of ['ftp://x.com/a', 'http://localhost/a', 'http://127.0.0.1/', 'http://[::1]/', 'http://10.0.0.5/x', 'http://intranet/',
      'http://printer.local/', 'https://x.supabase.co/rest/v1/pi_staff', 'https://a:b@news.com/', 'https://news.com:8443/', 'http://2130706433/'])
      t.ok(L.urlProblem(bad), `refused: ${bad}`);
    for (const ok of ['https://www.facebook.com/udot/posts/1', 'https://www.ksl.com/article/123', 'http://news.example.org/a?b=1'])
      t.eq(L.urlProblem(ok), null, `allowed: ${ok}`);
    t.eq(L.platformOf('https://m.facebook.com/x'), 'Facebook', 'platform: Facebook');
    t.eq(L.platformOf('https://x.com/udot/status/1'), 'X', 'platform: X');
    t.eq(L.unwrapLink('https://urldefense.proofpoint.com/v2/url?u=https-3A__publicinput.com_udot-2Di84&d=DwMF&c=x'), 'https://publicinput.com/udot-i84', 'Proofpoint v2 link unwrapped');
    t.eq(L.unwrapLink('https://urldefense.com/v3/__https://www.ksl.com/article/1__;!!abc$'), 'https://www.ksl.com/article/1', 'Proofpoint v3 link unwrapped');
    t.eq(L.unwrapLink('https://www.ksl.com/a'), 'https://www.ksl.com/a', 'an ordinary link is left alone');
    t.eq(L.parseCount('1.2K'), 1200, '1.2K → 1200');
    t.eq(L.parseCount('12,345'), 12345, '12,345 → 12345');

    // ── fake web + Supabase ──
    const seen = [];
    const sites = {
      'https://www.instagram.com/p/abc/': { body: IG_HTML },
      'https://short.example/ksl': { status: 301, location: 'https://www.ksl.com/article/1' },
      'https://www.ksl.com/article/1': { body: NEWS_HTML },
      'https://short.example/evil': { status: 302, location: 'http://169.254.169.254/latest/meta-data' },
      'https://www.facebook.com/udot/posts/9': { body: FB_LOGIN },
    };
    const fetchFn = async (url, opts = {}) => {
      const u = String(url); seen.push({ u, ua: opts.headers && opts.headers['User-Agent'] });
      if (u === SB + '/auth/v1/user') {
        const a = (opts.headers || {}).Authorization || '';
        if (a === 'Bearer staff') return new Response(JSON.stringify({ email: 'Staff@Sunrise.example' }));
        if (a === 'Bearer stranger') return new Response(JSON.stringify({ email: 'someone@else.example' }));
        return new Response('{}', { status: 401 });
      }
      if (u.startsWith(SB + '/rest/v1/pi_staff')) return new Response(JSON.stringify(u.includes('staff%40sunrise.example') ? [{ email: 'staff@sunrise.example' }] : []));
      if (u.startsWith('https://publish.twitter.com/oembed')) return new Response(JSON.stringify({ author_name: 'UDOT Region One', provider_name: 'Twitter',
        html: '<blockquote><p>Overnight closures on I-84 this week.</p>&mdash; UDOT Region One (@UDOTRegionOne) <a href="x">October 4, 2026</a></blockquote>' }));
      const s = sites[u];
      if (!s) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
      if (s.location) return new Response('', { status: s.status, headers: { location: s.location } });
      return new Response(s.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
    const handle = L.createHandler({ env: { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'svc' }, fetchFn });
    const call = async (url, who = 'staff') => {
      const r = await handle(new Request('https://fn/link-preview', { method: 'POST', headers: { authorization: 'Bearer ' + who, 'content-type': 'application/json' }, body: JSON.stringify({ url }) }));
      return { status: r.status, body: await r.json(), cors: r.headers.get('access-control-allow-origin') };
    };

    // ── staff only ──
    t.eq((await call('https://www.ksl.com/article/1', 'nobody')).status, 401, 'no session → 401');
    t.eq((await call('https://www.ksl.com/article/1', 'stranger')).status, 403, 'signed in but not staff → 403');
    const pre = await handle(new Request('https://fn/link-preview', { method: 'OPTIONS' }));
    t.eq(pre.status, 204, 'CORS preflight answered');

    // ── Instagram: counts from the public description ──
    const ig = await call('https://www.instagram.com/p/abc/');
    t.eq(ig.status, 200, 'staff → 200'); t.eq(ig.cors, '*', 'CORS header on the answer');
    t.ok(ig.body.ok && /I-84 lane closures/.test(ig.body.fields.title), 'Instagram title read (entities decoded)');
    t.eq(ig.body.engagement, { reactions: 1234, comments: 56 }, 'Instagram counts read from the description');
    t.eq(ig.body.engagementSource, 'page description', 'says where the counts came from');

    // ── a Proofpoint-wrapped link reads the real page ──
    const wrapped = await call('https://urldefense.proofpoint.com/v2/url?u=https-3A__www.instagram.com_p_abc_&d=x');
    t.ok(wrapped.body.ok && wrapped.body.url === 'https://www.instagram.com/p/abc/', 'wrapped link read at its real address');
    t.ok(!seen.some((s) => s.u.includes('urldefense')), 'the wrapper itself is never fetched');

    // ── news: a redirect is followed, structured data wins ──
    const news = await call('https://short.example/ksl');
    t.eq(news.body.finalUrl, 'https://www.ksl.com/article/1', 'redirect followed');
    t.eq(news.body.fields.site, 'KSL.com', 'outlet');
    t.eq(news.body.fields.published, '2026-10-02T08:00:00Z', 'published date');
    t.eq(news.body.fields.author, 'A Reporter', 'author from JSON-LD');
    t.eq(news.body.engagement, { comments: 17, shares: 1200 }, 'counts from schema.org interactionStatistic');

    // ── a redirect to an internal address is refused before it is fetched ──
    const evil = await call('https://short.example/evil');
    t.ok(!evil.body.ok && /redirected to an address that is not read/.test(evil.body.error), 'redirect to 169.254.x refused');
    t.ok(!seen.some((s) => s.u.includes('169.254')), 'the internal address was never requested');

    // ── Facebook sign-in wall is named as such ──
    const fb = await call('https://www.facebook.com/udot/posts/9');
    t.ok(!fb.body.ok, 'a sign-in page is not a read post');
    t.ok(fb.body.notes.some((n) => /sign-in page/.test(n)), 'the note says the site answered with a sign-in page');
    t.ok(fb.body.notes.some((n) => /screenshot or type them/.test(n)), 'and points at the screenshot / typed fallback');

    // ── X: public oEmbed fills title/date ──
    const x = await call('https://x.com/UDOTRegionOne/status/123');
    t.ok(x.body.ok && /Overnight closures/.test(x.body.fields.description), 'X post text via public oEmbed');
    t.eq(x.body.fields.published, 'October 4, 2026', 'X post date via oEmbed');

    // ── honest user agent on every outside request ──
    const outside = seen.filter((s) => !s.u.startsWith(SB));
    t.ok(outside.length > 0 && outside.every((s) => s.ua === L.LINK_UA), 'every outside request identifies itself as the Cirrus Cc link reader');
    t.ok(!/facebookexternalhit|Twitterbot|Googlebot/i.test(L.LINK_UA), 'never pretends to be another crawler');

    // ── the DEV card ──
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const posted = [], hdrs = [];
      await app.page.route('**/functions/v1/link-preview', async (route) => {
        const b = JSON.parse(route.request().postData() || '{}'); posted.push(b.url);
        const h = route.request().headers(); hdrs.push(Object.keys(h).filter((k) => !['content-type', 'apikey', 'authorization', 'referer', 'user-agent', 'accept', 'origin'].includes(k) && !k.startsWith('sec-')));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
          b.url.includes('instagram') ? { ok: true, platform: 'Instagram', status: 200, fields: { title: 'IGMARK post' }, engagement: { reactions: 1234, comments: 56 }, engagementSource: 'page description', notes: [] }
            : { ok: false, platform: 'Facebook', status: 200, fields: {}, engagement: {}, notes: ['The site answered with a sign-in page, not the post.'] }) });
      });
      await app.page.evaluate(() => { setView('settings'); });
      t.ok(await app.page.$('#link-test-card'), 'the card shows on DEV');
      await app.page.fill('#link-test-urls', 'https://www.instagram.com/p/abc/\nnot a link\nhttps://www.facebook.com/udot/posts/9\nhttps://www.instagram.com/p/abc/');
      await app.page.click('#link-test-go');
      await t.until(() => app.page.evaluate(() => _linkTestRows.length === 2 && _linkTestRows.every((r) => r.res)), 'both links read');
      t.eq(posted.length, 2, 'duplicates and non-links are skipped');
      // The function's CORS allow-list must cover every header sent, or the
      // browser stops at the preflight (seen live: Prefer was sent and refused).
      const allowed = L.CORS['Access-Control-Allow-Headers'].split(/,\s*/);
      t.ok(hdrs.every((ks) => ks.every((k) => allowed.includes(k))), 'every header the card sends is on the function’s CORS allow-list: ' + JSON.stringify(hdrs[0]));
      const out = await app.page.textContent('#link-test-out');
      t.ok(/IGMARK post/.test(out) && /1,234 reactions · 56 comments/.test(out), 'the read link shows its title and counts');
      t.ok(/Read 1 of 2 · counts found on 1/.test(out), 'the summary line counts what was read');
      t.ok(/sign-in page/.test(out), 'the refused link says why');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
    // On LIVE the card is never drawn (CC_ENV gate).
    t.ok(/\$\{CC_ENV==='dev'\?_linkTestCardHTML\(\):''\}/.test(require('fs').readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')), 'the card is gated to DEV');
  },
};
