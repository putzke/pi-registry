// The tribal consultation tracker is BUILT but deliberately NOT reachable.
//
// Decision (Aug 2026, Jeff): keep it hidden from users for now. It is not
// production-ready — never fully tested or validated — and tribal consultation
// is a government-to-government process under EO 13175 / UDOT 08A2-07 and
// Section 106. A half-validated tracker for THAT is worse than no tracker:
// it invites a consultant to treat an untested record as the consultation file.
//
// So this is not dead code to delete, and not a feature to quietly switch on.
// It is finished work parked behind a deliberate gate, and the gate is the
// thing under test. renderTribal() and its data layer stay intact so enabling
// it later is a small change rather than a rebuild.
//
// What actually holds the gate is ONE line in setView(). This test exists
// because that is easy to remove by accident — a future session tidying the
// nav, or "fixing" what looks like an unreachable branch, would ship an
// untested compliance module to users with nothing to catch it.
module.exports = {
  name: 'tribal — built, parked, and genuinely unreachable',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // ── the gate holds ───────────────────────────────────────────────────
      const gate = await app.page.evaluate(() => {
        const toasts = []; const real = window.showToast;
        window.showToast = (m) => { toasts.push(String(m)); };
        setView('interactions');
        const before = S.view;
        let threw = null;
        try { setView('tribal'); } catch (e) { threw = e.message; }
        const after = S.view;
        window.showToast = real;
        return { before, after, threw, toasts,
                 main: document.getElementById('main').innerHTML };
      });
      t.eq(gate.threw, null, 'asking for the tribal view does not throw');
      t.eq(gate.before, 'interactions', 'we started somewhere else');
      t.eq(gate.after, 'interactions',
           'and setView("tribal") leaves you there — the view never opens');
      t.eq(/Tribe name|THPO|tribal consultation record/i.test(gate.main), false,
           'nothing from the tracker renders');

      // A silent no-op is its own bug: a button that does nothing reads as
      // broken. It has to say why.
      t.gt(gate.toasts.length, 0, 'it explains itself rather than failing silently');
      t.ok(/not available yet/i.test(gate.toasts.join(' ')),
           'saying the module is not available yet');

      // ── nothing offers it ────────────────────────────────────────────────
      // The gate is the backstop, not the front door. No control should be
      // inviting a user into a view that refuses them.
      const nav = await app.page.evaluate(() => {
        const el = document.getElementById('nav-tribal');
        const html = document.documentElement.innerHTML;
        return {
          exists: !!el,
          tag: el ? el.tagName : null,
          onclick: el ? (el.getAttribute('onclick') || '') : '',
          disabledLook: el ? /not-allowed/.test(el.getAttribute('style') || '') : false,
          title: el ? (el.getAttribute('title') || '') : '',
          // Any handler anywhere that would navigate there.
          callers: (html.match(/setView\(\s*['"]tribal['"]\s*\)/g) || []).length,
        };
      });
      t.ok(nav.exists, 'the nav still shows the item, greyed out');
      t.eq(nav.tag, 'DIV',
           'as a DIV, not a button — there is nothing to click');
      t.eq(nav.onclick, '', 'and it carries no click handler');
      t.ok(nav.disabledLook, 'it looks disabled');
      t.ok(/not available/i.test(nav.title), 'and says so on hover');
      t.eq(nav.callers, 0,
           'no control anywhere calls setView("tribal") — the gate is a backstop, '
           + 'not the only thing standing between a user and an untested module');

      // ── the work is still here ───────────────────────────────────────────
      // Parked, not deleted. If this ever fails, someone removed the module
      // rather than the gate, and re-enabling means rebuilding it.
      const kept = await app.page.evaluate(() => ({
        renderer: typeof renderTribal === 'function',
        modal: typeof openTribalModal === 'function',
        mapped: !!SB_TO_INT.pi_tribal_consultations,
      }));
      t.ok(kept.renderer, 'renderTribal() is still there, ready to be re-enabled');
      t.ok(kept.modal, 'so is its editor');
      t.ok(kept.mapped, 'and the table is still mapped');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
