// "Draft all sections" must make the SAME call as each section's own button.
//
// It used to batch every task into one prompt with a JSON reply contract, and
// the narratives it produced were visibly shorter and thinner than the ones the
// individual buttons produced. Three separate causes, all of them invisible in
// the output — you only saw a weaker draft:
//
//   1. The per-section RETRY (which ran whenever the JSON failed to parse) used
//      _claudeSystemPrompt(), the GENERIC prompt that caps output at "2-4
//      sentence narrative summaries". _claudeSectionSystemPrompt() exists
//      precisely because that cap truncates richer sections.
//   2. The overall summary was drafted under the SECTION prompt rather than
//      _claudeExecSystemPrompt(), from a near-copy of the individual button's
//      instruction instead of the instruction itself.
//   3. One response carrying N narratives as JSON makes the model ration
//      length whatever the shared ceiling says.
//
// The batch's justification was that project context is "sent once rather than
// once per section". That was never true — the facts are built PER SECTION, so
// batching only concatenated the same text; the whole saving was the system
// prompt. This test measures that too, because it is the reason the trade was
// not worth making.
module.exports = {
  name: 'draft all sections — the same call as each section\'s own button',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(
        `select id, pid from pi_projects where pid='25-154-001'`))[0];
      t.ok(proj, 'found a demo project');

      // A section with facts, and one without — draft-all must treat both the
      // way that section's own button does.
      const TYPES = ['auto-concerns', 'auto-del', 'auto-contacts'];
      const EMPTY = 'auto-parcels';   // SR-154 has no parcels

      // Open the editor on a draft with several auto sections, and stub the API
      // so every call is recorded instead of billed.
      const rec = await app.page.evaluate(async ([pid, types, empty]) => {
        S.projectFilter = pid;
        _syncCache.reports = [];
        localStorage.setItem('pir4_pi_reports_' + pid, JSON.stringify({
          reportNum: '1', periodStart: '2026-08-03', periodEnd: '2026-08-21',
          sections: types.concat([empty])
            .map((ty, i) => ({ id: 's' + i, title: ty, type: ty })),
          distGroups: [],
        }));
        S.view = 'reports'; S.rptTab = 'pi-editor';
        await openPIReport();

        // Both paths return early with template text when no key is saved, so
        // neither would reach the API at all.
        _setClaudeKey('sk-ant-test-key-not-real');
        window.__calls = [];
        window.__realNarrative = _claudeNarrative;
        window._claudeNarrative = async (sys, user, max, model) => {
          window.__calls.push({ sys, user, max: max === undefined ? null : max,
                                model: model === undefined ? null : model });
          return 'STUB NARRATIVE';
        };
        window.confirm = () => true;

        // ── every section, one at a time, via its own button ───────────────
        const perButton = {};
        for (let i = 0; i < types.length; i++) {
          window.__calls.length = 0;
          await generateSectionDraft(types[i], String(i));
          perButton[types[i]] = window.__calls.slice();
        }
        window.__calls.length = 0;
        await generateOverallDraft();
        perButton.overall = window.__calls.slice();

        // ── then the same report via "Draft all sections" ──────────────────
        document.querySelectorAll('.rpt-sec-summary').forEach(ta => { ta.value = ''; });
        document.getElementById('rpt-overall-summary').value = '';
        window.__calls.length = 0;
        await generateAllSectionDrafts();
        const all = window.__calls.slice();

        window._claudeNarrative = window.__realNarrative;
        const dbg = {}; types.concat([empty]).forEach(ty => { dbg[ty] = (_buildSectionDraft(ty)||'').length; });
        const tas = [...document.querySelectorAll('.rpt-sec-summary')];
        return { dbg, perButton, all,
                 filled: tas.slice(0, types.length).map(x => x.value),
                 emptySection: tas[types.length].value };
      }, [String(proj.id), TYPES, EMPTY]);

      // ── one call per narrative, not one call for all of them ─────────────
      t.eq(rec.all.length, TYPES.length + 1,
           `"Draft all" made one call per narrative (${rec.all.length} for `
           + `${TYPES.length} sections + the overall summary)`);
      t.ok(rec.filled.every(v => v === 'STUB NARRATIVE'),
           'and every section with facts received its own narrative');

      // A section with no facts is skipped, exactly as its own button refuses
      // one. The batch drafted them off an empty facts block — an invitation to
      // invent, and inventing engagement is what a compliance narrative must
      // never do.
      t.eq(rec.dbg[EMPTY], 0, `${EMPTY} has no facts on this project`);
      t.eq(rec.emptySection, '', 'so "Draft all" left it alone rather than inventing one');
      t.eq(rec.all.some(c => /parcel/i.test(c.user)), false,
           'and never sent a request for it');

      // ── each call matches the one that section's button makes ────────────
      // Byte-for-byte: same system prompt, same instruction, same token budget,
      // same model. Anything less and the two paths can drift again.
      TYPES.forEach(ty => {
        t.eq(rec.perButton[ty].length, 1, `${ty}: its own button makes exactly one call`);
        const one = rec.perButton[ty][0];
        if (!one) return;
        const match = rec.all.find(c => c.user === one.user);
        t.ok(match, `${ty}: "Draft all" sends the identical instruction`);
        if (!match) return;
        t.eq(match.sys, one.sys, `${ty}: and the identical system prompt`);
        t.eq(match.max, one.max, `${ty}: and the identical token budget (${match.max})`);
        t.eq(match.model, one.model, `${ty}: and the same model`);
      });

      // The executive summary is the one that must NOT share the section
      // prompt — it orients rather than recaps, and the batch drafted it under
      // the section prompt.
      const oneOverall = rec.perButton.overall[0];
      t.ok(oneOverall, 'the overall summary button makes a call');
      const allOverall = rec.all.find(c => c.user === oneOverall.user);
      t.ok(allOverall, '"Draft all" sends the identical overall instruction');
      if (allOverall) {
        t.eq(allOverall.sys, oneOverall.sys, 'under the identical system prompt');
        t.eq(allOverall.max, oneOverall.max, 'with the identical token budget');
      }
      // Named explicitly, not merely "different from the section one" — the two
      // could both be wrong and still differ.
      const prompts = await app.page.evaluate(() => ({
        exec: _claudeExecSystemPrompt(), section: _claudeSectionSystemPrompt(),
      }));
      t.eq(oneOverall.sys, prompts.exec,
           'the overall summary is drafted under the EXECUTIVE prompt');
      t.eq(allOverall && allOverall.sys, prompts.exec, 'in both paths');
      TYPES.forEach(ty => {
        const c = rec.all.find(x => x.user === rec.perButton[ty][0].user);
        t.eq(c && c.sys, prompts.section, `${ty} is drafted under the SECTION prompt`);
      });

      // ── the generic 2-4-sentence prompt reaches no report narrative ──────
      // This is what made the batch's fallback produce short drafts.
      const generic = await app.page.evaluate(() => _claudeSystemPrompt());
      t.ok(/2-4 sentence/.test(generic), 'the generic prompt does cap length at 2-4 sentences');
      rec.all.forEach((c, i) => t.eq(c.sys === generic, false,
        `draft-all call ${i + 1} does not use the capped generic prompt`));
      const src = await app.page.evaluate(() => String(generateAllSectionDrafts));
      t.eq(/_claudeSystemPrompt\(\)/.test(src.replace(/\/\/[^\n]*/g, '')), false,
           'and no code path inside it can reach for it');

      // ── the batch saved almost nothing, which is why it went ─────────────
      const size = await app.page.evaluate(([pid, types]) => {
        const sys = _claudeSectionSystemPrompt().length;
        const per = types.map(ty => _sectionAIRequest(ty, _buildSectionDraft(ty) || '')
                                      .userContent.length);
        return { perCall: per.reduce((a, b) => a + b + sys, 0),
                 batched: per.reduce((a, b) => a + b, 0) + sys,
                 sys, n: types.length };
      }, [String(proj.id), TYPES]);
      const saved = size.perCall - size.batched;
      t.eq(saved, size.sys * (size.n - 1),
           `batching only ever saved repeated system prompts (${saved} chars)`);
      t.ok(saved / size.perCall < 0.5,
           'a fraction of the input, because the FACTS are per-section — there '
           + 'was no shared context to send once');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
