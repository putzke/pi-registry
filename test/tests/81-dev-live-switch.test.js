// Dev and live databases (Oct 2026).
//
// One block, identical in all four apps, picks the database from the address
// in the browser. ONLY the exact live addresses reach the live database; any
// other address (dev.cirruscc.com, a Cloudflare preview, a file on disk, a
// look-alike host) gets dev. Getting this backwards would put real stakeholder
// data behind a test site, so the rule is checked hostname by hostname.
module.exports = {
  name: 'dev / live switch — only the live addresses reach the live database',
  async run({ t }) {
    const fs = require('fs'), path = require('path'), vm = require('vm');
    const root = path.join(__dirname, '..', '..');
    const apps = ['index.html', 'mobile.html', 'importer.html', 'client-portal.html'];
    const src = Object.fromEntries(apps.map(a => [a, fs.readFileSync(path.join(root, a), 'utf8')]));
    const LIVE = 'ncfbblhlsiglxkoiounv', DEV = 'oxbonrnilvadszgfctfl';

    // ── one block, four identical copies ─────────────────────────────────
    const blockOf = s => (s.match(/\/\/ ── ENVIRONMENT \(begin\)[\s\S]*?\/\/ ── ENVIRONMENT \(end\)[^\n]*\n/) || [])[0];
    const block = blockOf(src['index.html']);
    t.ok(block, 'index.html has the environment block');
    for (const a of apps.slice(1)) t.eq(blockOf(src[a]), block, `${a}: block is byte-identical to index.html's`);
    for (const a of apps) {
      t.ok(/const SUPA_URL\s+= CC_SUPA\.url;/.test(src[a]) && /const SUPA_KEY\s+= CC_SUPA\.key;/.test(src[a]), `${a}: SUPA_URL / SUPA_KEY come from the block`);
      const outside = src[a].replace(block, '');
      t.eq((outside.match(new RegExp(LIVE + '|' + DEV, 'g')) || []).length, a === 'client-portal.html' ? 0 : 2,
        `${a}: no project address outside the block except the two CSP entries`);
      if (a !== 'client-portal.html') t.ok(new RegExp('connect-src[^;]*' + DEV).test(src[a]), `${a}: CSP allows the dev database`);
    }

    // ── each key belongs to its own project (a swap would cross the wires) ──
    const keyRef = k => JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).ref;
    const run = (href) => {
      const u = new URL(href);
      const ctx = { location: { hostname: u.hostname, protocol: u.protocol, origin: u.origin }, document: { body: null, addEventListener() {}, getElementById() { return null; } } };
      vm.runInNewContext(block + ';this.r={env:CC_ENV,url:CC_SUPA.url,key:CC_SUPA.key,base:CC_BASE};', ctx);
      return ctx.r;
    };
    const live = run('https://app.cirruscc.com/'), dev = run('https://dev.cirruscc.com/');
    t.ok(live.url.includes(LIVE) && keyRef(live.key) === LIVE, 'live: live URL and a key issued for the live project');
    t.ok(dev.url.includes(DEV) && keyRef(dev.key) === DEV, 'dev: dev URL and a key issued for the dev project');

    // ── hostname by hostname ─────────────────────────────────────────────
    const cases = [
      ['https://app.cirruscc.com/index.html', 'live', 'https://app.cirruscc.com'],
      ['https://putzke.github.io/pi-registry/', 'live', 'https://app.cirruscc.com'],
      ['https://dev.cirruscc.com/', 'dev', 'https://dev.cirruscc.com'],
      ['https://cirruscc-dev.pages.dev/', 'dev', 'https://cirruscc-dev.pages.dev'],
      ['https://3f2a1b.cirruscc-dev.pages.dev/', 'dev', 'https://3f2a1b.cirruscc-dev.pages.dev'],
      ['file:///home/x/index.html', 'dev', 'https://dev.cirruscc.com'],
      ['http://localhost:8080/', 'dev', 'http://localhost:8080'],
      ['https://app.cirruscc.com.evil.example/', 'dev', 'https://app.cirruscc.com.evil.example'],
      ['https://myapp.cirruscc.com/', 'dev', 'https://myapp.cirruscc.com'],
      ['https://appxcirruscc.com/', 'dev', 'https://appxcirruscc.com'],
      ['https://www.cirruscc.com/', 'dev', 'https://www.cirruscc.com'],
    ];
    for (const [href, env, base] of cases) {
      const r = run(href);
      t.eq([r.env, r.url.includes(env === 'live' ? LIVE : DEV), r.base], [env, true, base], `${href} → ${env}`);
    }

    // ── in a real page (the harness opens files → dev): banner and dev URL ──
    for (const a of ['index.html', 'client-portal.html']) {
      const app = await t.open(a, { email: 'putzke@demo.test' });
      try {
        await app.page.waitForTimeout(400);
        const r = await app.page.evaluate(() => ({ env: CC_ENV, url: SUPA_URL, banner: (document.getElementById('cc-env-banner') || {}).textContent || '' }));
        t.eq([r.env, r.url.includes(DEV)], ['dev', true], `${a} opened from disk uses the dev database`);
        t.ok(/DEV/.test(r.banner), `${a} shows the DEV banner`);
      } finally { await app.close(); }
    }
  },
};
