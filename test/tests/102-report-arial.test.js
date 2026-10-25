// The PI report prints in ONE font, Arial, on every surface (Jeff, Oct 2026):
//  - the live preview was Georgia, with monospace block characters for the
//    PI-compliance bars;
//  - the archived copy (an iframe with no font of its own) fell to the
//    browser default, usually Times New Roman;
//  - the portal's copy used the portal's system font;
//  - the .docx set Arial on its paragraphs but on NO table cell, so Word drew
//    every table in the template's theme font, Calibri.
// Also found here: a report with the Right-of-Way Parcels section could not be
// exported at all ("projF is not defined" in the .docx branch).
const fs = require('fs');
const path = require('path');
module.exports = {
  name: 'PI report — Arial on every surface; the Parcels section exports',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-3W-DESIGN'`))[0];
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const setup = async () => app.page.evaluate(async (pid) => {
        S.projectFilter = DB.get('projects').find(p => String(p.id) === pid).id;
        _syncCache.reports = [];
        const secs = getAvailableSections().map((s, i) => ({ id: 's' + i, title: 'Section ' + i, type: s.type || s.id, summary: 'Narrative ' + i, showTable: true }));
        localStorage.setItem('pir4_pi_reports_' + S.projectFilter, JSON.stringify({
          reportNum: '1', reportTitle: 'PI Progress Report', periodStart: '2025-01-01', periodEnd: '2026-10-25',
          overallSummary: 'Overall text.', sections: secs, distGroups: ['Project team'] }));
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport(); renderLivePreview();
        return secs.map(s => s.type);
      }, String(proj.id));
      const types = await setup();
      t.ok(types.includes('auto-parcels') && types.includes('auto-pi-compliance'), 'every section type is in the test report');

      // ── on screen: live preview and the archived copy ─────────────────────
      const fams = await app.page.evaluate(() => {
        const collect = root => {
          const f = new Set();
          root.querySelectorAll('*').forEach(el => {
            if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) f.add(getComputedStyle(el).fontFamily);
          });
          return [...f];
        };
        const live = collect(document.getElementById('rpt-live-preview'));
        // the archived copy, inside a box with a serif face of its own (as the
        // report frame's browser default would be)
        const html = _buildArchivedPreviewHTML({ reportTitle: 'PI Progress Report', reportNum: '1', overallSummary: 'Overall.',
          archivedAt: new Date().toISOString(), snapshot: { sections: [{ title: 'S', summary: 'Narr', countsLabel: '3 items',
          tableHtml: '<table><tr><td>cell</td></tr></table>' }] } }, { name: 'x', pid: 'x' });
        const box = document.createElement('div'); box.style.fontFamily = 'serif'; box.innerHTML = html; document.body.appendChild(box);
        const arch = collect(box); box.remove();
        return { live, arch, mono: !!document.querySelector('#rpt-live-preview [style*="monospace"]') };
      });
      t.eq(fams.live.join('|'), 'Arial, Helvetica, sans-serif', 'live preview: every line of text is Arial');
      t.ok(!fams.mono, 'live preview: no monospace bar characters left');
      t.eq(fams.arch.join('|'), 'Arial, Helvetica, sans-serif', 'archived copy: Arial, whatever frame it opens in');

      // ── the .docx, every letterhead ───────────────────────────────────────
      for (const brand of ['sunrise', 'sunrisealt', 'udot']) {
        await setup();
        const r = await app.page.evaluate(async (brand) => {
          const bs = document.getElementById('docx-brand-sel'); if (bs) bs.value = brand;
          const msgs = []; const _a = window.alert; window.alert = m => msgs.push(m);
          const real = URL.createObjectURL.bind(URL); let blob = null;
          URL.createObjectURL = x => { blob = x; return real(x); };
          try { await exportPIDocx(); } catch (e) { msgs.push(String(e)); }
          for (let i = 0; i < 100 && !blob; i++) await new Promise(r => setTimeout(r, 100));
          URL.createObjectURL = real; window.alert = _a;
          if (!blob) return { ok: false, msgs };
          const zip = await JSZip.loadAsync(blob);
          const doc = await zip.file('word/document.xml').async('string');
          const body = doc.slice(doc.indexOf('<w:body>'), doc.indexOf('<w:sectPr'));
          const runs = body.match(/<w:r>[\s\S]*?<\/w:r>/g) || [];
          let text = 0, arial = 0; const other = new Set();
          runs.forEach(rn => {
            if (!/<w:t[ >]/.test(rn)) return; text++;
            const m = rn.match(/<w:rFonts [^>]*w:ascii="([^"]+)"/);
            if (m && m[1] === 'Arial') arial++; else other.add(m ? m[1] : '(none)');
          });
          return { ok: true, text, arial, other: [...other], parcels: /Right-of-Way Parcel Status/.test(body) };
        }, brand);
        t.ok(r.ok, brand + ': the report exports (with the Parcels section in it)' + (r.ok ? '' : ' — ' + (r.msgs || []).join('; ')));
        if (!r.ok) continue;
        t.ok(r.parcels, brand + ': the Parcels section is in the file');
        t.ok(r.text > 100, brand + ': the file has the tables (' + r.text + ' text runs)');
        t.eq(r.arial, r.text, brand + ': every text run is Arial (other: ' + r.other.join(',') + ')');
      }
    } finally { await app.close(); }

    // ── the portal's copy and its print window ──────────────────────────────
    const src = fs.readFileSync(path.join(__dirname, '../../client-portal.html'), 'utf8');
    const fn = src.slice(src.indexOf('function renderArchivedReportHTML'), src.indexOf('// Download the real, hand-finished'));
    t.ok(/return `<div style="font-family:Arial,Helvetica,sans-serif">\$\{html\}<\/div>`;/.test(fn), 'portal copy is wrapped in Arial');
    t.ok(/body\{font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;max-width:760px/.test(src), 'portal print window is Arial');
  }
};
