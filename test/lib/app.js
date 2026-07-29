// Loads index.html / client-portal.html in headless Chromium with every
// Supabase call redirected at the local shim.
//
// The apps are unmodified — routing is what makes this work, so the harness
// tests the real shipped file rather than a test build of it.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const CHROME = '/opt/pw-browsers/chromium';
const CHARTJS = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js');

async function openApp(file, { shimOrigin, email = 'putzke@demo.test', viewport, portalToken } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: viewport || { width: 1440, height: 900 } });

  // ORDER MATTERS: Playwright matches the LAST registered route first, so the
  // catch-all goes down first and the specific handlers below override it.
  // Registered the other way round, this fallback swallowed every /rest/v1/
  // call and handed the app "{}" instead of a row array.
  await page.route('**://**', route => {
    const u = route.request().url();
    if (u.startsWith('file://') || u.startsWith(shimOrigin)) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Supabase REST -> local shim.
  // Proxied through Node rather than route.continue({url}), because continue()
  // refuses to rewrite https:// to http:// and standing up TLS just to talk to
  // a local shim isn't worth it.
  await page.route('**/rest/v1/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const headers = { ...req.headers() };
    delete headers.host; delete headers['content-length'];
    try {
      const r = await fetch(shimOrigin + u.pathname + u.search, {
        method: req.method(), headers, body: req.postData() || undefined,
      });
      await route.fulfill({
        status: r.status,
        contentType: r.headers.get('content-type') || 'application/json',
        body: await r.text(),
      });
    } catch (e) {
      await route.fulfill({ status: 500, contentType: 'application/json',
                            body: JSON.stringify({ message: 'shim proxy: ' + e.message }) });
    }
  });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Chromium logs a console error for any non-2xx fetch; the shim's 4xx
    // responses are already asserted on directly via shim.calls.
    if (/Failed to load resource/.test(t)) return;
    errors.push('console: ' + t);
  });

  // Supabase auth -> a fixed fake session. getLoggedBy() derives its initials
  // from this email, so tests can control who "I" am.
  const session = {
    access_token: 'hdr.' + Buffer.from(JSON.stringify({ email, sub: 'test-user' })).toString('base64') + '.sig',
    refresh_token: 'refresh', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'test-user', email },
  };
  await page.route('**/auth/v1/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }));

  // Chart.js from disk so a blocked CDN can't fail a test run
  await page.route('**/cdn.jsdelivr.net/**', route => fs.existsSync(CHARTJS)
    ? route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(CHARTJS, 'utf8') })
    : route.abort());

  // index.html keeps its session in sessionStorage under 'pi_session';
  // client-portal.html uses localStorage under 'cp_session_v1'.
  await page.addInitScript(s => {
    sessionStorage.setItem('pi_session', JSON.stringify(s));
    localStorage.setItem('cp_session_v1', JSON.stringify(s));
  }, session);

  const q = portalToken ? '?token=' + portalToken : '';
  await page.goto('file://' + path.join(REPO, file) + q);
  await page.waitForTimeout(150);
  // Dismiss the login overlay if the app still put one up.
  await page.evaluate(() => document.getElementById('login-overlay')?.remove());

  return {
    page, errors,
    async close() { await browser.close(); },
    // Wait until the app has finished its initial load.
    async ready(timeout = 15000) {
      await page.waitForFunction(
        () => typeof _syncCache !== 'undefined' && Array.isArray(_syncCache.projects),
        null, { timeout });
    },
  };
}

module.exports = { openApp, REPO };
