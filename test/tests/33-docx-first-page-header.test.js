// The letterhead prints on page ONE, not on all ten.
//
// Word needs two things together: the letterhead registered as the FIRST-page
// header, and <w:titlePg/> in the section properties to make it look for one.
// The Sunrise template was authored that way. The UDOT and Sunrise Alt
// templates register their letterhead as w:type="default" with no titlePg, so
// the full graphic repeated at the top of every page of a report — which is
// what a reader sees on a long PI report, and what a client receives.
//
// Two ways to get this wrong, both silent in a diff and both obvious in Word:
// a "first" reference with no titlePg prints NO header anywhere, and touching
// the footer references turns a page-number footer into a first-page-only one.
module.exports = {
  name: 'docx letterhead — first page only, on every template',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(
        `select id, pid from pi_projects where pid='25-3W-DESIGN'`))[0];
      t.ok(proj, 'found a demo project');

      await app.page.evaluate(async pid => {
        S.projectFilter = pid;
        _syncCache.reports = [];
        localStorage.setItem('pir4_pi_reports_' + pid, JSON.stringify({
          reportNum: '1', reportTitle: 'PI Progress Report',
          periodStart: '2026-08-03', periodEnd: '2026-08-21',
          overallSummary: 'Summary.',
          sections: [{ id: 'concerns', title: 'Recent Public Concerns',
                       type: 'auto-concerns', summary: 'Narrative.', showTable: true }],
          distGroups: [],
        }));
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
      }, String(proj.id));

      // ── the transform itself, against the real section properties ────────
      // The three templates differ, and the two that were wrong were wrong in
      // the same way. Idempotence matters because the helper also runs over the
      // template that already complies.
      const unit = await app.page.evaluate(() => {
        const SUN  = '<w:sectPr><w:footerReference w:type="default" r:id="rId11"/>'
                   + '<w:headerReference w:type="first" r:id="rId12"/>'
                   + '<w:footerReference w:type="first" r:id="rId13"/>'
                   + '<w:cols w:space="720"/><w:titlePg/><w:docGrid w:linePitch="360"/></w:sectPr>';
        const UDOT = '<w:sectPr><w:headerReference w:type="default" r:id="rId12"/>'
                   + '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';
        const BOTH = '<w:sectPr><w:headerReference w:type="default" r:id="rId9"/>'
                   + '<w:headerReference w:type="first" r:id="rId12"/>'
                   + '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';
        const f = _firstPageHeaderOnly;
        return { sun: f(SUN), udot: f(UDOT), both: f(BOTH),
                 sunStable: f(f(SUN)) === f(SUN), udotStable: f(f(UDOT)) === f(UDOT) };
      });

      t.eq(unit.sun.indexOf('<w:titlePg/>') >= 0, true,
           'a compliant template is left alone — titlePg still there');
      t.ok(/<w:footerReference w:type="default"/.test(unit.sun),
           'and its repeating FOOTER is untouched — a page number belongs on every page');
      t.ok(/<w:footerReference w:type="first"/.test(unit.sun),
           'as is its first-page footer');

      t.eq(/<w:headerReference[^>]*w:type="default"/.test(unit.udot), false,
           'the letterhead is no longer the default header');
      t.ok(/<w:headerReference[^>]*w:type="first"[^>]*r:id="rId12"/.test(unit.udot),
           'it is the first-page header, still pointing at the same header part');
      t.ok(/<w:cols[^>]*\/><w:titlePg\/><w:docGrid/.test(unit.udot),
           'titlePg is added in schema position — after w:cols, before w:docGrid');

      t.eq((unit.both.match(/<w:headerReference/g) || []).length, 1,
           'a template with both kinds ends up with one header reference, not two');
      t.ok(/w:type="first"/.test(unit.both), 'and it is the first-page one');

      t.ok(unit.sunStable && unit.udotStable, 'the transform is idempotent');

      // ── the real exported files ──────────────────────────────────────────
      const docx = async brand => app.page.evaluate(async b => {
        // exportPIDocx reads the editor's Letterhead select FIRST and falls back
        // to the stored mode, so setting only localStorage silently exports the
        // brand that happens to be on screen.
        localStorage.setItem('compass_report_branding', b);
        const sel = document.getElementById('docx-brand-sel');
        if (sel) sel.value = b;
        const real = URL.createObjectURL.bind(URL);
        let blob = null;
        URL.createObjectURL = x => { blob = x; return real(x); };
        try { await exportPIDocx(); } catch (e) { /* reported by the caller */ }
        for (let i = 0; i < 80 && !blob; i++) await new Promise(r => setTimeout(r, 100));
        URL.createObjectURL = real;
        if (!blob) return { ok: false };
        const zip = await JSZip.loadAsync(blob);
        const doc = await zip.file('word/document.xml').async('string');
        const sect = (doc.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/) || [''])[0];
        return { ok: true, sect,
                 hasHeaderPart: !!zip.file('word/header1.xml'),
                 rels: zip.file('word/_rels/document.xml.rels')
                   ? await zip.file('word/_rels/document.xml.rels').async('string') : '' };
      }, brand);

      for (const brand of ['sunrise', 'sunrisealt', 'udot']) {
        const d = await docx(brand);
        t.ok(d.ok, `${brand}: the export produced a file`);
        if (!d.ok) continue;
        t.ok(d.sect, `${brand}: the document carries section properties`);
        t.eq(/<w:headerReference[^>]*w:type="default"/.test(d.sect), false,
             `${brand}: no default header, so nothing repeats on page 2`);
        t.ok(/<w:headerReference[^>]*w:type="first"/.test(d.sect),
             `${brand}: the letterhead is the first-page header`);
        t.ok(/<w:titlePg\s*\/>/.test(d.sect),
             `${brand}: titlePg is set, or Word ignores the first-page header entirely`);
        t.ok(d.hasHeaderPart, `${brand}: the header part is still in the package`);
        // The reference has to still resolve, or page 1 loses its letterhead too.
        const rid = (d.sect.match(/<w:headerReference[^>]*r:id="([^"]+)"/) || [])[1];
        t.ok(rid && d.rels.includes('Id="' + rid + '"'),
             `${brand}: the first-page reference resolves to a relationship (${rid})`);
      }

      // Letterhead off: the whole apparatus goes, and nothing is left dangling.
      const off = await docx('off');
      t.ok(off.ok, 'off: the export produced a file');
      if (off.ok) {
        t.eq(/<w:headerReference/.test(off.sect), false, 'off: no header reference at all');
        t.eq(/<w:titlePg/.test(off.sect), false, 'off: and no titlePg to point at one');
        t.eq(off.hasHeaderPart, false, 'off: the header part is removed from the package');
      }

      // The two issue exports run through the same helper, so a future template
      // swap cannot quietly regress them.
      const wired = await app.page.evaluate(() => ({
        report: /_firstPageHeaderOnly\(/.test(String(_buildDocxWithTemplate)),
        issues: /_firstPageHeaderOnly\(/.test(String(exportIssuesSummaryDocx)),
        issue:  /_firstPageHeaderOnly\(/.test(String(exportIssueSingleDocx)),
      }));
      t.ok(wired.report, 'the PI report export applies it');
      t.ok(wired.issues, 'so does the issues summary export');
      t.ok(wired.issue, 'and the single-issue export');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
