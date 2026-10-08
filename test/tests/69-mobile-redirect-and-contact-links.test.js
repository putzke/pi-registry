// Three mobile requests (Oct 2026):
//   1. app.cirruscc.com on a phone opens the mobile app. Tablets and computers
//      stay on the desktop app; "Use full desktop site" (?desktop=1) is
//      remembered on that device; an address carrying anything else (a sign-in
//      or password-reset link) is left alone.
//   2. Tapping the contact's name on an interaction row opens their contact
//      screen; tapping the rest of the row still opens the interaction. Back
//      returns to the screen it came from.
//   3. The floating "log interaction" button is gone (its styling had already
//      been removed, so it drew as a bare grey bar over the bottom nav).
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const PHONE_VIEW = { width: 390, height: 844 };

module.exports = {
  name: 'mobile — phones land on the mobile app; contact names open the contact',
  async run({ t }) {
    t.seed();
    const page = (a) => a.page.url().split('/').pop().split(/[?#]/)[0];
    const settle = (a) => a.page.waitForTimeout(400);

    // ── 1. the redirect ─────────────────────────────────────────────────
    for (const [label, ua, want] of [
      ['an iPhone', IPHONE, 'mobile.html'],
      ['an Android phone', ANDROID_PHONE, 'mobile.html'],
      ['an iPad', IPAD, 'index.html'],
      ['an Android tablet', ANDROID_TABLET, 'index.html'],
      ['a computer', undefined, 'index.html'],
    ]) {
      const a = await t.open('index.html', { userAgent: ua, viewport: ua ? PHONE_VIEW : undefined });
      try { await settle(a); t.eq(page(a), want, `${label} opening the app lands on ${want}`); }
      finally { await a.close(); }
    }

    // Full desktop site: remembered, and undone with ?desktop=0.
    const p = await t.open('index.html', { userAgent: IPHONE, viewport: PHONE_VIEW, query: '?desktop=1' });
    try {
      await settle(p);
      t.eq(page(p), 'index.html', '?desktop=1 keeps a phone on the desktop app');
      await p.page.goto(p.page.url().split('?')[0]); await settle(p);
      t.eq(page(p), 'index.html', 'and it is remembered on the next visit');
      await p.page.goto(p.page.url().split('?')[0] + '?desktop=0'); await settle(p);
      t.eq(page(p), 'mobile.html', '?desktop=0 forgets it');
    } finally { await p.close(); }

    // A sign-in / reset link is left alone.
    const h = await t.open('index.html', { userAgent: IPHONE, viewport: PHONE_VIEW, query: '#type=recovery&access_token=x' });
    try { await settle(h); t.eq(page(h), 'index.html', 'an address with a #… on it is not redirected'); }
    finally { await h.close(); }

    // ── 2 + 3. the mobile app ───────────────────────────────────────────
    const m = await t.open('mobile.html', { viewport: { width: 414, height: 896 } });
    try {
      await m.page.waitForFunction(() => typeof _syncCache !== 'undefined' && (_syncCache.interactions || []).length > 0,
        null, { timeout: 15000 });

      const chrome = await m.page.evaluate(() => ({
        fab: !!document.querySelector('.fab'),
        desktopLink: (document.querySelector('a[href^="index.html?desktop=1"]') || {}).textContent || '',
      }));
      t.eq(chrome.fab, false, 'the floating log button is gone');
      t.ok(/full desktop site/i.test(chrome.desktopLink), 'the Dashboard offers "Use full desktop site"');

      // Tap the name on a Dashboard row.
      const tap = async (screen, listSel) => m.page.evaluate(async ([screen, listSel]) => {
        if (screen === 'screen-followups') document.getElementById('fu-user').value = 'all';
        showScreen(screen);
        const link = document.querySelector(listSel + ' .stake-link');
        if (!link) return { found: false };
        const sheetBefore = document.getElementById('sheet-log').classList.contains('open');
        link.click();
        await new Promise(r => setTimeout(r, 100));
        const active = document.querySelector('.screen.active').id;
        const shownName = document.getElementById('detail-topbar-name').textContent.trim();
        const sheetAfter = document.getElementById('sheet-log').classList.contains('open');
        document.querySelector('#screen-contact-detail .topbar-back').click();
        return { found: true, linkText: link.textContent.trim(), active, shownName,
                 editOpened: !sheetBefore && sheetAfter,
                 backTo: document.querySelector('.screen.active').id };
      }, [screen, listSel]);

      for (const [label, screen, sel] of [
        ['Dashboard', 'screen-home', '#home-int-list'],
        ['Interactions', 'screen-interactions', '#ints-list'],
        ['Follow-ups', 'screen-followups', '#fu-list'],
      ]) {
        const r = await tap(screen, sel);
        t.ok(r.found, `${label}: rows show the contact name as a link`);
        if (!r.found) continue;
        t.eq(r.active, 'screen-contact-detail', `${label}: tapping the name opens the contact screen`);
        t.ok(r.shownName && r.linkText.includes(r.shownName.split(' ')[0]), `${label}: for that contact (${r.shownName})`);
        t.eq(r.editOpened, false, `${label}: and does not also open the interaction editor`);
        t.eq(r.backTo, screen, `${label}: Back returns to ${label}`);
      }

      // The rest of the row still opens the interaction.
      const rowStill = await m.page.evaluate(async () => {
        showScreen('screen-home');
        let opened = null; const real = window.editInteraction;
        window.editInteraction = id => { opened = id; };
        try { document.querySelector('#home-int-list .list-item').click(); }
        finally { window.editInteraction = real; }
        return opened;
      });
      t.ok(rowStill, 'tapping elsewhere on the row still opens the interaction');
      t.eq(m.errors, [], 'no page errors on mobile');
    } finally { await m.close(); }
  },
};
