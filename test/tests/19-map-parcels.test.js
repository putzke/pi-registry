// The Map view's parcel layer.
//
// Before it, the Map view plotted stakeholder MAILING addresses and nothing
// else — which for right-of-way work is actively misleading: an absentee owner,
// an LLC or three heirs get their post nowhere near the land being acquired.
// Situs addresses and survey coordinates existed only as text in the parcel
// list and the reports.
//
// Google Maps cannot load in the harness (no network, and the CSP would block
// it anyway), so this covers everything up to the map object: scoping, the
// layer toggle, plottability, the status counts, the legend, and the parcel
// that has no location at all — which must be NAMED rather than silently
// dropped, because on a ROW campaign that is the row somebody has to resolve.
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'map — parcel layer scopes, colours by status, and names what it cannot place',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-3W-DESIGN'`))[0];
      t.ok(proj, 'found the design project');

      const shape = (await t.sql(`
        select count(*)::int total,
               count(*) filter (where coalesce(situs_address,'') <> ''
                                  or coalesce(latitude,'') <> '')::int locatable,
               count(*) filter (where coalesce(situs_address,'') = ''
                                  and coalesce(latitude,'') = '')::int no_loc,
               count(*) filter (where coalesce(situs_address,'') = ''
                                  and coalesce(latitude,'') <> '')::int coords_only
          from pi_parcels where project_id::text = $1`, [String(proj.id)]))[0];
      t.eq(shape.total, 7, 'seven parcels on the project');
      t.eq(shape.locatable, 6, 'six of them can be placed');
      t.eq(shape.no_loc, 1, 'one has neither address nor coordinates');
      t.eq(shape.coords_only, 1, 'one is located by coordinates only');

      const open = layer => app.page.evaluate(([id, l]) => {
        S.mapLayer = l; S.mapFParcSt = ''; S.mapFSearch = '';
        setView('map');
        S.mapLayer = l;              // setView resets mapPicked, not the layer
        mapSelectProject(id);
        const main = document.getElementById('main');
        return {
          status: (main.querySelector('#mv-legend') || {}).previousElementSibling
                    ? main.querySelector('#mv-legend').previousElementSibling.textContent.trim() : '',
          legend: (main.querySelector('#mv-legend') || {}).textContent || '',
          errors: (document.getElementById('mv-errors') || {}).textContent || '',
          hasParcelFilter: !!main.innerHTML.match(/Parcel status/),
          hasSupportFilter: !!main.innerHTML.match(/Support level/),
          parcelsHeld: (window._mvParcels || []).length,
          noLocHeld: (window._mvParcNoLoc || []).length,
          contactsHeld: (window._mvFiltered || []).length,
        };
      }, [String(proj.id), layer]);

      // ── contacts only: unchanged behaviour ─────────────────────────────
      let v = await open('contacts');
      t.eq(v.parcelsHeld, 0, 'the contacts layer plots no parcels');
      t.gt(v.contactsHeld, 0, 'and still plots contacts');
      t.eq(v.hasParcelFilter, false, 'no parcel-status filter on the contacts layer');
      t.ok(v.hasSupportFilter, 'the stakeholder filters are there');
      t.ok(/contacts?/i.test(v.status), `the count is labelled — got "${v.status}"`);

      // ── parcels only ───────────────────────────────────────────────────
      v = await open('parcels');
      t.eq(v.parcelsHeld, 6, 'the parcel layer holds the six placeable parcels');
      t.eq(v.contactsHeld, 0, 'and drops the contacts');
      t.eq(v.noLocHeld, 1, 'the unplaceable parcel is tracked separately');
      t.ok(/6 of 6 parcels/.test(v.status), `status reads the parcel count — got "${v.status}"`);
      t.ok(v.hasParcelFilter, 'the parcel-status filter appears');
      t.eq(v.hasSupportFilter, false, 'stakeholder-only filters are hidden');

      // The parcel with no location is named, before any geocoding happens.
      const missing = (await t.sql(`
        select parcel_number n from pi_parcels
         where project_id::text = $1 and coalesce(situs_address,'')=''
           and coalesce(latitude,'')=''`, [String(proj.id)]))[0].n;
      t.ok(v.errors.includes(missing),
           `the unplaceable parcel is named (${missing}) — got "${v.errors}"`);
      t.ok(/no situs address or coordinates/i.test(v.errors), 'and says why');

      // ── both ───────────────────────────────────────────────────────────
      v = await open('both');
      t.eq(v.parcelsHeld, 6, 'both layers keep the parcels');
      t.gt(v.contactsHeld, 0, 'and the contacts');
      t.ok(/contacts?/.test(v.status) && /parcels?/.test(v.status),
           `status counts both — got "${v.status}"`);
      t.ok(/Champion/.test(v.legend) && /Notice sent/.test(v.legend),
           'the legend explains both marker sets');
      t.ok(/Parcels/.test(v.legend), 'and says which shape is which');

      // ── status filter narrows the layer ────────────────────────────────
      const byStatus = await app.page.evaluate(() => {
        S.mapFParcSt = 'Negotiating';
        renderMapView(document.getElementById('main'));
        return (window._mvParcels || []).map(p => p.status);
      });
      const expect = Number((await t.sql(
        `select count(*) c from pi_parcels where project_id::text=$1 and status='Negotiating'`,
        [String(proj.id)]))[0].c);
      t.eq(byStatus.length, expect, `filtering to Negotiating leaves ${expect}`);
      t.ok(byStatus.every(s => s === 'Negotiating'), 'and only those');

      // ── every status has its own marker colour ─────────────────────────
      // Collapsing the middle statuses into one amber would lose the
      // distinction the map exists to show.
      const colors = await app.page.evaluate(() =>
        PARCEL_STATUSES.map(s => _parcMapColor(s)));
      t.eq(new Set(colors).size, colors.length, 'each parcel status maps to a distinct colour');

      // ── markers are labelled by PARCEL NUMBER ──────────────────────────
      // P1…Pn correlated with nothing: a client holding the parcel register
      // could not tie a square to a row, and the sequence moved whenever a
      // filter changed.
      const icon = await app.page.evaluate(() => {
        // Stand in for the Google Maps types the icon builder needs; the map
        // itself cannot load in the harness.
        window.google = window.google || { maps: {
          Size: function(w,h){ this.w=w; this.h=h; },
          Point: function(x,y){ this.x=x; this.y=y; } } };
        const p = (_syncCache.parcels || []).find(x => x.parcelNumber);
        const ic = _mvParcIcon(p);
        return { num: p.parcelNumber, status: p.status,
                 svg: decodeURIComponent(ic.url.replace(/^data:image\/svg\+xml;charset=UTF-8,/, '')),
                 anchored: !!ic.anchor };
      });
      t.ok(icon.svg.includes(icon.num),
           `the marker draws the parcel number (${icon.num})`);
      t.eq(/P\d+<\/text>/.test(icon.svg), false, 'and no longer a P-sequence');
      t.ok(icon.svg.includes(await app.page.evaluate(s => _parcMapColor(s), icon.status)),
           'in the status colour');
      t.ok(icon.anchored, 'anchored so the square sits on the coordinate');

      // ── parcels sharing a geocoded point are spread, not stacked ───────
      // A street or ZIP centroid can swallow several addresses; stacked
      // markers hide each other, so the count says six and three are visible.
      const spread = await app.page.evaluate(() => {
        const items = [{lat: 41.2, lng: -112.0}, {lat: 41.2, lng: -112.0},
                       {lat: 41.2, lng: -112.0}, {lat: 41.3, lng: -112.1}];
        const n = _mvSpread(items);
        const keys = new Set(items.map(i => i.lat.toFixed(5) + ',' + i.lng.toFixed(5)));
        return { nudged: n, distinct: keys.size, flagged: items.filter(i => i.nudged).length,
                 untouched: items[3].lat === 41.3 && items[3].lng === -112.1 };
      });
      t.eq(spread.nudged, 3, 'three co-located markers were moved');
      t.eq(spread.distinct, 4, 'every marker ends on its own point');
      t.eq(spread.flagged, 3, 'and each moved one is flagged as approximate');
      t.ok(spread.untouched, 'a marker with no neighbour is left exactly where it was');

      // ── the printed map keys correlate with the printed table ──────────
      const keys = await app.page.evaluate(() => [0,8,9,10].map(i => _mvPrintKey(i)));
      t.eq(keys, ['1','9','A','B'],
           'Static Maps single-character labels run 1-9 then A-Z');

      // Coordinates must never cost a geocode — that is the whole reason they
      // are stored, and the only locator an unsubdivided parcel has.
      const coordsOnly = await app.page.evaluate(() => {
        const p = (_syncCache.parcels || []).find(x => !x.situsAddress && x.latitude && x.longitude);
        return p ? { has: _parcHasLoc(p), num: p.parcelNumber } : null;
      });
      t.ok(coordsOnly && coordsOnly.has, 'a coordinates-only parcel is placeable');

      // ── info windows must set their own text colour ────────────────────
      // A Google InfoWindow renders into the page DOM, so the app's dark-theme
      // white text is inherited onto its white background and any run of text
      // without an explicit colour disappears. It hit the parcel owner names
      // first; every one of these popups had the same hole.
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
      const wrappers = src.match(/font-family:sans-serif;font-size:13px[^"]*/g) || [];
      t.gt(wrappers.length, 3, 'found the info-window content wrappers');
      t.eq(wrappers.filter(w => !/;color:/.test(w)), [],
           'every info-window wrapper sets an explicit text colour');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
