// The Cirrus Cc rebrand (Oct 2026, formerly Horizon COMPASS).
//
// Same rule as the UDOT logo (test 36): every embedded copy of the brand is
// the SAME BYTES as a source file in brand/, so a future logo change is one
// rebuild plus one swap, and a copy left behind fails here rather than
// shipping a second, stale mark to a client.
//   brand/source/   the design handoff exactly as delivered
//   brand/*.svg     tools/build-brand.py: metadata stripped, text outlined
//   brand/png/      tools/render-brand-png.js: what Word and iOS need
// Plus: the old name is gone from everything a user sees, and the internal
// identifiers that would lose data if renamed are still there.
module.exports = {
  name: 'Cirrus Cc brand — every embedded copy matches brand/, and the old name is gone',
  async run({ t }) {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..', '..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');
    const brand = f => fs.readFileSync(path.join(root, 'brand', f));
    const apps = ['index.html', 'mobile.html', 'importer.html', 'client-portal.html'];
    const src = Object.fromEntries(apps.map(a => [a, read(a)]));
    const dataUris = (html, mime) => [...html.matchAll(new RegExp('data:' + mime.replace('+', '\\+') + ';base64,([A-Za-z0-9+/=]+)', 'g'))]
      .map(m => Buffer.from(m[1], 'base64'));
    const has = (html, file, mime) => dataUris(html, mime).some(b => b.equals(brand(file)));

    // ── the production SVGs carry no live text and no 8 KB metadata block ──
    for (const f of fs.readdirSync(path.join(root, 'brand')).filter(n => n.endsWith('.svg'))) {
      const s = brand(f).toString('utf8');
      if (/<text\b|<metadata\b/.test(s)) t.ok(false, `${f} still has live text or metadata`);
    }
    t.ok(true, 'brand/*.svg are outlined and metadata-free (a data: URI cannot load Michroma or Saira)');

    // ── favicons, icons, headers ──────────────────────────────────────────
    for (const a of apps) {
      const m = src[a].match(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)">/);
      t.ok(m && Buffer.from(m[1], 'base64').equals(brand('cirrus-cc-favicon.svg')), `${a}: the favicon is brand/cirrus-cc-favicon.svg`);
    }
    t.ok(has(src['mobile.html'], 'png/cirrus-cc-apple-touch-180.png', 'image/png'), 'mobile: the home-screen icon is the rendered 180 px tile');
    t.ok(has(src['mobile.html'], 'cirrus-cc-wordmark-dark.svg', 'image/svg+xml'), 'mobile: the header carries the reversed wordmark');
    t.ok(has(src['importer.html'], 'cirrus-cc-wordmark-light.svg', 'image/svg+xml'), 'importer: the header carries the wordmark');
    t.ok(has(src['client-portal.html'], 'cirrus-cc-wordmark-dark.svg', 'image/svg+xml'), 'portal: the top bar carries the reversed wordmark');
    t.ok(/You’re cc’d on this project/.test(src['client-portal.html']), 'portal: the "you\'re cc\'d" indicator is in the top bar');
    const rh = src['index.html'].match(/window\._srHeader = "data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/);
    t.ok(rh && Buffer.from(rh[1], 'base64').equals(brand('cirrus-cc-lockup-horizontal-light.svg')), 'desktop: the report header mark is the horizontal lockup');

    // inline lockups: the stacked reversed lockup (sidebar + sign-in) and the tagline
    const stackedPaths = (brand('cirrus-cc-lockup-stacked-dark.svg').toString().match(/<path d="[^"]{200,}/) || [''])[0];
    t.ok(stackedPaths && src['index.html'].split(stackedPaths).length - 1 >= 2, 'desktop: sidebar and sign-in both draw the stacked lockup');
    for (const a of ['index.html', 'mobile.html', 'client-portal.html']) {
      t.ok(src[a].includes('Consultant to client, in real time'), `${a}: the sign-in carries the tagline`);
    }

    // ── titles ───────────────────────────────────────────────────────────
    const titles = apps.map(a => (src[a].match(/<title>([^<]*)<\/title>/) || [])[1]);
    t.eq(titles, ['Cirrus Cc — Stakeholder Management', 'Cirrus Cc — Field App', 'Cirrus Cc — Stakeholder Import Tool', 'Cirrus Cc — Client Portal'], 'page titles');

    // ── the old names are gone; "Cc" is never "CC" ───────────────────────
    for (const a of apps) {
      const hits = (src[a].match(/Horizon COMPASS|HORIZON COMPASS|\bCOMPASS\b|PI Registry|horizoncompass/g) || []);
      t.eq(hits, [], `${a}: no Horizon COMPASS / COMPASS / PI Registry left`);
      t.eq((src[a].match(/Cirrus CC|CIRRUS CC|Cirrus cc/g) || []), [], `${a}: "Cc" is always upper-then-lower`);
    }

    // ── what must NOT be renamed ─────────────────────────────────────────
    // Renaming these would sign every user out of their saved AI key and
    // report letterhead choice, and break every portal link already sent.
    t.ok(src['index.html'].includes("'compass_claude_api_key_v2'"), 'the saved-API-key localStorage key is unchanged');
    t.ok(src['index.html'].includes("'compass_report_branding'"), 'the letterhead-choice localStorage key is unchanged');
    // The app address lives in ONE constant per app, so the move to
    // app.cirruscc.com is a one-line change made the day DNS is live.
    const base = a => (src[a].match(/const APP_BASE_URL = '([^']+)'/) || [])[1];
    t.ok(base('index.html') && base('index.html') === base('client-portal.html'), 'index.html and the portal agree on APP_BASE_URL');
    for (const a of apps) t.eq((src[a].match(/putzke\.github\.io/g) || []).length, a === 'index.html' || a === 'client-portal.html' ? 1 : 0, `${a}: the address appears only in APP_BASE_URL`);

    // ── the .docx letterheads ────────────────────────────────────────────
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const marks = await app.page.evaluate(async () => {
        const out = {};
        for (const v of ['_piDocxTemplate', '_piDocxTemplateSunriseAlt', '_piDocxTemplateUdot']) {
          const bin = atob(window[v]); const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const zip = await JSZip.loadAsync(arr);
          const header = await zip.file('word/header1.xml').async('string');
          const rels = await zip.file('word/_rels/header1.xml.rels').async('string');
          const draws = [...header.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)].map(d => d[0]);
          out[v] = await Promise.all(draws.map(async d => {
            const id = d.match(/r:embed="([^"]+)"/)[1];
            const target = rels.match(new RegExp('Id="' + id + '"[^>]*Target="([^"]+)"'))[1];
            const wp = d.match(/<wp:extent cx="(\d+)" cy="(\d+)"/).slice(1).map(Number);
            const a = d.match(/<a:ext cx="(\d+)" cy="(\d+)"/).slice(1).map(Number);
            return { target, wp, a, img: await zip.file('word/' + target).async('base64') };
          }));
        }
        return out;
      });
      const png = brand('png/cirrus-cc-lockup-horizontal-light.png');
      const ratio = png.readUInt32BE(16) / png.readUInt32BE(20);
      for (const v of ['_piDocxTemplateSunriseAlt', '_piDocxTemplateUdot']) {
        const mark = marks[v][1];
        t.ok(mark && Buffer.from(mark.img, 'base64').equals(png), `${v}: the product mark is brand/png/cirrus-cc-lockup-horizontal-light.png`);
        t.ok(mark && Math.abs(mark.wp[0] / mark.wp[1] - ratio) < 0.01 && Math.abs(mark.a[0] / mark.a[1] - ratio) < 0.01,
          `${v}: both of its extents carry the new ${ratio.toFixed(2)}:1 shape (no stretched mark)`);
      }
      t.eq(marks._piDocxTemplate.length, 1, 'the Sunrise letterhead is one banner with no product mark, as before');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
