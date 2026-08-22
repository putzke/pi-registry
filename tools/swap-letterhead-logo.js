#!/usr/bin/env node
//
// Swap the brand logo inside one of the embedded .docx letterhead templates.
//
//   node tools/swap-letterhead-logo.js udot path/to/new-logo.png
//   node tools/swap-letterhead-logo.js udot path/to/new-logo.png --dry-run
//
// The three letterhead templates live in index.html as base64 .docx blobs
// (window._piDocxTemplate / _piDocxTemplateUdot / _piDocxTemplateSunriseAlt).
// A logo lives inside one of those zips as word/media/imageN.png, referenced
// from word/header1.xml by a relationship id. Editing it by hand means: decode
// the base64, unzip, replace the part, re-zip, re-base64, paste back — five
// steps with no feedback if one goes wrong. This does all of it, and re-checks
// the result by reading the rebuilt zip back out.
//
// It also RESIZES the drawing. word/header1.xml pins each image to an explicit
// <wp:extent cx cy> in EMU, so dropping in a logo of a different aspect ratio
// leaves the old box and Word stretches the new art to fit it. The new extent
// keeps the HEIGHT the template already uses — that is what keeps the logo
// visually level with whatever sits beside it in the band — and recomputes the
// width from the replacement's own pixel dimensions.
//
// Nothing is written unless every step succeeded.

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRANDS = {
  sunrise:    'window._piDocxTemplate',
  udot:       'window._piDocxTemplateUdot',
  sunrisealt: 'window._piDocxTemplateSunriseAlt',
};

const [brand, logoPath, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

if (!brand || !logoPath) {
  console.error('usage: node tools/swap-letterhead-logo.js <'
    + Object.keys(BRANDS).join('|') + '> <logo.png|logo.jpg> [--dry-run]');
  process.exit(2);
}
const varName = BRANDS[brand];
if (!varName) die(`unknown brand "${brand}" — expected one of ${Object.keys(BRANDS).join(', ')}`);
if (!fs.existsSync(logoPath)) die(`no such file: ${logoPath}`);

const INDEX = path.join(__dirname, '..', 'index.html');

// ── minimal zip reader/writer ───────────────────────────────────────────────
// Only what a .docx needs: stored + deflated entries, no zip64, no encryption.
function unzip(buf) {
  const eocd = (() => {
    for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) return i;
    return -1;
  })();
  if (eocd < 0) die('template is not a zip (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) die('corrupt central directory');
    const method  = buf.readUInt16LE(p + 10);
    const crc     = buf.readUInt32LE(p + 16);
    const nameLen = buf.readUInt16LE(p + 28);
    const extLen  = buf.readUInt16LE(p + 30);
    const cmtLen  = buf.readUInt16LE(p + 32);
    const local   = buf.readUInt32LE(p + 42);
    const name    = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const csize   = buf.readUInt32LE(p + 20);
    // Read the payload via the LOCAL header — its extra field length can differ
    // from the central one, and using the wrong one shifts every byte.
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtLen  = buf.readUInt16LE(local + 28);
    const start    = local + 30 + lNameLen + lExtLen;
    const raw      = buf.subarray(start, start + csize);
    entries.push({ name, method, crc,
                   data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLen + extLen + cmtLen;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDeflate = deflated.length < e.data.length;
    const payload = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(e.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x0021, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, payload);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x0021, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(payload.length, 20); ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(chunks), centralBuf, eocd]);
}

// ── image dimensions, without a dependency ──────────────────────────────────
function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) {                    // PNG
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {                    // JPEG
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
        return { type: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  die('logo must be a PNG or JPEG (an SVG has to be rasterised first — Word '
      + 'will not render one inside a header reliably)');
}

// ── locate the brand blob in index.html ─────────────────────────────────────
const html = fs.readFileSync(INDEX, 'utf8');
const re = new RegExp(varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="([A-Za-z0-9+/=]+)"');
const m = html.match(re);
if (!m) die(`could not find ${varName} in index.html`);

const entries = unzip(Buffer.from(m[1], 'base64'));

// Which media part is the brand logo? Follow header1.xml's FIRST drawing to its
// relationship, rather than guessing at a file name — image numbering differs
// between the three templates and the Horizon COMPASS mark sits in the same
// header.
const header = entries.find(e => e.name === 'word/header1.xml');
const rels   = entries.find(e => e.name === 'word/_rels/header1.xml.rels');
if (!header || !rels) die('template has no word/header1.xml — is this the right brand?');
const headerXml = header.data.toString('utf8');
const relsXml   = rels.data.toString('utf8');

const embeds = [...headerXml.matchAll(/r:embed="([^"]+)"/g)].map(x => x[1]);
if (!embeds.length) die('header1.xml references no images');
const relId = embeds[0];
const target = (relsXml.match(new RegExp(`Id="${relId}"[^>]*Target="([^"]+)"`)) || [])[1];
if (!target) die(`relationship ${relId} not found in header1.xml.rels`);
const partName = 'word/' + target.replace(/^\/?/, '');
const part = entries.find(e => e.name === partName);
if (!part) die(`${partName} is not in the package`);

const oldSize = imageSize(part.data);
const newBuf  = fs.readFileSync(logoPath);
const newSize = imageSize(newBuf);

if (newSize.type !== oldSize.type) {
  die(`the template's logo is a ${oldSize.type.toUpperCase()} and the replacement is a `
    + `${newSize.type.toUpperCase()}. Convert it first — swapping the bytes without also `
    + `updating [Content_Types].xml would produce a file Word refuses to open.`);
}

// ── resize the drawing to the new aspect ratio ──────────────────────────────
const extents = [...headerXml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)];
if (!extents.length) die('header1.xml has no <wp:extent> to resize');
const [, oldCxStr, oldCyStr] = extents[0];
const oldCx = Number(oldCxStr), oldCy = Number(oldCyStr);
const newCx = Math.round(oldCy * (newSize.w / newSize.h));   // keep the height
const newCy = oldCy;

console.log(`brand      : ${brand} (${varName})`);
console.log(`logo part  : ${partName}`);
console.log(`old image  : ${oldSize.w}×${oldSize.h}px  drawn at ${oldCx}×${oldCy} EMU `
          + `(${(oldCx/914400).toFixed(2)}" × ${(oldCy/914400).toFixed(2)}")`);
console.log(`new image  : ${newSize.w}×${newSize.h}px  drawn at ${newCx}×${newCy} EMU `
          + `(${(newCx/914400).toFixed(2)}" × ${(newCy/914400).toFixed(2)}")`);
console.log(`aspect     : ${(oldSize.w/oldSize.h).toFixed(2)}:1 → ${(newSize.w/newSize.h).toFixed(2)}:1`);

if (dryRun) { console.log('\n--dry-run: nothing written.'); process.exit(0); }

// Only the FIRST extent — the second is the Horizon COMPASS mark.
let patchedHeader = headerXml.replace(
  `<wp:extent cx="${oldCxStr}" cy="${oldCyStr}"/>`,
  `<wp:extent cx="${newCx}" cy="${newCy}"/>`);
// a:ext mirrors wp:extent inside the shape geometry; Word honours both.
patchedHeader = patchedHeader.replace(
  new RegExp(`<a:ext cx="${oldCxStr}" cy="${oldCyStr}"/>`),
  `<a:ext cx="${newCx}" cy="${newCy}"/>`);

part.data   = newBuf;
header.data = Buffer.from(patchedHeader, 'utf8');

const rebuilt = zip(entries);

// Read it straight back out — a swap that produces an unopenable file is worse
// than no swap, and this is the only cheap way to catch it here.
const check = unzip(rebuilt);
if (check.length !== entries.length) die('rebuilt package lost entries');
const rt = check.find(e => e.name === partName);
if (!rt || !rt.data.equals(newBuf)) die('the new logo did not survive the round-trip');
const rh = check.find(e => e.name === 'word/header1.xml').data.toString('utf8');
if (!rh.includes(`cx="${newCx}"`)) die('the resized extent did not survive the round-trip');

const b64 = rebuilt.toString('base64');
fs.writeFileSync(INDEX, html.replace(m[0], `${varName}="${b64}"`));
console.log(`\n✓ ${partName} replaced and ${varName} rewritten in index.html`);
console.log(`  package ${entries.length} entries, ${rebuilt.length} bytes, base64 ${b64.length} chars`);
console.log('  next: node test/run.js 33   (exports a real .docx per brand)');
