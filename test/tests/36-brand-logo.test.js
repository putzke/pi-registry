// The UDOT letterhead logo has to be the same mark everywhere it appears.
//
// It lives in TWO independent places and they are easy to update singly:
//   - window._srUdotLogo, a data: URI, used by _rptBrandHeader() for the HTML
//     quick reports, the print package and the archived-report preview;
//   - word/media/image2.png inside window._piDocxTemplateUdot, the .docx.
// A client can receive both from the same project on the same day, so a swap
// applied to one and not the other ships two different UDOT logos under one
// firm's name.
//
// This asserts they are the SAME BYTES, which is the only check that survives
// a future logo change without needing to be rewritten.
module.exports = {
  name: 'brand logos — one UDOT mark, in the .docx and the quick reports alike',
  async run({ t }) {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..', '..');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    // ── the source of record, checked into the repo ──────────────────────
    const srcPath = path.join(root, 'UDOT_Logo_Blue.png');
    t.ok(fs.existsSync(srcPath), 'the logo source file is in the repo');
    const src = fs.readFileSync(srcPath);
    t.ok(src.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'it is a PNG');
    const srcW = src.readUInt32BE(16), srcH = src.readUInt32BE(20);
    t.eq(srcW, 1000, 'and it is the 1000px-wide artwork');
    t.eq(srcH, 258, 'at 258px tall');

    // ── 1. the quick-report data: URI ────────────────────────────────────
    const uri = html.match(/window\._srUdotLogo = "data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)"/);
    t.ok(uri, 'index.html carries a UDOT logo for the HTML reports');
    const fromUri = Buffer.from(uri[2], 'base64');
    t.ok(fromUri.equals(src), 'the quick-report logo is the current mark, byte for byte');

    // ── 2. it survives into a rendered report ────────────────────────────
    // The bytes being right in the file is not the same as the header
    // rendering them: _rptBrandHeader falls back to a plain text wordmark when
    // the asset is missing, which looks deliberate rather than broken.
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const rendered = await app.page.evaluate(() => {
        const out = {};
        for (const mode of ['udot', 'sunrise', 'off']) {
          const h = _rptBrandHeader(mode);
          const el = document.createElement('div');
          el.innerHTML = h;
          const img = el.querySelector('img[alt="UDOT"]');
          out[mode] = { html: h.length,
                        src: img ? img.getAttribute('src').slice(0, 64) : null,
                        full: img ? img.getAttribute('src') : null,
                        textFallback: /UDOT<\/div>/.test(h) };
        }
        return out;
      });
      t.gt(rendered.udot.html, 0, 'the UDOT letterhead renders');
      t.ok(rendered.udot.src, 'with an <img>, not the text fallback');
      t.eq(rendered.udot.textFallback, false, 'the missing-asset fallback did not fire');
      t.ok(rendered.udot.full && rendered.udot.full.endsWith(uri[2].slice(-32)),
           'and the image it renders is the logo from index.html');
      t.eq(rendered.sunrise.src, null, 'the Sunrise letterhead carries no UDOT mark');
      t.eq(rendered.off.html, 0, 'and branding off renders no letterhead at all');

      // ── 3. the .docx template ────────────────────────────────────────
      // Unzipped in the page, with the JSZip the app already embeds for its
      // own export — the harness has no node-side zip library.
      const docx = await app.page.evaluate(async () => {
        const bin = atob(window._piDocxTemplateUdot);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const zip = await JSZip.loadAsync(arr);
        const header = await zip.file('word/header1.xml').async('string');
        const rels   = await zip.file('word/_rels/header1.xml.rels').async('string');
        const relId  = (header.match(/r:embed="([^"]+)"/) || [])[1];
        const target = (rels.match(new RegExp('Id="' + relId + '"[^>]*Target="([^"]+)"')) || [])[1];
        const logo   = target ? await zip.file('word/' + target).async('base64') : null;
        return { relId, target, logo,
                 extents: [...header.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)]
                   .map(m => ({ cx: Number(m[1]), cy: Number(m[2]) })) };
      });
      t.ok(docx.relId, 'the .docx header references an image');
      t.ok(docx.target, `it resolves to a media part (${docx.target})`);
      t.ok(docx.logo && Buffer.from(docx.logo, 'base64').equals(src),
           'the .docx logo is the same mark, byte for byte');

      // header1.xml pins the image to an explicit box, so swapping the bytes
      // without moving the extent lets Word stretch the art to the old shape.
      t.gt(docx.extents.length, 1, 'the header band holds the logo and the COMPASS mark');
      const box = docx.extents[0];
      const drawn = box.cx / box.cy, actual = srcW / srcH;
      t.ok(Math.abs(drawn - actual) < 0.02,
           `the drawing keeps the logo's aspect ratio (${drawn.toFixed(2)}:1 vs `
           + `${actual.toFixed(2)}:1) — the box it replaced was 3.08:1`);
      const dpi = srcW / (box.cx / 914400);
      t.ok(dpi >= 300, `it prints at ${Math.round(dpi)} DPI, above the 300 DPI standard`);
      t.eq(docx.extents[1].cx, 2683017, 'and the COMPASS mark beside it was not disturbed');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
