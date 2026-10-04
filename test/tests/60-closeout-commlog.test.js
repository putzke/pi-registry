// PI Close-Out, step 5: the Stakeholder Communications Log Summary.
//
// The Messages API is intercepted at the network layer (as in 59), so this
// checks what is actually SENT for the one long synthesis in the app:
//   - every count is computed by COMPASS and matches the database; the log is
//     sent to be read, labelled "do not count";
//   - nobody is identified by personal name: each line names WHO by
//     organization and type, anonymous contacts as "Member of the public";
//   - long summaries are trimmed so a big project's log stays affordable;
//   - the section's own AI Draft runs at medium effort with room to think;
//   - "Compare models" sends the identical request to Sonnet 5.5 and Opus 5.5,
//     shows both, and nothing changes until one is picked;
//   - a project with nothing logged is refused, never drafted from empty.
module.exports = {
  name: 'close-out comm log summary — computed counts, no personal names, compare models',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-LC-400N'`))[0];
    const projId = String(proj.id);
    const total = (await t.sql(`select count(*)::int n from pi_interactions where project_id='${projId}'`))[0].n;
    const outbound = (await t.sql(`select count(*)::int n from pi_interactions where project_id='${projId}' and direction='Outgoing'`))[0].n;
    const issues = (await t.sql(`select count(*)::int n from pi_issues where project_id='${projId}'`))[0].n;
    // A very long summary, to check trimming.
    const longSum = 'Detailed call. '.repeat(60);
    await t.sql(`insert into pi_interactions (project_id, interaction_date, channel, direction, subject, nature, summary)
                 values ('${projId}', '2026-05-05', 'Phone', 'Incoming', 'Traffic', 'Concern', $1)`, [longSum]);
    const people = await t.sql(`select s.first_name||' '||s.last_name nm from pi_stakeholders s
      join pi_project_stakeholders l on l.stakeholder_id = s.id::text where l.project_id='${projId}' and coalesce(s.first_name,'') <> ''`);
    const id = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by)
      values (${projId}, 'Final', '{"draft":{"commlog":"Weekly walk-and-talks with Main Street businesses."},"praise":"Owners thanked the team for access planning."}'::jsonb, 'putzke@demo.test') returning id`))[0].id);
    const empty = String((await t.sql(`insert into pi_projects (pid, name, status) values ('EMPTY-1','Nothing logged','Active') returning id`))[0].id);
    const emptyCo = String((await t.sql(`insert into pi_closeouts (project_id, label, intake) values (${empty}, 'Final', '{}'::jsonb) returning id`))[0].id);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const page = app.page;
      const sent = [];
      await page.route('**/api.anthropic.com/**', async route => {
        const body = JSON.parse(route.request().postData() || '{}');
        sent.push(body);
        const who = body.model === 'claude-opus-5-5' ? 'Opus' : 'Sonnet';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Stakeholder Communications Log Summary: ' + who + ' paragraph one.\n\n' + who + ' paragraph two.' }] }) });
      });
      await page.evaluate(([pid, cid]) => {
        _setClaudeKey('sk-ant-test');
        S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports'); openCloseoutReport(cid);
      }, [projId, id]);

      // ── the facts ───────────────────────────────────────────────────────
      const fx = await page.evaluate(() => _coCommlogFacts(_syncCache.closeouts.find(c => c.id === _coWork.id)));
      t.eq(fx.n, total + 1, 'every logged interaction is included');
      t.ok(fx.counts.includes('Total logged contacts: ' + (total + 1) + '.'), 'total count is the database’s');
      t.ok(fx.counts.some(c => c.startsWith('Outbound (the team reaching out): ' + outbound + '; inbound or in-person: ' + (total + 1 - outbound) + '.')),
        'outbound / inbound split is the database’s');
      t.ok(fx.issues[0].startsWith(issues ? 'Issues escalated to the project team: ' + issues : 'No issues were escalated'), 'issues stated from the record');
      t.ok(fx.counts.some(c => /^Span: .+ \(about \d+ months?\)\.$/.test(c)), 'the span is given in words, with months');
      t.ok(fx.log.every((l, i, a) => i === 0 || a[i - 1].date <= l.date), 'the log is oldest first');
      t.ok(fx.log.some(l => l.who === 'Member of the public'), 'anonymous contacts read as Member of the public');
      t.ok(fx.log.some(l => /^[A-Z][\w /-]+: .+/.test(l.who)), 'organisations read as "Type: Organisation"');
      const whoNames = people.map(p => p.nm).filter(nm => fx.log.some(l => l.who.includes(nm)));
      t.eq(whoNames, [], 'no stakeholder’s personal name is ever used to say who a contact was');
      const longLine = fx.log.find(l => l.line.includes('Detailed call.'));
      t.ok(longLine && /…/.test(longLine.line) && longLine.line.length < 420, 'a long summary is trimmed');
      t.ok(fx.notes.includes('Weekly walk-and-talks with Main Street businesses.') && fx.notes.includes('Outcome or praise: Owners thanked the team for access planning.'),
        'the box text and the intake pointers go along as notes');

      // ── AI Draft ────────────────────────────────────────────────────────
      await page.evaluate(() => { window.confirm = () => false; return coDraftCommlog(); });
      t.eq(sent.length, 0, 'declining the confirm sends nothing');
      let asked = '';
      await page.evaluate(() => { window.confirm = m => { window.__asked = m; return true; }; return coDraftCommlog(); });
      asked = await page.evaluate(() => window.__asked);
      t.ok(/from all \d+ logged interactions/.test(asked) && /Estimated cost: about \$\d+\.\d\d/.test(asked), 'the confirm names the count and an estimated cost');
      t.eq(sent.length, 1, 'one call');
      const b = sent[0];
      t.eq(b.model, 'claude-sonnet-5-5', 'the section drafts on Sonnet 5.5 (CLAUDE_COMMLOG_MODEL)');
      t.eq(b.output_config, { effort: 'medium' }, 'at medium effort — the one long synthesis');
      t.eq(b.max_tokens, Math.round(450 * 1.6) + 100 + 4000, 'with medium-effort thinking room on top of the reply length');
      const u = b.messages[0].content;
      t.ok(/COUNTS \(authoritative; use exactly\)/.test(u) && /Do not count from it/.test(u), 'counts are authoritative and the log is marked read-only');
      t.ok(/never by name, and never give a phone number or email address/.test(u), 'the privacy rule is in the task');
      t.ok(!whoNames.length && u.includes('INTERACTION LOG'), 'the log is sent');
      await page.waitForTimeout(400);
      t.eq(await page.evaluate(() => document.getElementById('co-dr-commlog').value), 'Sonnet paragraph one.\nSonnet paragraph two.',
        'the heading is stripped and paragraphs become lines in the box');
      t.ok(await page.evaluate(() => document.getElementById('co-preview').innerText.includes('Sonnet paragraph two.')), 'and the preview shows it');

      // ── Compare models ──────────────────────────────────────────────────
      sent.length = 0;
      await page.evaluate(() => { window.confirm = () => true; return coCompareCommlog(); });
      t.eq(sent.map(x => x.model).sort(), ['claude-opus-5-5', 'claude-sonnet-5-5'], 'one call to each model');
      t.eq(sent[0].messages[0].content, sent[1].messages[0].content, 'with the identical request');
      t.ok(sent.every(x => x.output_config.effort === 'medium' && x.fallbacks === 'default'), 'both at medium effort, both with fallback');
      const modal = await page.evaluate(() => ({ cols: document.querySelectorAll('.co-cmp-text').length, text: document.getElementById('modal-ov').innerText }));
      t.eq(modal.cols, 2, 'both drafts shown side by side');
      t.ok(/Claude Sonnet 5\.5/.test(modal.text) && /Claude Opus 5\.5/.test(modal.text) && /\d+ words/.test(modal.text), 'labelled by model, with word counts');
      t.eq(await page.evaluate(() => document.getElementById('co-dr-commlog').value), 'Sonnet paragraph one.\nSonnet paragraph two.', 'nothing changes until one is picked');
      await page.evaluate(() => { const i = _coCompareResults.findIndex(x => /^Opus/.test(x)); coPickCommlog(i); });
      t.eq(await page.evaluate(() => document.getElementById('co-dr-commlog').value), 'Opus paragraph one.\nOpus paragraph two.', 'picking a draft puts it in the box');
      await page.waitForTimeout(1200);
      t.eq((await t.sql(`select intake->'draft'->>'commlog' c from pi_closeouts where id=${id}`))[0].c, 'Opus paragraph one.\nOpus paragraph two.', 'and it autosaves');

      // ── no API key → one clear message, before any confirm or window ────
      // (Seen live: the compare window opened with two empty "No draft
      // returned" boxes, and the reason only showed up as a toast after.)
      sent.length = 0;
      const nokey = await page.evaluate(async () => {
        if (typeof closeM === 'function') closeM();
        _setClaudeKey('');
        const t = []; const keep = window.showToast; window.showToast = m => t.push(m);
        let asked = 0; window.confirm = () => { asked++; return true; };
        await coCompareCommlog(); await coDraftCommlog(); await coDraftHighlight('outreach'); await coDraftAllHighlights();
        window.showToast = keep; _setClaudeKey('sk-ant-test');
        return { t, asked, open: document.getElementById('modal-ov').classList.contains('open') };
      });
      t.eq(sent.length, 0, 'no API key: no call is made');
      t.eq(nokey.asked, 0, 'no API key: no cost confirmation is asked first');
      t.eq(nokey.open, false, 'no API key: the compare window does not open');
      t.ok(nokey.t.length === 4 && nokey.t.every(m => /Settings → Claude AI Narrative Generation/.test(m)), 'each button says where to add the key: ' + JSON.stringify(nokey.t[0]));

      // ── nothing logged → refused ────────────────────────────────────────
      sent.length = 0;
      await page.evaluate(async ([pid, cid]) => {
        cacheClear('closeouts'); _syncCache.closeouts = await sbGet('closeouts');
        S.projectFilter = pid; openCloseoutReport(cid);
        window.__t = []; window.showToast = m => window.__t.push(m);
        window.confirm = () => true;
        await coDraftCommlog(); await coCompareCommlog();
      }, [empty, emptyCo]);
      t.eq(sent.length, 0, 'a project with nothing logged makes no call');
      t.ok((await page.evaluate(() => window.__t)).every(m => /No interactions are logged/.test(m)), 'and says why');
      t.eq(app.errors, [], 'no page errors');
    } finally {
      await app.close();
    }
  },
};
