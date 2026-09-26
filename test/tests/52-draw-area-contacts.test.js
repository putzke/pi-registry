// Draw-area placeholder contacts (Sep 2026). A small in-person canvass (a
// consultant walking a block of property owners) knows the situs address of
// each house before it knows who lives or owns there. "New contacts — draw
// area" sits beside the existing "Untracked parcels — UGRC" section (test 45)
// in the same polygon results panel, reads the same UtahStatewideParcels
// layer for situs addresses, but writes ordinary CONTACTS
// (pi_stakeholders + pi_project_stakeholders) — never a pi_parcels row. This
// is contact creation, not ROW/acquisition tracking, and deliberately stays
// out of the Parcels module (see the CLAUDE.md note on this feature).
//
// Like Phase 2b's discovery, this is a plain fetch with no Google Maps
// dependency, so the whole discover/diff/create path is reachable here.
module.exports = {
  name: 'draw-area contacts — candidate diff, the 10-per-capture cap, and reviewed creation',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      const projId = String(proj.id);
      await app.page.evaluate(id => { S.projectFilter = id; setView('map'); }, projId);
      await app.page.waitForTimeout(200);

      const countCalls = [];
      const queryCalls = [];
      let countResponse = { count: 2 };
      let queryFeatures = [
        { attributes: { PARCEL_ID: '100000001', OWN_TYPE: 'Private', PARCEL_ADD: '100 Testcase Ave', PARCEL_CITY: 'Ogden', PARCEL_ZIP: '84404' }, geometry: null },
        { attributes: { PARCEL_ID: '100000002', OWN_TYPE: 'Private', PARCEL_ADD: '200 Testcase Ave', PARCEL_CITY: 'Ogden', PARCEL_ZIP: '84404' }, geometry: null },
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
        S.mapLayer = 'both';
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverContacts(pts);
        const html = document.getElementById('mv-poly-contacts');
        document.getElementById('mv-poly-panel').remove();
        return html ? html.innerHTML : null;
      }, box);
      t.eq(noProj, null, 'no project selected: discovery does not run at all');
      t.eq(countCalls.length, 0, 'and no UGRC request was made');

      // ── guard: parcels-only layer — no network call ─────────────────────
      const parcelsOnly = await app.page.evaluate(async a => {
        S.projectFilter = a.pid;
        S.mapLayer = 'parcels';
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverContacts(a.pts);
        const html = document.getElementById('mv-poly-contacts');
        document.getElementById('mv-poly-panel').remove();
        return html ? html.innerHTML : null;
      }, { pid: projId, pts: box });
      t.eq(parcelsOnly, null, 'parcels-only layer: contact discovery does not run — the inverse of the untracked-parcels rule');
      t.eq(countCalls.length, 0, 'still no UGRC request — the layer check happens before any fetch');

      // ── the real flow: an address with an existing contact is excluded ──
      const found = await app.page.evaluate(async (a) => {
        S.projectFilter = a.pid;
        S.mapLayer = 'both';
        // A controlled fixture: exactly one project contact, at the SAME
        // street address as one of the two UGRC features (different
        // city/zip formatting on purpose — the diff matches on the street
        // line only).
        _syncCache.stakeholders = [{ id: 'fix1', firstName: 'Jane', lastName: 'Doe', address: '100 Testcase Ave, Ogden, UT 84404, USA', isMaster: false }];
        _syncCache.project_stakeholders = [{ id: 'fixps1', projectId: a.pid, stakeholderId: 'fix1' }];
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverContacts(a.pts);
        const html = document.getElementById('mv-poly-contacts').innerHTML;
        return { html, candidates: window._mvContactCandidates };
      }, { pid: projId, pts: box });
      t.eq(countCalls.length, 1, 'the count-only pre-check ran first');
      t.eq(queryCalls.length, 1, 'and the full query ran once the count passed');
      t.eq(found.candidates.length, 1, 'the address with an existing contact was excluded');
      t.ok(/200 Testcase Ave/.test(found.candidates[0].address), 'the genuinely uncontacted address is the one offered');
      t.ok(/New contacts . draw area/.test(found.html), 'the panel names the section');
      t.ok(/200 Testcase Ave/.test(found.html), 'the candidate address is listed');
      t.ok(!/100 Testcase Ave/.test(found.html), 'the address with an existing contact is NOT listed');
      t.ok(/up to 10 per capture/.test(found.html), 'the panel states the per-capture cap');

      // ── check all / uncheck all ─────────────────────────────────────────
      const toggled = await app.page.evaluate(() => {
        _mvSetAllContacts(false);
        const allUnchecked = [...document.querySelectorAll('.mv-contact-cb')].every(cb => !cb.checked);
        _mvSetAllContacts(true);
        const allChecked = [...document.querySelectorAll('.mv-contact-cb')].every(cb => cb.checked);
        return { allUnchecked, allChecked };
      });
      t.ok(toggled.allUnchecked, '"Uncheck all" clears every box');
      t.ok(toggled.allChecked, '"Check all" re-checks every box');

      // ── the 10-per-capture cap: 12 candidates, only 10 offered ──────────
      queryFeatures = Array.from({ length: 12 }, (_, i) => ({
        attributes: { PARCEL_ID: '2000000' + String(i).padStart(2, '0'), OWN_TYPE: 'Private', PARCEL_ADD: (300 + i) + ' Testcase Ave', PARCEL_CITY: 'Ogden', PARCEL_ZIP: '84404' },
        geometry: null,
      }));
      countResponse = { count: 12 };
      const capped = await app.page.evaluate(async (a) => {
        _syncCache.stakeholders = [];
        _syncCache.project_stakeholders = [];
        document.getElementById('mv-poly-panel').remove();
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverContacts(a.pts);
        return { html: document.getElementById('mv-poly-contacts').innerHTML, n: window._mvContactCandidates.length };
      }, { pid: projId, pts: box });
      t.eq(capped.n, 10, 'the checklist itself is capped at 10 candidates');
      t.ok(/Showing the first 10/.test(capped.html), 'and the panel says so, pointing at drawing a smaller area');

      // ── over-threshold count: refused before the full query ever runs ──
      countResponse = { count: 5000 };
      queryCalls.length = 0;
      const overLimit = await app.page.evaluate(async (a) => {
        document.getElementById('mv-poly-panel').remove();
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverContacts(a.pts);
        return document.getElementById('mv-poly-contacts').innerHTML;
      }, { pid: projId, pts: box });
      t.ok(/too many to review/.test(overLimit), 'an oversized area is refused with an explanation');
      t.eq(queryCalls.length, 0, 'the full query never ran — the count-only pre-check saved the cost');

      // ── a genuine zero: quiet, no clutter ────────────────────────────────
      countResponse = { count: 0 };
      const zero = await app.page.evaluate(async (a) => {
        document.getElementById('mv-poly-panel').remove();
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverContacts(a.pts);
        return document.getElementById('mv-poly-contacts');
      }, { pid: projId, pts: box });
      t.eq(zero, null, 'zero parcels in the shape: the section is not shown at all');

      // ── network failure never looks like "nothing found" ────────────────
      countResponse = { count: 2 };
      countShouldFail = true;
      const failed = await app.page.evaluate(async (a) => {
        document.getElementById('mv-poly-panel').remove();
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverContacts(a.pts);
        return document.getElementById('mv-poly-contacts').innerHTML;
      }, { pid: projId, pts: box });
      t.ok(/Could not reach UGRC/.test(failed), 'a failed count check is reported as a failure, not as "nothing found"');
      countShouldFail = false;

      // ── creation: writes the checked candidates, tagged Needs review ────
      queryFeatures = [
        { attributes: { PARCEL_ID: '300000001', OWN_TYPE: 'Private', PARCEL_ADD: '600 Testcase Ave', PARCEL_CITY: 'Ogden', PARCEL_ZIP: '84404' }, geometry: null },
        { attributes: { PARCEL_ID: '300000002', OWN_TYPE: 'Private', PARCEL_ADD: '700 Testcase Ave', PARCEL_CITY: 'Ogden', PARCEL_ZIP: '84404' }, geometry: null },
      ];
      countResponse = { count: 2 };
      await app.page.evaluate(async (a) => {
        _syncCache.stakeholders = [];
        _syncCache.project_stakeholders = [];
        document.getElementById('mv-poly-panel').remove();
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverContacts(a.pts);
      }, { pid: projId, pts: box });
      await app.page.evaluate(() => _mvCreateContactCandidates());
      await app.page.waitForTimeout(800);

      const firstBatch = await t.sql(`
        select s.first_name, s.last_name, s.address, s.needs_review, s.stakeholder_type, s.is_master
        from pi_stakeholders s
        join pi_project_stakeholders ps on ps.stakeholder_id::text = s.id::text
        where ps.project_id = $1 and s.first_name = 'Property'
        order by s.last_name::int
      `, [projId]);
      t.eq(firstBatch.length, 2, 'both checked candidates were created');
      t.ok(firstBatch.every(r => r.needs_review === true), 'every placeholder is tagged needs_review');
      t.ok(firstBatch.every(r => r.stakeholder_type === 'Property Owner'), 'every placeholder is typed Property Owner');
      t.ok(firstBatch.every(r => r.is_master === false), 'placeholders are project-only, never added to the master registry');
      t.ok(firstBatch.some(r => /600 Testcase Ave/.test(r.address)), 'the situs address carried through into the contact address');
      t.ok(firstBatch.some(r => /700 Testcase Ave/.test(r.address)), 'both addresses carried through');
      const firstNums = firstBatch.map(r => Number(r.last_name)).sort((a, b) => a - b);
      t.eq(firstNums, [1, 2], 'a clean project starts numbering at Property 1');

      // ── numbering continues on a second capture, never restarts ────────
      queryFeatures = [
        { attributes: { PARCEL_ID: '300000003', OWN_TYPE: 'Private', PARCEL_ADD: '800 Testcase Ave', PARCEL_CITY: 'Ogden', PARCEL_ZIP: '84404' }, geometry: null },
      ];
      countResponse = { count: 1 };
      await app.page.evaluate(async (a) => {
        document.getElementById('mv-poly-panel').remove();
        document.body.insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:block"></div>');
        await _mvDiscoverContacts(a.pts);
      }, { pid: projId, pts: box });
      await app.page.evaluate(() => _mvCreateContactCandidates());
      await app.page.waitForTimeout(800);

      const secondBatch = await t.sql(`
        select s.last_name
        from pi_stakeholders s
        join pi_project_stakeholders ps on ps.stakeholder_id::text = s.id::text
        where ps.project_id = $1 and s.first_name = 'Property' and s.address like '%800 Testcase%'
      `, [projId]);
      t.eq(secondBatch.length, 1, 'the second capture created one more placeholder');
      t.eq(Number(secondBatch[0].last_name), 3, 'numbering continued from the first capture (Property 3), not restarted at 1');

      // ── the "Needs review" badge shows in the contact list and detail pane ─
      const badge = await app.page.evaluate(async (a) => {
        cacheClear('stakeholders'); cacheClear('project_stakeholders');
        await loadAllData();
        S.projectFilter = a.pid;
        setView('stakeholders');
        const row = [...document.querySelectorAll('.lrow')].find(r => /Property 1\b/.test(r.textContent));
        if (!row) return { rowFound: false };
        row.click();
        await new Promise(r => setTimeout(r, 50));
        const main = document.getElementById('main').textContent;
        return { rowFound: true, rowHasBadge: /Needs review/.test(row.textContent), detailHasBanner: /situs address, not a confirmed mailing address/.test(main) };
      }, { pid: projId });
      t.ok(badge.rowFound, 'the created placeholder appears in the project contact list');
      t.ok(badge.rowHasBadge, 'its row carries the amber "Needs review" badge instead of a role tag');
      t.ok(badge.detailHasBanner, 'opening it shows the auto-created / situs-address callout banner');

      // ── _mvDrawFinish actually triggers contact discovery ────────────────
      const wired = await app.page.evaluate((a) => {
        setView('map');
        S.projectFilter = a.pid;
        document.getElementById('mv-poly-panel')?.remove();
        window._mvGeocoded = []; window._mvParcelsGeo = [];
        window.showToast = () => {};
        window.confirm = () => true; // this box is well over the acreage warning threshold
        document.getElementById('main').insertAdjacentHTML('beforeend', '<div id="mv-poly-panel" style="display:none"></div>');
        let calledWith = null;
        const real = window._mvDiscoverContacts;
        window._mvDiscoverContacts = (p) => { calledWith = p; return real(p); };
        window._mvDraw = { path: a.pts.slice(0, 2), listeners: [] };
        _mvDrawAddVertex(a.pts[2].lat, a.pts[2].lng);
        _mvDrawFinish();
        window._mvDiscoverContacts = real;
        return { calledWith };
      }, { pts: box, pid: projId });
      t.ok(Array.isArray(wired.calledWith) && wired.calledWith.length >= 3,
           '_mvDrawFinish calls contact discovery with the finished path, fire-and-forget');

      t.eq(app.errors.filter(e => !/UGRC/.test(e)), [], 'no unexpected page errors during the run');
    } finally {
      await app.close();
    }
  },
};
