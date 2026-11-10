// PI Close-Out: ✦ AI Draft for the cover letter, and the project description
// read from the project website saved as a PDF (Nov 2026, Jeff).
// _claudeNarrative is stubbed, so this checks what is SENT and what happens to
// what comes back.
module.exports = {
  name: 'close-out cover letter — AI draft from counts, description, praise and contents; description from a PDF',
  async run({ t }) {
    t.seed();
    const projId = String((await t.sql(`select id from pi_projects where pid='25-LC-400N'`))[0].id);
    const intake = {
      route: 'SR-30', region: 'Region One', scmName: 'Mitch Shaw, Senior Communication Manager',
      projDesc: 'The project rebuilt 400 North with new curb, gutter and a center turn lane, which required overnight closures.',
      praise: 'Business owners praised the text-message updates.',
      concerns: 'A few businesses worried about customer access.',
      letterAttach: 'the stakeholder registry, weekly PI reports and newsletters',
      draft: { 'hl-concerns': 'Our team answered every concern within a day.', letter: 'Mention the early reopening.' },
    };
    const id = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by)
      values (${projId}, 'Final', $1::jsonb, 'putzke@demo.test') returning id`, [JSON.stringify(intake)]))[0].id);
    const inbound = (await t.sql(`select count(*)::int n from pi_interactions where project_id='${projId}' and coalesce(direction,'') <> 'Outgoing'`))[0].n;
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const page = app.page;
      await page.evaluate(([pid, cid]) => {
        window.__calls = [];
        _setClaudeKey('sk-ant-test');
        window._claudeNarrative = async (system, user, maxTokens) => {
          window.__calls.push({ system, user, maxTokens });
          if (Array.isArray(user)) return 'The project rebuilt the Main Street bridge.\nIt closed one lane.';
          return 'Dear Mr. Shaw,\n\nWe are grateful for the opportunity.\n\nThe public responded well.\n\nThe following pages summarize it.\n\nBest regards,\nJeff';
        };
        window.confirm = () => true;
        S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports'); openCloseoutReport(cid);
      }, [projId, id]);

      t.ok(await page.evaluate(() => !!document.querySelector('button[onclick^="coDraftLetter"]')), 'the Letter body box has an ✦ AI Draft button');
      await page.evaluate(() => coDraftLetter(document.querySelector('button[onclick^="coDraftLetter"]')));
      const [c] = await page.evaluate(() => window.__calls.splice(0));
      t.ok(c && /cover letter/.test(c.system) && /Three paragraphs/.test(c.user), 'one call, asking for the three-paragraph letter body');
      t.ok(c.user.includes('Inbound and in-person contacts from the public: ' + inbound + '.'), 'counts come from the database');
      t.ok(c.user.includes(intake.projDesc) && c.user.includes(intake.praise) && c.user.includes(intake.concerns), 'project description, praise and concerns from the intake are sent');
      t.ok(c.user.includes('ATTACHMENTS THAT FOLLOW THE REPORT (from the PI team): ' + intake.letterAttach), 'the attachments line is sent');
      t.ok(/WHAT THE FOLLOWING PAGES CONTAIN: [^\n]*PI highlights/.test(c.user), 'what the report contains is listed');
      t.ok(c.user.includes('Our team answered every concern within a day.'), 'the PI Highlights already written are passed for consistency');
      t.ok(c.user.includes('Mention the early reopening.'), 'what was already in the letter box goes along as notes');
      t.ok(!/Mitch Shaw/.test(c.user.split('FACTS FROM THE PROJECT RECORD')[1] || ''), 'no personal name in the facts block');
      const box = await page.evaluate(() => document.getElementById('co-dr-letter').value);
      t.eq(box.split('\n').length, 3, 'three paragraphs land in the box, one per line');
      t.ok(!/Dear|Best regards/.test(box), 'a repeated salutation or sign-off is taken off');
      await page.waitForFunction(() => /We are grateful/.test(document.getElementById('co-preview').textContent));
      const pv = await page.evaluate(() => document.getElementById('co-preview').textContent);
      t.ok(pv.includes('We are grateful for the opportunity.') && !/\[Cover letter:/.test(pv), 'the preview shows the letter instead of the placeholder');

      // ── no key → one message, no call ──
      await page.evaluate(() => { localStorage.removeItem('compass_claude_api_key_v2'); });
      await page.evaluate(() => coDraftLetter(null));
      t.eq((await page.evaluate(() => window.__calls.splice(0))).length, 0, 'without an API key nothing is sent');
      await page.evaluate(() => _setClaudeKey('sk-ant-test'));

      // ── the intake: description box + fill from a PDF ──
      await page.evaluate(cid => openCloseoutIntake(cid), id);
      t.ok(await page.evaluate(() => !!document.getElementById('co-f-projDesc') && !!document.getElementById('co-f-letterAttach')), 'the intake has the project description and attachments boxes');
      await page.setInputFiles('#co-sec-narrative input[type=file]', { name: 'website.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
      await page.waitForFunction(() => /Main Street bridge/.test(document.getElementById('co-f-projDesc').value));
      const [d] = await page.evaluate(() => window.__calls.splice(0));
      t.ok(Array.isArray(d.user) && d.user[0].type === 'document' && d.user[0].source.media_type === 'application/pdf', 'the PDF is sent to Claude as a document');
      t.eq(await page.evaluate(() => document.getElementById('co-f-projDesc').value), 'The project rebuilt the Main Street bridge. It closed one lane.', 'the description fills the box, as one paragraph');
      await page.evaluate(() => _coSave && _coSave());
      await page.waitForTimeout(400);
      const stored = (await t.sql(`select intake->>'projDesc' d from pi_closeouts where id=$1`, [id]))[0].d;
      t.eq(stored, 'The project rebuilt the Main Street bridge. It closed one lane.', 'only the text is saved with the intake');
    } finally { await app.close(); }
  },
};
