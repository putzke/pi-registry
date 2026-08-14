// The ROW register export — the working document for a sponsor and a hired
// right-of-way agent.
//
// The thing this has to get right is the many-to-many. A parcel with three
// heirs has three mailing addresses; an owner holding two parcels appears under
// both. Collapsing that into one address per parcel is the failure the
// pi_parcels tables exist to prevent, and it would reach the agent as a notice
// that never got sent.
//
// The other is scope: the export deliberately ignores the search and status
// filters, because a filtered file looks complete once it has been emailed.
//
// The .xlsx is unzipped and its XML parsed here, so this checks the actual
// bytes a spreadsheet would open rather than the arrays that fed them.
module.exports = {
  name: 'ROW export — workbook carries every parcel and every owner address',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id, pid from pi_projects where pid='25-3W-DESIGN'`))[0];
      const truth = (await t.sql(`
        select (select count(*) from pi_parcels where project_id::text=$1)::int parcels,
               (select count(*) from pi_parcel_owners po
                  join pi_parcels pc on pc.id::text=po.parcel_id::text
                 where pc.project_id::text=$1)::int links,
               (select count(*) from pi_parcels pc where pc.project_id::text=$1
                  and not exists (select 1 from pi_parcel_owners po
                                   where po.parcel_id::text=pc.id::text))::int unowned`,
        [String(proj.id)]))[0];
      t.eq(truth.parcels, 7, 'seven parcels on the design project');
      t.eq(truth.links, 10, 'ten ownership links');
      t.eq(truth.unowned, 1, 'one parcel has no owner');

      await app.page.evaluate(id => { S.projectFilter = id; setView('parcels'); }, String(proj.id));
      await app.page.waitForTimeout(200);

      // ── the rows that feed the workbook ─────────────────────────────────
      const rows = await app.page.evaluate(() => ({
        reg: _rowRegisterRows(), mail: _rowMailingRows(),
        regCols: ROW_REG_COLS.map(c => c.h), mailCols: ROW_MAIL_COLS.map(c => c.h),
      }));
      t.eq(rows.reg.length, truth.parcels, 'the register has one row per parcel');
      // One row per owner, plus a placeholder row for the parcel with none.
      t.eq(rows.mail.length, truth.links + truth.unowned,
           'the mailing list has one row per owner, and keeps the unowned parcel');
      t.ok(rows.mailCols.includes('Mailing address'), 'the mailing sheet carries the address');
      t.ok(rows.regCols.includes('Situs address') && rows.mailCols.includes('Situs address'),
           'both sheets carry the situs address, so the two are never confused');

      // The three-heir parcel must produce three rows, each with its own address.
      const heirs = (await t.sql(`
        select pc.parcel_number n, count(*)::int c from pi_parcel_owners po
          join pi_parcels pc on pc.id::text=po.parcel_id::text
         where pc.project_id::text=$1 group by pc.parcel_number
         order by count(*) desc limit 1`, [String(proj.id)]))[0];
      t.eq(heirs.c, 3, 'one parcel carries three owners');
      const heirRows = rows.mail.filter(r => r[1] === heirs.n);
      t.eq(heirRows.length, 3, 'and it produces three mailing rows');
      t.eq(new Set(heirRows.map(r => r[3])).size, 3, 'each naming a different owner');

      // An owner across two parcels appears under both.
      const names = rows.mail.map(r => r[3]).filter(n => !/No owner/.test(n));
      const dupe = names.find((n, i) => names.indexOf(n) !== i);
      t.ok(dupe, 'an owner holding more than one parcel appears more than once');
      t.eq(new Set(rows.mail.filter(r => r[3] === dupe).map(r => r[1])).size, 2,
           'under two different parcel numbers');

      // The unowned parcel is present and flagged, not dropped.
      const flagged = rows.mail.filter(r => /No owner identified/.test(r[3]));
      t.eq(flagged.length, truth.unowned, 'the parcel with no owner still has a row');
      t.eq(flagged[0].length, rows.mailCols.length, 'and the right number of columns');

      // Mailing address is the OWNER's, which is routinely not the situs.
      const differs = rows.mail.some(r => r[6] && r[2] && r[6] !== r[2]);
      t.ok(differs, 'at least one owner is reachable somewhere other than the land');

      // ── filters must not narrow the file ────────────────────────────────
      const filtered = await app.page.evaluate(() => {
        S.parcStatus = 'Acquired'; S.parcSearch = 'zzzz';
        renderParcels(document.getElementById('main'));
        return { reg: _rowRegisterRows().length, mail: _rowMailingRows().length };
      });
      t.eq(filtered.reg, truth.parcels,
           'a status filter does not shrink the export — a partial file reads as complete');
      t.eq(filtered.mail, truth.links + truth.unowned, 'nor the mailing list');
      await app.page.evaluate(() => { S.parcStatus = ''; S.parcSearch = ''; });

      // ── the actual .xlsx bytes ──────────────────────────────────────────
      const book = await app.page.evaluate(async () => {
        const blob = await _xlsxBuild([
          { name: 'Parcel register', cols: ROW_REG_COLS, rows: _rowRegisterRows() },
          { name: 'Mailing list', cols: ROW_MAIL_COLS, rows: _rowMailingRows() },
        ]);
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        const names = Object.keys(zip.files);
        const out = { size: blob.size, type: blob.type, names };
        for (const f of ['xl/workbook.xml', 'xl/worksheets/sheet1.xml',
                         'xl/worksheets/sheet2.xml', '[Content_Types].xml',
                         'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) {
          out[f] = zip.file(f) ? await zip.file(f).async('string') : null;
        }
        return out;
      });

      t.ok(/spreadsheetml\.sheet/.test(book.type), 'the blob is an xlsx MIME type');
      t.gt(book.size, 1500, 'and has real content');
      ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml',
       'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']
        .forEach(f => t.ok(book.names.includes(f), `the package contains ${f}`));

      t.ok(/name="Parcel register"/.test(book['xl/workbook.xml'])
        && /name="Mailing list"/.test(book['xl/workbook.xml']), 'both sheets are named');
      // Every sheet needs a relationship, or Excel refuses the file outright.
      t.eq((book['xl/_rels/workbook.xml.rels'].match(/<Relationship /g) || []).length, 3,
           'two worksheet relationships plus styles');

      const rowsIn = s => (book[s].match(/<row /g) || []).length;
      t.eq(rowsIn('xl/worksheets/sheet1.xml'), truth.parcels + 1,
           'sheet 1 holds every parcel plus the header');
      t.eq(rowsIn('xl/worksheets/sheet2.xml'), truth.links + truth.unowned + 1,
           'sheet 2 holds every owner plus the header');
      t.ok(/<autoFilter ref="A1:/.test(book['xl/worksheets/sheet2.xml']),
           'filtering is switched on — the agent will sort this');
      t.ok(/state="frozen"/.test(book['xl/worksheets/sheet2.xml']), 'and the header is frozen');

      // XML validity: the parts must parse, and an ampersand in a name or an
      // address must not break the file.
      const parsed = await app.page.evaluate(x => {
        const p = new DOMParser();
        return Object.keys(x).filter(k => k.endsWith('.xml')).map(k => {
          const d = p.parseFromString(x[k], 'application/xml');
          return { k, ok: !d.querySelector('parsererror') };
        });
      }, book);
      parsed.forEach(r => t.ok(r.ok, `${r.k} is well-formed XML`));

      const escaped = await app.page.evaluate(() =>
        _xlsxEsc('Smith & Sons <LLC> "Trust"'));
      t.eq(escaped, 'Smith &amp; Sons &lt;LLC&gt; &quot;Trust&quot;',
           'ampersands and angle brackets are escaped, not emitted raw');

      // Dates go out ISO so they sort as text and import as dates.
      const noticed = rows.reg.map(r => r[7]).filter(Boolean);
      t.gt(noticed.length, 0, 'notice dates are exported');
      t.ok(noticed.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)),
           'as ISO, which sorts correctly anywhere and imports as a date');

      // ── the print view ──────────────────────────────────────────────────
      await app.page.evaluate(() => printRowRegister());
      await app.page.waitForTimeout(300);
      const printed = await app.page.evaluate(() => {
        const f = document.getElementById('inline-rpt-frame');
        const el = document.getElementById('inline-rpt-overlay');
        return (f && f.getAttribute('srcdoc')) || (el ? el.innerHTML : '');
      });
      t.ok(/Parcel register/.test(printed) && /Mailing list/.test(printed),
           'the print view shows both tables');
      t.ok(/Mailing address/.test(printed), 'including the mailing addresses');
      t.ok(/No owner identified/.test(printed), 'and the parcel with no owner');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
