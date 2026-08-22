// The report has ONE prose voice.
//
// The overall summary printed at 13px upright #222; every section narrative —
// which is what the AI drafts — printed at 12px ITALIC #444. Same writer, same
// document, and the type changed halfway down the page, so the AI-drafted
// sections read as a caption on the table below them rather than as the
// report's own text. The .docx did the same thing in Word run properties: body
// 10pt upright for the overall summary, 9pt italic grey for every section.
//
// Four surfaces carry this prose and all four must agree — the live preview,
// the archived preview, the client portal's copy of the archived report, and
// the .docx a client actually receives.
const JSZip = (() => { try { return require('jszip'); } catch (e) { return null; } })();

module.exports = {
  name: 'report prose — one voice across preview, archive, portal and .docx',
  async run({ t }) {
    t.seed();
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..', '..');
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(
        `select id, pid from pi_projects where pid='25-3W-DESIGN'`))[0];
      t.ok(proj, 'found a demo project');

      const OVERALL = 'OVERALL_PROSE_MARKER the project moved into construction.';
      const SECSUM  = 'SECTION_PROSE_MARKER residents raised detour concerns.';
      const SECS = [
        { id: 'concerns', title: 'Recent Public Concerns and Inquiries',
          type: 'auto-concerns', summary: SECSUM, showTable: true },
        { id: 'del', title: 'Deliverable / Scope Status', type: 'auto-del' },
      ];

      // ── the live preview ─────────────────────────────────────────────────
      const styles = await app.page.evaluate(async ([pid, secs, overall]) => {
        S.projectFilter = pid;
        _syncCache.reports = [];
        localStorage.setItem('pir4_pi_reports_' + pid, JSON.stringify({
          reportNum: '1', reportTitle: 'PI Progress Report',
          periodStart: '2026-08-03', periodEnd: '2026-08-21',
          overallSummary: overall, sections: secs, distGroups: [],
        }));
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
        renderLivePreview();
        const pane = document.getElementById('rpt-live-preview');
        const find = marker => [...pane.querySelectorAll('div')]
          .filter(d => d.textContent.includes(marker))
          .pop();                                  // innermost wrapper
        const read = el => {
          if (!el) return null;
          const c = getComputedStyle(el);
          return { size: c.fontSize, style: c.fontStyle, weight: c.fontWeight,
                   family: c.fontFamily, color: c.color, height: c.lineHeight };
        };
        return { overall: read(find('OVERALL_PROSE_MARKER')),
                 section: read(find('SECTION_PROSE_MARKER')),
                 paneFamily: getComputedStyle(pane).fontFamily };
      }, [String(proj.id), SECS, OVERALL]);

      t.ok(styles.overall, 'the overall summary rendered');
      t.ok(styles.section, 'the section narrative rendered');
      t.eq(styles.section.family, styles.overall.family, 'same font family');
      t.eq(styles.section.size,   styles.overall.size,   'same font size');
      t.eq(styles.section.style,  styles.overall.style,  'same font style');
      t.eq(styles.section.color,  styles.overall.color,  'same colour');
      t.eq(styles.section.height, styles.overall.height, 'same line height');
      t.eq(styles.section.style, 'normal',
           'and the AI-drafted narrative is no longer italic');
      t.ok(/Georgia/.test(styles.section.family),
           'both sit in the report\'s serif face, not the app UI\'s');

      // The two are still visually distinct — sameness of TYPE was the ask, not
      // sameness of container. Losing the section rule would merge narrative
      // into the data block above it.
      const containers = await app.page.evaluate(() => ({
        overall: /background:#f0f4f8/.test(RPT_OVERALL_CSS),
        section: /border-left:2px solid #9ab/.test(RPT_SECSUM_CSS),
        shared:  RPT_PROSE_CSS,
      }));
      t.ok(containers.overall, 'the overall summary keeps its tinted box');
      t.ok(containers.section, 'the section narrative keeps its left rule');
      t.eq(/italic/.test(containers.shared), false,
           'the shared prose declaration carries no italic');

      // ── the archived copy ────────────────────────────────────────────────
      // The frozen record is what a client re-reads months later; it must look
      // like the report that was on screen when it was issued.
      const archived = await app.page.evaluate(([pid, secs, overall]) => {
        const html = _buildArchivedPreviewHTML({
          reportTitle: 'PI Progress Report', reportNum: '1',
          overallSummary: overall, archivedAt: new Date().toISOString(),
          snapshot: { sections: secs.map(s => ({ ...s, countsLabel: '', tableHtml: '' })) },
        }, { name: 'x', pid: 'x' });
        const el = document.createElement('div');
        el.style.cssText = 'font-family:Georgia,serif;font-size:13px';
        el.innerHTML = html; document.body.appendChild(el);
        const read = marker => {
          const d = [...el.querySelectorAll('div')]
            .filter(x => x.textContent.includes(marker)).pop();
          if (!d) return null;
          const c = getComputedStyle(d);
          return { size: c.fontSize, style: c.fontStyle, color: c.color };
        };
        const out = { overall: read('OVERALL_PROSE_MARKER'),
                      section: read('SECTION_PROSE_MARKER'),
                      usesShared: /RPT_SECSUM_CSS/.test(String(_buildArchivedPreviewHTML)) };
        el.remove();
        return out;
      }, [String(proj.id), SECS, OVERALL]);

      t.ok(archived.overall && archived.section, 'the archived preview rendered both');
      t.eq(archived.section.size,  archived.overall.size,  'archived: same font size');
      t.eq(archived.section.style, archived.overall.style, 'archived: same font style');
      t.eq(archived.section.color, archived.overall.color, 'archived: same colour');
      t.eq(archived.section.style, 'normal', 'archived: not italic');
      t.ok(archived.usesShared,
           'and it reads the shared declaration rather than its own copy');

      // ── the .docx a client receives ──────────────────────────────────────
      const docx = await app.page.evaluate(async () => {
        const real = URL.createObjectURL.bind(URL);
        let blob = null;
        URL.createObjectURL = b => { blob = b; return real(b); };
        try { await exportPIDocx(); } catch (e) { /* reported below */ }
        for (let i = 0; i < 60 && !blob; i++) await new Promise(r => setTimeout(r, 100));
        URL.createObjectURL = real;
        if (!blob) return { ok: false };
        const zip = await JSZip.loadAsync(blob);
        return { ok: true, xml: await zip.file('word/document.xml').async('string') };
      });
      t.ok(docx.ok, 'the .docx export produced a file');
      if (docx.ok) {
        // Pull the paragraph each marker sits in and read its run properties.
        const paraOf = marker => {
          const at = docx.xml.indexOf(marker);
          if (at < 0) return null;
          const start = docx.xml.lastIndexOf('<w:p>', at);
          const end = docx.xml.indexOf('</w:p>', at);
          return start < 0 || end < 0 ? null : docx.xml.slice(start, end);
        };
        const oP = paraOf('OVERALL_PROSE_MARKER'), sP = paraOf('SECTION_PROSE_MARKER');
        t.ok(oP, 'the overall summary is in the document');
        t.ok(sP, 'so is the section narrative');
        const size = p => (p.match(/<w:sz w:val="(\d+)"/) || [])[1];
        t.eq(size(sP), size(oP),
             `same point size in Word (${size(sP)} half-points)`);
        t.eq(/<w:i\/>/.test(sP), false, 'the section narrative is not italicised in Word');
        t.eq(/<w:i\/>/.test(oP), false, 'nor is the overall summary');
        const color = p => (p.match(/<w:color w:val="([0-9A-Fa-f]{6})"/) || [])[1];
        t.eq(color(sP), color(oP), `same colour in Word (${color(sP)})`);
        // Regression guard: the italic-grey run property is still used for the
        // things that ARE captions, so its mere presence is not the bug.
        t.ok(/<w:i\/>/.test(docx.xml), 'italic runs still exist for genuine captions');
      }

      // ── the portal's standalone copy ─────────────────────────────────────
      // client-portal.html imports nothing from index.html, so this is a fourth
      // hand-written copy of the same declaration — checked as text, the way the
      // shared-lists test checks the other duplicated ones.
      const portal = fs.readFileSync(path.join(root, 'client-portal.html'), 'utf8');
      const pSec = portal.match(/if \(sec\.summary\) \{[\s\S]{0,400}?esc\(sec\.summary\)/);
      t.ok(pSec, 'found the portal\'s section-narrative renderer');
      const pStyle = pSec[0].match(/style="([^"]*)"/);
      t.ok(pStyle, 'it carries an inline style');
      const prose = await app.page.evaluate(() => RPT_PROSE_CSS);
      prose.split(';').forEach(decl => {
        t.ok(pStyle[1].includes(decl.trim()),
             `the portal declares "${decl.trim()}" too`);
      });
      t.eq(/font-style:\s*italic/.test(pStyle[1]), false,
           'and the portal narrative is not italic either');

      // ── and it is asked for at a workable length ──────────────────────────
      // "5-8 sentences" bought nothing: the model complied on the count and blew
      // past the intent — 265 words in six sentences of 40-plus words each. A
      // sentence count cannot constrain length; it says nothing about how long a
      // sentence may be. The budget is now words, and the cut must come out of
      // elaboration, not out of topics: a dropped theme under-reports public
      // concern, which is a compliance figure, not a style preference.
      const OBSERVED = 265;   // words the old prompt actually produced
      const ask = await app.page.evaluate(() => {
        const r = _sectionAIRequest('auto-concerns', 'facts');
        return { text: r.userContent, budget: r.maxTokens };
      });
      const budget = ask.text.match(/about (\d+) words, and no more than (\d+) words/);
      t.ok(budget, 'the concerns task states a target and a hard ceiling');
      t.ok(Number(budget[1]) <= Math.round(OBSERVED * 0.7),
           `the target is about a third below what it was producing `
           + `(${budget[1]} vs ${OBSERVED})`);
      t.ok(Number(budget[2]) > Number(budget[1]) && Number(budget[2]) <= OBSERVED * 0.8,
           `and the ceiling sits just above it (${budget[2]}), not back at the old length`);
      t.eq(/\d-\d sentences/.test(ask.text), false,
           'no sentence count, which never constrained the length');
      t.ok(/compress, do not omit/i.test(ask.text),
           'the cut is explicitly elaboration, not coverage');
      t.ok(/Cover every distinct theme/.test(ask.text),
           'every theme is still required');
      t.ok(/stating the reporting period explicitly/i.test(ask.text),
           'this section still owns the reporting date range');
      t.ok(ask.budget >= Number(budget[2]) * 2 && ask.budget <= 600,
           `the token ceiling matches the new length (${ask.budget}), with room to `
           + 'finish a sentence rather than clip mid-word');

      // "Draft all sections" must carry the SAME instruction and budget, or the
      // batched copy of this section comes out at a different length from the
      // one the per-section button produces.
      const batchSrc = await app.page.evaluate(() => String(generateAllSectionDrafts));
      t.ok(/_sectionAIRequest\(/.test(batchSrc),
           'the batch path builds its task from the same request builder');
      t.ok(/req\.maxTokens/.test(batchSrc), 'and inherits its token budget');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
