// The pick-lists a user chooses from are duplicated across four places, and
// none of them imports the others: index.html, mobile.html, importer.html, and
// the .xlsx template embedded as base64 inside importer.html's
// downloadTemplate(). CLAUDE.md warns about this; the warning is only as good
// as somebody remembering it.
//
// Drift here is quiet and one-directional: the .xlsx offered "Letter" and
// "Text" as interaction channels that the app has never had, and the importer
// writes channel values verbatim — so an import from the firm's own template
// produced interactions the app's channel filter could not select. It also
// omitted "Public event" and the "In-person" direction, so those were
// unreachable from the template.
//
// index.html is canonical. This test says so mechanically.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

// Minimal zip reader — enough to pull one file out of the xlsx. Avoids adding a
// dependency for what is a handful of bytes of central-directory parsing.
function unzip(buf, want) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  let off = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  const names = [];
  let found = null;
  for (let i = 0; i < count; i++) {
    const nLen = buf.readUInt16LE(off + 28), xLen = buf.readUInt16LE(off + 30),
          cLen = buf.readUInt16LE(off + 32);
    const name = buf.slice(off + 46, off + 46 + nLen).toString();
    names.push(name);
    if (name === want) {
      const lho = buf.readUInt32LE(off + 42);
      const lnLen = buf.readUInt16LE(lho + 26), lxLen = buf.readUInt16LE(lho + 28);
      const start = lho + 30 + lnLen + lxLen;
      const comp = buf.readUInt16LE(off + 10);
      const size = buf.readUInt32LE(off + 20);
      const raw = buf.slice(start, start + size);
      // Keep walking rather than returning here — the caller checks the full
      // entry count to prove no sheet was lost when the template was rebuilt.
      found = comp === 0 ? raw : zlib.inflateRawSync(raw);
    }
    off += 46 + nLen + xLen + cLen;
  }
  return { names, data: found };
}

const jsList = (html, re) => { const m = html.match(re); return m ? eval(m[1]) : null; };
const sorted = a => (a || []).slice().sort();

module.exports = {
  name: 'shared lists — index.html vs mobile, importer, and the .xlsx template',
  async run({ t }) {
    const idx = read('index.html'), mob = read('mobile.html'), imp = read('importer.html');

    // ── canonical, from index.html ──────────────────────────────────────
    const canon = {
      types:   jsList(idx, /const STAKE_TYPES=(\[[^\]]*\])/),
      dist:    jsList(idx, /const DIST_GROUPS=(\[[^\]]*\])/),
      channel: jsList(idx, /id="f-ic">\$\{(\[[^\]]*\])/),
      dir:     jsList(idx, /id="f-idr">\$\{(\[[^\]]*\])/),
      support: jsList(idx, /id="f-ls">\$\{(\[[^\]]*\])/),
    };
    t.eq(canon.types && canon.types.length, 13, 'canonical STAKE_TYPES found (13)');
    t.eq(canon.dist && canon.dist.length, 4, 'canonical DIST_GROUPS found (4)');
    t.ok(canon.channel && canon.channel.length, 'canonical channel list found');
    t.ok(canon.dir && canon.dir.length, 'canonical direction list found');

    // ── mobile.html: its own copies of the dropdowns ────────────────────
    // Mobile logs interactions, so it duplicates the channel and direction
    // lists too — not just stakeholder types. Only #add-type was checked here
    // before, which left the two lists a field worker actually picks from every
    // day unguarded.
    const mobileSelect = id => {
      const i = mob.indexOf(`id="${id}"`);
      if (i < 0) return null;
      return [...mob.slice(i, mob.indexOf('</select>', i))
        .matchAll(/<option[^>]*>([^<]+)</g)].map(m => m[1].trim());
    };
    const mobileTypes = mobileSelect('add-type');
    t.eq(sorted(mobileTypes), sorted(canon.types), 'mobile #add-type matches STAKE_TYPES');
    t.eq(sorted(mobileSelect('log-channel')), sorted(canon.channel),
         'mobile #log-channel matches the app channel list');
    t.eq(sorted(mobileSelect('log-direction')), sorted(canon.dir),
         'mobile #log-direction matches the app direction list');

    // ── importer.html: normalizeType's own canonical copy ───────────────
    const impTypes = jsList(imp, /const STAKE_TYPES = (\[[\s\S]*?\]);/);
    t.eq(sorted(impTypes), sorted(canon.types), 'importer STAKE_TYPES matches');

    // Unrecognised input must land on a valid type, not pass through as junk.
    const i0 = imp.indexOf('function normalizeType');
    const normalizeType = eval('(' + imp.slice(i0, imp.indexOf('\n}', i0) + 2)
      .replace('function normalizeType', 'function') + ')');
    global.STAKE_TYPES = impTypes;
    t.eq(normalizeType('zzz not a type'), 'Other', 'unknown type falls back to Other');
    t.eq(normalizeType('Contractor'), 'Contractor', 'a valid type with no keyword rule survives');
    t.eq(normalizeType('Nonprofit'), 'Non-profit', 'a spelling variant normalises');
    for (const ty of canon.types) {
      t.ok(canon.types.includes(normalizeType(ty)), `normalizeType("${ty}") stays canonical`);
    }

    // ── the .xlsx template embedded in downloadTemplate() ───────────────
    const b64 = (imp.match(/const b64 = '([A-Za-z0-9+/=]+)';/) || [])[1];
    t.ok(b64, 'template base64 blob found');
    const { names, data } = unzip(Buffer.from(b64, 'base64'), 'xl/worksheets/sheet3.xml');
    t.eq(names.length, 20, 'template still has all 20 zip entries');
    t.ok(names.includes('xl/worksheets/sheet2.xml') && data, 'template sheets readable');
    t.ok(names.includes('xl/worksheets/sheet5.xml'), 'including the Parcel Import sheet');

    const dropdowns = xml => [...xml.matchAll(/<formula1>"([^"]*)"<\/formula1>/g)]
      .map(m => m[1].replace(/&amp;/g, '&').split(','));
    const sheet2 = unzip(Buffer.from(b64, 'base64'), 'xl/worksheets/sheet2.xml').data.toString();
    const s2 = dropdowns(sheet2), s3 = dropdowns(data.toString());
    const has = (lists, want) => lists.some(l => sorted(l).join('|') === sorted(want).join('|'));

    t.ok(has(s2, canon.types),   '.xlsx stakeholder-type dropdown matches STAKE_TYPES');
    t.ok(has(s2, canon.dist),    '.xlsx distribution-group dropdown matches DIST_GROUPS');
    t.ok(has(s2, canon.support), '.xlsx support dropdown matches');
    t.ok(has(s3, canon.channel), '.xlsx channel dropdown matches the app');
    t.ok(has(s3, canon.dir),     '.xlsx direction dropdown matches the app');

    // ── the Parcel Import sheet ─────────────────────────────────────────
    // A fifth copy of two more lists. The importer normalises against its own
    // constants, so a template offering a status the importer would reject
    // silently becomes "Not started" on every row that used it.
    const sheet5 = unzip(Buffer.from(b64, 'base64'), 'xl/worksheets/sheet5.xml').data.toString();
    const s5 = dropdowns(sheet5);
    const impStatuses = jsList(imp, /const PARCEL_STATUSES_IMP = (\[[\s\S]*?\]);/);
    const impAcq      = jsList(imp, /const PARCEL_ACQ_IMP = (\[[\s\S]*?\]);/);
    const appStatuses = jsList(idx, /const PARCEL_STATUSES = (\[[\s\S]*?\]);/);
    t.ok(impStatuses && impStatuses.length, 'importer PARCEL_STATUSES_IMP found');
    t.ok(impAcq && impAcq.length, 'importer PARCEL_ACQ_IMP found');
    t.eq(sorted(impStatuses), sorted(appStatuses),
         'importer parcel statuses match index.html PARCEL_STATUSES');
    t.ok(has(s5, impStatuses), '.xlsx parcel-status dropdown matches');
    t.ok(has(s5, impAcq),      '.xlsx acquisition-type dropdown matches');

    // The header row is what the importer's auto-map reads, so it has to name
    // fields the wizard actually offers.
    const hdrs = [...sheet5.matchAll(/<c r="[A-Z]+4"[^>]*><v>([^<]*)<\/v><\/c>/g)].map(m => m[1]);
    t.ok(hdrs.includes('ParcelNumber'), 'the sheet leads with the one required column');
    ['SitusAddress','Latitude','Longitude','AcquisitionType','Status','NoticeDate','Notes',
     'OwnerEmail','OwnerName'].forEach(h =>
       t.ok(hdrs.includes(h), `the sheet offers ${h}`));

    // Every header must auto-map to a real parcel field, or the template hands
    // the user columns the wizard leaves on "— ignore —".
    const parcAuto = imp.match(/const PARC_AUTO_MAP = \{([\s\S]*?)\};/);
    t.ok(parcAuto, 'PARC_AUTO_MAP found');
    const parcFields = [...imp.matchAll(/\{key:'(\w+)',\s*label:'[^']*'\}/g)].map(m => m[1]);
    const autoKeys = [...parcAuto[1].matchAll(/'([^']+)'\s*:\s*'(\w+)'/g)];
    hdrs.forEach(h => {
      const lower = h.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      const hit = autoKeys.some(([, k, v]) => lower.includes(k) && parcFields.includes(v));
      t.ok(hit, `"${h}" auto-maps to a parcel field`);
    });

    // And the Parcels tab has to offer the download, or the sheet is unreachable.
    const parcPane = imp.slice(imp.indexOf('id="parc-pane-1"'),
                               imp.indexOf('id="parc-pane-2"'));
    t.ok(/downloadTemplate\(\)/.test(parcPane),
         'the Parcels tab offers the template download, like the other two tabs');
  },
};
