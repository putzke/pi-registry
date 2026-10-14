// A drafted narrative must reach the live preview — and the autosave — the
// moment it lands in the box, exactly as typed text does. Reported live (Oct
// 2026): after changing the report dates and re-drafting the overall summary,
// the preview kept the old wording until another box was clicked into.
module.exports = {
  name: 'report editor — a drafted narrative shows in the preview and autosaves at once',
  async run({ t }) {
    t.seed();
    const [p] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const pid = String(p.id);
    const app = await t.open('index.html');
    const inPreview = (txt) => app.page.waitForFunction(x => (document.getElementById('rpt-live-preview') || {}).textContent.includes(x), txt, { timeout: 2000 }).then(() => true, () => false);
    try {
      await app.ready();
      await app.page.evaluate(async (pid) => {
        window.confirm = () => true;
        S.projectFilter = pid; S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();
      }, pid);
      await app.page.waitForFunction(() => document.getElementById('rpt-live-preview').textContent.length > 50);
      await app.page.evaluate(() => {
        _setClaudeKey('sk-ant-test-key-not-real');
        window._claudeNarrative = async () => { await new Promise(r => setTimeout(r, 50)); return 'FRESH OVERALL NARRATIVE'; };
        const ps = document.getElementById('rpt-pstart'); ps.value = '2026-01-01'; ps.dispatchEvent(new Event('change'));
        document.getElementById('rpt-overall-summary').value = 'OLD WORDING';
      });
      await app.page.evaluate(() => { _rptEdit.dirty = false; window.__saves = 0; const real = _scheduleRptSave; window._scheduleRptSave = function(){ window.__saves++; return real.apply(this, arguments); }; });
      await app.page.click('#overall-draft-btn');
      t.ok(await inPreview('FRESH OVERALL NARRATIVE'), 'the overall summary draft shows in the preview without touching another box');
      t.ok(await app.page.evaluate(() => window.__saves > 0), 'the drafted overall summary is queued for autosave, like typed text');

      // A section's ✦ Draft does the same.
      const idx = await app.page.evaluate(() => { const ta = document.querySelector('.rpt-sec-summary[data-sectype^="auto-"]'); ta.value = ''; return ta.getAttribute('data-idx'); });
      await app.page.evaluate(() => { window._claudeNarrative = async () => 'FRESH SECTION NARRATIVE'; });
      await app.page.click('#sec-draft-btn-' + idx);
      t.ok(await inPreview('FRESH SECTION NARRATIVE'), 'a section draft shows in the preview at once');

      // No API key: the template text lands in the box — and in the preview.
      await app.page.evaluate(() => { localStorage.removeItem('compass_claude_api_key_v2'); document.getElementById('rpt-overall-summary').value = ''; return generateOverallDraft(); });
      const tmpl = await app.page.evaluate(() => document.getElementById('rpt-overall-summary').value);
      t.ok(tmpl && await inPreview(tmpl.slice(0, 40)), 'without a key, the template draft shows in the preview too');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
