// "Copy client link" on an archived report, and the portal link it makes (Oct 2026).
//
// A shared report with a final PDF gets a button that copies
// client-portal.html?token=<portal link>&report=<id>, as rich text whose link
// text is the report's name, for pasting into an email. The portal opens that
// report's PDF straight away. Also: the portal nav reads "Project PI Reports",
// and the Overview shows the latest report.
module.exports = {
  name: 'report client link + portal "Project PI Reports"',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id, name from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    await t.sql(`delete from pi_report_archive where project_id=${P}`);
    const [shared] = await t.sql(`insert into pi_report_archive (project_id, report_num, report_title, period_start, period_end, sections, archived_at, docx_path, client_visible)
      values (${P}, '7', 'Project Team PI Update', '2026-09-19', '2026-10-02', '[]', '2026-10-02', '${P}/a.pdf', true) returning id`);
    const [unshared] = await t.sql(`insert into pi_report_archive (project_id, report_num, report_title, period_start, period_end, sections, archived_at, docx_path, client_visible)
      values (${P}, '8', 'Project Team PI Update', '2026-10-03', '2026-10-16', '[]', '2026-10-16', '${P}/b.pdf', false) returning id`);
    await t.sql(`delete from pi_portal_links where project_id::text=$1`, [P]);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      await app.page.evaluate(p => { S.projectFilter = p; S.rptTab = 'archive'; setView('reports'); S.projectFilter = p; S.rptTab = 'archive'; render(); }, P);
      const btns = await app.page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /Copy client link/.test(b.textContent)).map(b => ({ dis: b.disabled, on: b.getAttribute('onclick') || '' })));
      t.eq(btns.length, 2, 'both PDF reports show the button');
      t.ok(btns.some(b => !b.dis && b.on.includes(String(shared.id))), 'enabled on the shared report');
      t.ok(btns.some(b => b.dis), 'disabled on the unshared one');

      await app.page.evaluate(() => {
        window._clip = null; window._asked = '';
        window.confirm = m => { window._asked = m; return true; }; window._t = []; const _o = showToast; showToast = (m, ...r) => { window._t.push(m); return _o(m, ...r); };
        navigator.clipboard.write = async items => { const it = items[0]; window._clip = {}; for (const ty of it.types) window._clip[ty] = await (await it.getType(ty)).text(); };
      });
      await app.page.evaluate(id => copyReportClientLink(id, null), String(shared.id));
      const clip = await app.page.evaluate(() => ({ c: window._clip, asked: window._asked }));
      t.ok(/no client portal link yet/.test(clip.asked), 'with no portal link it asks before creating one');
      const [lnk] = await t.sql(`select token from pi_portal_links where project_id::text=$1`, [P]);
      t.ok(!!lnk, 'the portal link is created');
      const url = `https://app.cirruscc.com/client-portal.html?token=${lnk.token}&report=${shared.id}`;
      const label = `${proj.name}: Project Team PI Update #7, September 19 – October 2, 2026 (PDF)`;
      t.eq(clip.c && clip.c['text/html'], `<a href="${url.replace('&', '&amp;')}">${label}</a>`, 'rich text: the report name links to the report');
      t.eq(clip.c && clip.c['text/plain'], `${label}: ${url}`, 'plain text: name then link');

      await app.page.evaluate(() => { window._asked = ''; });
      await app.page.evaluate(id => copyReportClientLink(id, null), String(shared.id));
      t.eq(await app.page.evaluate(() => window._asked), '', 'a second copy reuses the link without asking');
      const toasts = await app.page.evaluate(async id => { let m = ''; const o = showToast; showToast = x => { m = x; }; window._clip = null; await copyReportClientLink(id, null); showToast = o; return { m, clip: window._clip }; }, String(unshared.id));
      t.ok(/Share this report first/.test(toasts.m) && !toasts.clip, 'an unshared report copies nothing');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }

    const [tok] = await t.sql(`select token from pi_portal_links where project_id::text=$1`, [P]);
    // Overview + nav
    let portal = await t.open('client-portal.html', { portalToken: tok.token });
    try {
      await portal.page.waitForFunction(() => document.querySelector('.latest-report'), null, { timeout: 15000 });
      const ov = await portal.page.evaluate(() => ({ nav: document.getElementById('nav-summary').textContent, card: document.querySelector('.latest-report').textContent }));
      t.ok(/Project PI Reports/.test(ov.nav), 'the nav reads "Project PI Reports"');
      t.ok(/Latest PI report/.test(ov.card) && /#7/.test(ov.card) && /All PI reports \(1\)/.test(ov.card), 'the Overview shows the latest shared report: ' + ov.card.replace(/\s+/g, ' '));
      t.ok(!/#8/.test(ov.card), 'the unshared report is not offered');
      await portal.page.evaluate(() => setView('summary'));
      t.ok(await portal.page.evaluate(() => document.querySelector('.content-inner .card .card-title').textContent.startsWith('Project PI Reports')), 'the reports list is the first card on its tab');
      t.eq(portal.errors, [], 'no portal errors');
    } finally { await portal.close(); }

    // The emailed link goes straight to the PDF
    portal = await t.open('client-portal.html', { query: `?token=${tok.token}&report=${shared.id}` });
    try {
      await portal.page.waitForFunction(() => document.getElementById('deep-open') && /could not be opened/.test(document.getElementById('deep-open').textContent), null, { timeout: 15000 });
      t.ok(await portal.page.evaluate(() => !document.documentElement.classList.contains('deep-report') && /Project PI Reports/.test(document.body.textContent)), 'a link whose PDF cannot be signed lands on the portal, not a blank page');
      let signedFor = '';
      await portal.page.route('**/storage/v1/object/sign/**', r => { signedFor = r.request().url(); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/report-files/x.pdf?token=t' }) }); });
      const went = await portal.page.evaluate(async id => { let u = ''; _goToUrl = x => { u = x; }; await openReportDeepLink(id); return u; }, String(shared.id));
      t.ok(/\/storage\/v1\/object\/sign\/report-files\/x\.pdf\?token=t$/.test(went), 'it goes to the signed PDF in the same tab');
      t.ok(signedFor.endsWith(`/report-files/${P}/a.pdf`), 'it signs that report\'s file');
      // The fast path (what the emailed link runs): the dashboard is never drawn.
      const fast = await portal.page.evaluate(async ([tk, id]) => {
        document.getElementById('content').innerHTML = '';
        document.documentElement.classList.add('deep-report');
        let u = ''; _goToUrl = x => { u = x; };
        await openReportLinkFast(tk, id);
        return { u, content: document.getElementById('content').innerHTML, splash: getComputedStyle(document.getElementById('report-splash')).display, login: getComputedStyle(document.getElementById('login-screen')).display, msg: document.getElementById('report-splash-msg').textContent };
      }, [tok.token, String(shared.id)]);
      t.ok(/x\.pdf\?token=t$/.test(fast.u), 'the fast path goes to the signed PDF');
      t.eq(fast.content, '', 'the dashboard is never drawn on the way');
      t.ok(fast.splash === 'flex' && fast.login === 'none', 'only the "Opening" screen shows, not the sign-in screen');
      t.ok(/Opening Project Team PI Update #7/.test(fast.msg), 'the splash names the report: ' + fast.msg);
      const back = await portal.page.evaluate(async ([tk, id]) => {
        document.documentElement.classList.add('deep-report');
        let u = ''; _goToUrl = x => { u = x; };
        await openReportLinkFast(tk, id);
        await new Promise(r => setTimeout(r, 300));
        return { u, deep: document.documentElement.classList.contains('deep-report'), txt: (document.querySelector('.content-inner') || {}).textContent || '' };
      }, [tok.token, String(unshared.id)]);
      t.ok(!back.u && !back.deep && /no longer shared/.test(back.txt), 'an unshared report falls back to the portal with a note');
      const gone = await portal.page.evaluate(async id => { let u = ''; _goToUrl = x => { u = x; }; await openReportDeepLink(id); return { u, txt: document.querySelector('.content-inner').textContent }; }, String(unshared.id));
      t.ok(!gone.u && /no longer shared/.test(gone.txt), 'an unshared report goes nowhere and says so');
    } finally { await portal.close(); }
  }
};
