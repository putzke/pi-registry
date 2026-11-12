// Edit hotline dialog laid out in call order (Nov 2026, Jeff): numbered,
// colour-coded steps, a flow strip that greys skipped steps, no sideways
// scrolling, radio buttons and checkboxes at their natural size, and the
// "What callers hear" preview one line per step.
module.exports = {
  name: 'hotline dialog — call-order steps, flow strip, no overflow, natural-size controls',
  async run({ t }) {
    t.seed();
    const ids = (await t.sql(`select id from pi_projects order by id limit 3`)).map(r => String(r.id));
    const [h] = await t.sql(`insert into pi_hotlines (name, phone_number, spanish_enabled, greeting_mode, greeting_text, active)
      values ('Layout Hotline','+18015550142',true,'voice','Thank you for calling.',true) returning id`);
    for (const [i, p] of ids.entries())
      await t.sql(`insert into pi_hotline_extensions (hotline_id, digit, project_id, label, active) values ($1,$2,$3,$4,true)`,
        [h.id, String(i + 1), p, 'a fairly long menu label for project number ' + (i + 1)]);
    const app = await t.open('index.html', { viewport: { width: 1280, height: 900 } });
    try {
      await app.page.evaluate(id => { setView('settings'); openHotlineModal(id); }, String(h.id));
      const r = await app.page.evaluate(() => {
        const b = document.getElementById('m-body');
        const steps = [...b.querySelectorAll('section.hl-step[id^="hl-step-"]')].map(s => s.id.replace('hl-step-', ''));
        const radio = document.querySelector('input[name="f-hl-mode"]').getBoundingClientRect().width;
        const check = document.getElementById('f-hl-es').getBoundingClientRect().width;
        const lines = [...document.querySelectorAll('#f-hl-preview .hl-hear-line')].length;
        return { steps, sw: b.scrollWidth, cw: b.clientWidth, radio, check, lines,
          chips: [...document.querySelectorAll('#hl-flow .hl-chip')].map(c => c.dataset.step + (c.classList.contains('off') ? ':off' : '')) };
      });
      t.eq(r.steps, ['greet', 'es', 'route', 'ring', 'vm'], 'the steps follow the call: greeting, Spanish, menu, ring the PI Lead, voicemail');
      t.ok(r.sw <= r.cw + 1, 'nothing runs off the right edge (no sideways scrolling)');
      t.ok(r.radio < 30 && r.check < 30, 'radio buttons and checkboxes keep their natural size (were stretched to full width)');
      t.eq(r.chips, ['greet', 'es', 'route', 'ring', 'vm'], 'every step is on for a menu hotline with Spanish and ringing');
      t.ok(r.lines >= 5, '“What callers hear” is one line per step');
      const off = await app.page.evaluate(() => {
        document.getElementById('f-hl-es').checked = false; _hotSyncVis();
        document.querySelector('input[name="f-hl-mode"][value="one"]').checked = true; _hotModeChanged();
        return { chips: [...document.querySelectorAll('#hl-flow .hl-chip.off')].map(c => c.dataset.step),
          esWrap: document.getElementById('f-hl-es-wrap').style.display, menu: document.getElementById('f-hl-menu').style.display,
          one: document.getElementById('f-hl-one').style.display };
      });
      t.eq(off.chips, ['es', 'route'], 'Spanish off and one project grey out those two steps');
      t.ok(off.esWrap === 'none' && off.menu === 'none' && off.one === '', 'and hide their fields');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
