// The importer's third mode: parcel records.
//
// Deliberately separate from the stakeholder and interaction imports because a
// parcel is a different record — one row per PARCEL, not one per owner. It
// writes pi_parcels (what the Parcels view counts) rather than the contact-level
// pi_stakeholders.parcel_id reference.
//
// The two behaviours worth guarding are the ones that protect the table's whole
// reason for existing: a parcel number already on the project is skipped rather
// than duplicated, and owner attachment is exact-match only — a near-miss must
// leave the parcel ownerless and visibly flagged, never silently wrong.
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'importer — parcel import creates parcels and attaches owners exactly',
  async run({ t }) {
    t.seed();

    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const projId = String(proj.id);
    // A contact already on the project, to match an owner against.
    const owner = (await t.sql(
      `select s.id, s.first_name, s.last_name, s.email
         from pi_stakeholders s join pi_project_stakeholders l
           on l.stakeholder_id::text = s.id::text
        where l.project_id::text=$1 and s.email <> '' order by s.id limit 1`, [projId]))[0];
    t.ok(owner, 'found a project contact to use as an owner');

    // One parcel already on the project — the import must skip a repeat of it.
    await t.sql(
      `insert into pi_parcels (project_id, parcel_number, status) values ($1,'13-112-0001','Not started')`,
      [projId]);

    const csv = [
      'Parcel,Situs Address,Latitude,Longitude,Status,Notice Date,Owner Email,Owner Name,Notes',
      '13-112-0001,Already here,,,,,,,dupe of an existing parcel',
      `13-112-0002,1450 W 3600 S,,,Notice sent,2026-07-20,${owner.email},,matched by email`,
      `13-112-0003,1470 W 3600 S,,,,,,${owner.first_name} ${owner.last_name},matched by name`,
      '13-112-0004,,41.2984,-112.0847,,,,Nobody McNoperson,no such contact',
      '13-112-0002,Repeat in file,,,,,,,second copy in the same file',
      ',,,,,,,,row with no parcel number',
    ].join('\n');
    const csvPath = path.join(__dirname, '..', '_parcels.csv');
    fs.writeFileSync(csvPath, csv);

    const app = await t.open('importer.html', { email: 'putzke@demo.test' });
    try {
      await app.page.waitForFunction(() => typeof parcState !== 'undefined', null, { timeout: 20000 });

      // ── the tab exists and is distinct from the other two ───────────────
      t.ok(await app.page.$('#tab-parcels'), 'a Parcels tab exists');
      await app.page.evaluate(() => switchImpTab('parcels'));
      await app.page.waitForTimeout(400);
      const paneOn = await app.page.evaluate(() => ({
        parcels: document.getElementById('tabpane-parcels').classList.contains('active'),
        stakeholders: document.getElementById('tabpane-stakeholders').classList.contains('active'),
        interactions: document.getElementById('tabpane-interactions').classList.contains('active'),
      }));
      t.ok(paneOn.parcels, 'the parcels pane activates');
      t.ok(!paneOn.stakeholders && !paneOn.interactions, 'and the other two deactivate');

      const projOpts = await app.page.evaluate(() =>
        document.getElementById('parc-project-select').options.length);
      t.gt(projOpts, 1, 'the project select is populated');

      // ── upload ──────────────────────────────────────────────────────────
      await app.page.evaluate(id => {
        document.getElementById('parc-project-select').value = id;
        updateParcProject();
      }, projId);
      await app.page.setInputFiles('#parc-file-input', csvPath);
      await app.page.waitForFunction(() => parcState.rawRows.length > 0, null, { timeout: 5000 });
      t.eq(await app.page.evaluate(() => parcState.rawRows.length), 6, 'six data rows read');

      // ── auto-mapping ────────────────────────────────────────────────────
      const map = await app.page.evaluate(() => parcState.columnMap);
      t.eq(map[0], 'parcelNumber', '"Parcel" auto-maps to the parcel number');
      t.eq(map[1], 'situsAddress', '"Situs Address" auto-maps');
      t.eq(map[2], 'latitude', '"Latitude" auto-maps');
      t.eq(map[6], 'ownerEmail', '"Owner Email" maps to email, not name');
      t.eq(map[7], 'ownerName', '"Owner Name" maps to name');

      // ── review classifies every row ─────────────────────────────────────
      await app.page.evaluate(() => parcGoToStep(3));
      await app.page.waitForTimeout(600);
      const review = await app.page.evaluate(() => parcState.parsed.map(r => ({
        num: r.parcelNumber, skip: r.skip, reason: r.reason,
        owner: r.owner ? String(r.owner.id) : null, warn: !!r.ownerWarn,
        status: r.status, notice: r.noticeDate, lat: r.latitude,
      })));

      t.eq(review[0].skip, true, 'a parcel already on the project is skipped');
      t.ok(/already/i.test(review[0].reason), 'and says why');
      t.eq(review[1].skip, false, 'a new parcel imports');
      t.eq(review[1].owner, String(owner.id), 'owner matched by email');
      t.eq(review[1].status, 'Notice sent', 'status came through');
      t.eq(review[1].notice, '2026-07-20', 'notice date normalised');
      t.eq(review[2].owner, String(owner.id), 'owner matched by exact full name');
      t.eq(review[3].owner, null, 'an unknown owner name matches nothing');
      t.eq(review[3].warn, true, 'and is flagged rather than silently dropped');
      t.eq(review[3].skip, false, 'but the parcel is still created');
      t.eq(review[3].lat, '41.2984', 'coordinates carry through');
      t.eq(review[4].skip, true, 'a repeat within the same file is skipped');
      t.ok(/duplicate/i.test(review[4].reason), 'and says which row it duplicates');
      t.eq(review[5].skip, true, 'a row with no parcel number is skipped');

      // ── import ──────────────────────────────────────────────────────────
      await app.page.evaluate(() => runParcImport());
      await app.page.waitForFunction(() => parcState.result !== null, null, { timeout: 20000 });
      const res = await app.page.evaluate(() => parcState.result);
      t.eq(res.created, 3, 'three parcels created');
      t.eq(res.owners, 2, 'two owners attached');
      t.eq(res.failed, 0, 'nothing failed');
      t.eq(res.skipped, 3, 'three rows skipped');

      const saved = await t.sql(
        `select parcel_number, status, notice_date, latitude, situs_address
           from pi_parcels where project_id::text=$1 order by parcel_number`, [projId]);
      t.eq(saved.length, 4, 'the project now has four parcels including the pre-existing one');
      t.eq(saved.map(r => r.parcel_number).join(','),
           '13-112-0001,13-112-0002,13-112-0003,13-112-0004',
           'and no duplicate was written');
      t.eq(saved[3].latitude, '41.2984', 'the coordinates-only parcel persisted');

      // Scoped: the demo seed ships parcels on another project.
      const links = await t.sql(
        `select p.parcel_number, o.stakeholder_id from pi_parcel_owners o
           join pi_parcels p on p.id::text = o.parcel_id::text
          where p.project_id::text=$1 order by p.parcel_number`, [projId]);
      t.eq(links.length, 2, 'exactly two ownership links written');
      t.ok(links.every(l => String(l.stakeholder_id) === String(owner.id)),
           'both point at the matched contact');
      t.eq(links.map(l => l.parcel_number).join(','), '13-112-0002,13-112-0003',
           'and only to the parcels whose owner matched');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      fs.unlinkSync(csvPath);
      await app.close();
    }
  },
};
