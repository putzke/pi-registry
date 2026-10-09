// The Project Status Report reads each report's final .docx (Oct 2026).
//
// The consultant hand-edits the exported .docx before it reaches the client,
// so the status report reads that wording where a final file is attached:
// paragraphs only (no tables, no header/footer). A report with no file, or a
// file that cannot be read, falls back to its archived wording, and the
// prompt labels every report with its source.
module.exports = {
  name: 'status report reads the final .docx, falls back to the archived wording',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    await t.sql(`delete from pi_report_archive where project_id=${P}`);
    const snap = label => JSON.stringify({ periodLabel: label, sections: [] });
    await t.sql(`insert into pi_report_archive (project_id, report_num, report_title, period_start, period_end, overall_summary, sections, snapshot, archived_at, docx_path) values
      (${P}, '1', 'R1', '2026-08-01', '2026-08-14', 'ARCHIVED-ONE draft summary', '[]', $1, '2026-08-15', null),
      (${P}, '2', 'R2', null, null, 'ARCHIVED-TWO draft summary', '[]', $2, '2026-08-29', '${P}/two.docx'),
      (${P}, '3', 'R3', '2026-08-29', '2026-09-11', 'ARCHIVED-THREE draft summary', '[]', $3, '2026-09-12', '${P}/three-missing.docx')`,
      [snap('Aug 1, 2026 – Aug 14, 2026'), snap('Aug 15, 2026 – Aug 28, 2026'), snap('Aug 29, 2026 – Sep 11, 2026')]);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      // A real .docx, built with the page's own JSZip: two paragraphs, a table
      // and a header part.
      const docxB64 = await app.page.evaluate(async () => {
        const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
        const p = txt => `<w:p><w:r><w:t>${txt}</w:t></w:r></w:p>`;
        const z = new JSZip();
        z.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
        z.file('word/document.xml', `<?xml version="1.0"?><w:document ${W}><w:body>`
          + p('FINAL-PROSE-MARKER: edited wording the client received.')
          + `<w:p><w:r><w:t xml:space="preserve">Second </w:t></w:r><w:r><w:t>paragraph</w:t><w:tab/><w:t>EDITED-TWO</w:t></w:r></w:p>`
          + `<w:tbl><w:tr><w:tc>${p('TABLE-NAME-MARKER Jane Resident')}</w:tc></w:tr></w:tbl>`
          + p('') + `<w:sectPr/></w:body></w:document>`);
        z.file('word/header1.xml', `<w:hdr ${W}>${p('HEADER-MARKER')}</w:hdr>`);
        return z.generateAsync({ type: 'base64' });
      });
      const storage = [];
      await app.page.route('**/storage/v1/object/**', route => {
        const u = route.request().url();
        storage.push({ u, auth: route.request().headers()['authorization'] || '' });
        if (u.endsWith('/two.docx')) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(docxB64, 'base64') });
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
      });
      let sent = null;
      await app.page.route('**/api.anthropic.com/**', async route => {
        sent = JSON.parse(route.request().postData());
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ content: [{ type: 'text', text: 'Status narrative.' }], stop_reason: 'end_turn' }) });
      });

      const confirmText = await app.page.evaluate(async pid => {
        _setClaudeKey('sk-ant-test');
        let msg = '';
        window.confirm = m => { msg = m; return true; };
        cacheClear('report_archive');
        await loadAllData();
        S.view = 'reports'; S.projectFilter = pid; S.rptTab = 'archive'; render();
        await generateTrendSummary();
        return msg;
      }, P);

      t.ok(sent, 'one request went to Claude');
      const user = sent.messages[0].content, sys = sent.system;
      t.ok(storage.some(s => /\/object\/authenticated\/report-files\/.+\/two\.docx$/.test(s.u)), 'the attached file was downloaded from storage');
      t.ok(storage.every(s => /^Bearer /.test(s.auth)), '…with the signed-in session');
      t.eq(storage.some(s => /R1|null/.test(s.u)), false, 'a report with no file is never fetched');

      t.ok(/FINAL-PROSE-MARKER/.test(user) && /Second paragraph EDITED-TWO/.test(user), 'the final .docx paragraphs reach the AI');
      t.ok(!/ARCHIVED-TWO/.test(user), '…in place of that report\'s archived draft');
      t.ok(!/TABLE-NAME-MARKER|Jane Resident/.test(user), 'table text (where names live) is left out');
      t.ok(!/HEADER-MARKER/.test(user), 'header and footer text is left out');
      t.ok(/Report 2 \(#2, Aug 15, 2026 – Aug 28, 2026\) — SOURCE: final delivered report \(\.docx\)/.test(user),
        'it is labelled as the final delivered report (period from the snapshot when the columns are blank)');
      t.ok(/Report 1 [^\n]*SOURCE: archived draft wording \(no final \.docx attached\): ARCHIVED-ONE/.test(user), 'no file → archived wording, labelled');
      t.ok(/Report 3 [^\n]*SOURCE: archived draft wording \(the final \.docx could not be read\): ARCHIVED-THREE/.test(user), 'unreadable file → archived wording, labelled');
      t.ok(/report of record/.test(sys) && /computed facts win/.test(sys), 'the instructions rank the final file above the draft, and the computed facts above both');
      t.ok(/Read from the final \.docx: 1 of 3 \(1 could not be read/.test(confirmText), 'the cost check says how many were read from the final file');
      t.ok(/About [\d,]+ tokens of input/.test(confirmText), '…and gives a token estimate from the actual text');

      // A long report is cut at the per-report limit, on a word boundary, and flagged.
      const big = await app.page.evaluate(async () => {
        const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
        const z = new JSZip();
        z.file('word/document.xml', `<w:document ${W}><w:body><w:p><w:r><w:t>${'alpha '.repeat(3000)}</w:t></w:r></w:p></w:body></w:document>`);
        return z.generateAsync({ type: 'base64' });
      });
      await app.page.route('**/storage/v1/object/**/big.docx', route => route.fulfill({ status: 200, body: Buffer.from(big, 'base64') }));
      const r = await app.page.evaluate(async () => { const x = await _archiveDocxProse({ id: 'b', docxPath: 'x/big.docx' }); return { n: x.text.length, trimmed: x.trimmed, end: x.text.slice(-6) }; });
      t.ok(r.trimmed && r.n <= 8000 && r.end === ' alpha', 'a long report is trimmed to the limit on a word boundary, and flagged: ' + r.n);
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  }
};
