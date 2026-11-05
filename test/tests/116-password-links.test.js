// Set or reset a password from an emailed link (Nov 2026, Jeff). A Supabase
// "Send invitation" email led to the sign-in screen with no password; now the
// link opens "Set your password". "Forgot password?" sends the reset email.
const fs = require('fs');
const path = require('path');
const { REPO } = require('../lib/app');

function fakeAuth(state) {
  return async route => {
    const req = route.request();
    const u = new URL(req.url());
    const tokenOk = (req.headers()['authorization'] || '') === 'Bearer GOODTOKEN';
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/auth/v1/recover')) {
      state.recover.push({ url: req.url(), body: JSON.parse(req.postData() || '{}') });
      return json(200, {});
    }
    if (u.pathname.endsWith('/auth/v1/user')) {
      if (!tokenOk) return json(401, { msg: 'invalid JWT' });
      if (req.method() === 'PUT') { state.password = JSON.parse(req.postData() || '{}').password; }
      return json(200, { id: 'u1', email: 'new.person@example.com', factors: [] });
    }
    return json(200, { access_token: 'x', refresh_token: 'y', user: { email: 'putzke@demo.test' } });
  };
}

module.exports = {
  name: 'password links — invite/reset link sets a password and signs in; expired link explained; forgot password',
  async run({ t }) {
    t.seed();
    // 1. Invite link on the desktop app.
    let st = { recover: [] };
    let app = await t.open('index.html', { session: false, auth: fakeAuth(st),
      query: '#access_token=GOODTOKEN&refresh_token=R1&expires_in=3600&token_type=bearer&type=invite' });
    try {
      const p = app.page;
      await p.waitForSelector('#setpw-overlay');
      t.ok(!(await p.evaluate(() => location.hash)), 'the tokens are removed from the address');
      t.ok(!(await p.$('#login-overlay')), 'no sign-in screen over it');
      await p.waitForFunction(() => /new\.person@example\.com/.test(document.getElementById('setpw-who').textContent));
      t.ok(/Welcome/.test(await p.textContent('#setpw-overlay')), 'an invite reads as a welcome');
      await p.fill('#setpw-1', 'short'); await p.fill('#setpw-2', 'short'); await p.click('#setpw-btn');
      t.ok(/at least 8/.test(await p.textContent('#setpw-error')), 'too short is refused');
      await p.fill('#setpw-1', 'longenough1'); await p.fill('#setpw-2', 'different22'); await p.click('#setpw-btn');
      t.ok(/different/.test(await p.textContent('#setpw-error')), 'two different passwords are refused');
      t.eq(st.password, undefined, 'nothing was saved yet');
      await p.fill('#setpw-2', 'longenough1'); await p.click('#setpw-btn');
      await p.waitForFunction(() => !document.getElementById('setpw-overlay'));
      t.eq(st.password, 'longenough1', 'the password is saved with the link\'s session');
      const sess = await p.evaluate(() => JSON.parse(sessionStorage.getItem('pi_session') || 'null'));
      t.ok(sess && sess.access_token === 'GOODTOKEN' && sess.user && sess.user.email === 'new.person@example.com', 'signed in as that account');
      await app.ready();
      t.ok(true, 'the app opens');
    } finally { await app.close(); }

    // 2. An expired link explains itself on the sign-in screen.
    st = { recover: [] };
    app = await t.open('index.html', { session: false, auth: fakeAuth(st),
      query: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
    try {
      const p = app.page;
      await p.waitForSelector('#login-overlay');
      t.ok(/expired or was already used/.test(await p.textContent('#login-error')), 'expired link explained');
      t.ok(!(await p.evaluate(() => location.hash)), 'the error is removed from the address');
      // 3. Forgot password.
      await p.fill('#login-email', '');
      await p.click('#login-forgot');
      t.ok(/Type your email/.test(await p.textContent('#login-error')), 'no email: asks for it');
      t.eq(st.recover.length, 0, 'no email sent without an address');
      await p.fill('#login-email', 'someone@example.com');
      await p.click('#login-forgot');
      await p.waitForFunction(() => /on its way/.test(document.getElementById('login-error').textContent));
      t.eq(st.recover.length, 1, 'one reset email asked for');
      t.eq(st.recover[0].body.email, 'someone@example.com', 'for the typed address');
      t.ok(/redirect_to=/.test(st.recover[0].url), 'with a return address to the app');
    } finally { await app.close(); }

    // 4. A reset link opened on a phone sets the password, then goes to the mobile app.
    st = { recover: [] };
    app = await t.open('index.html', { session: false, auth: fakeAuth(st),
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      query: '#access_token=GOODTOKEN&refresh_token=R1&type=recovery' });
    try {
      const p = app.page;
      await p.waitForSelector('#setpw-overlay');
      t.ok(/Set a new password/.test(await p.textContent('#setpw-overlay')), 'a reset reads as a new password, on the phone too');
      await p.fill('#setpw-1', 'phonepass9'); await p.fill('#setpw-2', 'phonepass9');
      await Promise.all([p.waitForURL(/mobile\.html/), p.click('#setpw-btn')]);
      t.eq(st.password, 'phonepass9', 'saved');
    } finally { await app.close(); }

    // 5. Mobile has the same block and the same "Forgot password?" link.
    const grab = f => { const s = fs.readFileSync(path.join(REPO, f), 'utf8'); const m = s.match(/\/\/ ── PASSWORD LINKS \(begin\)[\s\S]*?\/\/ ── PASSWORD LINKS \(end\)[^\n]*/); return m ? m[0] : ''; };
    const d = grab('index.html'), m = grab('mobile.html');
    t.ok(d.length > 1000 && d === m, 'the password-link block is identical in both apps');
    t.ok(/id="login-forgot"[^>]*pwForgot\(\)/.test(fs.readFileSync(path.join(REPO, 'mobile.html'), 'utf8')), 'mobile sign-in has Forgot password?');
  },
};
