// UGRC reconciliation — Polygon Phase 2a (Aug 2026).
//
// Checks a parcel this app already tracks against Utah's statewide county GIS
// records (UGRC's Parcels_Utah layer), one APN at a time. Unlike the map's
// polygon-draw feature, this needs no Google Maps object at all — it is a
// plain fetch — so unlike test 42 it CAN be driven end to end here, including
// the network-failure path.
//
// The one thing this test exists to prove: a failed lookup (a non-200, a
// thrown fetch, an ArcGIS-level error payload) must NEVER be recorded as
// ugrc_matched=false. This app already paid for that exact confusion once,
// in production, when sbGet turned a 401 into an empty array indistinguishable
// from a table with no rows (see the CLAUDE.md note on strict reads). The same
// shape of bug here would tell a consultant a parcel is missing from county
// records when the real story is "could not reach UGRC".
module.exports = {
  name: 'UGRC reconciliation — matched, not-found, and network-failure never look alike',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      const projId = String(proj.id);
      await app.page.evaluate(id => { S.projectFilter = id; setView('parcels'); }, projId);
      await app.page.waitForTimeout(200);

      // Route AFTER t.open() so it registers last and wins over the harness's
      // generic catch-all (which would otherwise answer every UGRC call with
      // an empty {} body — see test/lib/app.js's routing-order comment).
      const calls = [];
      await app.page.route('**/services1.arcgis.com/**', route => {
        const url = new URL(route.request().url());
        const where = url.searchParams.get('where') || '';
        calls.push(where);
        const m = /PARCEL_ID='(\d+)'/.exec(where);
        const apn = m ? m[1] : '';
        if (apn === '120479001' || apn === '120479004') {
          // A genuine match, with a small square of geometry to centroid.
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            features: [{
              attributes: { PARCEL_ID: apn, OWN_TYPE: 'Private', PARCEL_ADD: '900 W Test Ave', PARCEL_CITY: 'Ogden', PARCEL_ZIP: '84404' },
              geometry: { rings: [[[-111.9, 40.5], [-111.9, 40.6], [-111.8, 40.6], [-111.8, 40.5], [-111.9, 40.5]]] },
            }],
          }) });
        }
        if (apn === '120479002') {
          // A genuine answer: the service responded, zero features. Not found.
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: [] }) });
        }
        // apn 120479003 and anything else: simulate the service being down.
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'internal error' }) });
      });

      const addParcel = (num, extra) => app.page.evaluate(async a => {
        openParcelModal();
        document.getElementById('f-pcp').value = a.pid;
        document.getElementById('f-pcn').value = a.num;
        if (a.lat) { document.getElementById('f-pclat').value = a.lat; document.getElementById('f-pclng').value = a.lng; }
        await saveParcel();
      }, Object.assign({ pid: projId, num }, extra || {}));

      await addParcel('12-047-9001'); // will match, no coords on file -> should backfill
      await addParcel('12-047-9002'); // will come back with zero features -> not found
      await addParcel('12-047-9003'); // service will 500 -> must stay untouched
      await addParcel('12-047-9004', { lat: '40.1231', lng: '-111.1231' }); // matches, but already located
      await app.page.waitForTimeout(1200);

      const idFor = async num => String((await t.sql(
        `select id from pi_parcels where project_id::text=$1 and parcel_number=$2`, [projId, num]))[0].id);
      const idA = await idFor('12-047-9001');
      const idB = await idFor('12-047-9002');
      const idC = await idFor('12-047-9003');
      const idD = await idFor('12-047-9004');

      // ── matched, coordinates were blank: backfilled from the centroid ────
      await app.page.evaluate(id => ugrcReconcileOne(id), idA);
      await app.page.waitForTimeout(600);
      let rowA = (await t.sql(`select * from pi_parcels where id=$1`, [idA]))[0];
      t.eq(rowA.ugrc_matched, true, 'matched parcel: ugrc_matched is true');
      t.eq(rowA.ugrc_own_type, 'Private', 'matched parcel: own_type carried through');
      t.ok(rowA.ugrc_checked_at, 'matched parcel: checked_at is set');
      t.eq(rowA.latitude, '40.55', 'blank coordinates were backfilled from the centroid');
      t.eq(rowA.longitude, '-111.85', 'blank coordinates were backfilled from the centroid');

      // ── a genuine not-found: checked_at set, matched is false, not null ──
      await app.page.evaluate(id => ugrcReconcileOne(id), idB);
      await app.page.waitForTimeout(600);
      let rowB = (await t.sql(`select * from pi_parcels where id=$1`, [idB]))[0];
      t.eq(rowB.ugrc_matched, false, 'zero features from a real response is a genuine not-found');
      t.ok(rowB.ugrc_checked_at, 'not-found parcel: checked_at is set (a real answer was received)');

      // ── the failure case this test exists for ────────────────────────────
      await app.page.evaluate(id => ugrcReconcileOne(id), idC);
      await app.page.waitForTimeout(600);
      let rowC = (await t.sql(`select * from pi_parcels where id=$1`, [idC]))[0];
      t.eq(rowC.ugrc_matched, null, 'a 500 from the service must NOT be recorded as "not found"');
      t.eq(rowC.ugrc_checked_at, null, 'a 500 from the service must NOT set checked_at — nothing was actually checked');

      // ── matched, but coordinates already on file: never overwritten ──────
      await app.page.evaluate(id => ugrcReconcileOne(id), idD);
      await app.page.waitForTimeout(600);
      let rowD = (await t.sql(`select * from pi_parcels where id=$1`, [idD]))[0];
      t.eq(rowD.ugrc_matched, true, 'parcel D matched');
      t.eq(rowD.latitude, '40.1231', 'a coordinate already on file is never overwritten by an approximate centroid');
      t.eq(rowD.longitude, '-111.1231', 'a coordinate already on file is never overwritten by an approximate centroid');

      // ── the request actually asked for the normalized, digits-only APN ───
      t.ok(calls.some(w => w.includes("PARCEL_ID='120479001'")), 'the query strips dashes before matching against UGRC');

      // ── the table badge and modal panel reflect state without a reload ──
      const badges = await app.page.evaluate(() => {
        const rows = [...document.querySelectorAll('#main table.dtable tbody tr')];
        return rows.map(r => r.textContent);
      });
      t.ok(badges.some(t2 => t2.includes('UGRC') && t2.includes('Private')), 'a matched row shows the UGRC badge with owner type');
      t.ok(badges.some(t2 => t2.includes('not in UGRC')), 'a not-found row is flagged in the list');

      // ── re-checking a failed one recovers cleanly once the service is up ─
      await app.page.unroute('**/services1.arcgis.com/**');
      await app.page.route('**/services1.arcgis.com/**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          features: [{ attributes: { PARCEL_ID: '120479003', OWN_TYPE: 'Federal' }, geometry: null }],
        }),
      }));
      await app.page.evaluate(id => ugrcReconcileOne(id), idC);
      await app.page.waitForTimeout(600);
      rowC = (await t.sql(`select * from pi_parcels where id=$1`, [idC]))[0];
      t.eq(rowC.ugrc_matched, true, 'a later successful check recovers normally after an earlier failure');
      t.eq(rowC.ugrc_own_type, 'Federal', 'the recovered check records the real answer');

      // The 500 against idC is deliberate (that is the failure this test
      // exists to exercise) and _ugrcReconcileParcel logs it via
      // console.error on purpose — every failure path in this app does, per
      // CLAUDE.md's "console.error paths were kept deliberately" note. Filter
      // just that expected line, same idiom as test 29's refresh-failure test.
      t.eq(app.errors.filter(e => !/UGRC lookup failed/.test(e)), [], 'no unexpected page errors during the run');
    } finally {
      await app.close();
    }
  },
};
