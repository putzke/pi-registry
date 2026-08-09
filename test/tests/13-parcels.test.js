// pi_parcels + pi_parcel_owners — the many-to-many a ROW campaign actually is.
//
// The single pi_stakeholders.parcel_id text column could not represent either
// direction: one owner holding several parcels got one value, and several owners
// on one parcel meant the number was typed once per owner, so a single typo
// split the parcel into two groups that never appeared together again.
//
// Both directions are exercised here, plus the duplicate guard that exists
// specifically to stop that typo-split.
module.exports = {
  name: 'parcels — many-to-many ownership, and the duplicate guard',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      const projId = String(proj.id);
      await app.page.evaluate(id => { S.projectFilter = id; setView('parcels'); }, projId);
      await app.page.waitForTimeout(200);
      t.ok(await app.page.$('button[onclick="openParcelModal()"]'), 'the Parcels view renders');

      const addParcel = (num, extra) => app.page.evaluate(async a => {
        openParcelModal();
        document.getElementById('f-pcp').value = a.pid;
        document.getElementById('f-pcn').value = a.num;
        if (a.lat) {
          document.getElementById('f-pclat').value = a.lat;
          document.getElementById('f-pclng').value = a.lng;
        }
        await saveParcel();
      }, Object.assign({ pid: projId, num: num }, extra || {}));

      await addParcel('13-112-0002');
      await addParcel('13-112-0003');
      // A parcel with no dwelling can only be designated by coordinates.
      await addParcel('13-112-0004', { lat: '40.5231', lng: '-111.9385' });
      await app.page.waitForTimeout(1500);

      const rows = await t.sql(
        `select id, parcel_number, latitude, status from pi_parcels
          where project_id::text=$1 order by parcel_number`, [projId]);
      t.eq(rows.length, 3, 'three parcels saved');
      t.eq(rows[0].status, 'Not started', 'status defaults');
      t.eq(rows[2].latitude, '40.5231', 'coordinates persist for an unaddressed parcel');

      // ── situs address is wired for Places, and degrades gracefully ──────
      // Google Maps is unreachable from the harness, which is the useful case to
      // pin: initAddressAutocomplete() only swaps the input for the widget once
      // Places actually loads, so with no network the field stays an ordinary
      // typable text input rather than becoming unusable.
      const addr = await app.page.evaluate(async () => {
        openParcelModal();
        // The wiring runs in a requestAnimationFrame after the modal renders.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const a = document.getElementById('f-pca');
        return { exists: !!a, type: a.type,
                 // Picking a place must not touch the coordinates: a place gives
                 // an address centroid, which on an unsubdivided parcel is not
                 // where the parcel is. Coordinates come from survey.
                 touchesCoords: !!(a.dataset.fillLatLng || a.dataset.latField),
                 hasClear: /clearAddressField\('f-pca'\)/.test(document.body.innerHTML) };
      });
      t.ok(addr.exists, 'the situs address field is present');
      t.eq(addr.type, 'text', 'it stays typable when Places cannot load');
      t.eq(addr.touchesCoords, false, 'the address picker never fills coordinates');
      t.ok(addr.hasClear, 'and offers a Clear affordance');

      // The clear helper is generic now, not hardcoded to the contact field.
      const cleared = await app.page.evaluate(() => {
        document.getElementById('f-pca').value = 'somewhere';
        clearAddressField('f-pca');
        return document.getElementById('f-pca').value;
      });
      t.eq(cleared, '', 'clearAddressField() blanks the parcel address');
      await app.page.evaluate(() => closeM());

      // ── the duplicate guard ─────────────────────────────────────────────
      const dupe = await app.page.evaluate(async pid => {
        let alerted = null;
        const orig = window.alert;
        window.alert = m => { alerted = m; };
        openParcelModal();
        document.getElementById('f-pcp').value = pid;
        document.getElementById('f-pcn').value = '  13-112-0002 ';   // same, padded
        await saveParcel();
        window.alert = orig;
        return alerted;
      }, projId);
      t.ok(dupe && /already exists/i.test(dupe), 'a repeat parcel number is refused');
      t.eq(Number((await t.sql('select count(*) c from pi_parcels where project_id::text=$1',
                               [projId]))[0].c), 3, 'and no second row was written');

      // ── several owners on one parcel, one owner on several parcels ──────
      const contacts = await app.page.evaluate(id => {
        const linked = DB.get('project_stakeholders')
          .filter(x => String(x.projectId) === String(id)).map(x => String(x.stakeholderId));
        return DB.getActive('stakeholders').filter(s => linked.indexOf(String(s.id)) > -1)
          .slice(0, 2).map(s => String(s.id));
      }, projId);
      t.eq(contacts.length, 2, 'found project contacts to use as owners');

      const p1 = String(rows[0].id), p2 = String(rows[1].id);
      const attach = (parcel, owner) => app.page.evaluate(async a => {
        openParcelModal(a.parcel);
        await new Promise(r => setTimeout(r, 60));
        document.getElementById('f-pc-addowner').value = a.owner;
        await attachOwner(a.parcel);
      }, { parcel: parcel, owner: owner });

      await attach(p1, contacts[0]);
      await attach(p1, contacts[1]);
      await attach(p2, contacts[0]);
      await app.page.waitForTimeout(1500);

      const links = await t.sql(
        `select parcel_id, stakeholder_id, ownership_role from pi_parcel_owners
          order by parcel_id, stakeholder_id`);
      t.eq(links.length, 3, 'three ownership links written');
      t.eq(links.filter(l => String(l.parcel_id) === p1).length, 2,
           'one parcel carries two owners');
      t.eq(links.filter(l => String(l.stakeholder_id) === contacts[0]).length, 2,
           'one owner carries two parcels');
      t.ok(links.every(l => l.ownership_role === 'Owner'), 'role defaults to Owner');

      // Attaching the same contact twice must be a no-op.
      await attach(p1, contacts[0]);
      await app.page.waitForTimeout(800);
      t.eq(Number((await t.sql('select count(*) c from pi_parcel_owners'))[0].c), 3,
           'a duplicate owner attach is refused');

      // ── searching an owner's name finds their parcels ───────────────────
      const byOwner = await app.page.evaluate(sid => {
        const s = DB.get('stakeholders').find(x => String(x.id) === sid);
        S.parcSearch = (s.lastName || s.org || '').slice(0, 6);
        renderParcels(document.getElementById('main'));
        return { term: S.parcSearch,
                 rows: document.querySelectorAll('#main table.dtable tbody tr').length };
      }, contacts[0]);
      t.eq(byOwner.rows, 2, `searching an owner name finds both their parcels ("${byOwner.term}")`);

      // ── the contact pane shows their holdings ───────────────────────────
      t.eq(await app.page.evaluate(sid => _parcelsFor(sid).length, contacts[0]), 2,
           'the contact-side lookup returns both parcels');

      // ── deleting a parcel takes its links, not the contacts ─────────────
      const stakesBefore = Number((await t.sql('select count(*) c from pi_stakeholders'))[0].c);
      await app.page.evaluate(async id => {
        window.confirm = () => true;
        await delParcel(id);
      }, p1);
      await app.page.waitForTimeout(1400);
      t.eq(Number((await t.sql('select count(*) c from pi_parcels where project_id::text=$1',
                               [projId]))[0].c), 2, 'the parcel is gone');
      t.eq(Number((await t.sql('select count(*) c from pi_parcel_owners'))[0].c), 1,
           'its ownership links went with it');
      t.eq(Number((await t.sql('select count(*) c from pi_stakeholders'))[0].c), stakesBefore,
           'but the contacts themselves are untouched');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
