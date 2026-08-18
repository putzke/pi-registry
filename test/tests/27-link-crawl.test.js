// Walks every view and exercises every link.
//
// Four bugs this session were the same shape: a control that looked fine, threw
// nothing, and quietly did the wrong thing — the contact link that opened the
// list instead of the contact, the Log-interaction pre-fill discarded, the
// Assign-to field naming the reader instead of the owner, list scroll that had
// never worked. Rendering tests cannot see any of that, because the view renders
// perfectly either way.
//
// Two layers, because the click surface is lopsided: ~1,700 clickable elements
// but only ~51 distinct handlers, and 1,218 of those elements are the rows of
// one list.
//
//   1. STATIC, total coverage — every onclick in every view is parsed and every
//      function it names must exist. Catches a renamed or deleted handler across
//      all 1,700 in milliseconds. This is the layer that would have caught a
//      dead link the moment it was introduced.
//   2. BEHAVIOURAL, sampled — one representative element per (view, handler)
//      pair is actually clicked, and the app must not throw, must not blank the
//      screen, and must leave S.view valid.
//
// Writes are stubbed and confirm() answers no, so a crawl cannot delete a demo
// record or fire a real request. That is deliberate: this test is about
// navigation and wiring. What each handler DOES is covered by its own test.
const VIEWS = ['dashboard', 'projects', 'master', 'stakeholders', 'interactions',
               'followups', 'commitments', 'comments', 'deliverables', 'meetings',
               'issues', 'parcels', 'reports', 'settings'];

// Language and browser built-ins that appear inside inline handlers. Anything
// NOT in here and not a function on window is a dead reference.
const BUILTINS = ['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'new', 'delete', 'void', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON',
  'Math', 'Date', 'RegExp', 'Error', 'Promise', 'Set', 'Map', 'parseInt', 'parseFloat',
  'isNaN', 'alert', 'confirm', 'prompt', 'setTimeout', 'setInterval', 'clearTimeout',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'btoa', 'atob',
  'requestAnimationFrame', 'fetch', 'print', 'open', 'eval'];

module.exports = {
  name: 'link crawl — every view, every handler, nothing dead or blank',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      // Where the app lives, captured before any click can move us off it — a
      // reload() would otherwise reload whatever page we landed on.
      const HOME = app.page.url();

      // Make the crawl inert: no writes, no popups, no confirmations, no maps.
      // Re-applied after any recovery reload, which wipes it.
      const arm = () => app.page.evaluate(() => {
        window.__crawl = { toasts: [], alerts: [], opened: [] };
        window.confirm = () => false;             // destructive paths bail out
        window.alert = m => window.__crawl.alerts.push(String(m));
        // Return a window-ish object, NOT null. openImportTool treats null as
        // "popup blocked" and falls back to same-tab navigation — correct
        // behaviour that a null-returning stub turns into a fake bug.
        window.open = u => { window.__crawl.opened.push(String(u));
                             return { closed: false, close() {}, focus() {}, document: {} }; };
        window.print = () => {};
        // An <a href> inside a handler would navigate the whole page away and
        // take the test context with it. Capture-phase, so it runs before the
        // element's own onclick and cannot be cancelled by it.
        document.addEventListener('click', e => {
          const a = e.target && e.target.closest && e.target.closest('a[href]');
          if (a && !/^#/.test(a.getAttribute('href') || '')) {
            window.__crawl.opened.push(a.getAttribute('href'));
            e.preventDefault();
          }
        }, true);
        const realToast = window.showToast;
        window.showToast = (m, k) => { window.__crawl.toasts.push({ m: String(m), k }); };
        window.__realToast = realToast;
        // A write must never leave the browser during a crawl.
        window._sbWrite = async () => ({
          ok: true, status: 200,
          text: async () => '[{"id":999999}]',
          json: async () => [{ id: 999999 }],
        });
        const noop = function () {};
        window.google = { maps: {
          Size: function () {}, Point: function () {},
          Geocoder: function () { this.geocode = (r, cb) => cb([], 'ZERO_RESULTS'); },
          Map: function () { this.getDiv = () => document.createElement('div');
                             this.fitBounds = noop; this.setCenter = noop; },
          Marker: function () { this.setMap = noop; this.addListener = noop; },
          InfoWindow: function () { this.setContent = noop; this.open = noop; },
          LatLngBounds: function () { this.extend = noop; },
          SymbolPath: { CIRCLE: 0 },
        } };
      });
      await arm();

      // ── layer 1: every handler an onclick names must exist ───────────────
      const dead = await app.page.evaluate(([views, builtins]) => {
        const known = new Set(builtins);
        const out = [];
        let scanned = 0;
        for (const v of views) {
          try { setView(v); } catch (e) { out.push({ view: v, name: '(render)', err: e.message }); continue; }
          document.querySelectorAll('#main [onclick]').forEach(el => {
            const raw = el.getAttribute('onclick') || '';
            scanned++;
            // Blank out string literals first. Without this, prose inside a
            // toast — showToast('API key saved (obfuscated)') — reads as a call
            // to a function named `saved`.
            const code = raw
              .replace(/'(\\.|[^'\\])*'/g, "''")
              .replace(/"(\\.|[^"\\])*"/g, '""')
              .replace(/`(\\.|[^`\\])*`/g, '``');
            let m; const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
            while ((m = re.exec(code))) {
              const name = m[2];
              if (known.has(name)) continue;
              if (typeof window[name] === 'function') continue;
              out.push({ view: v, name, snippet: raw.slice(0, 70) });
            }
          });
        }
        return { dead: out, scanned };
      }, [VIEWS, BUILTINS]);

      t.gt(dead.scanned, 500, `scanned the whole click surface (${dead.scanned} elements)`);
      // Deduped: one dead handler can appear on every row of a list, and 15
      // copies of the same line buries the next finding.
      t.eq([...new Set(dead.dead.map(d => `${d.view}: ${d.name}`))], [],
           'every function named in an onclick exists');

      // ── layer 2: click one of each (view, handler) pair ──────────────────
      // Twice per view: unscoped, and scoped to a project. Several controls only
      // exist when a project is selected — Quick log, the register exports, the
      // per-project report buttons — so an unscoped-only crawl never sees them.
      const projId = await app.page.evaluate(() =>
        String((_syncCache.projects.find(p => p.pid === '25-3W-DESIGN') || _syncCache.projects[0]).id));

      const plan = await app.page.evaluate(([views, pid]) => {
        const seen = new Set(), jobs = [];
        for (const scope of ['', pid]) {
          for (const v of views) {
            S.projectFilter = scope;
            try { setView(v); } catch (e) { continue; }
            S.projectFilter = scope;                 // setView clears some state
            try { render(); } catch (e) { continue; }
            [...document.querySelectorAll('#main [onclick]')].forEach(el => {
              const code = el.getAttribute('onclick') || '';
              const m = code.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/);
              const handler = m ? m[1] : null;
              // Identify the element by WHAT IT CALLS, not by its position. An
              // index recorded now is meaningless later: a click can change
              // S.projectFilter, the view re-renders with different controls,
              // and index 3 becomes a different button. That is exactly how the
              // first version of this crawl silently skipped the one handler it
              // was meant to catch.
              const key = v + '|' + scope + '|' + (handler || code.slice(0, 40));
              if (seen.has(key)) return;
              seen.add(key);
              jobs.push({ view: v, scope, handler, code: handler ? null : code });
            });
          }
        }
        return jobs;
      }, [VIEWS, projId]);
      t.gt(plan.length, 60, `planned ${plan.length} distinct clicks across both scopes`);

      const broken = [];
      for (const job of plan) {
        const before = app.errors.length;
        let res;
        try {
          res = await app.page.evaluate(async ({ view, scope, handler, code }) => {
            try { if (typeof closeM === 'function') closeM(); } catch (e) {}
            S.projectFilter = scope;
            setView(view);
            S.projectFilter = scope;
            render();
            const el = [...document.querySelectorAll('#main [onclick]')].find(e => {
              const c = e.getAttribute('onclick') || '';
              return handler ? new RegExp('^\\s*' + handler + '\\s*\\(').test(c)
                             : c === code;
            });
            if (!el) return { skipped: true };
            el.click();
            await new Promise(r => setTimeout(r, 30));
            const main = document.getElementById('main');
            const overlay = document.getElementById('inline-rpt-overlay');
            const modal = document.querySelector('.modal, #modal-overlay');
            return {
              len: main ? main.innerHTML.length : 0,
              view: S.view,
              covered: !!(overlay || (modal && modal.offsetParent !== null)),
            };
          }, job);
        } catch (e) {
          broken.push(`${job.view} → ${job.handler}: navigated away or destroyed the page`);
          await app.page.goto(HOME); await app.ready(); await arm();
          continue;
        }

        // Give the pageerror event time to reach Node before reading it.
        await app.page.waitForTimeout(15);
        const errs = app.errors.slice(before);
        const label = `${job.view}${job.scope ? ' (scoped)' : ''} → ${job.handler || 'inline'}`;
        if (res.skipped) continue;
        if (errs.length) { broken.push(`${label}: ${errs[0].slice(0, 120)}`); continue; }
        if (!res.covered && res.len < 200) {
          broken.push(`${label}: left #main nearly empty (${res.len} chars)`); continue;
        }
        if (!VIEWS.includes(res.view) && res.view !== 'map' && res.view !== 'tribal') {
          broken.push(`${label}: S.view became "${res.view}"`);
        }
      }
      t.eq(broken, [], 'every handler runs cleanly and leaves the app usable');

      // Nothing may escape to the network or a popup during a crawl.
      const escaped = await app.page.evaluate(() => ({
        opened: window.__crawl.opened,
        alerts: window.__crawl.alerts.length,
      }));
      // blob: URLs are the .xlsx / .docx downloads — a file handed to the user,
      // not a window. Only a real navigation would be a finding.
      t.eq(escaped.opened.filter(u => !/^blob:|importer\.html/.test(u)), [],
           'nothing navigated away except the importer launcher and file downloads');
      t.gt(escaped.opened.length, 0, 'and the crawl did reach the export paths');
    } finally {
      await app.close();
    }
  },
};
