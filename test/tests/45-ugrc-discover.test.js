// UGRC discovery — Polygon Phase 2b (Aug 2026).
//
// The other half of Phase 2: on a drawn polygon, find parcels UGRC has on
// record inside the shape that pi_parcels does not, and offer them for
// REVIEWED import — nothing is created until a human checks a box and
// presses Import. Layers on top of Phase 1's polygon draw (test 42) and
// Phase 2a's reconciliation (test 44).
//
// Like 2a, this is a plain fetch with no Google Maps dependency, so — unlike
// Phase 1's own drawing, which needs a live map object test 42 cannot give it
// — the whole discovery/diff/import path is reachable here end to end.
module.exports = {
  name: 'UGRC discovery — count guard, the untracked diff, and reviewed import',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      const projId = String(proj.id);
      await app.page.evaluate(id => { S.projectFilter = id; setView('parcels'); }, projId);
      await app.page.waitForTimeout(200);

      // A parcel already tracked LOCALLY in dashed format — proves the diff
      // normalizes both sides before comparing, the same rule 2a's matching
      // uses, rather than treating "12-047-1001" and "120471001" as different.
      await app.page.evaluate(async a => {
        openParcelModal();
        document.getElementById('f-pcp').value = a.pid;
        document.getElementById('f-pcn').value = '12-047-1001';
        await saveParcel();
      }, { pid: projId });
      await app.page.waitForTimeout(600);

      const countCalls = [];
      const queryCalls = [];
      let countResponse = { count: 2 };
      let queryFeatures = [
        { attributes: { PARCEL_ID: '120471001', OWN_TYPE: 'Private', PARCEL_ADD: '100 Main St' }, geometry: null }, // already tracked
        { attributes: { PARCEL_ID: '120471002', OWN_TYPE: 'Private', PARCEL_ADD: '200 Main St' },
          geometry: { rings: [[[-111.9, 40.5], [-111.9, 40.6], [-111.8, 40.6], [-111.8, 40.5], [-111.9, 40.5]]] } }, // untracked
      ];
      let countShouldFail = false;
      await app.page.route('**/services1.arcgis.com/**', route => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('returnCountOnly') === 'true') {
          countCalls.push(1);
          if (countShouldFail) return route.fulfill({ status: 500, body: '{}' });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(countResponse) });
        }
        queryCalls.push(1);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: queryFeatures }) });
      });

      const box = [{ lat: 40.5, lng: -111.9 }, { lat: 40.5, lng: -111.8 }, { lat: 40.6, lng: -111.8 }, { lat: 40.6, lng: -111.9 }];

      // ── guard: no project selected — no network call at all ────────────
      const noProj = await app.page.evaluate(async pts => {
        S.projectFilter = '';
        S.mapLayer = 'parcels';
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverUntracked(pts);
        const html = document.getElementById('mv-poly-untracked');
        document.getElementById('mv-poly-panel').remove();
        return html ? html.innerHTML : null;
      }, box);
      t.eq(noProj, null, 'no project selected: discovery does not run at all');
      t.eq(countCalls.length, 0, 'and no UGRC request was made');

      // ── guard: contacts-only layer — no network call ────────────────────
      const contactsOnly = await app.page.evaluate(async (a) => {
        S.projectFilter = a.pid;
        S.mapLayer = 'contacts';
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverUntracked(a.pts);
        const html = document.getElementById('mv-poly-untracked');
        document.getElementById('mv-poly-panel').remove();
        return html ? html.innerHTML : null;
      }, { pid: projId, pts: box });
      t.eq(contactsOnly, null, 'contacts-only layer: discovery does not run');
      t.eq(countCalls.length, 0, 'still no UGRC request — the layer check happens before any fetch');

      // ── the real flow: count under threshold, diff excludes the tracked one ─
      const found = await app.page.evaluate(async (a) => {
        S.projectFilter = a.pid;
        S.mapLayer = 'parcels';
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverUntracked(a.pts);
        const html = document.getElementById('mv-poly-untracked').innerHTML;
        return { html, untracked: window._mvUntracked };
      }, { pid: projId, pts: box });
      t.eq(countCalls.length, 1, 'the count-only pre-check ran first');
      t.eq(queryCalls.length, 1, 'and the full query ran once the count passed');
      t.eq(found.untracked.length, 1, 'the already-tracked parcel (dashed locally, undashed from UGRC) was excluded');
      t.eq(found.untracked[0].apn, '120471002', 'the genuinely untracked parcel is the one offered');
      t.ok(/Untracked parcels/.test(found.html), 'the panel names the section');
      t.ok(/120471002/.test(found.html), 'the untracked APN is listed');
      t.ok(!/120471001/.test(found.html), 'the already-tracked APN is NOT listed');

      // ── import: writes the checked parcel, never the unchecked kind ────
      await app.page.evaluate(() => _mvImportUntracked());
      await app.page.waitForTimeout(600);
      const imported = await t.sql(
        `select * from pi_parcels where project_id::text=$1 and parcel_number='120471002'`, [projId]);
      t.eq(imported.length, 1, 'the untracked parcel was created');
      t.eq(imported[0].situs_address, '200 Main St', 'address carried through from UGRC');
      t.eq(imported[0].ugrc_matched, true, 'imported rows are marked matched — they came FROM a UGRC answer');
      t.eq(imported[0].ugrc_own_type, 'Private', 'own_type carried through');
      t.eq(imported[0].latitude, '40.55', 'centroid coordinates carried through for the geometry-bearing feature');
      t.ok(imported[0].ugrc_checked_at, 'checked_at is set on an imported row');

      const stillOne = await t.sql(
        `select count(*) c from pi_parcels where project_id::text=$1 and parcel_number='12-047-1001'`, [projId]);
      t.eq(Number(stillOne[0].c), 1, 'the already-tracked parcel (stored dashed, as typed) was not duplicated by the import');

      // ── the count-too-high guard refuses before ever running the query ──
      countResponse = { count: 5000 };
      queryCalls.length = 0; countCalls.length = 0;
      const capped = await app.page.evaluate(async (a) => {
        document.getElementById('mv-poly-panel').remove();
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverUntracked(a.pts);
        return document.getElementById('mv-poly-untracked').innerHTML;
      }, { pid: projId, pts: box });
      t.ok(/too many to review/.test(capped), 'an oversized area is refused with an explanation');
      t.eq(queryCalls.length, 0, 'and the full query never ran — the count-only pre-check is what saved the cost');

      // ── a genuine zero: quiet, no clutter ────────────────────────────────
      countResponse = { count: 0 };
      const zero = await app.page.evaluate(async (a) => {
        document.getElementById('mv-poly-panel').remove();
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverUntracked(a.pts);
        return document.getElementById('mv-poly-untracked');
      }, { pid: projId, pts: box });
      t.eq(zero, null, 'zero parcels in the shape: the section is not shown at all');

      // ── network failure never looks like "nothing here" ─────────────────
      countResponse = { count: 2 };
      countShouldFail = true;
      const failed = await app.page.evaluate(async (a) => {
        document.getElementById('mv-poly-panel').remove();
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverUntracked(a.pts);
        return document.getElementById('mv-poly-untracked').innerHTML;
      }, { pid: projId, pts: box });
      t.ok(/Could not reach UGRC/.test(failed), 'a failed count check is reported as a failure, not as "nothing found"');

      // ── _mvDrawFinish actually triggers discovery ────────────────────────
      countShouldFail = false;
      const wired = await app.page.evaluate((pts) => {
        document.getElementById('mv-poly-panel')?.remove();
        window._mvGeocoded = []; window._mvParcelsGeo = [];
        window.showToast = () => {};
        // This box is ~17,000 acres, well over the size-guard threshold —
        // answer the confirm() the same way test 42 does, or _mvDrawFinish
        // cancels the drawing before ever reaching discovery.
        window.confirm = () => true;
        document.getElementById('main').insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:none"></div>');
        let calledWith = null;
        const real = window._mvDiscoverUntracked;
        window._mvDiscoverUntracked = (p) => { calledWith = p; return real(p); };
        window._mvDraw = { path: pts.slice(0, 2), listeners: [] };
        _mvDrawAddVertex(pts[2].lat, pts[2].lng);
        _mvDrawFinish();
        window._mvDiscoverUntracked = real;
        return { calledWith };
      }, box);
      t.ok(Array.isArray(wired.calledWith) && wired.calledWith.length >= 3,
           '_mvDrawFinish calls discovery with the finished path, fire-and-forget');

      t.eq(app.errors.filter(e => !/UGRC/.test(e)), [], 'no unexpected page errors during the run');
    } finally {
      await app.close();
    }
  },
};
