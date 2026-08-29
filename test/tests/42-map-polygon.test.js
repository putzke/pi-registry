// Polygon query, Phase 1: draw a shape on the map, get every plotted
// stakeholder and parcel inside it.
//
// A corridor influence area, a neighbourhood, or a ROW acquisition strip is a
// SHAPE, and no list filter can express one. For an EJ analysis it answers "who
// inside this impact zone is flagged LEP or underserved" in a single gesture,
// which is why the panel calls those out rather than leaving them to be counted
// by eye.
//
// Google Maps cannot load in the harness, so the DRAWING itself is untestable
// here. That is exactly why _polyContains and _polyAreaAcres are hand-written
// rather than taken from google.maps.geometry: the whole query path — the maths,
// the layer scoping, the equity counts, the panel, and the hand-off to the
// contacts list — is reachable without a map object. Only the DrawingManager
// shell is not.
module.exports = {
  name: 'map polygon — point-in-polygon, area, and the hand-off to contacts',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // ── containment ──────────────────────────────────────────────────────
      const geom = await app.page.evaluate(() => {
        // A unit square around (0,0), and a concave "C" where a naive
        // bounding-box test would wrongly claim the notch.
        const sq = [{lat:0,lng:0},{lat:0,lng:1},{lat:1,lng:1},{lat:1,lng:0}];
        const cee = [{lat:0,lng:0},{lat:0,lng:3},{lat:1,lng:3},{lat:1,lng:1},
                     {lat:2,lng:1},{lat:2,lng:3},{lat:3,lng:3},{lat:3,lng:0}];
        return {
          middle:   _polyContains(sq, 0.5, 0.5),
          outsideN: _polyContains(sq, 1.5, 0.5),
          outsideE: _polyContains(sq, 0.5, 1.5),
          farAway:  _polyContains(sq, 40.7, -111.9),
          notch:    _polyContains(cee, 1.5, 2.0),   // inside the bounding box…
          arm:      _polyContains(cee, 0.5, 2.0),   // …but this arm is solid
          twoPts:   _polyContains([{lat:0,lng:0},{lat:1,lng:1}], 0.5, 0.5),
          nullPath: _polyContains(null, 0.5, 0.5),
        };
      });
      t.eq(geom.middle, true, 'a point inside the square is inside');
      t.eq(geom.outsideN, false, 'one north of it is not');
      t.eq(geom.outsideE, false, 'nor one east of it');
      t.eq(geom.farAway, false, 'nor one in Utah');
      t.eq(geom.notch, false,
           'a point in a CONCAVE notch is outside — a bounding box would say inside');
      t.eq(geom.arm, true, 'while the solid arm beside it is inside');
      t.eq(geom.twoPts, false, 'two points are not a polygon');
      t.eq(geom.nullPath, false, 'and no path is not a polygon');

      // ── area ─────────────────────────────────────────────────────────────
      // A degree of latitude is ~111.32 km, so a 0.01° x 0.01° box near the
      // equator is ~1.2393 km^2 ~= 306 acres. Checked loosely: the number only
      // has to be right enough to gate the size warning.
      const area = await app.page.evaluate(() => ({
        box: _polyAreaAcres([{lat:0,lng:0},{lat:0,lng:0.01},{lat:0.01,lng:0.01},{lat:0.01,lng:0}]),
        // Wound the other way — orientation must not flip the sign.
        rev: _polyAreaAcres([{lat:0.01,lng:0},{lat:0.01,lng:0.01},{lat:0,lng:0.01},{lat:0,lng:0}]),
        degenerate: _polyAreaAcres([{lat:0,lng:0},{lat:0,lng:1}]),
        warnAt: POLY_AREA_WARN_ACRES,
      }));
      t.ok(area.box > 290 && area.box < 320, `a 0.01° box is ${area.box.toFixed(0)} acres (~306 expected)`);
      t.ok(Math.abs(area.box - area.rev) < 0.01, 'winding direction does not change the area');
      t.eq(area.degenerate, 0, 'a degenerate path has no area');
      t.ok(area.warnAt > 0, `and there is a size guard at ${area.warnAt} acres`);

      // ── the query, against what is actually plotted ──────────────────────
      const q = await app.page.evaluate(() => {
        // Stand in for a geocoded map. Two contacts inside a small box, one far
        // outside; one parcel inside, one outside.
        window._mvGeocoded = [
          { lat: 41.10, lng: -112.00, s:{ id:'s1', firstName:'In', lastName:'Side', lep:true },  lk:{support:'Champion'} },
          { lat: 41.11, lng: -112.01, s:{ id:'s2', firstName:'Also', lastName:'In', underserved:true }, lk:{support:'Opponent'} },
          { lat: 40.00, lng: -111.00, s:{ id:'s3', firstName:'Far', lastName:'Away' }, lk:{support:'Neutral'} },
        ];
        window._mvParcelsGeo = [
          { lat: 41.105, lng: -112.005, parcelNumber:'15-042-0031', status:'Notice sent', situsAddress:'4125 W' },
          { lat: 39.500, lng: -111.500, parcelNumber:'99-999-9999', status:'Not started' },
        ];
        const box = [{lat:41.08,lng:-112.05},{lat:41.08,lng:-111.95},
                     {lat:41.15,lng:-111.95},{lat:41.15,lng:-112.05}];
        const out = {};
        S.mapLayer = 'both';    out.both     = _mvPolyQuery(box);
        S.mapLayer = 'contacts';out.contacts = _mvPolyQuery(box);
        S.mapLayer = 'parcels'; out.parcels  = _mvPolyQuery(box);
        S.mapLayer = 'both';
        return {
          both:     { s: out.both.stakeholders.map(g=>g.s.id), p: out.both.parcels.length,
                      acres: out.both.acres },
          contacts: { s: out.contacts.stakeholders.length, p: out.contacts.parcels.length },
          parcels:  { s: out.parcels.stakeholders.length,  p: out.parcels.parcels.length },
        };
      });
      t.eq(q.both.s, ['s1','s2'], 'the two contacts inside the box are returned');
      t.eq(q.both.p, 1, 'and the one parcel inside it');
      t.ok(q.both.acres > 0, `with the shape's acreage (${Math.round(q.both.acres).toLocaleString()})`);

      // The query must respect the layer toggle, or it returns parcels on a
      // screen showing only contacts.
      t.eq(q.contacts.p, 0, 'the contacts layer returns no parcels');
      t.gt(q.contacts.s, 0, 'but still returns contacts');
      t.eq(q.parcels.s, 0, 'and the parcels layer returns no contacts');
      t.gt(q.parcels.p, 0, 'but still returns parcels');

      // ── the panel ────────────────────────────────────────────────────────
      const panel = await app.page.evaluate(() => {
        const box = [{lat:41.08,lng:-112.05},{lat:41.08,lng:-111.95},
                     {lat:41.15,lng:-111.95},{lat:41.15,lng:-112.05}];
        S.mapLayer = 'both';
        const res = _mvPolyQuery(box);
        const html = _mvPolyPanelHTML(res);
        const empty = _mvPolyPanelHTML({ acres: 12, stakeholders: [], parcels: [] });
        return { html, empty };
      });
      t.ok(/2<\/strong> stakeholders/.test(panel.html), 'the panel counts the stakeholders');
      t.ok(/1<\/strong> parcel\b/.test(panel.html), 'and the parcels');
      t.ok(/acres/.test(panel.html), 'and states the acreage');
      t.ok(/Side/.test(panel.html) && /15-042-0031/.test(panel.html),
           'and lists them by name and parcel number');
      t.eq(/Far/.test(panel.html), false, 'while the contact outside is absent');

      // The EJ question is the one a drawn boundary exists to answer.
      t.ok(/1 EJ/.test(panel.html), 'equity flags are called out — EJ');
      t.ok(/1 LEP/.test(panel.html), 'and LEP');

      t.ok(/View in contacts list/.test(panel.html), 'it offers the hand-off');
      t.eq(/View in contacts list/.test(panel.empty), false,
           'but not when nothing matched');
      t.ok(/Nothing plotted falls inside/.test(panel.empty),
           'an empty result says so plainly');
      t.ok(/could not place/.test(panel.empty),
           'and notes that unplaceable records are not searched — a shape can '
           + 'only claim what it can locate');

      // ── the hand-off to the contacts list ────────────────────────────────
      const handoff = await app.page.evaluate(() => {
        const box = [{lat:41.08,lng:-112.05},{lat:41.08,lng:-111.95},
                     {lat:41.15,lng:-111.95},{lat:41.15,lng:-112.05}];
        window._mvPolyResult = _mvPolyQuery(box);
        _mvPolyToContacts();
        return { view: S.view, ids: S.polyIds, acres: S.polyAcres,
                 banner: /inside the area drawn on the map/.test(
                   document.getElementById('main').innerHTML) };
      });
      t.eq(handoff.view, 'stakeholders', 'it switches to the contacts list');
      t.eq(handoff.ids, ['s1','s2'], 'carrying the matched ids');
      t.ok(handoff.acres > 0, 'and the acreage');
      t.ok(handoff.banner,
           'and the list SAYS it is filtered — setView does not clear polyIds, '
           + 'so an invisible filter would follow you around the app');

      // Really narrowed, not merely labelled.
      const narrowed = await app.page.evaluate(() => {
        const all = (() => { S.polyIds = null; setView('stakeholders');
          return document.querySelectorAll('#main .lrow').length; })();
        // Two real seeded contacts, so the filter has something to keep.
        const real = DB.get('stakeholders').slice(0, 2).map(s => String(s.id));
        S.polyIds = real; S.polyAcres = 40; setView('stakeholders');
        const few = document.querySelectorAll('#main .lrow').length;
        return { all, few };
      });
      t.gt(narrowed.all, narrowed.few,
           `the list really is narrowed (${narrowed.few} of ${narrowed.all})`);
      t.ok(narrowed.few > 0, 'and is not empty');

      const cleared = await app.page.evaluate(() => {
        _mvClearPolyFilter();
        return { ids: S.polyIds, rows: document.querySelectorAll('#main .lrow').length,
                 banner: /inside the area drawn on the map/.test(
                   document.getElementById('main').innerHTML) };
      });
      t.eq(cleared.ids, null, 'Clear removes the filter');
      t.eq(cleared.banner, false, 'and the banner with it');
      t.eq(cleared.rows, narrowed.all, 'restoring the full list');

      // ── the drawing shell degrades honestly ──────────────────────────────
      // google.maps is absent here, which is the same state as a user whose map
      // has not finished loading. It must say so, not throw.
      const noMaps = await app.page.evaluate(() => {
        const toasts = []; const real = window.showToast;
        window.showToast = (m, k) => toasts.push(String(m));
        let threw = null;
        try { _mvDrawPoly(); } catch (e) { threw = e.message; }
        window.showToast = real;
        return { threw, toasts };
      });
      t.eq(noMaps.threw, null, 'drawing before the map is ready does not throw');
      t.ok(noMaps.toasts.some(m => /not loaded|Plot the map/i.test(m)),
           'it explains why instead');

      // ── google.maps.drawing is NOT used ──────────────────────────────────
      // The Drawing library was deprecated in Aug 2025 and REMOVED in Maps JS
      // v3.65 (June 2026). We pin no version, so the weekly channel took it
      // away and "Draw area" threw in the live app. Nothing may depend on it
      // again: the geometry was already ours, and now the drawing is too.
      const src = await app.page.evaluate(() => ({
        loader: String(loadGoogleMaps),
        draw: [_mvDrawPoly, _mvDrawFinish, _mvDrawAddVertex, _mvDrawPreview]
                .map(String).join('\n'),
      }));
      t.eq(/DrawingManager/.test(src.draw), false,
           'no DrawingManager — it was REMOVED from the Maps API, not deprecated');
      t.eq(/maps\.drawing|libraries=[^&`'"]*drawing/.test(src.draw + src.loader), false,
           'and the drawing library is not requested or referenced at all');
      t.ok(/libraries=[^&`'"]*places/.test(src.loader),
           'places stays — the address autocomplete needs it');
      t.ok(/google\.maps\.Polygon/.test(src.draw),
           'the shape is drawn with core google.maps.Polygon, which is supported');

      // ── a whole drawing, without a map ───────────────────────────────────
      // This is what the rewrite bought: the vertex state machine is ours, so
      // the harness can drive a complete drawing even though Maps cannot load.
      // Only the click-event wiring is now beyond reach.
      const drawn = await app.page.evaluate(() => {
        window._mvGeocoded = [
          { lat: 41.10, lng: -112.00, s:{ id:'s1', firstName:'In', lastName:'Side' }, lk:{support:'Champion'} },
          { lat: 40.00, lng: -111.00, s:{ id:'s3', firstName:'Far', lastName:'Away' }, lk:{support:'Neutral'} },
        ];
        window._mvParcelsGeo = [];
        S.mapLayer = 'contacts';
        window.showToast = () => {};
        // This box is ~16,000 acres, so the size guard asks first. Answer yes
        // here; the refusal path is asserted below.
        const asked = []; window.confirm = m => { asked.push(String(m)); return true; };
        window._polyAsked = asked;
        document.getElementById('main').insertAdjacentHTML('beforeend',
          '<div id="mv-poly-panel" style="display:none"></div>');
        const panel = () => document.getElementById('mv-poly-panel');

        // Enter the state machine directly, the way the map's click listener
        // would. _mvDrawPoly itself needs a map object and correctly refuses
        // without one, which is asserted separately above.
        window._mvDraw = { path: [], listeners: [] };
        const hint0 = (_mvDrawHint(), panel().innerHTML);
        _mvDrawAddVertex(41.08, -112.05);
        const hint1 = panel().innerHTML;
        _mvDrawAddVertex(41.08, -111.95);
        const tooFew = _mvDrawFinish();      // 2 corners is not a polygon
        _mvDrawAddVertex(41.15, -111.95);
        _mvDrawAddVertex(41.15, -112.05);
        const hint4 = panel().innerHTML;
        const res = _mvDrawFinish();
        return {
          hint0, hint1, hint4, tooFew,
          ids: res ? res.stakeholders.map(g => g.s.id) : null,
          panelAfter: panel().innerHTML,
          stateCleared: window._mvDraw === null,
        };
      });
      t.ok(/Click the map/.test(drawn.hint0), 'an empty shape says what to do');
      t.ok(/1<\/strong> corner\b/.test(drawn.hint1), 'it counts corners as they land');
      t.ok(/at least 3/.test(drawn.hint1), 'and says 3 are needed');
      t.eq(drawn.tooFew, null, 'finishing with 2 corners does nothing — not a polygon');
      t.ok(/acres/.test(drawn.hint4), 'once closed-able it reports the acreage live');
      t.eq(drawn.ids, ['s1'],
           'and finishing runs the query — the contact inside, not the one outside');
      t.ok(/Inside the drawn area/.test(drawn.panelAfter),
           'the hint is replaced by the results panel');
      t.ok(drawn.stateCleared, 'and the drawing state is torn down');

      // The size guard asks before answering an enormous shape, and taking NO
      // for an answer means abandoning the drawing, not querying it anyway.
      const guard = await app.page.evaluate(() => {
        const asked = window._polyAsked || [];
        window.confirm = () => false;
        window._mvDraw = { path: [
          {lat:41.08,lng:-112.05},{lat:41.08,lng:-111.95},
          {lat:41.15,lng:-111.95},{lat:41.15,lng:-112.05}] };
        const res = _mvDrawFinish();
        return { asked, res, cleared: window._mvDraw === null,
                 hidden: document.getElementById('mv-poly-panel').style.display };
      });
      t.gt(guard.asked.length, 0, 'a shape over the acre limit asks before querying');
      t.ok(/acres/.test(guard.asked[0] || ''), 'and says how big it is');
      t.eq(guard.res, null, 'declining does not run the query');
      t.ok(guard.cleared, 'and the drawing is abandoned rather than left half-open');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
