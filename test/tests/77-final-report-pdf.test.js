// The final report of record is a PDF (Oct 2026).
//
// New uploads are PDF only; a .docx attached earlier stays valid until it is
// replaced, and replacing it removes the old file. The status report sends
// the newest final PDFs to Claude as documents (capped), and the portal opens
// a PDF in a new tab.
const pdf = pages => Buffer.from('%PDF-1.4\n1 0 obj << /Type /Pages /Count ' + pages + ' >> endobj\n'
  + Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj << /Type /Page /Parent 1 0 R >> endobj\n`).join('') + '%%EOF\n', 'latin1');

module.exports = {
  name: 'final report of record is a PDF: upload, replace, status report, portal',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    await t.sql(`delete from pi_report_archive where project_id=${P}`);
    // Nine archived reports: #1 no file, #2 an older .docx (replaced by a PDF
    // below), #3–#9 PDFs. #9's stored file is broken, to test the fallback.
    const rows = [];
    for (let n = 1; n <= 9; n++) {
      const path = n === 1 ? null : n === 2 ? `${P}/r2.docx` : `${P}/r${n}.pdf`;
      rows.push(`(${P}, '${n}', 'R${n}', '2026-0${n < 10 ? 1 : ''}-01'::date + ${n * 14}, '2026-01-01'::date + ${n * 14 + 13}, 'ARCHIVED-${n} draft', '[]', '{"sections":[]}', ('2026-01-01'::date + ${n * 14 + 14})::timestamptz, ${path ? `'${path}'` : 'null'})`);
    }
    await t.sql(`insert into pi_report_archive (project_id, report_num, report_title, period_start, period_end, overall_summary, sections, snapshot, archived_at, docx_path) values ${rows.join(',')}`);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const storage = [];
      await app.page.route('**/storage/v1/object/**', async route => {
        const req = route.request(), u = req.url();
        storage.push({ m: req.method(), u, ct: req.headers()['content-type'] || '' });
        if (req.method() === 'GET' && /\/r9\.pdf$/.test(u)) return route.fulfill({ status: 200, body: 'not a pdf' });
        if (req.method() === 'GET' && /\/r(\d)\.pdf$/.test(u)) return route.fulfill({ status: 200, body: pdf(Number(u.match(/r(\d)\.pdf$/)[1]) % 3 + 1) });
        if (req.method() === 'GET') return route.fulfill({ status: 404, body: '{}' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"x"}' });
      });
      let sent = null;
      await app.page.route('**/api.anthropic.com/**', async route => {
        sent = JSON.parse(route.request().postData());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }) });
      });
      await app.page.evaluate(async pid => {
        window._alerts = []; window._toasts = [];
        const st = showToast; window.showToast = (m, ...a) => { window._toasts.push(m); return st(m, ...a); };
        cacheClear('report_archive'); await loadAllData();
        S.view = 'reports'; S.projectFilter = pid; S.rptTab = 'archive'; render();
      }, P);

      // ── upload rules ──
      const r2 = (await t.sql(`select id from pi_report_archive where project_id=${P} and report_num='2'`))[0].id;
      const r1 = (await t.sql(`select id from pi_report_archive where project_id=${P} and report_num='1'`))[0].id;
      const panel = () => app.page.evaluate(() => document.getElementById('rpt-archive-panel').textContent.replace(/\s+/g, ' '));
      let txt = await panel();
      t.ok(/Final \.docx attached/.test(txt) && /Replace with PDF/.test(txt), 'an older .docx shows as such, with "Replace with PDF"');
      t.ok(/Final PDF attached/.test(txt) && /No final report attached/.test(txt) && /Attach final PDF/.test(txt), 'PDFs and missing files are labelled');
      const accept = await app.page.evaluate(id => { let acc = ''; const ce = document.createElement.bind(document);
        document.createElement = tag => { const el = ce(tag); if (tag === 'input') { el.click = () => {}; setTimeout(() => { acc = el.accept; }, 0); } return el; };
        uploadReportDocx(id); document.createElement = ce; return new Promise(r => setTimeout(() => r(acc), 5)); }, String(r1));
      t.eq(accept, '.pdf,application/pdf', 'the file picker offers PDFs only');
      await app.page.evaluate(async id => { await _doUploadReportDocx(id, new File(['x'], 'Report.docx')); }, String(r1));
      t.ok(await app.page.evaluate(() => window._toasts.some(m => /as a PDF/.test(m))), 'a .docx is refused, with how to make the PDF');
      t.eq((await t.sql(`select docx_path from pi_report_archive where id=${r1}`))[0].docx_path, null, '…and nothing is recorded');

      await app.page.evaluate(async id => { await _doUploadReportDocx(id, new File([new Uint8Array([37, 80, 68, 70])], 'Final.pdf', { type: 'application/pdf' })); }, String(r2));
      const up = storage.find(s => s.m === 'POST' && /\/object\/report-files\/.+\/\d+\.pdf$/.test(s.u));
      t.ok(up && /application\/pdf/.test(up.ct), 'the PDF is uploaded as application/pdf, under the archive id');
      const [rec2] = await t.sql(`select docx_path, period_start::text ps from pi_report_archive where id=${r2}`);
      t.ok(/\.pdf$/.test(rec2.docx_path) && rec2.ps, 'the record now points at the PDF, and keeps its period');
      t.ok(storage.some(s => s.m === 'DELETE' && /\/r2\.docx$/.test(s.u)), 'the replaced .docx is removed from storage');
      t.ok(/Final PDF attached/.test(await panel()), 'the panel redraws');

      // ── status report: newest six PDFs as documents, older ones as text ──
      // Now #2–#9 are all PDFs: the newest six are #4–#9, and #9 is broken.
      const confirmText = await app.page.evaluate(async () => {
        _setClaudeKey('sk-ant-test'); let msg = ''; window.confirm = m => { msg = m; return true; };
        await generateTrendSummary(); return msg;
      });
      const content = sent.messages[0].content;
      t.ok(Array.isArray(content), 'with PDFs, the request carries content blocks');
      const docs = content.filter(b => b.type === 'document');
      t.eq(docs.length, 5, 'the newest six PDFs are the candidates (the cap); the broken one is not sent');
      t.ok(docs.every(d => d.source.media_type === 'application/pdf' && Buffer.from(d.source.data, 'base64').toString('latin1').startsWith('%PDF-')), 'each as a base64 PDF document');
      const texts = content.filter(b => b.type === 'text').map(b => b.text);
      const labelBefore = content.map((b, i) => b.type === 'document' ? content[i - 1].text : null).filter(Boolean);
      t.ok(labelBefore.every(l => /SOURCE: final delivered report \(PDF\)/.test(l)), 'each PDF follows its own "final delivered report (PDF)" label');
      t.eq(labelBefore.map(l => l.match(/#(\d)/)[1]), ['4', '5', '6', '7', '8'], '…and they are the newest');
      t.ok(['2', '3'].every(n => texts.some(x => new RegExp('#' + n + ',[^\\n]*an older report; only the newest 6 final PDFs are read in full\\): ARCHIVED-' + n).test(x))), 'older PDFs fall back to their archived wording, saying why');
      t.ok(texts.some(x => /#9,[^\n]*the final file could not be read\): ARCHIVED-9/.test(x)), 'a broken file falls back too');
      t.ok(texts.some(x => /#1,[^\n]*no final report attached\): ARCHIVED-1/.test(x)), 'no file → archived wording');
      t.ok(/never name, quote or describe a private individual/.test(sent.system), 'the instructions forbid naming private individuals from the PDFs\' tables');
      t.ok(/Read from the final report: 5 of 9 \(5 PDFs, about \d+ pages?\); 2 older PDFs left out to keep the cost down; 1 could not be read/.test(confirmText), 'the cost check explains what was read: ' + confirmText.split('\n')[1]);
      const est = Number(confirmText.match(/About ([\d,]+) tokens/)[1].replace(/,/g, ''));
      t.ok(est > 5 * 2500, 'the token estimate counts the PDF pages: ' + est);
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }

    // ── portal: a shared PDF opens in a new tab ──
    const pdfRow = (await t.sql(`select id from pi_report_archive where project_id=${P} and report_num='9'`))[0].id;
    await t.sql(`update pi_report_archive set client_visible=true where id=${pdfRow}`);
    const [tok] = await t.sql(`select token from pi_portal_links where project_id::text=$1 limit 1`, [P]);
    const portal = await t.open('client-portal.html', { portalToken: tok.token });
    try {
      await portal.page.waitForFunction(() => typeof renderSection === 'function' && _sharedReports && _sharedReports.length, null, { timeout: 15000 });
      let signBody = null;
      await portal.page.route('**/storage/v1/object/sign/**', route => { signBody = route.request().postData(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/report-files/x.pdf?token=t' }) }); });
      await portal.page.evaluate(() => renderSection('summary'));
      t.ok(await portal.page.evaluate(() => /Open report \(PDF\)/.test(document.body.textContent)), 'the portal offers "Open report (PDF)"');
      const opened = await portal.page.evaluate(async id => {
        const fake = { document: { write() {} }, location: { href: '' }, close() {} };
        window.open = () => fake;
        await openSharedReportPdf(String(id));
        return fake.location.href;
      }, pdfRow);
      t.ok(/\/storage\/v1\/object\/sign\/report-files\/x\.pdf\?token=t$/.test(opened), 'it opens the signed link in the new tab');
      t.eq(JSON.parse(signBody || '{}').expiresIn, 300, 'the signing request carries its lifetime in the body');
      t.eq(portal.errors, [], 'no portal errors');
    } finally { await portal.close(); }
  }
};
