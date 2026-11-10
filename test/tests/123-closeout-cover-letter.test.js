// PI Close-Out: ✦ AI Draft for the cover letter, and the project description
// read from the project website saved as a PDF (Nov 2026, Jeff).
// _claudeNarrative is stubbed, so this checks what is SENT and what happens to
// what comes back.
module.exports = {
  name: 'close-out cover letter + Project documents — AI draft from counts, description, praise, contents and the website, newsletters and flyers',
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
    const dnl = String((await t.sql(`insert into pi_deliverables (project_id, deliverable_type, title, status) values ('${projId}', 'Digital newsletter', 'Monthly newsletter', 'Complete') returning id`))[0].id);
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

      // ── the intake: Project documents (website PDF, newsletters, flyers) ──
      await page.evaluate(() => { const co = _syncCache.closeouts.find(c => c.id === _coWork.id); _coWork.intake.projDesc = ''; });
      await page.evaluate(() => { window._claudeNarrative = async (system, user) => { window.__calls.push({ system, user });
        const name = window.__nextName.shift();
        return name === 'site.pdf'
          ? 'KIND: website\nDATE: 2026-03-01\nSUMMARY: The site explained overnight closures of 400 North and a detour on 300 North.\nDESCRIPTION: The project rebuilt the Main Street bridge. It closed one lane.'
          : 'KIND: newsletter\nDATE: 2026-05-15\nSUMMARY: The May newsletter announced the lane shift and how to sign up for text alerts.\nDESCRIPTION: none'; };
        window.__nextName = ['site.pdf', 'may.png']; });
      await page.evaluate(cid => openCloseoutIntake(cid), id);
      t.ok(await page.evaluate(() => !!document.getElementById('co-sec-docs') && document.querySelector('.co-sec').id === 'co-sec-docs'), 'Project documents is the first step of the intake');
      t.ok(await page.evaluate(() => !!document.getElementById('co-f-projDesc') && !!document.getElementById('co-f-letterAttach')), 'the intake still has the project description and attachments boxes');
      await page.setInputFiles('#co-sec-docs input[type=file]', [
        { name: 'site.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 /Type /Page /Type /Page') },
        { name: 'may.png', mimeType: 'image/png', buffer: Buffer.from('png') }]);
      await page.waitForFunction(() => (_coWork.intake.docs || []).length === 2);
      const calls2 = await page.evaluate(() => window.__calls.splice(0));
      t.eq(calls2.length, 2, 'each file is read once');
      t.ok(calls2.some(c => c.user[0].type === 'document' && c.user[0].source.media_type === 'application/pdf') && calls2.some(c => c.user[0].type === 'image'), 'PDFs go as documents, pictures as images');
      const docs = await page.evaluate(() => _coWork.intake.docs.map(d => [d.name, d.kind, d.date]).sort());
      t.eq(JSON.stringify(docs), JSON.stringify([['may.png', 'newsletter', '2026-05-15'], ['site.pdf', 'website', '2026-03-01']]), 'each file becomes a summary with its kind and date');
      t.eq(await page.evaluate(() => _coWork.intake.projDesc), 'The project rebuilt the Main Street bridge. It closed one lane.', 'the website fills an empty Project description');
      await page.evaluate(() => _coSave && _coSave());
      await page.waitForTimeout(400);
      const stored = (await t.sql(`select intake->'docs' d, intake->>'projDesc' p from pi_closeouts where id=$1`, [id]))[0];
      t.ok(stored.d.length === 2 && stored.d.every(d => d.summary && !('data' in d)) && /Main Street bridge/.test(stored.p), 'only the summaries are saved with the intake, never the file');
      // ── the summaries reach the drafts ──
      const lf = await page.evaluate(() => _coLetterRequest(_syncCache.closeouts.find(c => c.id === _coWork.id)).user);
      t.ok(/TOLD THE PUBLIC[^\n]*\n- From the project website \(Mar 1, 2026\): The site explained overnight closures/.test(lf), 'the cover letter request carries the document summaries, oldest first');
      const fe = await page.evaluate(() => _coHighlightFacts(_syncCache.closeouts.find(c => c.id === _coWork.id), 'email').lines.join('\n'));
      t.ok(/From the newsletter \(May 15, 2026\): The May newsletter announced/.test(fe) && !/From the project website/.test(fe), 'the email-updates highlight gets the newsletters only');
      // The summary box spans the card (it drew ~140px wide on LIVE).
      const wide = await page.evaluate(() => { const ta = document.querySelector('#co-sec-docs textarea[aria-label^="Summary of"]'), card = ta.parentElement; return ta.getBoundingClientRect().width / card.getBoundingClientRect().width; });
      t.ok(wide > 0.9, 'the summary box is as wide as its card (' + Math.round(wide * 100) + '%)');
      // ── edit and remove ──
      await page.evaluate(() => { window.confirm = () => true; coDocEdit(0, 'summary', 'Edited summary.'); });
      t.eq(await page.evaluate(() => _coWork.intake.docs[0].summary), 'Edited summary.', 'a summary can be edited');
      await page.evaluate(() => coDocRemove(1));
      t.eq(await page.evaluate(() => _coWork.intake.docs.length), 1, 'a document can be removed');

      // ── more kinds: they fill the intake further down, never over typing ──
      await page.evaluate(pid => {
        const it = _coWork.intake;
        it.praise = ''; it.scopeTitle = ''; it.scopeDate = ''; it.assumptions = '';
        it.concerns = 'Typed by staff: access worries.';
        it.deliverables = {};
        const R = {
          THANKS: 'KIND: thanks\nDATE: 2026-08-01\nTITLE: Thank you note\nOUTLET: none\nSUMMARY: A business owner thanked the team.\nDESCRIPTION: none\nPRAISE: A business owner on 400 North thanked the team for keeping access open.\nCONCERNS: none\nASSUMPTIONS: none',
          SCOPE: 'KIND: scope\nDATE: 2025-04-10\nTITLE: 19739 PI Scope\nOUTLET: none\nSUMMARY: The scope required a hotline, newsletters and weekly reports.\nDESCRIPTION: none\nPRAISE: none\nCONCERNS: none\nASSUMPTIONS: - 18 months of effort\n- Hotline for the life of the project',
          NL: 'KIND: newsletter\nDATE: 2026-06-01\nTITLE: Summer Update\nOUTLET: none\nSUMMARY: The June newsletter covered paving.\nDESCRIPTION: none\nPRAISE: none\nCONCERNS: none\nASSUMPTIONS: none',
          PRESS: 'KIND: press\nDATE: 2026-07-04\nTITLE: 400 North reopens early\nOUTLET: Logan City\nSUMMARY: The city announced the early reopening.\nDESCRIPTION: none\nPRAISE: none\nCONCERNS: none\nASSUMPTIONS: none',
          SUMM: 'KIND: summary\nDATE: 2026-02-01\nTITLE: Open house summary\nOUTLET: none\nSUMMARY: Thirty people attended.\nDESCRIPTION: none\nPRAISE: none\nCONCERNS: - Parking during construction\nASSUMPTIONS: none',
        };
        window._claudeNarrative = async (system, user) => { window.__calls.push({ system, user }); return R[atob(user[0].source.data).split(' ')[0]] || ''; };
      }, projId);
      const pdf = (tag) => Buffer.from(tag + ' %PDF-1.4 /Type /Page');
      await page.setInputFiles('#co-sec-docs input[type=file]', [
        { name: 'thanks.pdf', mimeType: 'application/pdf', buffer: pdf('THANKS') },
        { name: 'scope.pdf', mimeType: 'application/pdf', buffer: pdf('SCOPE') },
        { name: 'nl.pdf', mimeType: 'application/pdf', buffer: pdf('NL') },
        { name: 'press.pdf', mimeType: 'application/pdf', buffer: pdf('PRESS') },
        { name: 'summary.pdf', mimeType: 'application/pdf', buffer: pdf('SUMM') }]);
      await page.waitForFunction(() => (_coWork.intake.docs || []).length === 6);
      const sent = await page.evaluate(() => window.__calls.splice(0));
      t.ok(/PRAISE:/.test(sent[0].user[1].text) && /ASSUMPTIONS:/.test(sent[0].user[1].text) && /never by name/.test(sent[0].system), 'one read per file asks for praise, concerns and scope assumptions too, and keeps private people unnamed');
      const it2 = await page.evaluate(() => JSON.parse(JSON.stringify(_coWork.intake)));
      t.eq(it2.praise, 'A business owner on 400 North thanked the team for keeping access open.', 'a thank-you fills the empty praise box');
      t.eq(it2.concerns, 'Typed by staff: access worries.', 'a box staff typed in is never overwritten');
      t.ok(it2.scopeTitle === '19739 PI Scope' && it2.scopeDate === '2025-04-10' && it2.assumptions === '18 months of effort\nHotline for the life of the project', 'the scope of work fills the scope document, its date and what it assumed');
      t.eq((it2.deliverables[dnl] || {}).evidence, 'Newsletter: Summer Update (Jun 1, 2026)', 'a newsletter becomes the evidence on the newsletter deliverable');
      t.ok(await page.evaluate(() => /Filled in: Notable outcomes/.test(document.getElementById('co-sec-docs').textContent)), 'the document says what it filled in');
      // A second newsletter updates the evidence it filled; a typed one stays.
      await page.evaluate(() => { _coWork.intake.docs.push({ id: 'x2', name: 'jul.pdf', kind: 'newsletter', date: '2026-07-01', title: 'July Update', summary: 'Paving done.' }); _coDocFill(_coWork.intake); });
      t.eq(await page.evaluate(d => _coWork.intake.deliverables[d].evidence, dnl), 'Newsletters: Summer Update (Jun 1, 2026); July Update (Jul 1, 2026)', 'evidence it filled is updated by a later document');
      await page.evaluate(d => { _coWork.intake.deliverables[d].evidence = 'Typed evidence'; _coWork.intake.docs.pop(); _coDocFill(_coWork.intake); }, dnl);
      t.eq(await page.evaluate(d => _coWork.intake.deliverables[d].evidence, dnl), 'Typed evidence', 'evidence staff typed stays when a document is removed');
      // Removing the thank-you takes back the praise it filled.
      await page.evaluate(() => { window.confirm = () => true; coDocRemove(_coWork.intake.docs.findIndex(d => d.kind === 'thanks')); });
      t.eq(await page.evaluate(() => _coWork.intake.praise), '', 'removing the document clears what it filled (and only that)');
      // The facts reach the drafts.
      const fc = await page.evaluate(() => _coHighlightFacts(_syncCache.closeouts.find(c => c.id === _coWork.id), 'concerns').lines.join('\n'));
      t.ok(/From the survey or meeting summary \(Feb 1, 2026\) "Open house summary": Thirty people attended/.test(fc), 'a meeting summary reaches the concerns highlight');
      // Add to Outreach log: prefilled, and once saved it reads as logged.
      const pi = await page.evaluate(() => _coWork.intake.docs.findIndex(d => d.kind === 'press'));
      t.ok(await page.evaluate(i => !!document.querySelector('[data-doc-ol="' + i + '"]'), pi), 'a press release offers Add to Outreach log');
      await page.evaluate(i => coDocToOutreach(i), pi);
      const form = await page.evaluate(() => ['f-out-proj', 'f-out-type', 'f-out-date', 'f-out-title', 'f-out-outlet'].map(x => document.getElementById(x).value));
      t.eq(JSON.stringify(form), JSON.stringify([projId, 'Press release', '2026-07-04', '400 North reopens early', 'Logan City']), 'the Outreach dialog opens prefilled with project, type, date, title and outlet');
      await page.evaluate(() => saveOutreach());
      await page.waitForFunction(() => (DB.get('outreach_actions') || []).some(a => a.title === '400 North reopens early' && !/^tmp_/.test(String(a.id))));
      await page.evaluate(() => render());
      t.ok(await page.evaluate(() => /✓ In the Outreach log/.test(document.getElementById('co-sec-docs').textContent)), 'once logged, the document reads "In the Outreach log"');
      // ── a web address instead of a file ──
      await page.evaluate(() => {
        window.__lr = [];
        window._outReadLink = async (url, extra) => { window.__lr.push({ url, extra });
          if (/thin/.test(url)) return { ok: true, thin: true, text: 'x', notes: ['The page shows little readable text. Save it as a PDF and add the file instead.'] };
          return { ok: true, url, finalUrl: url, text: 'The I-84 Weber Bridges project replaces four bridges.', fields: { title: 'I-84 Weber Bridges', site: 'UDOT', published: '2026-03-02T00:00:00Z' } }; };
        window._claudeNarrative = async (system, user) => { window.__calls.push({ system, user });
          return 'KIND: website\nDATE: unknown\nTITLE: I-84 Weber Bridges\nOUTLET: UDOT\nSUMMARY: The page explains the bridge work and closures.\nDESCRIPTION: The project replaces four bridges.\nPRAISE: none\nCONCERNS: none\nASSUMPTIONS: none'; };
      });
      const before = await page.evaluate(() => _coWork.intake.docs.length);
      await page.fill('#co-doc-url', 'https://www.udot.utah.gov/thin');
      await page.evaluate(() => coAddDocUrl());
      t.eq(await page.evaluate(() => _coWork.intake.docs.length), before, 'a page with little text is not read; nothing is added');
      t.eq((await page.evaluate(() => window.__calls.splice(0))).length, 0, 'and nothing is sent to the model');
      await page.fill('#co-doc-url', 'https://www.udot.utah.gov/i84');
      await page.evaluate(() => coAddDocUrl());
      await page.waitForFunction(n => _coWork.intake.docs.length === n + 1, before);
      const lr = await page.evaluate(() => window.__lr.slice(-1)[0]);
      t.ok(lr.extra && lr.extra.text === true, 'the link reader is asked for the page text');
      const wc = await page.evaluate(() => window.__calls.splice(0));
      t.ok(wc.length === 1 && wc[0].user[0].type === 'text' && /replaces four bridges/.test(wc[0].user[0].text), 'the page text is read once, like a file');
      const wd = await page.evaluate(() => _coWork.intake.docs.slice(-1)[0]);
      t.ok(wd.url === 'https://www.udot.utah.gov/i84' && wd.date === '2026-03-02' && wd.kind === 'website' && !('text' in wd), 'the address and summary are kept (with the page\'s published date), not the page text');
      t.ok(await page.evaluate(() => /Read from <a[^>]*>udot\.utah\.gov\/i84/.test(document.getElementById('co-sec-docs').innerHTML)), 'the card links to the page it was read from');
      t.ok(await page.evaluate(() => /Add what Cirrus Cc can.t see on its own/.test(document.getElementById('co-sec-docs').textContent) && !/Claude/.test(document.getElementById('co-sec-docs').textContent)), 'the note to users names Cirrus Cc, not Claude');
    } finally { await app.close(); }
  },
};
