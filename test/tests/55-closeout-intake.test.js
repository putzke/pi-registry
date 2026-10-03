// PI Close-Out, step 1: the Close-Out tab on Reports and the type-driven intake
// (pi_closeouts, sql/2026-10-03_closeouts.sql).
//
// What has to hold:
//   - the tab's counts come from the project's own tables, never typed;
//   - "Start final close-out" creates ONE row of type 'udot-construction', and
//     a second press opens it instead of making another;
//   - the signature carries forward from this user's last close-out, and the
//     UDOT region is suggested from the project's county;
//   - every edit autosaves into intake jsonb and survives a full reload;
//   - repeating rows add and remove, deliverable wording/evidence is keyed by
//     the deliverable's id;
//   - only recipient and signature are required; an untouched optional
//     section reads "Left out of the report", never as a failure;
//   - an interim close-out sits beside the final one, Final listed first.
module.exports = {
  name: 'close-out — the tab counts live, the intake autosaves and reloads',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-LC-400N'`))[0];
    const other = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const projId = String(proj.id);
    const me = 'putzke@demo.test';

    // An earlier close-out this user signed, on another project — its
    // signature block should be carried into the new one.
    await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by, updated_at)
                 values (${other.id}, 'Final', '{"sigName":"Jeff Putzke","sigTitle":"PI Manager","sigEmail":"jeff@demo.test","scmName":"Not carried"}'::jsonb,
                         '${me}', now() - interval '3 days')`);

    const ints = (await t.sql(`select count(*)::int n from pi_interactions where project_id='${projId}'`))[0].n;
    const calls = (await t.sql(`select count(*)::int n from pi_interactions where project_id='${projId}'
                                and channel='Phone' and direction='Incoming'`))[0].n;
    const dels = await t.sql(`select id from pi_deliverables where project_id='${projId}' order by id`);
    t.ok(ints > 0 && dels.length > 0, 'fixture: the project has interactions and deliverables');

    let app = await t.open('index.html', { email: me });
    try {
      await app.ready();
      const page = app.page;
      const openTab = () => page.evaluate(pid => {
        S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports');
      }, projId);

      // ── the tab ──────────────────────────────────────────────────────────
      await openTab();
      let tab = await page.evaluate(() => ({
        text: document.getElementById('main').innerText,
        startBtn: !!Array.from(document.querySelectorAll('#main button')).find(b => /Start final close-out/.test(b.textContent)),
        tabBtn: !!Array.from(document.querySelectorAll('#main button')).find(b => /^Close-Out/.test(b.textContent.trim())),
      }));
      t.ok(tab.tabBtn, 'Reports carries a Close-Out tab');
      t.ok(tab.startBtn, 'with no close-out yet, "Start final close-out" is offered');
      t.ok(/No close-out started for this project yet/.test(tab.text), 'and the empty state says so');
      const facts = await page.evaluate(pid => {
        const f = _closeoutFacts(pid); return { interactions: f.interactions, inboundCalls: f.inboundCalls, dels: f.deliverables.length };
      }, projId);
      t.eq(facts.interactions, ints, 'interaction count is the project\'s real count');
      t.eq(facts.inboundCalls, calls, 'inbound calls = Phone · Incoming interactions');
      t.eq(facts.dels, dels.length, 'every deliverable on the project is listed');
      t.ok(tab.text.includes('Delivery Against Scope of Work'), 'the report outline is shown');

      // ── start the final close-out ────────────────────────────────────────
      await page.evaluate(() => coStart('final'));
      await page.waitForTimeout(300);
      let rows = await t.sql(`select * from pi_closeouts where project_id=${projId}`);
      t.eq(rows.length, 1, 'Start final creates one close-out row');
      t.eq(rows[0].report_type, 'udot-construction', 'of type udot-construction');
      t.eq(rows[0].label, 'Final', 'labelled Final');
      t.eq(rows[0].created_by, me, 'attributed to the signed-in user');
      t.eq(rows[0].intake.sigName, 'Jeff Putzke', 'signature carried from this user\'s last close-out');
      t.eq(rows[0].intake.sigTitle, 'PI Manager', 'title carried too');
      t.eq(rows[0].intake.scmName, undefined, 'but nothing outside the signature block is carried');
      t.eq(rows[0].intake.region, 'Region One', 'region suggested from the county (Cache → Region One)');
      t.ok(/^\d{4}-\d{2}-\d{2}$/.test(rows[0].intake.reportDate || ''), 'report date defaults to today');
      const coId = String(rows[0].id);

      // The intake replaced the view.
      let intake = await page.evaluate(() => ({
        title: document.querySelector('#main .topbar-title')?.textContent || '',
        recipPill: document.getElementById('co-st-recipient')?.textContent || '',
        newsPill: document.getElementById('co-st-news')?.textContent || '',
        sigPill: document.getElementById('co-st-signature')?.textContent || '',
        metricsPill: document.getElementById('co-st-metrics')?.textContent || '',
        reline: document.getElementById('co-reline')?.textContent || '',
      }));
      t.ok(/Close-out intake · Final/.test(intake.title), 'the intake opens straight after starting');
      t.ok(/Needs/.test(intake.recipPill), 'recipient is required and flagged while empty: ' + intake.recipPill);
      t.ok(/Complete/.test(intake.sigPill), 'signature already complete from the carried-forward name');
      t.eq(intake.newsPill, 'Left out of the report', 'an untouched optional section is left out, not failed');
      t.eq(intake.metricsPill, 'Counted by COMPASS', 'metrics need nothing typed');
      t.ok(intake.reline.includes('Logan City 400 North Reconstruction'), 'Re: line previews from the project');

      // ── edits autosave ───────────────────────────────────────────────────
      const type = (sel, val) => page.evaluate(([s, v]) => {
        const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      }, [sel, val]);
      await type('#co-f-scmName', 'Mitch Shaw, Senior Communication Manager');
      await type('#co-f-office', 'UDOT Region One\n169 N Wall Ave\nOgden, UT 84404');
      await type('#co-f-route', 'SR-30');
      intake = await page.evaluate(() => ({
        recipPill: document.getElementById('co-st-recipient').textContent,
        save: document.getElementById('co-save').textContent,
        reline: document.getElementById('co-reline').textContent,
      }));
      t.eq(intake.recipPill, 'Complete', 'filling the required fields clears the flag at once');
      t.eq(intake.save, 'Unsaved changes', 'the save state says an edit is pending');
      t.ok(intake.reline.includes('SR-30; Logan City'), 'the Re: line follows the route field');
      await page.waitForTimeout(1200);
      rows = await t.sql(`select intake, updated_by from pi_closeouts where id=${coId}`);
      t.eq(rows[0].intake.scmName, 'Mitch Shaw, Senior Communication Manager', 'the recipient autosaved');
      t.eq(rows[0].intake.office, 'UDOT Region One\n169 N Wall Ave\nOgden, UT 84404', 'multi-line office address kept intact');
      t.eq(rows[0].updated_by, me, 'the save is attributed');
      t.eq(await page.evaluate(() => document.getElementById('co-save').textContent), 'Saved', 'and the header says Saved');

      // ── repeating rows ───────────────────────────────────────────────────
      await page.evaluate(() => { _coAddRow('news'); _coAddRow('news'); });
      await type('[data-r="news"][data-i="0"][data-c="outlet"]', 'Herald Journal');
      await type('[data-r="news"][data-i="1"][data-c="outlet"]', 'Cache Valley Daily');
      await type('[data-r="news"][data-i="1"][data-c="url"]', 'https://example.test/cvd');
      await page.evaluate(() => _coDelRow('news', 0));
      await page.waitForTimeout(1200);
      rows = await t.sql(`select intake from pi_closeouts where id=${coId}`);
      t.eq((rows[0].intake.news || []).length, 1, 'removing a row removes it from the saved list');
      t.eq(rows[0].intake.news[0].outlet, 'Cache Valley Daily', 'and the surviving row is the right one');
      t.eq(await page.evaluate(() => document.getElementById('co-st-news').textContent), 'Complete', 'a section with a row counts as filled');

      // ── deliverable wording + evidence, keyed by deliverable id ──────────
      const delId = String(dels[0].id);
      const defWording = await page.evaluate(id => document.querySelector(`select[data-d="${id}"]`).value, delId);
      const delStatus = (await t.sql(`select status from pi_deliverables where id=${delId}`))[0].status;
      t.eq(defWording, await page.evaluate(s => _coDefaultWording({ status: s }), delStatus),
        'an untouched row\'s wording follows the deliverable\'s own status');
      t.eq(await page.evaluate(() => _coDefaultWording({ status: 'Not started' })), 'Not delivered',
        'a not-started deliverable never defaults to "Delivered"');
      await type(`input[data-d="${delId}"][data-c="evidence"]`, 'Stakeholder Registry; Interactions Log');
      await page.evaluate(id => { const s = document.querySelector(`select[data-d="${id}"]`); s.value = 'Partially delivered'; s.dispatchEvent(new Event('input', { bubbles: true })); }, delId);
      await page.waitForTimeout(1200);
      rows = await t.sql(`select intake from pi_closeouts where id=${coId}`);
      const saved = rows[0].intake.deliverables[delId] || {};
      t.eq(saved.evidence, 'Stakeholder Registry; Interactions Log', 'evidence saved under the deliverable id');
      t.eq(saved.wording, 'Partially delivered', 'and the chosen wording with it');

      // ── closing returns to the tab; Start final now opens the existing one
      await page.evaluate(() => coCloseIntake());
      await page.waitForTimeout(200);
      tab = await page.evaluate(() => ({
        text: document.getElementById('main').innerText,
        startBtn: !!Array.from(document.querySelectorAll('#main button')).find(b => /Start final close-out/.test(b.textContent)),
      }));
      t.ok(/Final close-out/.test(tab.text) && /To: Mitch Shaw/.test(tab.text), 'the tab lists the close-out with its recipient');
      t.ok(/Required fields complete/.test(tab.text), 'and its required fields as complete');
      t.ok(!tab.startBtn, 'Start final is no longer offered once a Final exists');
      await page.evaluate(() => coStart('final'));
      await page.waitForTimeout(300);
      t.eq((await t.sql(`select count(*)::int n from pi_closeouts where project_id=${projId}`))[0].n, 1,
        'starting a final again opens the existing one, never a second');
      await page.evaluate(() => coCloseIntake());

      // ── interim close-out ────────────────────────────────────────────────
      await page.evaluate(() => { window.prompt = () => 'Year 1'; return coStart('interim'); });
      await page.waitForTimeout(300);
      rows = await t.sql(`select label from pi_closeouts where project_id=${projId} order by id`);
      t.eq(rows.map(r => r.label), ['Final', 'Year 1'], 'an interim close-out sits beside the final');
      await page.evaluate(() => coCloseIntake());
      t.eq(await page.evaluate(pid => _coList(pid).map(c => c.label), projId), ['Final', 'Year 1'], 'Final is listed first');
      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }

    // ── everything survives a full reload ──────────────────────────────────
    app = await t.open('index.html', { email: me });
    try {
      await app.ready();
      const page = app.page;
      const coId = String((await t.sql(`select id from pi_closeouts where project_id=${projId} and label='Final'`))[0].id);
      await page.evaluate(([pid, id]) => { S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports'); openCloseoutIntake(id); }, [projId, coId]);
      const v = await page.evaluate(() => ({
        scm: document.getElementById('co-f-scmName').value,
        office: document.getElementById('co-f-office').value,
        news: document.querySelector('[data-r="news"][data-i="0"][data-c="outlet"]')?.value,
        sig: document.getElementById('co-f-sigName').value,
      }));
      t.eq(v.scm, 'Mitch Shaw, Senior Communication Manager', 'recipient reloads');
      t.eq(v.office, 'UDOT Region One\n169 N Wall Ave\nOgden, UT 84404', 'office address reloads with its line breaks');
      t.eq(v.news, 'Cache Valley Daily', 'news rows reload');
      t.eq(v.sig, 'Jeff Putzke', 'signature reloads');

      // ── delete ───────────────────────────────────────────────────────────
      const interim = String((await t.sql(`select id from pi_closeouts where project_id=${projId} and label='Year 1'`))[0].id);
      await page.evaluate(id => { coCloseIntake(); window.confirm = () => true; return coDelete(id); }, interim);
      await page.waitForTimeout(300);
      t.eq((await t.sql(`select label from pi_closeouts where project_id=${projId}`)).map(r => r.label), ['Final'],
        'delete removes only the chosen close-out');
      t.eq(app.errors, [], 'no page errors after reload');
    } finally {
      await app.close();
    }
  },
};
