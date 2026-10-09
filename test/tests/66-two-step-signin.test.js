// Two-step sign-in (Oct 2026): a 6-digit code from Microsoft Authenticator on
// top of the password, via Supabase Auth MFA (TOTP) over REST — plus the
// staff allowlist found while building it.
//
// The apps half runs against a FAKE Supabase Auth (fakeAuth below) that keeps
// real state: users, factors, aal1/aal2 tokens, a code that works and one
// that doesn't, and "deleting a verified factor needs aal2" as GoTrue rules.
// What it cannot prove is Microsoft Authenticator itself reading the QR —
// that is a standard otpauth:// TOTP code; try it by hand once.
//
// The database half switches role and JWT claims on a raw connection like
// test 47: a signed-in stranger (anyone can get a session from the portal's
// email sign-in) sees nothing; and sql/pending/…_staff_require_aal2.sql,
// applied inside a rolled-back transaction, refuses staff a password-only
// session and lets a portal client through unchanged.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const GOOD = '123456';
const tok = claims => 'hdr.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.sig';
const claimsOf = t => { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString()); } catch (e) { return {}; } };

function fakeAuth() {
  const st = { users: {}, calls: [], n: 0 };
  st.add = (email, password, verified) => {
    st.users[email] = { id: 'u-' + email, email, password, factors: verified ? [{ id: 'f-old', factor_type: 'totp', status: 'verified', friendly_name: 'Old phone', created_at: '2026-10-01T10:00:00Z' }] : [] };
  };
  st.session = (email, aal) => ({ access_token: tok({ email, aal, sub: 'u-' + email }), refresh_token: 'r-' + aal + '-' + email, user: { id: 'u-' + email, email } });
  st.handler = async route => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname.replace(/^.*\/auth\/v1/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    const bearer = claimsOf((req.headers().authorization || '').replace(/^Bearer /, ''));
    const me = st.users[bearer.email];
    st.calls.push(req.method() + ' ' + p);
    const send = (status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (p === '/token' && u.searchParams.get('grant_type') === 'password') {
      const usr = st.users[body.email];
      if (!usr || usr.password !== body.password) return send(400, { error_description: 'Invalid login credentials' });
      return send(200, st.session(body.email, 'aal1'));
    }
    if (p === '/token') { const [, aal, email] = body.refresh_token.split('-'); return send(200, st.session(email, aal)); }
    if (!me) return send(401, { msg: 'invalid JWT' });
    if (p === '/user') return send(200, { id: me.id, email: me.email, factors: me.factors });
    if (p === '/factors' && req.method() === 'POST') {
      if (me.factors.some(f => f.friendly_name === body.friendly_name)) return send(422, { msg: 'A factor with the friendly name "' + body.friendly_name + '" for this user already exists' });
      const f = { id: 'f' + (++st.n), factor_type: 'totp', status: 'unverified', friendly_name: body.friendly_name, created_at: '2026-10-06T10:00:00Z' };
      me.factors.push(f);
      st.lastEnroll = body;
      return send(200, { id: f.id, type: 'totp', totp: {
        qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
        secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Cirrus%20Cc:' + me.email + '?secret=JBSWY3DPEHPK3PXP&issuer=Cirrus%20Cc' } });
    }
    const m = p.match(/^\/factors\/([^/]+)(\/challenge|\/verify)?$/);
    const f = m && me.factors.find(x => x.id === m[1]);
    if (!f) return send(404, { msg: 'Factor not found' });
    if (m[2] === '/challenge') return send(200, { id: 'ch-' + f.id, expires_at: 0 });
    if (m[2] === '/verify') {
      if (body.challenge_id !== 'ch-' + f.id || body.code !== GOOD) return send(422, { msg: 'Invalid TOTP code entered' });
      f.status = 'verified';
      return send(200, { ...st.session(me.email, 'aal2'), token_type: 'bearer', expires_in: 3600 });
    }
    if (req.method() === 'DELETE') {
      if (f.status === 'verified' && bearer.aal !== 'aal2') return send(403, { msg: 'AAL2 required to unenroll verified factor' });
      me.factors = me.factors.filter(x => x !== f);
      return send(200, { id: f.id });
    }
    return send(404, { msg: 'no route' });
  };
  return st;
}

module.exports = {
  name: 'two-step sign-in — Authenticator codes on all three staff apps, and a staff allowlist in the database',
  async run({ t, db }) {
    // ── the shared block really is shared ───────────────────────────────
    const block = f => (read(f).match(/\/\/ ── TWO-STEP SIGN-IN \(begin\)[\s\S]*?\/\/ ── TWO-STEP SIGN-IN \(end\)/) || [''])[0];
    t.ok(block('index.html').length > 3000, 'index.html carries the two-step block');
    t.eq(block('mobile.html'), block('index.html'), 'mobile.html carries the identical block');
    t.eq(block('importer.html'), block('index.html'), 'importer.html carries the identical block');
    t.ok(/const MFA_REQUIRED = false;/.test(block('index.html')), 'optional for now (MFA_REQUIRED = false)');
    t.ok(/clearSession\(\);\s*_mfaPending = sess;/.test(block('index.html')), 'the half-signed-in session is taken out of sessionStorage and held in memory');

    t.seed();
    const auth = fakeAuth();
    auth.add('jeff@sunrise.example', 'pw-jeff', false);
    auth.add('shay@sunrise.example', 'pw-shay', true);
    const loginAs = async (page, email, pw, ids = ['#login-email', '#login-password', '#login-btn']) => {
      await page.waitForSelector(ids[0]);
      await page.fill(ids[0], email); await page.fill(ids[1], pw);
      await page.click(ids[2]);
    };
    const typeCode = async (page, code) => { await page.fill('#mfa-code', ''); await page.type('#mfa-code', code); };
    const stored = page => page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('pi_session') || 'null'); return s && _jwtClaims(s.access_token).aal; });

    // ── desktop: optional — no factor, no extra step ─────────────────────
    let app = await t.open('index.html', { auth: auth.handler, session: false });
    const dialogs = [];
    app.page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
    try {
      await loginAs(app.page, 'jeff@sunrise.example', 'pw-jeff');
      await app.ready();
      t.eq(await app.page.evaluate(() => !!document.getElementById('mfa-overlay')), false, 'a user with no authenticator signs in with the password alone (optional mode)');

      // ── Settings: set up ──────────────────────────────────────────────
      await app.page.evaluate(() => setView('settings'));
      // The boot's data load can redraw Settings just after the card fills in,
      // putting it back to "Checking…" for a moment — wait for the settled card.
      const offShown = await app.page.waitForFunction(() => { const b = document.getElementById('mfa-card-body'); return !!(b && b.querySelector('button') && /Off/.test(b.textContent)); }, null, { timeout: 8000 }).then(() => true, () => false);
      t.ok(offShown, 'Settings shows two-step sign-in as Off');
      await app.page.waitForFunction(() => { const b = document.getElementById('mfa-card-body'); return !!(b && b.querySelector('button')); }, null, { timeout: 8000 });
      await app.page.click('#mfa-card-body button:has-text("Set up")');
      await app.page.waitForSelector('#mfa-qr');
      const qr = await app.page.getAttribute('#mfa-qr', 'src');
      t.ok(qr.startsWith('data:image/svg+xml;charset=utf-8,%3Csvg'), 'the QR code is shown as an escaped SVG data URI');
      t.ok(await app.page.evaluate(() => document.getElementById('mfa-qr').naturalWidth > 0), 'and the browser actually draws it');
      t.eq(await app.page.textContent('#mfa-key'), 'JBSW Y3DP EHPK 3PXP', 'the key for typing it in by hand is shown, in groups of four');
      t.eq(auth.lastEnroll.issuer, 'Cirrus Cc', 'Authenticator will list it as "Cirrus Cc"');
      await typeCode(app.page, '000000');
      await app.page.waitForSelector('#mfa-err', { state: 'visible' });
      t.ok(/didn’t work/.test(await app.page.textContent('#mfa-err')), 'a wrong code says so, in plain words');
      t.eq(auth.users['jeff@sunrise.example'].factors[0].status, 'unverified', 'and turns nothing on');
      await typeCode(app.page, GOOD);
      await app.page.waitForSelector('#mfa-overlay', { state: 'detached' });
      t.eq(await stored(app.page), 'aal2', 'the right code turns it on and upgrades this session to aal2');
      await app.page.waitForFunction(() => /On/.test(document.getElementById('mfa-card-body').textContent));
      t.ok(/Microsoft Authenticator/.test(await app.page.textContent('#mfa-card-body')), 'Settings now shows it On');

      // ── a reload of an aal2 session goes straight in ────────────────────
      const callsBefore = auth.calls.length;
      await app.page.reload();
      await app.ready();
      t.eq(auth.calls.slice(callsBefore).filter(c => /user|factors/.test(c)), [], 'reloading an aal2 session asks for nothing and calls nothing');

      // ── sign out, sign in: the code step ────────────────────────────────
      await app.page.evaluate(() => signOut());
      await loginAs(app.page, 'jeff@sunrise.example', 'pw-jeff');
      await app.page.waitForSelector('#mfa-code');
      t.ok(/Cirrus Cc/.test(await app.page.textContent('#mfa-overlay')) && /jeff@sunrise\.example/.test(await app.page.textContent('#mfa-overlay')), 'the code step names the app and the account, as Authenticator lists them');
      t.eq(await stored(app.page), null, 'while the code is being asked for, nothing is stored — a reload goes back to the password');
      await app.page.reload();
      await app.page.waitForSelector('#login-email');
      t.eq(await app.page.evaluate(() => !!document.getElementById('mfa-overlay') || typeof _syncCache.projects !== 'undefined'), false, 'and it does: the password screen, no data loaded');
      await loginAs(app.page, 'jeff@sunrise.example', 'pw-jeff');
      await app.page.waitForSelector('#mfa-code');
      await app.page.click('#mfa-back');
      t.eq(await app.page.evaluate(() => [!!document.getElementById('mfa-overlay'), !!document.getElementById('login-overlay'), document.getElementById('login-btn').disabled]), [false, true, false], '"Use a different account" goes back to the password screen');
      await loginAs(app.page, 'jeff@sunrise.example', 'pw-jeff');
      await app.page.waitForSelector('#mfa-code');
      await typeCode(app.page, GOOD);
      await app.ready();
      t.eq(await stored(app.page), 'aal2', 'the code opens the app with an aal2 session');
      t.eq(await app.page.evaluate(() => !!document.getElementById('login-overlay')), false, 'and the sign-in screen is gone');

      // ── a session from before set-up (aal1) is asked on the next load ───
      await app.page.evaluate(s => sessionStorage.setItem('pi_session', JSON.stringify(s)), auth.session('jeff@sunrise.example', 'aal1'));
      await app.page.reload();
      await app.page.waitForSelector('#mfa-code');
      t.eq(await stored(app.page), null, 'an aal1 session left in another tab is not let in: the code is asked for');
      await typeCode(app.page, GOOD);
      await app.ready();

      // ── move to a new phone: new one first, then the old one goes ───────
      await app.page.evaluate(() => setView('settings'));
      await app.page.waitForSelector('#mfa-card-body button:has-text("Move to a new phone")');
      const oldId = auth.users['jeff@sunrise.example'].factors[0].id;
      await app.page.click('#mfa-card-body button:has-text("Move to a new phone")');
      await app.page.waitForSelector('#mfa-qr');
      t.eq(auth.users['jeff@sunrise.example'].factors.map(f => f.status), ['verified', 'unverified'], 'while the new phone is being set up, the old one still works');
      await typeCode(app.page, GOOD);
      await app.page.waitForSelector('#mfa-overlay', { state: 'detached' });
      await t.until(() => auth.users['jeff@sunrise.example'].factors.length === 1);
      const fs2 = auth.users['jeff@sunrise.example'].factors;
      t.ok(fs2.length === 1 && fs2[0].id !== oldId && fs2[0].status === 'verified', 'after the new code, only the new phone is left');

      // ── turn off ────────────────────────────────────────────────────────
      await app.page.waitForSelector('#mfa-card-body button:has-text("Turn off")');
      await app.page.click('#mfa-card-body button:has-text("Turn off")');
      await app.page.waitForFunction(() => /Off/.test(document.getElementById('mfa-card-body').textContent));
      t.eq(auth.users['jeff@sunrise.example'].factors, [], 'Turn off (after a confirm) removes it');
      t.ok(dialogs.some(d => /Turn off two-step sign-in/.test(d)), 'and asked first');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }

    // ── desktop, required mode: no factor → set up at sign-in ────────────
    const reqFile = '_mfa_required_index.html';
    fs.writeFileSync(path.join(ROOT, reqFile), read('index.html').replace('const MFA_REQUIRED = false;', 'const MFA_REQUIRED = true;'));
    auth.add('new@sunrise.example', 'pw-new', false);
    app = await t.open(reqFile, { auth: auth.handler, session: false });
    try {
      await loginAs(app.page, 'new@sunrise.example', 'pw-new');
      await app.page.waitForSelector('#mfa-qr');
      t.ok(/now asks for a code/.test(await app.page.textContent('#mfa-overlay')), 'required mode: a user without one is walked through set-up first');
      t.eq(await stored(app.page), null, 'and nothing opens or is stored until it is done');
      await typeCode(app.page, GOOD);
      await app.ready();
      t.eq(await stored(app.page), 'aal2', 'then the app opens, already aal2');
      await app.page.evaluate(() => setView('settings'));
      await app.page.waitForFunction(() => /On/.test(document.getElementById('mfa-card-body')?.textContent || ''));
      t.eq(await app.page.evaluate(() => /Turn off/.test(document.getElementById('mfa-card-body').textContent)), false, 'and there is no Turn off while it is required');
    } finally { await app.close(); fs.unlinkSync(path.join(ROOT, reqFile)); }

    // ── mobile and the importer ask for the code too ─────────────────────
    app = await t.open('mobile.html', { auth: auth.handler, session: false });
    try {
      await loginAs(app.page, 'shay@sunrise.example', 'pw-shay');
      await app.page.waitForSelector('#mfa-code');
      t.eq(await stored(app.page), null, 'mobile: a user with an authenticator is asked for the code');
      await typeCode(app.page, GOOD);
      await app.page.waitForFunction(() => !document.getElementById('login-overlay') && typeof _syncCache !== 'undefined' && Array.isArray(_syncCache.projects), null, { timeout: 15000 });
      t.eq(await stored(app.page), 'aal2', 'mobile: and opens with aal2');
      t.eq(app.errors, [], 'mobile: no page errors');
    } finally { await app.close(); }

    app = await t.open('importer.html', { auth: auth.handler, session: false });
    try {
      await loginAs(app.page, 'shay@sunrise.example', 'pw-shay', ['#imp-login-email', '#imp-login-password', '#imp-login-btn']);
      await app.page.waitForSelector('#mfa-code');
      t.eq(await stored(app.page), null, 'importer: asked for the code too');
      await typeCode(app.page, GOOD);
      await app.page.waitForFunction(() => document.querySelectorAll('#import-context option').length > 1, null, { timeout: 15000 });
      t.eq(await stored(app.page), 'aal2', 'importer: then loads its project list');
    } finally { await app.close(); }

    // ── the database ─────────────────────────────────────────────────────
    const c = await db.pool.connect();
    try {
      await c.query('begin');
      const [{ id: P }] = (await c.query(`select id from pi_projects order by id limit 1`)).rows;
      await c.query(`insert into pi_client_access (email, project_id) values ('client@x.example', $1)`, [P]);
      await c.query(`insert into storage.buckets (id, name) values ('report-files','report-files') on conflict do nothing`);
      await c.query(`insert into storage.objects (bucket_id, name) values ('report-files', '${P}/1.docx')`);
      const as = async (claims, q) => {
        await c.query('savepoint s'); await c.query('set local role authenticated');
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        let out; try { out = (await c.query(q)).rows; } catch (e) { out = 'denied: ' + e.message; }
        await c.query('rollback to savepoint s');
        return out;
      };
      const n = async (claims, table) => { const r = await as(claims, `select count(*)::int n from ${table}`); return typeof r === 'string' ? r : r[0].n; };
      // pi_interactions, not pi_stakeholders: the harness builds dashboard-made
      // tables without RLS (production has it on every pi_ table — checked
      // live 2026-10-06), and the policy is only added where RLS is on.
      const total = (await c.query(`select count(*)::int n from pi_interactions`)).rows[0].n;
      t.gt(total, 0, 'the seed has interactions to count');
      const staff = { email: 'staff@sunrise.example' }, stranger = { email: 'anyone@stranger.example' }, client = { email: 'client@x.example' };

      t.eq(await n(staff, 'pi_interactions'), total, 'a listed staff login sees every interaction');
      t.eq(await n(stranger, 'pi_interactions'), 0, 'a signed-in stranger (not staff, not a client) sees no interactions');
      t.eq(await n(stranger, 'pi_projects'), 0, 'no projects');
      t.eq(await n(stranger, 'pi_parcel_outreach'), 0, 'no ROW outreach notes');
      t.eq(await n(stranger, 'pi_staff'), 0, 'and not the staff list');
      t.ok(String(await as(stranger, `insert into pi_client_access (email, project_id) values ('anyone@stranger.example', ${P}) returning id`)).startsWith('denied'), 'and cannot grant itself a project');
      t.eq(await n(stranger, `storage.objects where bucket_id='report-files'`), 0, 'and cannot read the report files');
      t.eq(await n(staff, `storage.objects where bucket_id='report-files'`), 1, 'staff still can');
      t.eq(await n(client, 'pi_projects'), 1, 'a portal client still sees exactly their own project');
      const policies = (await c.query(`select count(distinct tablename)::int n from pg_policies where policyname='pi_staff_or_client'`)).rows[0].n;
      const pitables = (await c.query(`select count(*)::int n from pg_tables where schemaname='public' and tablename like 'pi\\_%' and rowsecurity`)).rows[0].n;
      t.eq(policies, pitables, 'every pi_ table with RLS carries the staff-or-client policy');

      // ── pending: staff need aal2 ────────────────────────────────────────
      await c.query(read('sql/pending/2026-10-06_staff_require_aal2.sql'));
      t.eq(await n({ ...staff, aal: 'aal1' }, 'pi_interactions'), 0, 'with the pending file run: a password-only staff session sees nothing');
      t.eq(await n({ ...staff, aal: 'aal2' }, 'pi_interactions'), total, 'the same login after the code (aal2) sees everything');
      t.eq(await n({ ...stranger, aal: 'aal2' }, 'pi_interactions'), 0, 'a stranger who set up an authenticator of their own still sees nothing');
      t.eq(await n({ ...client, aal: 'aal1' }, 'pi_projects'), 1, 'a portal client (email link, aal1) is unaffected');
      t.eq(await n({ ...staff, aal: 'aal1' }, `storage.objects where bucket_id='report-files'`), 0, 'report files need aal2 too');
    } finally { await c.query('rollback').catch(() => {}); c.release(); }
  },
};
