// The Map view withheld the map object entirely when a project had nothing
// plottable yet (no geocoded contacts, no located parcels) — three separate
// early returns, all before a Google Map was ever constructed:
//   1. renderMapView returned before calling loadGoogleMaps()/_mvGeocode() at
//      all, when withAddr.length===0 && parcPlot.length===0.
//   2. _mvGeocode's own "nothing could be located" guard returned before ever
//      calling _mvRenderMarkers, once geocoding (of nothing) finished.
//   3. _mvRenderMarkers itself bailed with `if (!anchor) return` — no first
//      plotted point, no map, full stop.
// The practical consequence, reported live: a brand-new project with zero
// contacts/parcels showed a blank dark box instead of a map, and "Draw area"
// — the one control that would let you discover parcels or contacts from a
// drawn shape in the first place — failed with "Plot the map first," a dead
// end for exactly the workflow it exists to support.
//
// Fixed by falling back to a statewide Utah view (UTAH_MAP_CENTER, zoom 7)
// instead of returning at any of the three points — every project in this
// app is UDOT/Utah county work, so that is a genuinely useful default, not
// just "not blank."
//
// Google Maps cannot load in the harness (see the map-parcels test's own
// note), so this stubs window.google.maps completely, the same way, and
// verifies the CONTROL FLOW — that each function actually reaches the point
// of constructing a map / calling the next function — rather than anything
// about real map rendering.
module.exports = {
  name: 'map — a project with nothing plottable still gets a live map, not a blank box',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      const projId = String(proj.id);

      // Fully stub google.maps, same shape test 19 uses, plus a way to
      // capture what the Map constructor was actually built with.
      await app.page.evaluate(() => {
        const noop = function () {};
        window._mvMapCalls = [];
        window.google = { maps: {
          Size:  function (w, h) { this.w = w; this.h = h; },
          Point: function (x, y) { this.x = x; this.y = y; },
          Geocoder: function () { this.geocode = (req, cb) => cb([], 'ZERO_RESULTS'); },
          Map: function (el, opts) { window._mvMapCalls.push(opts);
                                      this.getDiv = () => el; this.fitBounds = noop; this.setCenter = noop; },
          Marker: function () { this.setMap = noop; this.addListener = noop; },
          InfoWindow: function () { this.setContent = noop; this.open = noop; },
          LatLngBounds: function () { this.extend = noop; },
          SymbolPath: { CIRCLE: 0 },
        } };
      });

      // ── an empty project: zero stakeholders, zero parcels ───────────────
      const empty = await app.page.evaluate((pid) => {
        S.projectFilter = pid;
        _syncCache.stakeholders = [];
        _syncCache.project_stakeholders = [];
        _syncCache.parcels = [];
        S.mapLayer = 'parcels'; S.mapFParcSt = ''; S.mapFSearch = '';
        let loadCalled = false;
        const realLoad = window.loadGoogleMaps;
        window.loadGoogleMaps = function () { loadCalled = true; };
        setView('map');
        S.mapLayer = 'parcels'; // setView resets mapPicked, not the layer
        mapSelectProject(pid);
        window.loadGoogleMaps = realLoad;
        return {
          loadCalled,
          loadingText: (document.getElementById('mv-loading') || {}).textContent || '',
          mapElExists: !!document.getElementById('mv-map'),
        };
      }, projId);
      t.ok(empty.mapElExists, 'the map container still renders');
      t.ok(empty.loadCalled, 'loadGoogleMaps() is called even with nothing plottable — renderMapView no longer returns before it');
      t.ok(/No parcels on this project yet/.test(empty.loadingText),
           `the empty-project message still shows (got "${empty.loadingText}")`);

      // ── _mvGeocode's own inner guard: reaches _mvRenderMarkers, and does
      // NOT overwrite the accurate "no parcels yet" message with a generic
      // geocode-failure one when nothing was actually attempted ───────────
      const geocodeEmpty = await app.page.evaluate(async () => {
        window._googleMapsReady = true;
        window._mvMap = null;
        window._mvMapCalls.length = 0;
        document.getElementById('mv-loading').textContent = 'No parcels on this project yet.';
        await _mvGeocode([], S.projectFilter, []);
        return {
          mapCreated: !!window._mvMap,
          calls: window._mvMapCalls.length,
          loadingText: document.getElementById('mv-loading').textContent,
          center: window._mvMapCalls[0] && window._mvMapCalls[0].center,
          zoom: window._mvMapCalls[0] && window._mvMapCalls[0].zoom,
        };
      });
      t.ok(geocodeEmpty.mapCreated, '_mvGeocode with nothing to geocode still constructs a map object');
      t.eq(geocodeEmpty.calls, 1, 'exactly one Map construction');
      t.ok(/No parcels on this project yet/.test(geocodeEmpty.loadingText),
           'the accurate empty-project message survives — not overwritten with a geocode-failure wording');
      t.ok(geocodeEmpty.center && Math.abs(geocodeEmpty.center.lat - 39.3) < 0.01 && Math.abs(geocodeEmpty.center.lng - -111.6) < 0.01,
           `falls back to the Utah statewide center (got ${JSON.stringify(geocodeEmpty.center)})`);
      t.eq(geocodeEmpty.zoom, 7, 'and a statewide zoom, not a neighborhood-level one, since there is no real anchor');

      // ── contrast: something WAS attempted and genuinely failed to locate —
      // that case keeps its own, different, accurate message ───────────────
      const geocodeFailed = await app.page.evaluate(async () => {
        window._mvMap = null;
        window._mvMapCalls.length = 0;
        document.getElementById('mv-loading').textContent = '';
        const fakeParcel = { id: 'fixp1', projectId: S.projectFilter, situsAddress: '1 Nowhere Ave', latitude: '', longitude: '' };
        await _mvGeocode([], S.projectFilter, [fakeParcel]);
        return { loadingText: document.getElementById('mv-loading').textContent, mapCreated: !!window._mvMap };
      });
      t.ok(geocodeFailed.mapCreated, 'a real (failed) attempt still leaves a map object in place');
      t.ok(/Nothing could be located/.test(geocodeFailed.loadingText),
           `a genuine geocode failure keeps its own accurate wording (got "${geocodeFailed.loadingText}")`);

      // ── _mvRenderMarkers directly: has-anchor path is unaffected (zoom 11) ─
      const withAnchor = await app.page.evaluate(() => {
        window._mvMap = null;
        window._mvMapCalls.length = 0;
        const g = { s: { id: 's1', firstName: 'A', lastName: 'B', type: 'Resident' }, lk: {}, lat: 40.7, lng: -111.9, formatted: '' };
        _mvRenderMarkers([g], []);
        return { center: window._mvMapCalls[0].center, zoom: window._mvMapCalls[0].zoom };
      });
      t.eq(withAnchor.zoom, 11, 'a real plotted point still zooms in close — the fallback never widens an ordinary map');
      t.eq(withAnchor.center, { lat: 40.7, lng: -111.9 }, 'and centers on the real anchor, not Utah');

      // ── Draw area no longer dead-ends on an empty project ────────────────
      // _mvDrawPoly's own guard is `if (!window._mvMap) { toast 'Plot the map
      // first.'; return; }` — exercising the full drawing session needs a much
      // larger Maps stub (Polyline, event.addListener/removeListener, etc.)
      // not worth the fragility here; the precondition that guard checks is
      // the whole point of this fix, so assert that directly.
      const hasMap = await app.page.evaluate(() => !!window._mvMap);
      t.ok(hasMap, 'window._mvMap exists on an empty project — the exact condition Draw area was failing on ("Plot the map first")');

      // ── Google refusing the key says so instead of staying blank ─────────
      // Google calls window.gm_authFailure when the page's address is not in
      // the key's website restrictions (hit live on the move to
      // app.cirruscc.com: the map stayed an empty box).
      const refused = await app.page.evaluate(() => {
        window.gm_authFailure();
        return document.getElementById('mv-loading').textContent;
      });
      t.ok(/Google Maps refused this address/.test(refused) && /website restrictions/.test(refused),
           'a refused Maps key names the cause and the fix where the map would be');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
