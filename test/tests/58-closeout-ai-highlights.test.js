// PI Close-Out, step 4: AI drafting for the PI Highlights.
//
// _claudeNarrative is stubbed (same technique as 34-draft-all-parity), so this
// checks what is SENT and what happens to what comes back, without a key:
//   - facts are computed in code from COMPASS and the intake, and the counts in
//     them are the database's counts;
//   - web and email addresses are never handed to the model (they print as
//     links under the paragraph; a model that has them tends to repeat them);
//   - whatever is typed in a heading's box goes along as authoritative NOTES;
//   - a heading with no facts and no notes is refused, never drafted from empty;
//   - "Draft all" drafts only EMPTY headings with facts and sends exactly what
//     each heading's own button sends;
//   - a failed call leaves the box as it was.
module.exports = {
  name: 'close-out AI highlights — computed facts, notes, refusal, draft-all parity',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-LC-400N'`))[0];
    const projId = String(proj.id);
    const intake = {
      route: 'SR-30', websiteUrl: 'https://publicinput.com/logan400n', projectEmail: 'logan400n@demo.test', hotline: '801-555-0199',
      visits: [{ when: 'Jun 2025', visits: '400' }, { when: 'Oct 2026', visits: '1,240' }],
      subsStart: '138', subsEnd: '412', nlCount: '5',
      editions: [{ sent: 'Dec 19, 2025', title: 'Winter Suspension', url: 'https://example.test/nl' }],
      news: [{ outlet: 'Herald Journal', topic: 'nighttime closures announced', url: 'https://example.test/hj' }],
      concerns: 'Ellis Elementary parents worried about the school-zone crossing.',
      praise: 'A business owner thanked the team for keeping access open.',
      draft: { 'hl-traffic': 'UDOT traffic app alert posted three weeks before the full closure.' },
    };
    const id = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by)
      values (${projId}, 'Final', $1::jsonb, 'putzke@demo.test') returning id`, [JSON.stringify(intake)]))[0].id);
    const inbound = (await t.sql(`select count(*)::int n from pi_interactions where project_id='${projId}' and coalesce(direction,'') <> 'Outgoing'`))[0].n;
    const outbound = (await t.sql(`select count(*)::int n from pi_interactions where project_id='${projId}' and direction = 'Outgoing'`))[0].n;
    const issues = (await t.sql(`select count(*)::int n from pi_issues where project_id='${projId}'`))[0].n;

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const page = app.page;
      await page.evaluate(([pid, cid]) => {
        window.__calls = []; window.__reply = 'ok';
        window._claudeNarrative = async (system, user, maxTokens, model) => {
          window.__calls.push({ system, user, maxTokens, model });
          if (window.__reply === null) return null;
          const h = (user.match(/^Section heading[^:]*: (.+)$/m) || [])[1];
          return h + ': Our team drafted this.\n\nSecond paragraph.';
        };
        S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports'); openCloseoutReport(cid);
      }, [projId, id]);
      const calls = () => page.evaluate(() => window.__calls.splice(0));
      const facts = hid => page.evaluate(h => _coHighlightFacts(_syncCache.closeouts.find(c => c.id === _coWork.id), h), hid);

      // ── facts are computed, and are the database's numbers ──────────────
      const fc = await facts('concerns');
      t.ok(fc.lines.includes('Inbound and in-person contacts logged: ' + inbound + '.'), 'inbound count matches the database');
      t.ok(fc.lines.some(l => l.startsWith(issues ? 'Issues escalated to the project team: ' + issues : 'No issues were escalated')), 'issue escalation stated from the record');
      t.ok(fc.lines.some(l => /^By nature: /.test(l)), 'inbound contacts broken down by nature');
      t.ok(fc.lines.includes('Concern of note (from the PI team): Ellis Elementary parents worried about the school-zone crossing.'), 'intake concerns pointers included');
      t.ok(fc.lines.includes('Outcome or praise (from the PI team): A business owner thanked the team for keeping access open.'), 'intake praise included');
      const fo = await facts('outreach');
      t.ok(fo.lines.some(l => l.startsWith('Outbound contacts logged by the PI team: ' + outbound + ' ')), 'outbound count matches the database');
      t.ok(fo.lines.includes('News coverage — Herald Journal: nighttime closures announced.'), 'news coverage from the intake, by outlet and topic');
      const fw = await facts('website');
      t.ok(fw.lines.includes('Project hotline: 801-555-0199.'), 'the hotline number is a fact (it prints nowhere else)');
      t.ok(fw.lines.includes('Cumulative unique website visits: 400 (Jun 2025), then 1,240 (Oct 2026).'), 'website readings in order');
      const all = JSON.stringify([fc, fo, fw, await facts('email'), await facts('social'), await facts('coord')]);
      t.ok(!/publicinput\.com|logan400n@|example\.test/.test(all), 'no web or email address is ever handed to the model');
      const fe = await facts('email');
      t.ok(fe.lines.includes('Email update editions sent: 5.') && fe.lines.includes('Subscribers at completion: 412.'), 'email facts from the intake');

      // ── one heading ─────────────────────────────────────────────────────
      await page.evaluate(() => coDraftHighlight('outreach'));
      let c = await calls();
      t.eq(c.length, 1, 'one API call for one heading');
      t.ok(/first-person plural/.test(c[0].system) && /Never invent a number/.test(c[0].system), 'the close-out voice and no-invention rule are in the system prompt');
      t.ok(/Do not write web addresses or email addresses/.test(c[0].system), 'and the no-addresses rule');
      t.ok(/about 180 words/.test(c[0].user) && /FACTS FROM THE PROJECT RECORD/.test(c[0].user), 'task, length and facts are in the request');
      t.eq(c[0].maxTokens, Math.round(220 * 2.2) + 60, 'token budget follows the heading’s word ceiling');
      t.eq(c[0].model, undefined, 'default model (Sonnet), same as every other report narrative');
      const outreachText = await page.evaluate(() => document.getElementById('co-dr-hl-outreach').value);
      t.eq(outreachText, 'Our team drafted this.\nSecond paragraph.', 'a repeated heading is stripped; paragraphs become lines');
      await page.waitForTimeout(400);
      t.ok(await page.evaluate(() => document.getElementById('co-preview').innerText.includes('Our team drafted this.')), 'the preview shows the draft');

      // ── notes typed in the box are authoritative ────────────────────────
      await page.evaluate(() => { window.confirm = () => false; return coDraftHighlight('traffic'); });
      t.eq((await calls()).length, 0, 'declining the rewrite makes no call');
      await page.evaluate(() => { window.confirm = () => true; return coDraftHighlight('traffic'); });
      c = await calls();
      t.ok(c.length === 1 && /NOTES FROM THE PI TEAM \(authoritative; include every point\):\n- UDOT traffic app alert posted three weeks before the full closure\./.test(c[0].user),
        'the box’s text goes to the model as notes to keep');

      // ── refusal: nothing recorded, nothing typed ────────────────────────
      t.eq((await facts('social')).lines.length, 0, 'fixture: no social posts in the intake');
      await page.evaluate(() => coDraftHighlight('social'));
      t.eq((await calls()).length, 0, 'a heading with no facts and no notes makes no call');

      // ── a failed call leaves the box alone ──────────────────────────────
      await page.evaluate(() => { window.__reply = null; window.confirm = () => true; return coDraftHighlight('outreach'); });
      await calls();
      t.eq(await page.evaluate(() => document.getElementById('co-dr-hl-outreach').value), outreachText, 'an API failure leaves the existing text untouched');
      await page.evaluate(() => { window.__reply = 'ok'; });

      // ── draft all: empty headings with facts only, same request as the button ──
      await page.evaluate(() => { window.confirm = () => false; return coDraftAllHighlights(); });
      t.eq((await calls()).length, 0, 'declining Draft all makes no calls');
      // What the website heading's own button would send right now, before Draft all fills it.
      const single = await page.evaluate(() => _coHighlightRequest(_syncCache.closeouts.find(c => c.id === _coWork.id), 'website'));
      await page.evaluate(() => { window.confirm = () => true; return coDraftAllHighlights(); });
      c = await calls();
      const drafted = c.map(x => (x.user.match(/^Section heading[^:]*: (.+)$/m) || [])[1]);
      t.ok(drafted.includes('Project Dedicated Website | Dedicated Project Phone Hotline/Email') && drafted.includes('Email Construction Updates to Public Subscribers')
        && drafted.includes('Inbound public complaints/concerns'), 'empty headings with facts are drafted');
      t.ok(!drafted.includes('Early public outreach & project advertising summary') && !drafted.includes('Traffic control notifications to public'),
        'headings that already have text are left alone');
      t.ok(!drafted.includes('UDOT and External Social Media Broadcasting'), 'a heading with nothing recorded is skipped');
      const bulk = c.find(x => /Project Dedicated Website/.test(x.user));
      t.eq([bulk.system, bulk.user, bulk.maxTokens], [single.system, single.user, single.maxTokens], 'Draft all sends exactly what the heading’s own button sends');

      await page.waitForTimeout(1200);
      const saved = (await t.sql(`select intake->'draft' d from pi_closeouts where id=${id}`))[0].d;
      t.eq(saved['hl-website'], 'Our team drafted this.\nSecond paragraph.', 'drafts autosave into intake.draft');
      t.eq(saved['hl-traffic'], 'Our team drafted this.\nSecond paragraph.', 'including the one drafted from notes');
      t.eq(app.errors, [], 'no page errors');
    } finally {
      await app.close();
    }
  },
};
